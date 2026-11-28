// Internal-only industry minute settlement. Invoked by the bounded School recovery scheduler.
// No call creation, retry or provider-money reconciliation. Capacity release
// is a separate internal operation and is not called by the CDR adapter.
import {sha256hex} from './core.mjs';
import {SCHOOL_VOICE_MODE} from './industry-school-voice-plan.mjs';
import {readVerifiedPlivoCdr} from './plivo-verified-cdr.mjs';
import {closeMinuteHold} from './minute-holds.mjs';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const requestId=x=>typeof x==='string'&&/^[a-zA-Z0-9-]{8,80}$/.test(x);
const terminal=new Set(['completed','declined','ended','needs_review']);
const denied=state=>({state,clientCreditsDebited:false,capacityReleased:false});
const iso=n=>new Date(n).toISOString();
const fields=['sessionId','requestId','callUuid','accountSid','caller','destination','hangupAt','maxSeconds','leadId','manifestSha256'];
const same=(a,b)=>!!a&&!!b&&fields.every(k=>a[k]===b[k]);

// Billing uses historical, immutable recipient clearance, not current consent.
// Suppression, suspension, archived campaigns and missing R2 audio must stop
// new calls, but cannot erase already incurred, identity-verified minutes.
async function readTerminal(env,tid,id,now){
 const j=await env.CRM_DB.prepare("SELECT j.lead_id,j.campaign_id,j.snapshot_id,j.graph_sha256,j.manifest_sha256,j.review_revision,j.review_expires_at,v.destination,v.lead_updated_at,a.max_seconds,a.finished_at,a.expires_at FROM industry_call_jobs j JOIN industry_funded_admissions a ON a.tenant_id=j.tenant_id AND a.job_id=j.id JOIN industry_recipient_reviews v ON v.tenant_id=j.tenant_id AND v.campaign_id=j.campaign_id AND v.lead_id=j.lead_id AND v.revision=j.review_revision WHERE j.tenant_id=? AND j.id=? AND j.state='prepared' AND j.purpose='school_admission' AND a.state='funded' AND a.lead_id=j.lead_id AND a.manifest_sha256=j.manifest_sha256 AND v.decision='cleared' AND v.expires_at=j.review_expires_at AND NOT EXISTS(SELECT 1 FROM calling_jobs p WHERE p.id=j.id)")
  .bind(tid,id).first();
 if(!j||!digest(j.manifest_sha256)||![90,120,150,180].includes(j.max_seconds))return null;
 const s=await env.CONTROL_DB.prepare("SELECT p.*,h.state AS hold_state,h.reserved_seconds AS hold_seconds FROM scripted_phone_pilots p JOIN tenants t ON t.id=p.tenant_id JOIN tenant_minute_holds h ON h.tenant_id=p.tenant_id AND h.job_id=p.job_id JOIN provider_cost_reservations c ON c.tenant_id=h.tenant_id AND c.job_id=h.job_id WHERE p.tenant_id=? AND p.job_id=? AND p.rate_slot IS NULL AND t.storage_mode='shared' AND t.status IN('active','trial','suspended') AND h.state IN('held','settled') AND h.reserved_seconds=c.reserved_seconds")
  .bind(tid,id).first();
 if(!s||s.hold_seconds!==j.max_seconds||s.lead_id!==j.lead_id||s.destination!==j.destination||s.lead_updated_at!==j.lead_updated_at||
    !uuid(s.id)||!uuid(s.provider_call_id)||!requestId(s.provider_request_id)||!terminal.has(s.phase)||
    !Number.isSafeInteger(s.hangup_at)||s.hangup_at>now-60000||
    !Number.isSafeInteger(s.expires_at)||s.hangup_at>s.expires_at+86400000||
    !['hi','en'].includes(s.language))return null;
 const created=Date.parse(s.created_at),funded=Date.parse(j.finished_at),expiry=Date.parse(j.expires_at);
 if(![created,funded,expiry].every(Number.isFinite)||created<funded||created>=expiry||s.hangup_at<created||s.expires_at<=created)return null;
 let d;try{d=JSON.parse(s.survey_json)}catch{return null}
 const v=d?.industryVoice,m=d?.phoneMeta;
 if(m?.mode!==SCHOOL_VOICE_MODE||m.engine!=='sarvam'||m.costMeterVersion!==1||
    v?.version!==1||v.language!==s.language||v.campaignId!==j.campaign_id||v.snapshotId!==j.snapshot_id||
    v.graphSha256!==j.graph_sha256||v.manifestSha256!==j.manifest_sha256||
    v.reviewRevision!==j.review_revision||v.reviewExpiresAt!==j.review_expires_at||
    v.manifest?.tenantId!==tid||v.manifest.snapshotId!==j.snapshot_id||v.manifest.graphSha256!==j.graph_sha256||
    await sha256hex('ar3d:industry-audio-pack:v1:'+JSON.stringify(v.manifest))!==j.manifest_sha256)return null;
 if(m.dispatchVersion===1&&!await env.CRM_DB.prepare("SELECT 1 AS ok FROM industry_dispatch_releases WHERE tenant_id=? AND job_id=? AND session_id=? AND state IN('posting','submitted','unknown')").bind(tid,id,s.id).first())return null;
 const collision=await env.CRM_DB.prepare("SELECT 1 AS found FROM calling_jobs WHERE provider_call_sid=? UNION ALL SELECT 1 AS found FROM verified_provider_call_costs WHERE provider_call_uuid=? UNION ALL SELECT 1 AS found FROM industry_notice_jobs WHERE call_uuid=? LIMIT 1")
  .bind(s.provider_call_id,s.provider_call_id,s.provider_call_id).first();
 if(collision)return null;
 return {sessionId:s.id,requestId:s.provider_request_id,callUuid:s.provider_call_id,accountSid:s.provider_account_id,
  caller:s.caller,destination:s.destination,hangupAt:s.hangup_at,maxSeconds:j.max_seconds,
  leadId:j.lead_id,manifestSha256:j.manifest_sha256};
}
function matchesReceipt(row,s,cdr){
 return !!row&&row.session_id===s.sessionId&&row.provider_request_id===s.requestId&&row.provider_call_uuid===s.callUuid&&
 row.hangup_at===s.hangupAt&&row.reported_amount===cdr.total_amount&&row.billed_seconds===cdr.billed_duration&&row.call_seconds===cdr.call_duration;
}

