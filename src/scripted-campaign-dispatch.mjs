import {resolveCrmDb} from './core.mjs';
import {campaignDispatchInterlock,dispatchPausePredicate} from './calling-dispatch-pause.mjs';
import {moneyBudgetConfig,providerBudgetPosition,reserveBudgetedMinutes} from './provider-cost-reservations.mjs';
import {minutePosition,closeMinuteHold,fundingCap,fundingPosition,affordableCallSeconds,BILLING_PULSE_SECONDS} from './minute-holds.mjs';
import {SCRIPTED_CALLING_POLICY,approvedCampaignPhone,reserveCampaignQuestionnaire,campaignPromptMode,submitScriptedPhone} from './scripted-phone-pilot.mjs';
import {resolveFundingEnv,resolvedFunding} from './provider-funding.mjs';

export const CAMPAIGN_CRON='* * * * *';
// Capacity is set by the platform limits below (dispatchSettings): no fixed
// number of companies per minute and no per-company daily cap.
// Authenticated manual-balance setup carries the owner's dispatch permission.
// Older envelope configurations retain their explicit deployment release gate.
export const fundedDispatchApproved=env=>(env.AR3D_FUNDED_CAMPAIGN_DISPATCH==='approved'||
 resolvedFunding(env)?.source==='manual_balance'&&resolvedFunding(env)?.status==='ready')&&
 fundingCap(env)!==null&&moneyBudgetConfig(env)!==null;
export const creditOnlyCallingApproved=env=>fundedDispatchApproved(env)&&env.AR3D_CREDIT_ONLY_CALLING==='approved';
export async function scriptedCampaignConfiguration(env){
 env=await resolveFundingEnv(env);
 const carrier=Boolean(await approvedCampaignPhone(env)),funded=fundedDispatchApproved(env);
 const gate=carrier&&funded?await campaignDispatchInterlock(env.CONTROL_DB):{paused:false,providerBlocked:false};
 const blocked=gate.paused||gate.providerBlocked;
 const missing=[...(!carrier?['Plivo setup, a completed internal pilot and campaign authorization']:[]),...(!funded?[
  resolvedFunding(env)?.source==='manual_balance'?'Sync both current provider balances on Super Admin Dashboard. Available funds must cover one billing pulse.':
  'Reviewed provider funding setup and dispatch approval are required. Check Super Admin → Credit transactions → Provider funding setup.']:[])];
 if(gate.paused)missing.push('New campaign calls paused by Super Admin');
 if(gate.providerBlocked)missing.push('Provider billing or authentication fault requires Super Admin review');
 return {ready:carrier&&funded&&!blocked,carrierReady:carrier,dispatchPaused:gate.paused,missing,creditOnly:carrier&&!blocked&&creditOnlyCallingApproved(env),
  funding:{source:resolvedFunding(env).source,status:resolvedFunding(env).status}};
}
// A definitive provider rejection is the only automatic no-submission release.
// A missing session, request UUID, call UUID or ambiguous network outcome is
// never treated as evidence of a free call.
function preSubmissionBlocked(row){
 try{return JSON.parse(row.survey_json).phoneMeta?.preSubmissionBlocked===1}catch{return false}
}
async function releaseRejectedHold(env,job,row,now){
 if(row?.phase!=='rejected'||row.provider_call_id!==null||row.provider_request_id!==null)return;
 const result=await closeMinuteHold(env.CONTROL_DB,{tenantId:job.tenant_id,job:job.id,billedSeconds:0,kind:'verified_no_submission',evidenceRef:(preSubmissionBlocked(row)?'pre-submit-blocked:':'provider-rejected:')+row.id,now});
 if(!result.ok&&result.state!=='missing_hold')throw Error('minute release requires review');
}
export function inCallingWindow(now){
 const minutes=Math.floor((now+330*60000)/60000)%1440;
 return minutes>=9*60&&minutes<20*60; // explicit India-only product window
}

