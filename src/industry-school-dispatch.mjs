// Funding-only approval never authorizes a carrier POST. One explicit release,
// one claim, one session. A lost POST response is never automatically retried.
import {mutationOriginAllowed} from './human-auth.mjs';
import {currentIndustryDispatchAuthorizer,activeIndustryDispatchActor,industryActorPredicate} from './industry-dispatch-authority.mjs';
import {readBoundedBytes} from './scripted-speech.mjs';
import {readPreparedIndustryJob} from './industry-call-queue.mjs';
import {claimFundedIndustryAdmission} from './industry-funded-admission.mjs';
import {approvedCampaignPhone,submitScriptedPhone} from './scripted-phone-pilot.mjs';
import {beginSchoolVoiceSession} from './industry-school-voice-plan.mjs';
import {resolveFundingEnv} from './provider-funding.mjs';
import {fundedDispatchApproved,inCallingWindow,providerThrottledUntil,dispatchSettings} from './scripted-campaign-dispatch.mjs';
import {campaignDispatchInterlock,dispatchPausePredicate} from './calling-dispatch-pause.mjs';
import {closeMinuteHold} from './minute-holds.mjs';
import {sharedTenantUnknown,sharedTenantCapacityCount,sharedCapacityCount} from './commercial-capacity.mjs';
import {automaticMinuteSettlementApproved} from './plivo-cost-reconcile-routes.mjs';
import {settleIndustryCallCdr,closeSettledIndustryCapacity} from './industry-cdr-settlement.mjs';
import {industryDispatchEnabled,inspectSchoolDispatchReadiness} from './industry-dispatch-policy.mjs';
export {industryDispatchEnabled} from './industry-dispatch-policy.mjs';

const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const iso=n=>new Date(n).toISOString();
const time=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&iso(Date.parse(x))===x?Date.parse(x):NaN;
const reference=x=>typeof x==='string'&&x.trim().length>=10&&x.length<=160&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(x);
const exact=(d,keys)=>d&&typeof d==='object'&&!Array.isArray(d)&&Object.keys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k));
const reply=(d,status=200)=>Response.json(d,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const err=(error,status=400)=>reply({error},status);
const state=s=>({state:s});
const clockFrom=now=>{const start=Date.now();return ()=>now+Math.max(0,Date.now()-start)};
const localEligibility="j.state='prepared' AND j.purpose='school_admission' AND c.archived_at IS NULL AND c.snapshot_id=j.snapshot_id AND c.graph_sha256=j.graph_sha256 AND v.decision='cleared' AND v.expires_at=j.review_expires_at AND v.revision=(SELECT MAX(r.revision) FROM industry_recipient_reviews r WHERE r.tenant_id=v.tenant_id AND r.campaign_id=v.campaign_id AND r.lead_id=v.lead_id) AND v.destination=l.mobile_e164 AND v.lead_updated_at=l.updated_at AND l.mobile_e164 GLOB '+91[6-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' AND l.consent_status<>'denied' AND l.dnd_status<>'blocked' AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id)";
const joins=" FROM industry_call_jobs j JOIN industry_campaigns c ON c.tenant_id=j.tenant_id AND c.id=j.campaign_id JOIN industry_recipient_reviews v ON v.tenant_id=j.tenant_id AND v.campaign_id=j.campaign_id AND v.lead_id=j.lead_id AND v.revision=j.review_revision JOIN leads l ON l.tenant_id=j.tenant_id AND l.id=j.lead_id";
const audit=(db,tid,actor,action,id,at)=>db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) SELECT ?,?,?,?,?,? WHERE changes()>0").bind(tid,crypto.randomUUID(),actor,action,id,at);