// No caller can supply a phone number, CDR, amount, session ID or carrier URL.
// Retrying after a crash between the two D1 databases is safe: the immutable
// receipt is written before the same exact evidence closes the shared hold.
export async function settleIndustryCallCdr(env,{tenantId:tid,jobId:id,now=Date.now(),fetcher=fetch}={}){
 if(!uuid(tid)||!uuid(id)||!Number.isSafeInteger(now)||now<0)return denied('invalid_scope');
 try{
  const initial=await readTerminal(env,tid,id,now);
  if(!initial)return denied('terminal_evidence_unavailable');
  const verified=await readVerifiedPlivoCdr(env,initial,{fetcher});
  if(!verified.ok)return denied('provider_cdr_unverified');
  const cdr=verified.cdr;
  const current=await readTerminal(env,tid,id,now);
  if(!same(initial,current))return denied('terminal_evidence_changed');
  const db=env.CRM_DB,at=iso(now);
  const out=await db.batch([
   db.prepare("INSERT OR IGNORE INTO verified_industry_call_costs(tenant_id,job_id,session_id,provider_request_id,provider_call_uuid,reported_amount,billed_seconds,call_seconds,hangup_at,verified_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(tid,id,current.sessionId,current.requestId,current.callUuid,cdr.total_amount,cdr.billed_duration,cdr.call_duration,current.hangupAt,at),
   db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) SELECT ?,?,'system:industry-cdr','industry.cdr_observed',?,? WHERE changes()=1")
    .bind(tid,crypto.randomUUID(),id,at)
  ]);
  const receipt=await db.prepare("SELECT * FROM verified_industry_call_costs WHERE tenant_id=? AND job_id=?").bind(tid,id).first();
  if(!matchesReceipt(receipt,current,cdr))return denied('conflicting_cdr_review');
  // Never round up or invent a provider billing pulse. Retain the hold
  // for unsupported billing increments or a charge above the reserve.
  if(cdr.billed_duration%30!==0)return denied('billing_pulse_review');
  if(cdr.billed_duration>current.maxSeconds)return denied('over_reserve_review');
  const final=await readTerminal(env,tid,id,now);
  if(!same(current,final))return denied('terminal_evidence_changed');
  const result=await closeMinuteHold(env.CONTROL_DB,{tenantId:tid,job:id,billedSeconds:cdr.billed_duration,
   kind:'verified_cdr',evidenceRef:'plivo-cdr:'+final.callUuid,now});
  return {state:result.ok?'settled':result.state==='settled'?'settlement_evidence_conflict':result.state,recorded:out[0]?.meta?.changes===1,
   clientCreditsDebited:result.ok&&cdr.billed_duration>0&&!result.replayed,
   chargedSeconds:result.ok?cdr.billed_duration:null,replayed:result.replayed===true,capacityReleased:false};
 }catch{return denied('settlement_unavailable')}
}