async function updateJob(db,job,state,at,{error=null,phase=null,call=null,duration=null,before=[]}={}){
 await db.batch([
  ...before,
  db.prepare(`INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)
   SELECT tenant_id,?,'scripted_campaign',?,id,? FROM calling_jobs
   WHERE tenant_id=? AND id=? AND state IN('reserved','submitted','unknown') AND state!=?`)
   .bind(crypto.randomUUID(),'calling.'+state,at,job.tenant_id,job.id,state),
  db.prepare(`UPDATE calling_jobs SET state=?,error_code=?,provider_status=?,provider_call_sid=COALESCE(?,provider_call_sid),
   duration_seconds=COALESCE(?,duration_seconds),updated_at=?
   WHERE tenant_id=? AND id=? AND state IN('reserved','submitted','unknown')`)
   .bind(state,error,phase,call,duration,at,job.tenant_id,job.id)
 ]);
}

// Save accepted partial answers only after a signed terminal hangup. The
// control row is the server-owned questionnaire, not a client transcript.
// A review snapshot is immutable and never edits the lead or grants consent.
function partialResultStatements(db,job,row,at){
 if(!['ended','needs_review'].includes(row.phase)||!row.provider_call_id||
    !Number.isSafeInteger(row.hangup_at)||row.lead_id!==job.lead_id||
    row.destination!==job.destination)return [];
 let survey;try{survey=JSON.parse(row.survey_json)}catch{return []}
 if(!survey||survey.version!==1||!['active','needs_review'].includes(survey.status)||
    !Number.isSafeInteger(survey.index)||survey.index<1||survey.index>6||
    !survey.answers||typeof survey.answers!=='object'||Array.isArray(survey.answers))return [];
 const fields=['propertyType','location','area','size','budgetInr','interest'];
 const keys=fields.slice(0,survey.index),answers=survey.answers;
 if(Object.hasOwn(answers,'budgetMinInr')){
  if(!keys.includes('budgetInr')||!Number.isSafeInteger(answers.budgetMinInr)||answers.budgetMinInr<10000||answers.budgetMinInr>answers.budgetInr)return [];
  keys.push('budgetMinInr');
 }
 if(Object.keys(answers).length!==keys.length||!keys.every(k=>Object.hasOwn(answers,k)))return [];
 if(!['plot','flat','house'].includes(answers.propertyType))return [];
 for(const k of ['location','area','size']){
  if(Object.hasOwn(answers,k)&&(typeof answers[k]!=='string'||answers[k].length<2||
     answers[k].length>(k==='size'?80:120)||/[\u0000-\u001f\u007f]/u.test(answers[k])))return [];
 }
 if(Object.hasOwn(answers,'budgetInr')&&(!Number.isSafeInteger(answers.budgetInr)||
    answers.budgetInr<10000||answers.budgetInr>1000000000000))return [];
 if(Object.hasOwn(answers,'interest')&&answers.interest!=='interested')return [];
 const snapshot=JSON.stringify({...Object.fromEntries(keys.map(k=>[k,answers[k]])),__partial:true});
 return [
  db.prepare(`INSERT INTO scripted_call_results(tenant_id,job_id,session_id,answers_json,saved_to_lead,captured_at)
   SELECT j.tenant_id,j.id,?,?,0,? FROM calling_jobs j JOIN leads l ON l.tenant_id=j.tenant_id AND l.id=j.lead_id
   WHERE j.tenant_id=? AND j.id=? AND j.state IN('reserved','submitted','unknown')
   AND l.id=? AND l.mobile_e164=? AND l.consent_status!='denied' AND l.dnd_status!='blocked'
   AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id)
   ON CONFLICT(tenant_id,job_id) DO NOTHING`).bind(row.id,snapshot,at,job.tenant_id,job.id,row.lead_id,row.destination),
  db.prepare(`INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)
   SELECT ?,?,'scripted_campaign','calling.partial_result_saved',?,? WHERE changes()=1`)
   .bind(job.tenant_id,crypto.randomUUID(),job.id,at)
 ];
}
async function reconcile(env,db,job,now,at){
 if(job.flow_id!==SCRIPTED_CALLING_POLICY)return {state:'legacy_job_locked'};
 const row=await env.CONTROL_DB.prepare(`SELECT id,lead_id,destination,survey_json,phase,expires_at,hangup_at,provider_call_id,provider_request_id,duration_seconds
  FROM scripted_phone_pilots WHERE tenant_id=? AND job_id=?`).bind(job.tenant_id,job.id).first();
 if(row?.phase==='rejected'){
  await releaseRejectedHold(env,job,row,now);
  await updateJob(db,job,'failed',at,{error:preSubmissionBlocked(row)?'eligibility_changed_before_submission':'plivo_rejected',phase:row.phase});
  return {state:'reconciled'};
 }
 if(row?.hangup_at!==null&&['completed','declined','ended','needs_review'].includes(row?.phase)){
  await updateJob(db,job,row.phase==='completed'?'completed':'failed',at,{
   error:row.phase==='completed'?null:'questionnaire_'+row.phase,phase:row.phase,
   call:row.provider_call_id,duration:row.duration_seconds,before:partialResultStatements(db,job,row,at)});
  return {state:'reconciled'};
 }
 if(job.state!=='unknown'&&now>= (row?.expires_at??Date.parse(job.reserved_at)+600000)){
  await updateJob(db,job,'unknown',at,{error:'provider_outcome_uncertain',phase:row?.phase??null});
 }
 return {state:'waiting_or_locked'};
}

