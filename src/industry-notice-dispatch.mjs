// One durable claim and carrier submission; no retry after uncertain POST.
// Shares the original wallet/provider reservation and capacity serialization.
import {NOTICE_SECONDS,noticeJob,noticeEligibility,currentNotice,noticeSessionDoc,exactNoticeSession,reviewDigest,uuid,reference,requestId,iso,noticeDispatchEnabled,noticeDeliveryAvailable} from './industry-notice-common.mjs';
import {industryNoticeConnectorStatus} from './industry-notice-connectors.mjs';
import {approvedCampaignPhone,submitScriptedPhone} from './scripted-phone-pilot.mjs';
import {resolveFundingEnv} from './provider-funding.mjs';
import {fundedDispatchApproved,inCallingWindow,providerThrottledUntil,dispatchSettings} from './scripted-campaign-dispatch.mjs';
import {automaticMinuteSettlementApproved} from './plivo-cost-reconcile-routes.mjs';
import {campaignDispatchInterlock} from './calling-dispatch-pause.mjs';
import {reserveBudgetedMinutes,moneyBudgetConfig} from './provider-cost-reservations.mjs';
import {fundingCap,closeMinuteHold} from './minute-holds.mjs';
import {sharedCapacityCount,sharedTenantCapacityCount,sharedTenantUnknown,commercialCapacityRows} from './commercial-capacity.mjs';
import {readVerifiedPlivoCdr} from './plivo-verified-cdr.mjs';
const state=s=>({state:s});
const clockFrom=now=>{const start=Date.now();return ()=>now+Math.max(0,Date.now()-start)};
const enabled=noticeDispatchEnabled;
export {noticeDeliveryAvailable} from './industry-notice-common.mjs';
export async function noticeDispatchConfig(baseEnv,{now=Date.now()}={}){
 try{
  if(!enabled(baseEnv)||!reference(baseEnv.AR3D_NOTICE_CARRIER_APPROVAL_REFERENCE,10))return null;
  const env=await resolveFundingEnv(baseEnv),config=await approvedCampaignPhone(env);
  if(!config||!fundedDispatchApproved(env)||!automaticMinuteSettlementApproved(env))return null;
  const gate=await campaignDispatchInterlock(env.CONTROL_DB);
  if(gate.paused||gate.providerBlocked||await providerThrottledUntil(env)>now)return null;
  return {env,config,windowOpen:inCallingWindow(now)};
 }catch{return null}
}
async function move(db,j,next,now){
 const r=await db.prepare("UPDATE industry_notice_jobs SET state=?,updated_at=? WHERE tenant_id=? AND id=? AND state=? AND updated_at=?").bind(next,Math.max(now,j.updated_at),j.tenant_id,j.id,j.state,j.updated_at).run();
 return r.meta.changes===1;
}
async function releaseUnused(env,j,now){
 const c=env.CONTROL_DB,db=env.CRM_DB;
 if(j.state!=='no_post')return state('locked');
 const row=await c.prepare('SELECT * FROM scripted_phone_pilots WHERE tenant_id=? AND job_id=?').bind(j.tenant_id,j.id).first();
 if(row){
  if(!exactNoticeSession(j,row)||!['requested','rejected'].includes(row.phase)||row.provider_call_id!==null||row.provider_request_id!==null||row.hangup_at!==null)return state('locked');
  const stop=await c.prepare("UPDATE scripted_phone_pilots SET phase='rejected' WHERE id=? AND phase IN('requested','rejected') AND provider_call_id IS NULL AND provider_request_id IS NULL AND hangup_at IS NULL").bind(row.id).run();
  if(stop.meta.changes!==1)return state('locked');
 }
 const hold=await c.prepare("SELECT h.state,h.reserved_seconds,p.reserved_seconds AS provider_seconds FROM tenant_minute_holds h JOIN provider_cost_reservations p ON p.tenant_id=h.tenant_id AND p.job_id=h.job_id WHERE h.tenant_id=? AND h.job_id=?").bind(j.tenant_id,j.id).first();
 if(!hold||hold.reserved_seconds!==NOTICE_SECONDS||hold.provider_seconds!==NOTICE_SECONDS||!['held','released'].includes(hold.state))return state('locked');
 const closed=await closeMinuteHold(c,{tenantId:j.tenant_id,job:j.id,billedSeconds:0,kind:'verified_no_submission',evidenceRef:'notice-no-submission:'+j.id,now});
 if(!closed.ok)return state('locked');
 return state(await move(db,j,'not_submitted',now)?'not_submitted':'locked');
}
async function noPost(env,j,now){
 if(!await move(env.CRM_DB,j,'no_post',now))return state('locked');
 return releaseUnused(env,await noticeJob(env.CRM_DB,j.tenant_id,j.id),now);
}
export async function fundNoticeJob(baseEnv,{tenantId:tid,jobId:id,now=Date.now()}={}){
 if(!uuid(tid)||!uuid(id))return state('invalid_scope');
 const ready=await noticeDispatchConfig(baseEnv,{now});
 if(!ready?.windowOpen)return state('not_ready');
 const {env}=ready,db=env.CRM_DB,clock=clockFrom(now);
 let j=await noticeJob(db,tid,id);
 if(!j||j.state!=='authorized'||j.release_expires_at<=now+115000||!noticeDeliveryAvailable(env,j)||!await currentNotice(env,j,now))return state('release_unavailable');
 const settings=await dispatchSettings(env),stamp=clock();
 if(!inCallingWindow(stamp)||j.release_expires_at<=stamp+115000)return state('release_unavailable');
 const claim=await db.prepare("UPDATE industry_notice_jobs SET state='claiming',claimed_at=?,updated_at=? WHERE tenant_id=? AND id=? AND state='authorized' AND updated_at=? AND revoked_at IS NULL AND release_expires_at>? AND "+noticeEligibility+" AND "+sharedTenantUnknown+" AND "+sharedTenantCapacityCount+"<? AND "+sharedCapacityCount+"<? AND NOT EXISTS(SELECT 1 FROM ("+commercialCapacityRows+") occupied WHERE occupied.tenant_id=industry_notice_jobs.tenant_id AND occupied.lead_id=industry_notice_jobs.lead_id)").bind(stamp,stamp,tid,id,j.updated_at,stamp+115000,tid,tid,settings.maxPerCompany,settings.maxConcurrent).run();
 if(claim.meta.changes!==1)return state('capacity_or_scope_changed');
 j={...j,state:'claiming',claimed_at:stamp,updated_at:stamp};
 try{
  const held=await reserveBudgetedMinutes(env.CONTROL_DB,{tenantId:tid,job:id,maxSeconds:NOTICE_SECONDS,now:stamp,globalCap:fundingCap(env),config:moneyBudgetConfig(env)});
  const fresh=await noticeJob(db,tid,id);
  if(!fresh||fresh.state!=='claiming')return state('locked');
  if(!held.ok||held.replayed){
   const old=await env.CONTROL_DB.prepare('SELECT state FROM tenant_minute_holds WHERE tenant_id=? AND job_id=?').bind(tid,id).first();
   return state(await move(db,fresh,!old&&!held.ok?'blocked':'unknown',clock())?(!old&&!held.ok?'funding_unavailable':'locked'):'locked');
  }
  if(!noticeDeliveryAvailable(env,fresh)||!await currentNotice(env,fresh,clock(),{hold:true}))return noPost(env,fresh,clock());
  return state(await move(db,fresh,'funded',clock())?'funded':'locked');
 }catch{
  try{const latest=await noticeJob(db,tid,id);if(latest?.state==='claiming')await move(db,latest,'unknown',clock())}catch{}
  return state('locked');
 }
}
export async function dispatchNoticeJob(baseEnv,{tenantId:tid,jobId:id,now=Date.now(),fetcher=fetch}={}){
 if(!uuid(tid)||!uuid(id))return state('invalid_scope');
 const ready=await noticeDispatchConfig(baseEnv,{now});if(!ready?.windowOpen)return state('not_ready');
 const {env,config}=ready,db=env.CRM_DB,c=env.CONTROL_DB,clock=clockFrom(now);
 let j=await noticeJob(db,tid,id),owner=null;
 if(!j||j.state!=='funded')return state('release_unavailable');
 if(j.release_expires_at<=now+115000||!noticeDeliveryAvailable(env,j)||!await currentNotice(env,j,now,{hold:true}))return noPost(env,j,clock());
 try{
  const settings=await dispatchSettings(env),sessionId=crypto.randomUUID(),stamp=clock();
  const claim=await db.prepare("UPDATE industry_notice_jobs SET state='claimed',session_id=?,updated_at=? WHERE tenant_id=? AND id=? AND state='funded' AND updated_at=? AND revoked_at IS NULL AND release_expires_at>? AND "+noticeEligibility+" AND "+sharedTenantUnknown+" AND "+sharedTenantCapacityCount+"<=? AND "+sharedCapacityCount+"<=?").bind(sessionId,stamp,tid,id,j.updated_at,stamp+115000,tid,tid,settings.maxPerCompany,settings.maxConcurrent).run();
  if(claim.meta.changes!==1)return state('claim_unavailable');
  owner={...j,state:'claimed',session_id:sessionId,updated_at:stamp};
  const inserted=await c.prepare("INSERT INTO scripted_phone_pilots(id,tenant_id,lead_id,lead_updated_at,actor_id,language,destination,caller,expires_at,phase,survey_json,created_at,provider_account_id,job_id) SELECT ?,?,?,?,?,?,?,?,?,'requested',?,?,?,? WHERE EXISTS(SELECT 1 FROM tenant_minute_holds h WHERE h.tenant_id=? AND h.job_id=? AND h.state='held' AND h.reserved_seconds=?) ON CONFLICT(tenant_id,job_id) DO NOTHING").bind(sessionId,tid,j.lead_id,j.lead_updated_at,j.actor_id,j.language,j.destination,config.caller,stamp+600000,JSON.stringify(noticeSessionDoc(owner)),iso(stamp),config.authId,id,tid,id,NOTICE_SECONDS).run();
  if(inserted.meta.changes!==1)throw Error('session_claim_unavailable');
  const beforeSubmit=async()=>{
   const ts=clock(),fresh=await noticeJob(db,tid,id);
   if(!fresh||fresh.state!=='claimed'||fresh.session_id!==sessionId||fresh.release_expires_at<=ts+115000||!enabled(env)||!inCallingWindow(ts)||!noticeDeliveryAvailable(env,fresh)||await providerThrottledUntil(env)>ts||!await currentNotice(env,fresh,ts,{hold:true,session:true}))return false;
   const changed=await db.prepare("UPDATE industry_notice_jobs SET state='posting',updated_at=? WHERE tenant_id=? AND id=? AND state='claimed' AND updated_at=? AND session_id=? AND revoked_at IS NULL AND release_expires_at>? AND "+noticeEligibility+" AND "+sharedTenantUnknown+" AND "+sharedTenantCapacityCount+"<=? AND "+sharedCapacityCount+"<=?").bind(ts,tid,id,fresh.updated_at,sessionId,ts+115000,tid,tid,settings.maxPerCompany,settings.maxConcurrent).run();
   return changed.meta.changes===1;
  };
  const result=await submitScriptedPhone(c,config,sessionId,j.destination,NOTICE_SECONDS,fetcher,{commercial:true,beforeSubmit});
  const latest=await noticeJob(db,tid,id);if(!latest||latest.session_id!==sessionId)return state('locked');
  if(result==='submitted'&&latest.state==='posting')return state(await move(db,latest,'submitted',clock())?'submitted':'locked');
  if(latest.state==='claimed')return noPost(env,latest,clock());
  if(latest.state==='posting'){
   const row=await c.prepare('SELECT * FROM scripted_phone_pilots WHERE id=?').bind(sessionId).first();
   if(['rejected','cancelled'].includes(result)&&row?.phase==='rejected'&&row.provider_call_id===null&&row.provider_request_id===null&&row.hangup_at===null)return noPost(env,latest,clock());
   await move(db,latest,'unknown',clock());
  }
  return state('locked');
 }catch{
  try{const latest=await noticeJob(db,tid,id);if(owner&&latest?.session_id===owner.session_id){
   if(latest.state==='claimed')return await noPost(env,latest,clock());
   if(latest.state==='posting')await move(db,latest,'unknown',clock());
  }}catch{}
  return state('locked');
 }
}
// Receipt is immutable and written before the Control D1 wallet close.
// Current permission is intentionally not required to account for a placed call.
async function terminal(env,j,now){
 const row=await env.CONTROL_DB.prepare("SELECT s.*,h.state AS hold_state,h.reserved_seconds,p.reserved_seconds AS provider_seconds FROM scripted_phone_pilots s JOIN tenant_minute_holds h ON h.tenant_id=s.tenant_id AND h.job_id=s.job_id JOIN provider_cost_reservations p ON p.tenant_id=h.tenant_id AND p.job_id=h.job_id WHERE s.id=? AND s.tenant_id=? AND s.job_id=?").bind(j.session_id,j.tenant_id,j.id).first();
 if(!exactNoticeSession(j,row)||!uuid(row.provider_call_id)||!requestId(row.provider_request_id)||!['completed','declined','ended','needs_review'].includes(row.phase)||!Number.isSafeInteger(row.hangup_at)||row.hangup_at>now-60000||row.hangup_at<Date.parse(row.created_at)||row.hangup_at>row.expires_at+86400000||!['held','settled'].includes(row.hold_state)||row.reserved_seconds!==NOTICE_SECONDS||row.provider_seconds!==NOTICE_SECONDS||await reviewDigest(j)!==j.review_sha256)return null;
 if(await env.CRM_DB.prepare("SELECT 1 AS found FROM calling_jobs WHERE provider_call_sid=? UNION ALL SELECT 1 FROM verified_provider_call_costs WHERE provider_call_uuid=? UNION ALL SELECT 1 FROM verified_industry_call_costs WHERE provider_call_uuid=? LIMIT 1").bind(row.provider_call_id,row.provider_call_id,row.provider_call_id).first())return null;
 return row;
}
async function closeReceipt(env,j,now){
 if(j.state!=='receipt')return state('locked');
 const row=await terminal(env,j,now);
 if(!row||row.provider_call_id!==j.call_uuid||row.provider_request_id!==j.request_id||row.hangup_at!==j.hangup_at)return state('locked');
 const settled=await closeMinuteHold(env.CONTROL_DB,{tenantId:j.tenant_id,job:j.id,billedSeconds:j.billed_seconds,kind:'verified_cdr',evidenceRef:'plivo-cdr:'+j.call_uuid,now});
 return state(settled.ok&&await move(env.CRM_DB,j,'settled',now)?'settled':'locked');
}
export async function recoverNoticeJob(env,{tenantId:tid,jobId:id,now=Date.now(),fetcher=fetch}={}){
 const db=env.CRM_DB,j=await noticeJob(db,tid,id);
 if(!j)return state('not_found');
 if(j.state==='receipt')return closeReceipt(env,j,now);
 if(j.state==='no_post')return releaseUnused(env,j,now);
 if(j.state==='authorized'&&(j.release_expires_at<=now+115000||j.revoked_at!==null)){
  const r=await db.prepare("UPDATE industry_notice_jobs SET state='revoked',updated_at=? WHERE tenant_id=? AND id=? AND state='authorized' AND updated_at=?").bind(now,tid,id,j.updated_at).run();return state(r.meta.changes===1?'revoked':'locked');
 }
 if(j.state==='funded'&&(j.release_expires_at<=now+115000||j.revoked_at!==null))return noPost(env,j,now);
 if(j.state==='claimed'&&j.updated_at<=now-120000)return noPost(env,j,now);
 if(j.state==='claiming'&&j.updated_at<=now-120000){await move(db,j,'unknown',now);return state('locked')}
 if(!['posting','submitted','unknown'].includes(j.state)||!j.session_id)return state('pending');
 const row=await terminal(env,j,now);
 if(!row){
  if(['posting','submitted'].includes(j.state)&&j.updated_at<=now-600000)await move(db,j,'unknown',now);
  return state('pending');
 }
 const cdr=await readVerifiedPlivoCdr(env,{accountSid:row.provider_account_id,callUuid:row.provider_call_id,caller:row.caller,destination:row.destination},{fetcher});
 if(!cdr.ok||cdr.cdr.billed_duration%30!==0||cdr.cdr.billed_duration>NOTICE_SECONDS)return state('cdr_review_required');
 const fresh=await noticeJob(db,tid,id);if(!fresh)return state('locked');const s=await terminal(env,fresh,now);
 if(!fresh||!['posting','submitted','unknown'].includes(fresh.state)||!s||s.id!==row.id||s.provider_call_id!==row.provider_call_id||s.provider_request_id!==row.provider_request_id||s.hangup_at!==row.hangup_at||s.phase!==row.phase)return state('locked');
 const r=cdr.cdr,result=s.phase==='completed'?'announcement_issued':s.phase==='declined'?'declined':s.phase==='ended'?'ended':'needs_review';
 const saved=await db.prepare("UPDATE industry_notice_jobs SET state='receipt',request_id=?,call_uuid=?,hangup_at=?,billed_seconds=?,connected_seconds=?,reported_amount=?,result=?,verified_at=?,updated_at=? WHERE tenant_id=? AND id=? AND state=? AND updated_at=?").bind(s.provider_request_id,s.provider_call_id,s.hangup_at,r.billed_duration,r.call_duration,r.total_amount,result,now,now,tid,id,fresh.state,fresh.updated_at).run();
 if(saved.meta.changes!==1)return state('locked');
 return closeReceipt(env,await noticeJob(db,tid,id),now);
}
// At most one notice job per allocated cron lane, with a hard D1 budget.
// Existing property/School work keeps its own independent lanes.
export async function runIndustryNoticeTick(baseEnv,{now=Date.now(),apiFetch=fetch,cdrFetch=fetch,maxQueries=40,lane=null}={}){
 if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(maxQueries)||maxQueries<20||maxQueries>950)return null;
 let used=0;const take=n=>{if(used+n>maxQueries)throw Error('notice_query_budget');used+=n};
 const wrap=db=>({prepare(sql){const bound=s=>({bind(...args){return bound(s.bind(...args))},async first(...args){take(1);return s.first(...args)},async all(...args){take(1);return s.all(...args)},async run(...args){take(1);return s.run(...args)},inner:s});return bound(db.prepare(sql))},async batch(rows){take(rows.length);return db.batch(rows.map(x=>x.inner))}});
 const env={...baseEnv,CRM_DB:wrap(baseEnv.CRM_DB),CONTROL_DB:wrap(baseEnv.CONTROL_DB)},db=env.CRM_DB;
 const mode=enabled(env)?lane??['fund','dial','recover'][Math.floor(now/240000)%3]:'recover';
 if(!['fund','dial','recover'].includes(mode))return null;
 const predicate=mode==='fund'?"state='authorized' AND revoked_at IS NULL AND release_expires_at>?":mode==='dial'?"state='funded' AND revoked_at IS NULL AND release_expires_at>?":"state IN('receipt','no_post','posting','submitted','unknown') OR (state IN('authorized','funded') AND (release_expires_at<=? OR revoked_at IS NOT NULL)) OR (state IN('claiming','claimed') AND updated_at<=?)";
 let selected=false;
 try{
  const args=mode==='recover'?[now+115000,now-120000]:[now+115000];
  const count=(await db.prepare('SELECT COUNT(*) AS n FROM industry_notice_jobs WHERE '+predicate).bind(...args).first())?.n;
  if(!Number.isSafeInteger(count)||count<1)return null;
  const row=await db.prepare('SELECT tenant_id,id FROM industry_notice_jobs WHERE '+predicate+' ORDER BY tenant_id,id LIMIT 1 OFFSET ?').bind(...args,Math.floor(now/720000)%count).first();
  if(!row)return null;selected=true;
  const scope={tenantId:row.tenant_id,jobId:row.id,now};
  const out=mode==='fund'?await fundNoticeJob(env,scope):mode==='dial'?await dispatchNoticeJob(env,{...scope,fetcher:apiFetch}):await recoverNoticeJob(env,{...scope,fetcher:cdrFetch});
  return {lane:'notice_'+mode,...out,queriesUsed:used};
 }catch{return selected?{lane:'notice_'+mode,state:'locked',queriesUsed:used}:null}
}