// Crash recovery for an already settled, exact industry call. No provider
// read or write, no wallet operation, no new call or reuse of the prepared
// job. An immutable settled hold and CDR are necessary even for zero billing.
const canonicalTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&iso(Date.parse(value))===value;
export async function closeSettledIndustryCapacity(env,{tenantId:tid,jobId:id,now=Date.now()}={}){
 if(!uuid(tid)||!uuid(id)||!Number.isSafeInteger(now)||now<0)return denied('invalid_scope');
 try{
  const first=await readTerminal(env,tid,id,now);
  if(!first)return denied('terminal_evidence_unavailable');
  const db=env.CRM_DB;
  const receipt=await db.prepare('SELECT * FROM verified_industry_call_costs WHERE tenant_id=? AND job_id=?').bind(tid,id).first();
  if(!receipt||receipt.session_id!==first.sessionId||receipt.provider_request_id!==first.requestId||
     receipt.provider_call_uuid!==first.callUuid||receipt.hangup_at!==first.hangupAt||
     receipt.currency_status!=='unverified'||!Number.isSafeInteger(receipt.billed_seconds)||
     receipt.billed_seconds<0||receipt.billed_seconds>first.maxSeconds||receipt.billed_seconds%30!==0||
     !canonicalTime(receipt.verified_at)||Date.parse(receipt.verified_at)<first.hangupAt+60000)
   return denied('terminal_receipt_unavailable');
  const hold=await env.CONTROL_DB.prepare('SELECT state,reserved_seconds,charged_seconds,evidence_ref,closed_at FROM tenant_minute_holds WHERE tenant_id=? AND job_id=?').bind(tid,id).first();
  if(!hold||hold.state!=='settled'||hold.reserved_seconds!==first.maxSeconds||
     hold.charged_seconds!==receipt.billed_seconds||hold.evidence_ref!=='plivo-cdr:'+first.callUuid||
     !canonicalTime(hold.closed_at)||hold.closed_at<receipt.verified_at||Date.parse(hold.closed_at)>now)
   return denied('settlement_evidence_unavailable');
  const latest=await readTerminal(env,tid,id,now);
  if(!same(first,latest))return denied('terminal_evidence_changed');
  // Both source records are immutable now. The CRM insert is atomic with
  // its audit and the capacity queries exclude exactly the closed identity.
  const at=iso(now);
  const out=await db.batch([
   db.prepare('INSERT OR IGNORE INTO industry_terminal_closures(tenant_id,job_id,session_id,provider_call_uuid,hangup_at,billed_seconds,settled_at,closed_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(tid,id,first.sessionId,first.callUuid,first.hangupAt,receipt.billed_seconds,hold.closed_at,at),
   db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) SELECT ?,?,'system:industry-terminal','industry.capacity_closed',?,? WHERE changes()=1")
    .bind(tid,crypto.randomUUID(),id,at)
  ]);
  const saved=await db.prepare('SELECT * FROM industry_terminal_closures WHERE tenant_id=? AND job_id=?').bind(tid,id).first();
  if(!saved||saved.session_id!==first.sessionId||saved.provider_call_uuid!==first.callUuid||
     saved.hangup_at!==first.hangupAt||saved.billed_seconds!==receipt.billed_seconds||saved.settled_at!==hold.closed_at)
   return denied('terminal_closure_conflict');
  return {state:'closed',capacityReleased:true,replayed:out[0]?.meta?.changes!==1,clientCreditsDebited:false,chargedSeconds:receipt.billed_seconds};
 }catch{return denied('terminal_closure_unavailable')}
}