// ---------- capacity settings ----------
export const DEFAULT_MAX_CONCURRENT_CALLS=8;     // ~Sarvam pay-as-you-go 60 STT req/min
export const DEFAULT_QUERY_BUDGET=45;            // Cloudflare Free: 50 D1 queries per invocation
const DIAL_QUERY_COST=19,RECONCILE_QUERY_COST=4; // normal claim path + two final eligibility reads; outer cron retains platform headroom
const intEnv=(v,lo,hi,def)=>{const n=Number(v);return Number.isSafeInteger(n)&&n>=lo&&n<=hi?n:def};
export async function dispatchSettings(env){
 const fallbackMax=intEnv(env.AR3D_MAX_CONCURRENT_CALLS,1,2000,DEFAULT_MAX_CONCURRENT_CALLS);
 let row=null;
 try{row=await env.CONTROL_DB.prepare('SELECT max_concurrent_calls AS maxConcurrent,max_calls_per_company AS maxPerCompany,updated_at AS updatedAt FROM calling_dispatch_settings WHERE id=1').first()}catch{}
 const maxConcurrent=row?.maxConcurrent??fallbackMax;
 return {maxConcurrent,maxPerCompany:Math.min(maxConcurrent,row?.maxPerCompany??Math.min(maxConcurrent,10)),
  queryBudget:intEnv(env.AR3D_DISPATCH_QUERY_BUDGET,20,950,DEFAULT_QUERY_BUDGET),saved:Boolean(row),updatedAt:row?.updatedAt??null};
}
export {providerThrottledUntil,signalProviderThrottle} from './capacity-signals.mjs';
import {providerThrottledUntil} from './capacity-signals.mjs';

// Counts D1 statements so one scheduled run never crosses the platform's
// per-invocation query limit in the middle of a provider submission.
function budgetedEnv(env,limit){
 const meter={used:0,limit};
 const wrapDb=db=>db&&{
  prepare(sql){const st=db.prepare(sql);const wrapSt=x=>({
   bind(...a){return wrapSt(x.bind(...a))},
   async first(...a){meter.used++;return x.first(...a)},async all(...a){meter.used++;return x.all(...a)},async run(...a){meter.used++;return x.run(...a)},
   __inner:x});return wrapSt(st)},
  async batch(list){meter.used+=list.length;return db.batch(list.map(x=>x.__inner||x))}
 };
 return {env:{...env,CONTROL_DB:wrapDb(env.CONTROL_DB),CRM_DB:wrapDb(env.CRM_DB)},meter,wrapDb};
}