export async function handleIndustryDispatchRelease(req,env,user,{now=Date.now()}={}){
 const url=new URL(req.url);
 if(url.pathname!=='/v1/human/industry-dispatch-release')return null;
 if(req.method!=='POST')return err('method_not_allowed',405);
 if(url.search||!mutationOriginAllowed(req))return err('same_origin_required',403);
 try{
  if(!user?.id||!['super_admin','user'].includes(user.globalRole)||!digest(user.token_hash))return err('current_dispatch_authorization_required',403);
  let d;try{
   if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw Error();
   d=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBytes(req,8192)));
  }catch{return err('invalid_dispatch_release')}
  if(!exact(d,['tenantId','campaignId','jobIds','manifestSha256','maxSeconds','expiresAt','approvalReference','acknowledgeDialing'])||
   !uuid(d.tenantId)||!uuid(d.campaignId)||!digest(d.manifestSha256)||![90,120,150,180].includes(d.maxSeconds)||
   !Array.isArray(d.jobIds)||!d.jobIds.length||d.jobIds.length>50||d.jobIds.some(x=>!uuid(x))||
   new Set(d.jobIds.map(x=>x.toLowerCase())).size!==d.jobIds.length||d.acknowledgeDialing!==true||
   !reference(d.approvalReference)||!(time(d.expiresAt)>now+(d.maxSeconds+25)*1000)||time(d.expiresAt)>now+3600000)
   return err('invalid_dispatch_release');
  const clock=clockFrom(now),tid=d.tenantId,db=env.CRM_DB;
  if(!await currentIndustryDispatchAuthorizer(env.CONTROL_DB,user,tid,now))return err('current_dispatch_authorization_required',403);
  if(!industryDispatchEnabled(env))return err('industry_dispatch_not_enabled',409);
  const readiness=await inspectSchoolDispatchReadiness(env,{now});
  if(!readiness.ready)return reply({error:'industry_dispatch_prerequisites_required',blockers:readiness.blockers},409);
  const campaign=await db.prepare("SELECT * FROM industry_campaigns WHERE tenant_id=? AND id=? AND archived_at IS NULL AND purpose='school_admission'").bind(tid,d.campaignId).first();
  if(!campaign)return err('dispatch_scope_unavailable',409);
  const ready=await env.CONTROL_DB.prepare("SELECT 1 AS ok FROM school_audio_preparations p JOIN industry_launch_requests r ON r.tenant_id=p.tenant_id AND r.id=p.launch_id JOIN tenants t ON t.id=p.tenant_id WHERE t.id=? AND t.status='active' AND t.storage_mode='shared' AND p.launch_id=? AND p.snapshot_id=? AND p.graph_sha256=? AND p.manifest_sha256=? AND p.state='approved' AND r.state='configuration_reviewed' AND r.purpose='school_admission' AND r.snapshot_id=p.snapshot_id AND r.graph_sha256=p.graph_sha256")
   .bind(tid,campaign.launch_request_id,campaign.snapshot_id,campaign.graph_sha256,d.manifestSha256).first();
  const stamp=clock(),at=iso(stamp);
  if(!ready||time(d.expiresAt)<=stamp+(d.maxSeconds+25)*1000||!await currentIndustryDispatchAuthorizer(env.CONTROL_DB,user,tid,stamp))return err('dispatch_scope_unavailable',409);
  // Atomically authorize funding AND dialing for the explicitly selected set.
  // Full asset byte verification is still mandatory at funding and dispatch.
  const cte="WITH eligible AS (SELECT j.tenant_id,j.id,j.lead_id,j.manifest_sha256,a.job_id AS existing FROM json_each(?) x JOIN industry_call_jobs j ON j.id=x.value JOIN industry_campaigns c ON c.tenant_id=j.tenant_id AND c.id=j.campaign_id JOIN industry_recipient_reviews v ON v.tenant_id=j.tenant_id AND v.campaign_id=j.campaign_id AND v.lead_id=j.lead_id AND v.revision=j.review_revision JOIN leads l ON l.tenant_id=j.tenant_id AND l.id=j.lead_id LEFT JOIN industry_funded_admissions a ON a.tenant_id=j.tenant_id AND a.job_id=j.id WHERE j.tenant_id=? AND j.campaign_id=? AND j.manifest_sha256=? AND j.review_expires_at>=? AND "+localEligibility+" AND (a.job_id IS NULL OR (a.state IN('released','funded') AND a.max_seconds=? AND a.expires_at>=? AND a.manifest_sha256=j.manifest_sha256)) AND NOT EXISTS(SELECT 1 FROM industry_dispatch_releases z WHERE z.tenant_id=j.tenant_id AND z.job_id=j.id) AND NOT EXISTS(SELECT 1 FROM industry_terminal_closures z WHERE z.tenant_id=j.tenant_id AND z.job_id=j.id) AND NOT EXISTS(SELECT 1 FROM calling_jobs p WHERE p.id=j.id)) ";
  const args=[JSON.stringify(d.jobIds),tid,d.campaignId,d.manifestSha256,d.expiresAt,d.maxSeconds,d.expiresAt];
  const out=await db.batch([
   db.prepare(cte+"INSERT INTO industry_funded_admissions(tenant_id,job_id,lead_id,manifest_sha256,max_seconds,approved_by,approval_reference,approved_at,expires_at) SELECT tenant_id,id,lead_id,manifest_sha256,?,?,?,?,? FROM eligible WHERE existing IS NULL AND (SELECT COUNT(*) FROM eligible)=?")
    .bind(...args,d.maxSeconds,user.id,d.approvalReference.trim(),at,d.expiresAt,d.jobIds.length),
   db.prepare(cte+"INSERT INTO industry_dispatch_releases(tenant_id,job_id,approved_by,approval_reference,approved_at,expires_at,updated_at) SELECT tenant_id,id,?,?,?,?,? FROM eligible WHERE existing IS NOT NULL AND (SELECT COUNT(*) FROM eligible WHERE existing IS NOT NULL)=?")
    .bind(...args,user.id,d.approvalReference.trim(),at,d.expiresAt,at,d.jobIds.length),
   audit(db,tid,'human:'+user.id,'industry.dispatch_batch_authorized',d.campaignId,at)
  ]);
  if(out[1].meta.changes!==d.jobIds.length)return err('dispatch_scope_or_state_changed',409);
  return reply({authorized:d.jobIds.length,callPlaced:false,scheduled:true,expiresAt:d.expiresAt},201);
 }catch{return err('dispatch_release_unavailable',503)}
}
async function load(db,tid,id){
 return db.prepare("SELECT d.*,a.state AS admission_state,a.max_seconds,a.finished_at,a.manifest_sha256,j.lead_id FROM industry_dispatch_releases d JOIN industry_funded_admissions a ON a.tenant_id=d.tenant_id AND a.job_id=d.job_id JOIN industry_call_jobs j ON j.tenant_id=d.tenant_id AND j.id=d.job_id WHERE d.tenant_id=? AND d.job_id=? AND NOT EXISTS(SELECT 1 FROM industry_terminal_closures z WHERE z.tenant_id=d.tenant_id AND z.job_id=d.job_id)").bind(tid,id).first();
}
async function transition(db,r,from,to,now){
 const at=iso(now),out=await db.batch([
  db.prepare("UPDATE industry_dispatch_releases SET state=?,updated_at=? WHERE tenant_id=? AND job_id=? AND state=? AND session_id IS ? AND updated_at<=?")
   .bind(to,at,r.tenant_id,r.job_id,from,r.session_id,at),
  audit(db,r.tenant_id,'system:industry-dispatch','industry.dispatch_'+to,r.job_id,at)
 ]);
 return out[0].meta.changes===1;
}
const scopeCheck="EXISTS(SELECT 1"+joins+" JOIN industry_funded_admissions a ON a.tenant_id=j.tenant_id AND a.job_id=j.id WHERE j.tenant_id=industry_dispatch_releases.tenant_id AND j.id=industry_dispatch_releases.job_id AND a.state='funded' AND a.manifest_sha256=j.manifest_sha256 AND a.expires_at>? AND j.review_expires_at>? AND "+localEligibility+")";
async function heldScope(env,r,p,config,stamp,{session=false}={}){
 const row=await env.CONTROL_DB.prepare("SELECT 1 AS ok FROM tenants t JOIN tenant_minute_holds h ON h.tenant_id=t.id JOIN provider_cost_reservations c ON c.tenant_id=h.tenant_id AND c.job_id=h.job_id JOIN human_users u ON u.id=? JOIN industry_launch_requests launch ON launch.tenant_id=t.id JOIN school_audio_preparations a ON a.tenant_id=t.id AND a.launch_id=launch.id WHERE t.id=? AND t.status='active' AND t.storage_mode='shared' AND "+industryActorPredicate+" AND h.job_id=? AND h.state='held' AND h.reserved_seconds=? AND c.reserved_seconds=h.reserved_seconds AND launch.id=? AND launch.state='configuration_reviewed' AND launch.purpose='school_admission' AND launch.snapshot_id=a.snapshot_id AND launch.graph_sha256=a.graph_sha256 AND a.state='approved' AND a.snapshot_id=? AND a.graph_sha256=? AND a.manifest_sha256=? AND "+dispatchPausePredicate+" AND NOT EXISTS(SELECT 1 FROM provider_safety_events e WHERE e.kind='blocked' AND e.sequence=(SELECT MAX(sequence) FROM provider_safety_events WHERE provider=e.provider))"+
  (session?" AND EXISTS(SELECT 1 FROM scripted_phone_pilots x WHERE x.tenant_id=t.id AND x.job_id=h.job_id AND x.id=? AND x.phase='requested' AND x.provider_request_id IS NULL AND x.provider_call_id IS NULL AND x.hangup_at IS NULL AND x.destination=? AND x.caller=? AND x.provider_account_id=? AND x.lead_updated_at=? AND x.expires_at>?)":""))
  .bind(r.approved_by,r.tenant_id,r.job_id,r.max_seconds,p.scope.launchRequestId,p.scope.snapshotId,p.scope.digest,r.manifest_sha256,...(session?[r.session_id,p.scope.destination,config.caller,config.authId,p.scope.leadUpdatedAt,stamp]:[])).first();
 return !!row;
}
async function noSubmission(env,r,now){
 const db=env.CRM_DB,c=env.CONTROL_DB;
 const fresh=await load(db,r.tenant_id,r.job_id);
 if(!fresh||fresh.state!=='no_post'||fresh.admission_state!=='funded')return state('locked');
 const session=await c.prepare('SELECT id,phase,provider_call_id,provider_request_id,hangup_at FROM scripted_phone_pilots WHERE tenant_id=? AND job_id=?').bind(r.tenant_id,r.job_id).first();
 if(session){
  if(session.id!==fresh.session_id||!['requested','rejected'].includes(session.phase)||session.provider_call_id!==null||session.provider_request_id!==null||session.hangup_at!==null)return state('locked');
  const stopped=await c.prepare("UPDATE scripted_phone_pilots SET phase='rejected' WHERE id=? AND phase IN('requested','rejected') AND provider_call_id IS NULL AND provider_request_id IS NULL AND hangup_at IS NULL").bind(session.id).run();
  if(stopped.meta.changes!==1)return state('locked');
 }
 const hold=await c.prepare("SELECT h.state,h.reserved_seconds,p.reserved_seconds AS provider_seconds FROM tenant_minute_holds h JOIN provider_cost_reservations p ON p.tenant_id=h.tenant_id AND p.job_id=h.job_id WHERE h.tenant_id=? AND h.job_id=?").bind(r.tenant_id,r.job_id).first();
 if(!hold||hold.reserved_seconds!==fresh.max_seconds||hold.provider_seconds!==fresh.max_seconds||!['held','released'].includes(hold.state))return state('locked');
 const closed=await closeMinuteHold(c,{tenantId:r.tenant_id,job:r.job_id,billedSeconds:0,kind:'verified_no_submission',evidenceRef:'industry-no-submission:'+r.job_id,now});
 if(!closed.ok)return state('locked');
 return state(await transition(db,fresh,'no_post','not_submitted',now)?'not_submitted':'locked');
}

