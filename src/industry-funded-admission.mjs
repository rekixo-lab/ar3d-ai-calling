// Production-only funding admission for reviewed School jobs. No carrier
// adapter or scheduler invokes claimFundedIndustryAdmission in this version.
// A release authorizes only this bounded reservation, NOT a carrier POST.
import {currentSuperAdminMfa,mutationOriginAllowed} from './human-auth.mjs';
import {readPreparedIndustryJob} from './industry-call-queue.mjs';
import {readBoundedBytes} from './scripted-speech.mjs';
import {campaignDispatchInterlock,dispatchPausePredicate} from './calling-dispatch-pause.mjs';
import {approvedCampaignPhone} from './scripted-phone-pilot.mjs';
import {fundedDispatchApproved,dispatchSettings,inCallingWindow,providerThrottledUntil} from './scripted-campaign-dispatch.mjs';
import {resolveFundingEnv} from './provider-funding.mjs';
import {fundingCap,closeMinuteHold} from './minute-holds.mjs';
import {moneyBudgetConfig,reserveBudgetedMinutes} from './provider-cost-reservations.mjs';
import {sharedCapacityCount,sharedTenantCapacityCount,sharedTenantUnknown} from './commercial-capacity.mjs';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const exact=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===k.length&&k.every(x=>Object.hasOwn(o,x));
const reference=x=>typeof x==='string'&&x.trim().length>=10&&x.length<=160&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(x);
const iso=n=>new Date(n).toISOString();
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(d,status=200)=>Response.json(d,{status,headers});
const fail=x=>{throw Error(x)};
const audit=(db,tid,actor,action,id,at)=>db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1").bind(tid,crypto.randomUUID(),actor,action,id,at);
const deadline=(expires,now,maxSeconds)=>Number.isFinite(Date.parse(expires))&&iso(Date.parse(expires))===expires&&Date.parse(expires)>now+(maxSeconds+25)*1000;
const currentRecipient="j.state='prepared' AND c.archived_at IS NULL AND v.decision='cleared' AND v.revision=(SELECT MAX(r.revision) FROM industry_recipient_reviews r WHERE r.tenant_id=v.tenant_id AND r.campaign_id=v.campaign_id AND r.lead_id=v.lead_id) AND v.expires_at=j.review_expires_at AND v.expires_at>? AND v.destination=l.mobile_e164 AND v.lead_updated_at=l.updated_at AND l.mobile_e164 GLOB '+91[6-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' AND l.consent_status<>'denied' AND l.dnd_status<>'blocked' AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id)";
const joins=" FROM industry_call_jobs j JOIN industry_campaigns c ON c.tenant_id=j.tenant_id AND c.id=j.campaign_id JOIN industry_recipient_reviews v ON v.tenant_id=j.tenant_id AND v.campaign_id=j.campaign_id AND v.lead_id=j.lead_id AND v.revision=j.review_revision JOIN leads l ON l.tenant_id=j.tenant_id AND l.id=j.lead_id";
async function load(db,tid,id){return db.prepare('SELECT * FROM industry_funded_admissions WHERE tenant_id=? AND job_id=?').bind(tid,id).first()}
const view=r=>r?{state:r.state,maxSeconds:r.max_seconds,expiresAt:r.expires_at,manifestSha256:r.manifest_sha256,claimedAt:r.claimed_at,finishedAt:r.finished_at,outcome:r.outcome,dispatchReady:false}:{state:'not_released',dispatchReady:false};
export async function authorizeIndustryAdmission(env,user,d,{now=Date.now()}={}){
 if(!exact(d,['tenantId','jobId','manifestSha256','maxSeconds','expiresAt','approvalReference','acknowledgeFundingOnly'])||!uuid(d.tenantId)||!uuid(d.jobId)||!digest(d.manifestSha256)||![90,120,150,180].includes(d.maxSeconds)||!reference(d.approvalReference)||d.acknowledgeFundingOnly!==true||!deadline(d.expiresAt,now,d.maxSeconds)||Date.parse(d.expiresAt)>now+3600000)fail('industry_admission_invalid_request');
 const started=Date.now(),clock=()=>now+Math.max(0,Date.now()-started),tid=d.tenantId,id=d.jobId,db=env.CRM_DB;
 if(!await currentSuperAdminMfa(env.CONTROL_DB,user,now))fail('industry_admission_mfa_required');
 if(await load(db,tid,id))fail('industry_admission_conflict');
 const prepared=await readPreparedIndustryJob(env,{tenantId:tid,jobId:id,now});
 if(prepared.pack.manifestSha256!==d.manifestSha256||Date.parse(d.expiresAt)>Date.parse(prepared.scope.expiresAt))fail('industry_admission_scope_changed');
 const stamp=clock(),at=iso(stamp);
 if(!await currentSuperAdminMfa(env.CONTROL_DB,user,stamp))fail('industry_admission_mfa_required');
 if(!deadline(d.expiresAt,stamp,d.maxSeconds))fail('industry_admission_scope_changed');
 const out=await db.batch([
  db.prepare("INSERT INTO industry_funded_admissions(tenant_id,job_id,lead_id,manifest_sha256,max_seconds,approved_by,approval_reference,approved_at,expires_at) SELECT j.tenant_id,j.id,j.lead_id,j.manifest_sha256,?,?,?,?,?"+joins+" WHERE j.tenant_id=? AND j.id=? AND j.manifest_sha256=? AND j.review_expires_at>=? AND "+currentRecipient+" AND NOT EXISTS(SELECT 1 FROM industry_funded_admissions a WHERE a.tenant_id=j.tenant_id AND a.job_id=j.id) AND NOT EXISTS(SELECT 1 FROM calling_jobs p WHERE p.id=j.id)")
   .bind(d.maxSeconds,user.id,d.approvalReference.trim(),at,d.expiresAt,tid,id,d.manifestSha256,d.expiresAt,iso(stamp+(d.maxSeconds+25)*1000)),
  audit(db,tid,'human:'+user.id,'industry.funding_admission_authorized',id,at)
 ]);
 if(out[0].meta.changes!==1)fail('industry_admission_conflict');
 return view(await load(db,tid,id));
}
export async function handleIndustryAdmission(req,env,user,{now=Date.now()}={}){
 const url=new URL(req.url),match=url.pathname.match(/^\/v1\/human\/industry-admission\/([a-f0-9-]{36})$/i);
 if(!url.pathname.startsWith('/v1/human/industry-admission/'))return null;
 if(!match||!uuid(match[1]))return reply({error:'industry_admission_invalid_request'},400);
 if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
 if(url.search||!mutationOriginAllowed(req))return reply({error:'same_origin_required'},403);
 try{
  if(!await currentSuperAdminMfa(env.CONTROL_DB,user,now))return reply({error:'industry_admission_mfa_required'},403);
  if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')fail('industry_admission_invalid_request');
  let d;try{d=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBytes(req,4096)))}catch{fail('industry_admission_invalid_request')}
  if(d?.jobId!==match[1])fail('industry_admission_invalid_request');
  return reply(await authorizeIndustryAdmission(env,user,d,{now}),201);
 }catch(e){
  const code=String(e?.message||'');
  if(code==='industry_admission_invalid_request')return reply({error:code},400);
  if(code==='industry_admission_mfa_required')return reply({error:code},403);
  if(/^(industry_admission_(?:conflict|scope_changed)|industry_(?:job|recipient|campaign|tenant)_|school_)/.test(code))return reply({error:'industry_admission_scope_or_state_changed'},409);
  return reply({error:'industry_admission_unavailable'},503);
 }
}
async function finish(db,r,state,outcome,now){
 const at=iso(now);
 const result=await db.batch([
  db.prepare("UPDATE industry_funded_admissions SET state=?,finished_at=?,outcome=? WHERE tenant_id=? AND job_id=? AND state='claiming' AND claimed_at=?")
   .bind(state,at,outcome,r.tenant_id,r.job_id,r.claimed_at),
  audit(db,r.tenant_id,'system:industry-admission','industry.admission_'+state,r.job_id,at)
 ]);
 return result[0].meta.changes===1;
}
const stopped=state=>({state,dispatchReady:false});
export async function claimFundedIndustryAdmission(baseEnv,{tenantId:tid,jobId:id,now=Date.now()}={}){
 if(!uuid(tid)||!uuid(id)||!Number.isSafeInteger(now)||now<0)fail('industry_admission_invalid_request');
 if(baseEnv.AR3D_INDUSTRY_SCHOOL_FUNDED_ADMISSION!=='approved'||baseEnv.AR3D_INDUSTRY_SCHOOL_VOICE_ENABLED!=='enabled'||baseEnv.AR3D_SCRIPTED_CAMPAIGNS_ENABLED!=='enabled'||baseEnv.AR3D_CAMPAIGN_SARVAM_DISCLOSURE!=='approved'||!inCallingWindow(now))return stopped('disabled_or_outside_hours');
 const started=Date.now(),clock=()=>now+Math.max(0,Date.now()-started),db=baseEnv.CRM_DB;
 const r=await load(db,tid,id);
 if(r?.state!=='released'||!deadline(r.expires_at,now,r.max_seconds))return stopped('release_unavailable');
 const env=await resolveFundingEnv(baseEnv);
 if(!fundedDispatchApproved(env)||!await approvedCampaignPhone(env))return stopped('funding_or_provider_approval_required');
 const gate=await campaignDispatchInterlock(env.CONTROL_DB);
 if(gate.paused||gate.providerBlocked||await providerThrottledUntil(env)>now)return stopped('dispatch_interlocked');
 const before=await readPreparedIndustryJob(env,{tenantId:tid,jobId:id,now});
 const stamp=clock(),at=iso(stamp),requiredUntil=iso(stamp+(r.max_seconds+25)*1000),cfg=await dispatchSettings(env);
 if(before.pack.manifestSha256!==r.manifest_sha256||!deadline(r.expires_at,stamp,r.max_seconds)||!inCallingWindow(stamp))return stopped('release_unavailable');
 // Same serialized shared CRM statement as legacy capacity admission:
 // both job types consume the global and per-company limits; unknown
 // attempts and same-lead overlaps block. No separate capacity pool.
 const changed=await db.prepare("UPDATE industry_funded_admissions SET state='claiming',claimed_at=? WHERE tenant_id=? AND job_id=? AND state='released' AND expires_at>? AND manifest_sha256=? AND EXISTS(SELECT 1"+joins+" WHERE j.tenant_id=industry_funded_admissions.tenant_id AND j.id=industry_funded_admissions.job_id AND j.manifest_sha256=industry_funded_admissions.manifest_sha256 AND "+currentRecipient+") AND "+sharedTenantUnknown+" AND "+sharedTenantCapacityCount+"<? AND "+sharedCapacityCount+"<? AND NOT EXISTS(SELECT 1 FROM calling_jobs p WHERE p.tenant_id=? AND p.lead_id=industry_funded_admissions.lead_id AND p.state IN('reserved','submitted','unknown')) AND NOT EXISTS(SELECT 1 FROM industry_funded_admissions a WHERE a.tenant_id=? AND a.lead_id=industry_funded_admissions.lead_id AND a.state IN('claiming','funded','unknown'))")
  .bind(at,tid,id,requiredUntil,r.manifest_sha256,requiredUntil,tid,tid,cfg.maxPerCompany,cfg.maxConcurrent,tid,tid).run();
 if(changed.meta.changes!==1)return stopped('capacity_or_scope_changed');
 const claim={...r,claimed_at:at};
 try{
  const held=await reserveBudgetedMinutes(env.CONTROL_DB,{tenantId:tid,job:id,maxSeconds:r.max_seconds,now:stamp,globalCap:fundingCap(env),config:moneyBudgetConfig(env)});
  if(!held.ok||held.replayed){
   const old=await env.CONTROL_DB.prepare('SELECT state FROM tenant_minute_holds WHERE tenant_id=? AND job_id=?').bind(tid,id).first();
   if(!old&&!held.ok&&held.state==='insufficient_or_unavailable'){
    return stopped(await finish(db,claim,'blocked','funding_unavailable',clock())?'funding_unavailable':'locked');
   }
   await finish(db,claim,'unknown','reservation_identity_uncertain',clock());return stopped('locked');
  }
  // No provider request exists in this implementation. On a confirmed
  // pre-submission revocation, release only the exact unused hold. Crashes
  // or exceptions retain the claim and money, with no automatic retry.
  let eligible=false;
  try{
   const after=await readPreparedIndustryJob(env,{tenantId:tid,jobId:id,now:clock()}),g=await campaignDispatchInterlock(env.CONTROL_DB);
   const funded=await env.CONTROL_DB.prepare("SELECT 1 AS ok FROM tenants t JOIN tenant_minute_holds h ON h.tenant_id=t.id JOIN provider_cost_reservations p ON p.tenant_id=h.tenant_id AND p.job_id=h.job_id WHERE t.id=? AND t.status='active' AND t.storage_mode='shared' AND h.job_id=? AND h.state='held' AND h.reserved_seconds=? AND p.reserved_seconds=h.reserved_seconds AND "+dispatchPausePredicate).bind(tid,id,r.max_seconds).first();
   eligible=!!funded&&!g.paused&&!g.providerBlocked&&inCallingWindow(clock())&&deadline(r.expires_at,clock(),r.max_seconds)&&after.pack.manifestSha256===r.manifest_sha256&&after.scope.destination===before.scope.destination&&after.scope.leadUpdatedAt===before.scope.leadUpdatedAt;
  }catch{ /* Preserve the unused hold unless its identity is explicitly proven. */ }
  if(!eligible){
   const released=await closeMinuteHold(env.CONTROL_DB,{tenantId:tid,job:id,billedSeconds:0,kind:'verified_no_submission',evidenceRef:'industry-admission-not-submitted:'+id,now:clock()});
   if(!released.ok){await finish(db,claim,'unknown','release_evidence_uncertain',clock());return stopped('locked')}
   return stopped(await finish(db,claim,'blocked','eligibility_changed_before_submission',clock())?'blocked':'locked');
  }
  return stopped(await finish(db,claim,'funded','funded_no_submission',clock())?'funded':'locked');
 }catch{
  // A write or network ambiguity never permits a second claim.
  try{await finish(db,claim,'unknown','reservation_outcome_uncertain',clock())}catch{}
  return stopped('locked');
 }
}