// ---------- one company: reconcile and dial ----------
async function dispatchPreconditions(env,tid,db,now,cache){
 const at=new Date(now).toISOString();
 if(!cache.global){
  if(!fundedDispatchApproved(env))cache.global={state:'funding_approval_required'};
  else{
   const gate=await campaignDispatchInterlock(env.CONTROL_DB);
   cache.global=gate.paused?{state:'operator_dispatch_paused'}:gate.providerBlocked?{state:'provider_review_required'}:{ok:true};
  }
 }
 if(!cache.global.ok)return cache.global;
 if(cache.tenants.has(tid))return cache.tenants.get(tid);
 const policy=await db.prepare('SELECT * FROM calling_policies WHERE tenant_id=? AND enabled=1 AND expires_at>? AND flow_id=?').bind(tid,at,SCRIPTED_CALLING_POLICY).first();
 let result;
 if(!policy)result={state:'approval_required'};
 else{
  // Permanent suppression is terminal. Missing/expired approval stays queued so a later review can release it.
  await db.prepare(`UPDATE calling_jobs SET state='blocked',error_code='customer_suppressed',updated_at=?
   WHERE tenant_id=? AND state='queued' AND flow_id=? AND EXISTS(
    SELECT 1 FROM leads l WHERE l.tenant_id=calling_jobs.tenant_id AND l.id=calling_jobs.lead_id
    AND (l.consent_status='denied' OR l.dnd_status='blocked' OR EXISTS(
     SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id)))`)
   .bind(at,tid,SCRIPTED_CALLING_POLICY).run();
  result={ok:true,policy,prompts:new Map()};
 }
 cache.tenants.set(tid,result);return result;
}