export async function dispatchFundedIndustryJob(baseEnv,{tenantId:tid,jobId:id,now=Date.now(),fetcher=fetch}={}){
 if(!uuid(tid)||!uuid(id)||!Number.isSafeInteger(now)||now<0)return state('invalid_scope');
 const clock=clockFrom(now),db=baseEnv.CRM_DB;
 let owner=null;
 try{
  if(!industryDispatchEnabled(baseEnv)||!inCallingWindow(now))return state('dispatch_disabled_or_outside_hours');
  const r=await load(db,tid,id);
  if(!r||r.state!=='authorized'||r.admission_state!=='funded'||time(r.approved_at)>now)return state('release_unavailable');
  if(time(r.expires_at)<=now+(r.max_seconds+25)*1000)return state('release_expiring');
  const env=await resolveFundingEnv(baseEnv),config=await approvedCampaignPhone(env);
  if(!config||!fundedDispatchApproved(env)||!automaticMinuteSettlementApproved(env))return state('provider_or_funding_unavailable');
  const g=await campaignDispatchInterlock(env.CONTROL_DB);
  if(g.paused||g.providerBlocked||await providerThrottledUntil(env)>now)return state('dispatch_interlocked');
  const p=await readPreparedIndustryJob(env,{tenantId:tid,jobId:id,now:clock()});
  if(p.pack.manifestSha256!==r.manifest_sha256||p.scope.leadId!==r.lead_id)return state('scope_changed');
  const doc=await beginSchoolVoiceSession(p.scope,p.pack);doc.phoneMeta.dispatchVersion=1;
  const stamp=clock(),at=iso(stamp),until=iso(stamp+(r.max_seconds+25)*1000),sessionId=crypto.randomUUID(),cfg=await dispatchSettings(env);
  if(!inCallingWindow(stamp)||time(r.expires_at)<=Date.parse(until))return state('scope_changed');
  if(!await heldScope(env,r,p,config,stamp)){
   // Only an untouched authorized release can be closed without a POST.
   if(!await activeIndustryDispatchActor(env.CONTROL_DB,tid,r.approved_by)&&await transition(db,r,'authorized','no_post',clock()))return await noSubmission(env,r,clock());
   return state('scope_changed');
  }
  const claimed=await db.batch([
   db.prepare("UPDATE industry_dispatch_releases SET state='claimed',session_id=?,claimed_at=?,updated_at=? WHERE tenant_id=? AND job_id=? AND state='authorized' AND expires_at>? AND "+scopeCheck+" AND "+sharedTenantUnknown+" AND "+sharedTenantCapacityCount+"<=? AND "+sharedCapacityCount+"<=?")
    .bind(sessionId,at,at,tid,id,until,until,until,tid,tid,cfg.maxPerCompany,cfg.maxConcurrent),
   audit(db,tid,'system:industry-dispatch','industry.dispatch_claimed',id,at)
  ]);
  if(claimed[0].meta.changes!==1)return state('claim_unavailable');
  owner={...r,state:'claimed',session_id:sessionId,claimed_at:at,updated_at:at};
  const c=env.CONTROL_DB,created=clock();
  const inserted=await c.prepare("INSERT INTO scripted_phone_pilots(id,tenant_id,lead_id,lead_updated_at,actor_id,language,destination,caller,expires_at,phase,survey_json,created_at,provider_account_id,job_id) SELECT ?,?,?,?,?,?,?,?,?,'requested',?,?,?,? WHERE EXISTS(SELECT 1 FROM tenant_minute_holds h WHERE h.tenant_id=? AND h.job_id=? AND h.state='held' AND h.reserved_seconds=?) ON CONFLICT(tenant_id,job_id) DO NOTHING")
   .bind(sessionId,tid,p.scope.leadId,p.scope.leadUpdatedAt,r.approved_by,doc.industryVoice.language,p.scope.destination,config.caller,created+600000,JSON.stringify(doc),iso(created),config.authId,id,tid,id,r.max_seconds).run();
  if(inserted.meta.changes!==1)throw Error('session_claim_unavailable');
  const beforeSubmit=async()=>{
   const ts=clock(),end=iso(ts+(r.max_seconds+25)*1000);
   if(!industryDispatchEnabled(env)||!inCallingWindow(ts)||time(r.expires_at)<=Date.parse(end)||
      await providerThrottledUntil(env)>ts||!await heldScope(env,owner,p,config,ts,{session:true}))return false;
   // Last durable step before the POST; a recovered claim cannot post.
   const change=await db.prepare("UPDATE industry_dispatch_releases SET state='posting',updated_at=? WHERE tenant_id=? AND job_id=? AND state='claimed' AND session_id=? AND expires_at>? AND "+scopeCheck+" AND "+sharedTenantUnknown+" AND "+sharedTenantCapacityCount+"<=? AND "+sharedCapacityCount+"<=?")
    .bind(iso(ts),tid,id,sessionId,end,end,end,tid,tid,cfg.maxPerCompany,cfg.maxConcurrent).run();
   return change.meta.changes===1;
  };
  const result=await submitScriptedPhone(c,config,sessionId,p.scope.destination,r.max_seconds,fetcher,{commercial:true,beforeSubmit});
  const latest=await load(db,tid,id);
  if(!latest||latest.session_id!==sessionId)return state('locked');
  if(result==='submitted')return state(await transition(db,latest,'posting','submitted',clock())?'submitted':'locked');
  if(latest.state==='claimed'){
   if(await transition(db,latest,'claimed','no_post',clock()))return await noSubmission(env,latest,clock());
   return state('locked');
  }
  if(latest.state==='posting'){
   const row=await c.prepare('SELECT phase,provider_call_id,provider_request_id,hangup_at FROM scripted_phone_pilots WHERE id=? AND tenant_id=? AND job_id=?').bind(sessionId,tid,id).first();
   if(['rejected','cancelled'].includes(result)&&row?.phase==='rejected'&&row.provider_call_id===null&&row.provider_request_id===null&&row.hangup_at===null){
    if(await transition(db,latest,'posting','no_post',clock()))return await noSubmission(env,latest,clock());
   }else await transition(db,latest,'posting','unknown',clock());
  }
  return state('locked');
 }catch{
  if(owner)try{
   const latest=await load(db,tid,id);
   if(latest?.session_id===owner.session_id&&latest.state==='claimed'){
    if(await transition(db,latest,'claimed','no_post',clock()))return await noSubmission(baseEnv,latest,clock());
   }else if(latest?.session_id===owner.session_id&&latest.state==='posting')await transition(db,latest,'posting','unknown',clock());
  }catch{}
  return state('locked');
 }
}
export async function reconcileIndustryDispatch(env,{tenantId:tid,jobId:id,now=Date.now(),fetcher=fetch}={}){
 if(!uuid(tid)||!uuid(id)||!Number.isSafeInteger(now)||now<0)return state('invalid_scope');
 const db=env.CRM_DB;
 try{
  const r=await load(db,tid,id);
  if(!r||r.admission_state!=='funded')return state('review_required');
  if(r.state==='authorized'&&time(r.expires_at)<=now+(r.max_seconds+25)*1000||
     r.state==='claimed'&&time(r.updated_at)<=now-120000){
   if(await transition(db,r,r.state,'no_post',now))return await noSubmission(env,r,now);
   return state('locked');
  }
  if(r.state==='no_post')return await noSubmission(env,r,now);
  if(!['posting','submitted','unknown'].includes(r.state))return state('pending');
  const row=await env.CONTROL_DB.prepare('SELECT p.id,p.phase,p.hangup_at,p.expires_at,h.state AS hold_state FROM scripted_phone_pilots p JOIN tenant_minute_holds h ON h.tenant_id=p.tenant_id AND h.job_id=p.job_id WHERE p.tenant_id=? AND p.job_id=?').bind(tid,id).first();
  if(row?.id===r.session_id&&Number.isSafeInteger(row.hangup_at)&&row.hangup_at<=now-60000&&['completed','declined','ended','needs_review'].includes(row.phase)){
   if(row.hold_state==='settled')return await closeSettledIndustryCapacity(env,{tenantId:tid,jobId:id,now});
   if(row.hold_state==='held'&&automaticMinuteSettlementApproved(env)){
    const result=await settleIndustryCallCdr(env,{tenantId:tid,jobId:id,now,fetcher});
    if(result.state==='settled')return await closeSettledIndustryCapacity(env,{tenantId:tid,jobId:id,now});
    return result;
   }
  }
  if(r.state==='posting'&&time(r.updated_at)<=now-120000||
     r.state==='submitted'&&((row?.id===r.session_id&&row.expires_at<=now)||time(r.updated_at)<=now-900000)){
   await transition(db,r,r.state,'unknown',now);return state('unknown');
  }
  return state('pending');
 }catch{return state('locked')}
}
// Hard query cap independent of the legacy scheduler. A crash after the
// durable POST transition retains the claim and hold; no paid retry.
function budgetEnv(env,limit){
 let used=0;
 const take=n=>{if(used+n>limit)throw Error('industry_query_budget');used+=n};
 const wrap=db=>({prepare(sql){
  const bind=st=>({bind(...args){return bind(st.bind(...args))},async first(...args){take(1);return st.first(...args)},async all(...args){take(1);return st.all(...args)},async run(...args){take(1);return st.run(...args)},inner:st});
  return bind(db.prepare(sql));
 },async batch(steps){take(steps.length);return db.batch(steps.map(s=>s.inner))}});
 return {env:{...env,CRM_DB:wrap(env.CRM_DB),CONTROL_DB:wrap(env.CONTROL_DB)},used:()=>used};
}
export async function runIndustrySchoolTick(baseEnv,{now=Date.now(),apiFetch=fetch,cdrFetch=fetch,maxQueries=40,lane=null}={}){
 if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(maxQueries)||maxQueries<20||maxQueries>950)return null;
 const meter=budgetEnv(baseEnv,maxQueries),env=meter.env,db=env.CRM_DB;
 const enabled=industryDispatchEnabled(env),mode=enabled?(lane??['fund','dial','recover'][Math.floor(now/120000)%3]):'recover';
 if(!['fund','dial','recover'].includes(mode))return null;
 const from=" FROM industry_dispatch_releases d JOIN industry_funded_admissions a ON a.tenant_id=d.tenant_id AND a.job_id=d.job_id WHERE NOT EXISTS(SELECT 1 FROM industry_terminal_closures z WHERE z.tenant_id=d.tenant_id AND z.job_id=d.job_id) AND ";
 const deadline="strftime('%Y-%m-%dT%H:%M:%fZ',?, '+'||(a.max_seconds+25)||' seconds')";
 const predicate=mode==='fund'?"d.state='authorized' AND a.state='released' AND d.expires_at>"+deadline:
  mode==='dial'?"d.state='authorized' AND a.state='funded' AND d.expires_at>"+deadline:
  "a.state='funded' AND (d.state IN('claimed','posting','submitted','unknown','no_post') OR (d.state='authorized' AND d.expires_at<="+deadline+"))";
 const cutoff=iso(now);
 // Each lane runs every third industry tick. Rotate by a full cycle rather
 // than by three, which otherwise starves rows when the queue size is 3k.
 const rotation=Math.floor(now/(enabled?360000:120000));
 let selected=false;
 try{
  const count=(await db.prepare('SELECT COUNT(*) AS n'+from+predicate).bind(cutoff).first())?.n;
  if(!Number.isSafeInteger(count)||count<=0)return null;
  const row=await db.prepare('SELECT d.tenant_id,d.job_id'+from+predicate+' ORDER BY d.tenant_id,d.job_id LIMIT 1 OFFSET ?').bind(cutoff,rotation%count).first();
  if(!row)return null;
  selected=true;
  const scope={tenantId:row.tenant_id,jobId:row.job_id,now};
  let result;
  if(mode==='fund'){
   // Do not reserve against a disabled provider or a non-approved settlement path.
   const resolved=await resolveFundingEnv(env);
   if(!automaticMinuteSettlementApproved(resolved))return {lane:mode,state:'settlement_not_approved',queriesUsed:meter.used()};
   const release=await load(db,row.tenant_id,row.job_id);
   if(!release||release.state!=='authorized'||!await activeIndustryDispatchActor(env.CONTROL_DB,release.tenant_id,release.approved_by))return {lane:mode,state:'authorization_unavailable',queriesUsed:meter.used()};
   result=await claimFundedIndustryAdmission(resolved,scope);
  }else if(mode==='dial')result=await dispatchFundedIndustryJob(env,{...scope,fetcher:apiFetch});
  else result=await reconcileIndustryDispatch(env,{...scope,fetcher:cdrFetch});
  return {lane:mode,...result,queriesUsed:meter.used()};
 }catch{return selected?{lane:mode,state:'locked',queriesUsed:meter.used()}:null}
}