// Dials the next eligible queued customer of ONE company, if that company has
// fewer than maxPerCompany live calls and no uncertain call awaiting review.
// Final read-only fence after durable job, money and session claims.
// Separate D1 databases and the external carrier cannot share a transaction.
async function stillEligibleForSubmission(env,db,job,policy,needed,reservedAt,now){
 if(env.AR3D_SCRIPTED_CAMPAIGNS_ENABLED!=='enabled'||!inCallingWindow(now))return false;
 const funded=await env.CONTROL_DB.prepare("SELECT 1 AS ok FROM tenants t JOIN tenant_minute_holds h ON h.tenant_id=t.id JOIN provider_cost_reservations p ON p.tenant_id=h.tenant_id AND p.job_id=h.job_id WHERE t.id=? AND t.status='active' AND t.storage_mode='shared' AND h.job_id=? AND h.state='held' AND h.reserved_seconds=? AND p.reserved_seconds=h.reserved_seconds AND "+dispatchPausePredicate).bind(job.tenant_id,job.id,needed).first();
 if(!funded)return false;
 const at=new Date(now).toISOString();
 return !!await db.prepare(`SELECT 1 AS ok FROM calling_jobs j
 JOIN calling_runs r ON r.tenant_id=j.tenant_id AND r.id=j.run_id
 JOIN call_campaign_drafts c ON c.tenant_id=r.tenant_id AND c.id=r.campaign_id
 JOIN leads l ON l.tenant_id=j.tenant_id AND l.id=j.lead_id
 JOIN calling_policies p ON p.tenant_id=j.tenant_id
 JOIN calling_clearances v ON v.tenant_id=j.tenant_id AND v.lead_id=j.lead_id AND v.purpose=c.purpose
 WHERE j.tenant_id=? AND j.id=? AND j.state='reserved' AND j.reserved_at=? AND j.flow_id=?
 AND j.destination=? AND r.state='running' AND c.purpose=? AND c.language_mode=?
 AND p.enabled=1 AND p.flow_id=j.flow_id AND p.updated_at=? AND p.expires_at>? AND p.max_seconds>=?
 AND v.reviewed_at=? AND v.reviewed_at>=p.updated_at AND v.expires_at>?
 AND l.id=? AND l.mobile_e164=j.destination AND l.updated_at=? AND l.consent_status!='denied' AND l.dnd_status!='blocked'
 AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id)`)
 .bind(job.tenant_id,job.id,reservedAt,SCRIPTED_CALLING_POLICY,job.destination,job.purpose,job.language,policy.updated_at,at,needed,job.clearance_reviewed_at,at,job.lead_id,job.lead_updated_at).first();
}
export async function dialNextForTenant(env,db,tid,config,{apiFetch=fetch,now=Date.now(),maxPerCompany=1,maxGlobalConcurrent=2147483647,cache={tenants:new Map()}}={}){
 const started=Date.now();
 const at=new Date(now).toISOString();
 if(!config||!inCallingWindow(now))return {state:'disabled_or_outside_hours'};
 const pre=await dispatchPreconditions(env,tid,db,now,cache);
 if(!pre.ok)return pre;
 const policy=pre.policy;
 // Choose the next eligible job, so an earlier unapproved lead cannot stall approved customers.
 const job=await db.prepare(`SELECT j.id,j.tenant_id,j.lead_id,l.mobile_e164 AS destination,l.updated_at AS lead_updated_at,
  c.purpose,c.language_mode AS language,r.created_by,v.reviewed_at AS clearance_reviewed_at
  FROM calling_jobs j JOIN calling_runs r ON r.tenant_id=j.tenant_id AND r.id=j.run_id
  JOIN call_campaign_drafts c ON c.tenant_id=r.tenant_id AND c.id=r.campaign_id
  JOIN leads l ON l.tenant_id=j.tenant_id AND l.id=j.lead_id
  JOIN calling_clearances v ON v.tenant_id=j.tenant_id AND v.lead_id=j.lead_id AND v.purpose=c.purpose
  WHERE j.tenant_id=? AND j.state='queued' AND j.flow_id=? AND r.state='running'
  AND v.expires_at>? AND v.reviewed_at>=?
  AND v.reviewed_at>COALESCE((SELECT MAX(h.reserved_at) FROM calling_jobs h WHERE h.tenant_id=j.tenant_id AND h.lead_id=j.lead_id),'')
  ORDER BY j.created_at,j.id LIMIT 1`).bind(tid,SCRIPTED_CALLING_POLICY,at,policy.updated_at).first();
 if(!job){
  await db.prepare(`UPDATE calling_runs SET state='completed',updated_at=? WHERE tenant_id=? AND state='running'
   AND NOT EXISTS(SELECT 1 FROM calling_jobs j WHERE j.tenant_id=calling_runs.tenant_id AND j.run_id=calling_runs.id
     AND j.state IN('queued','reserved','submitted','unknown'))`).bind(at,tid).run();
  return {state:'idle_or_clearance_required'};
 }
 if(!/^\+91[6-9]\d{9}$/.test(job.destination||'')||!['hi','en'].includes(job.language)){
  await db.prepare("UPDATE calling_jobs SET state='blocked',error_code='unsupported_destination_or_language',updated_at=? WHERE tenant_id=? AND id=? AND state='queued'")
   .bind(at,tid,job.id).run();
  return {state:'blocked'};
 }
 if(!pre.prompts.has(job.language))pre.prompts.set(job.language,await campaignPromptMode(env,job.language,tid));
 const promptMode=pre.prompts.get(job.language);
 if(!promptMode)return {state:'prompts_incomplete'};
 const position=await minutePosition(env.CONTROL_DB,tid),cap=fundingCap(env);
 if(position.uncommittedSeconds<BILLING_PULSE_SECONDS)return {state:'insufficient_credits'};
 const funding=await fundingPosition(env.CONTROL_DB,cap),budgetConfig=moneyBudgetConfig(env);
 const money=await providerBudgetPosition(env.CONTROL_DB,budgetConfig);
 const needed=affordableCallSeconds(policy.max_seconds,position.uncommittedSeconds,Math.min(funding.remainingFundedSeconds,money.remainingSeconds));
 if(needed<BILLING_PULSE_SECONDS)return {state:'provider_funding_exhausted'};
 // D1 serializes this ONE reservation statement: approval, clearance, suppression,
 // per-company live-call limit and "no uncertain call" are checked atomically.
 // Prepaid minutes and provider ceilings (below) are the only volume limits.
 let reserved;
 try{
  reserved=await db.prepare("UPDATE calling_jobs SET state='reserved',reserved_at=?,updated_at=?,account_sid=?,caller_id=?,flow_id=?,destination=? WHERE tenant_id=? AND id=? AND state='queued' AND EXISTS(SELECT 1 FROM calling_runs r WHERE r.tenant_id=calling_jobs.tenant_id AND r.id=calling_jobs.run_id AND r.state='running') AND EXISTS(SELECT 1 FROM calling_policies p WHERE p.tenant_id=? AND p.enabled=1 AND p.expires_at>? AND p.updated_at=? AND p.flow_id=?) AND EXISTS(SELECT 1 FROM calling_clearances v JOIN leads l ON l.tenant_id=v.tenant_id AND l.id=v.lead_id WHERE v.tenant_id=? AND v.lead_id=? AND v.purpose=? AND v.expires_at>? AND v.reviewed_at>=? AND v.reviewed_at>COALESCE((SELECT MAX(h.reserved_at) FROM calling_jobs h WHERE h.tenant_id=v.tenant_id AND h.lead_id=v.lead_id),'') AND l.consent_status!='denied' AND l.dnd_status!='blocked' AND l.mobile_e164=? AND l.updated_at=? AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id)) AND NOT EXISTS(SELECT 1 FROM calling_jobs x WHERE x.tenant_id=? AND x.state='unknown') AND (SELECT COUNT(*) FROM calling_jobs x WHERE x.tenant_id=? AND x.state IN('reserved','submitted'))<? AND (SELECT COUNT(*) FROM calling_jobs g WHERE g.state IN('reserved','submitted','unknown'))<?")
  .bind(at,at,config.authId,config.caller,policy.flow_id,job.destination,tid,job.id,tid,at,policy.updated_at,SCRIPTED_CALLING_POLICY,tid,job.lead_id,job.purpose,at,policy.updated_at,job.destination,job.lead_updated_at,tid,tid,maxPerCompany,maxGlobalConcurrent).run();
 }catch{return {state:'quota_or_concurrent_change'}} // e.g. a legacy one-call-per-company index
 if(Number(reserved.meta?.changes)!==1)return {state:'quota_or_concurrent_change'};
 try{
  // CRM and Control are separate D1 databases. Claim CRM first, then reserve
  // credits before creating any provider session. A crash locks the attempt
  // for review; never retry a provider POST or silently release a hold.
  const hold=await reserveBudgetedMinutes(env.CONTROL_DB,{tenantId:tid,job:job.id,maxSeconds:needed,now,globalCap:cap,config:budgetConfig});
  if(!hold.ok||hold.replayed){
   if(!hold.ok&&hold.state==='insufficient_or_unavailable'){
    await updateJob(db,job,'failed',at,{error:'credit_reservation_unavailable'});
    return {state:'insufficient_credits'};
   }
   return {state:'locked'};
  }
  const id=await reserveCampaignQuestionnaire(env.CONTROL_DB,{...config,promptMode},job,now);
  const outcome=await submitScriptedPhone(env.CONTROL_DB,config,id,job.destination,needed,apiFetch,{commercial:true,beforeSubmit:()=>stillEligibleForSubmission(env,db,job,policy,needed,at,now+Math.max(0,Date.now()-started))});
  if(outcome==='rejected'||outcome==='cancelled'){
   const rejected=await env.CONTROL_DB.prepare('SELECT id,phase,provider_call_id,provider_request_id,survey_json FROM scripted_phone_pilots WHERE tenant_id=? AND job_id=? AND id=?').bind(tid,job.id,id).first();
   await releaseRejectedHold(env,job,rejected,now);
   if(rejected?.phase!=='rejected'||rejected.provider_call_id!==null||rejected.provider_request_id!==null)return {state:'locked'};
  }
  const state=['rejected','cancelled'].includes(outcome)?'failed':outcome;
  await updateJob(db,job,state,at,{error:outcome==='cancelled'?'eligibility_changed_before_submission':state==='failed'?'plivo_rejected':state==='unknown'?'provider_outcome_uncertain':null});
  return {state};
 }catch{
  // A reservation survives crashes and ambiguous network responses. Never automatically redial.
  return {state:'locked'};
 }
}

// Single-company step used by tools and tests: finish one in-flight call if
// any, otherwise dial at most one customer.
export async function tickScriptedTenant(env,db,tid,config,{apiFetch=fetch,now=Date.now(),maxPerCompany=1}={}){
 const at=new Date(now).toISOString();
 const pending=await db.prepare("SELECT * FROM calling_jobs WHERE tenant_id=? AND state IN('reserved','submitted','unknown') LIMIT 1").bind(tid).first();
 if(pending&&maxPerCompany<=1)return reconcile(env,db,pending,now,at);
 env=await resolveFundingEnv(env);
 return dialNextForTenant(env,db,tid,config,{apiFetch,now,maxPerCompany});
}

// Reconcile in-flight jobs of one company whose call has ended, was rejected or
// has passed its expiry. Live calls are not touched.
async function reconcileTenantJobs(env,db,tid,jobs,now,meter){
 const at=new Date(now).toISOString();let finished=0;
 for(let i=0;i<jobs.length;i+=90){
  if(meter&&meter.used+RECONCILE_QUERY_COST>meter.limit)break;
  const chunk=jobs.slice(i,i+90);
  const rows=(await env.CONTROL_DB.prepare(`SELECT job_id FROM scripted_phone_pilots WHERE tenant_id=? AND job_id IN (${chunk.map(()=>'?').join(',')})
   AND (phase='rejected' OR (hangup_at IS NOT NULL AND phase IN('completed','declined','ended','needs_review')) OR expires_at<=?)`)
   .bind(tid,...chunk.map(j=>j.id),now).all()).results||[];
  const ready=new Set(rows.map(r=>r.job_id));
  for(const job of chunk){
   const stale=job.state!=='unknown'&&now>=Date.parse(job.reserved_at)+600000;
   if(!ready.has(job.id)&&!stale)continue;
   if(meter&&meter.used+RECONCILE_QUERY_COST>meter.limit)return finished;
   try{const r=await reconcile(env,db,job,now,at);if(r.state==='reconciled'){finished++;job.done=true}}catch{console.error('AR3D campaign reconcile unavailable')}
  }
 }
 return finished;
}

function rotate(list,now){if(!list.length)return list;const k=Math.floor(now/60000)%list.length;return [...list.slice(k),...list.slice(0,k)]}

export async function runScriptedCampaignCron(baseEnv,{now=Date.now(),apiFetch=fetch,settings=null}={}){
 if(baseEnv.AR3D_SCRIPTED_CAMPAIGNS_ENABLED!=='enabled')return {processed:0};
 // Bad schedule inputs fail closed before making any provider or CRM request.
 if(!Number.isSafeInteger(now)||now<0)throw Error('invalid Calling cron time');
 const config=await approvedCampaignPhone(baseEnv);
 if(!config)return {processed:0};
 const cfg=settings||await dispatchSettings(baseEnv);
 let {env,meter}=budgetedEnv(baseEnv,cfg.queryBudget);
 const db=env.CRM_DB;
 // Shared-CRM companies only; dedicated CRM databases are not provisioned.
 const active=new Set(((await env.CONTROL_DB.prepare("SELECT id FROM tenants WHERE status='active' AND storage_mode='shared'").all()).results||[]).map(r=>r.id));
 // Reconcile already-submitted shared CRM jobs even when their tenant is suspended.
 const inflight=((await db.prepare(`SELECT tenant_id,id,state,reserved_at,flow_id,lead_id,destination,run_id FROM calling_jobs
  WHERE state IN('reserved','submitted','unknown') ORDER BY reserved_at LIMIT 5000`).all()).results||[]);
 const byTenant=new Map();
 for(const j of inflight){if(!byTenant.has(j.tenant_id))byTenant.set(j.tenant_id,[]);byTenant.get(j.tenant_id).push(j)}
 // 1. Close finished calls first so their lines are free for new customers.
 let reconciled=0;
 for(const tid of rotate([...byTenant.keys()],now)){
  if(meter.used+RECONCILE_QUERY_COST>meter.limit)break;
  try{reconciled+=await reconcileTenantJobs(env,db,tid,byTenant.get(tid),now,meter)}catch{console.error('AR3D campaign reconcile unavailable')}
 }
 const live=new Map(),uncertain=new Set();let globalLive=0,unknownSlots=0;
 for(const [tid,jobs] of byTenant)for(const j of jobs){
  if(j.done)continue;
  if(j.state==='unknown'){uncertain.add(tid);unknownSlots++;continue}
  live.set(tid,(live.get(tid)||0)+1);globalLive++;
 }
 // 2. Fair fill: one new call per company per pass, until the platform limit,
 // the per-company limit, the query budget or the queue runs out.
 let dialed=0,processed=0,free=Math.max(0,cfg.maxConcurrent-globalLive-unknownSlots);
 const throttled=await providerThrottledUntil(env)>now;
 if(active.size&&!throttled&&free>0&&inCallingWindow(now)){
  env=await resolveFundingEnv(env);
  const running=((await db.prepare("SELECT DISTINCT tenant_id FROM calling_runs WHERE state='running' LIMIT 5000").all()).results||[])
   .map(r=>r.tenant_id).filter(t=>active.has(t)&&!uncertain.has(t));
  // Fair order: fewer live calls first, then the company served longest ago.
  const since=new Date(now-86400000).toISOString();
  const served=new Map(((await db.prepare("SELECT tenant_id,MAX(reserved_at) AS last FROM calling_jobs WHERE reserved_at>=? GROUP BY tenant_id").bind(since).all()).results||[]).map(r=>[r.tenant_id,r.last]));
  let queue=rotate(running.sort(),now).map((t,i)=>[t,i]).sort((a,b)=>(live.get(a[0])||0)-(live.get(b[0])||0)||
   String(served.get(a[0])||'').localeCompare(String(served.get(b[0])||''))||a[1]-b[1]).map(x=>x[0]);const cache={tenants:new Map()};
  while(queue.length&&free>0){
   const next=[];
   for(const tid of queue){
    if(free<=0||meter.used+DIAL_QUERY_COST>meter.limit){next.length=0;queue=[];break}
    if((live.get(tid)||0)>=cfg.maxPerCompany)continue;
    processed++;
    let r;
    try{r=await dialNextForTenant(env,db,tid,config,{apiFetch,now,maxPerCompany:cfg.maxPerCompany,maxGlobalConcurrent:cfg.maxConcurrent,cache})}
    catch{console.error('AR3D scripted campaign processing unavailable');continue}
    if(r.state==='submitted'){dialed++;free--;live.set(tid,(live.get(tid)||0)+1);next.push(tid)}
    else if(r.state==='unknown'||r.state==='locked'){free--;unknownSlots++;}
    else if(r.state==='funding_approval_required'||r.state==='provider_review_required'||r.state==='operator_dispatch_paused'){queue=[];next.length=0;break}
   }
   queue=next;
  }
 }
 // Aggregate counters only: no customer names, tenant IDs, provider tokens or
 // CRM answers in scheduled logs.
 return {processed,dialed,reconciled,liveCalls:globalLive+dialed,occupiedSlots:globalLive+dialed+unknownSlots,maxConcurrent:cfg.maxConcurrent,throttled,queriesUsed:meter.used,activeTenants:active.size};
}
