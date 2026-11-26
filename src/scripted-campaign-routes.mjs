import {requireMembership,mutationOriginAllowed} from './human-auth.mjs';
import {resolveCrmDb,parseJsonBody} from './core.mjs';
import {scriptedCampaignConfiguration,dispatchSettings,providerThrottledUntil} from './scripted-campaign-dispatch.mjs';
import {minutePosition,fundingCap,fundingPosition,affordableCallSeconds,BILLING_PULSE_SECONDS} from './minute-holds.mjs';
import {moneyBudgetConfig,providerBudgetPosition} from './provider-cost-reservations.mjs';
import {SCRIPTED_CALLING_POLICY,scriptedPromptsReady,approvedCampaignPhone} from './scripted-phone-pilot.mjs';
import {resolveFundingEnv} from './provider-funding.mjs';
import {enableClientCalling,validCallingActivationReference} from './client-calling-activation.mjs';
import {setManualFundingEnabled} from './manual-provider-balances.mjs';
import {readCallingAttemptEvidence} from './calling-attempt-evidence.mjs';
import {releaseUnusedReservation} from './unused-reservation-recovery.mjs';
const BASE='/v1/human/calling';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(error,status=400)=>json({error},status);
// Preserve the exact reserved target. Only a queued job may fall back to the
// current lead number, and the source remains explicit in both read-only views.
const targetColumns=`CASE WHEN j.destination IS NOT NULL THEN substr(j.destination,-4)
 WHEN j.state='queued' THEN substr(l.mobile_e164,-4) ELSE NULL END AS destinationLast4,
 CASE WHEN j.destination IS NOT NULL THEN 'attempt' WHEN j.state='queued' THEN 'queued_lead'
 ELSE 'unavailable' END AS destinationSource`;
const reference=v=>typeof v==='string'&&v.trim().length>=4&&v.length<=160&&!/[\u0000-\u001f]/.test(v);
// Company approval and clearances may last up to one year; review can revoke earlier.
const expiry=(v,now)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Date.parse(v)>now&&Date.parse(v)<=now+366*86400000;
async function body(req){
 if(!req.body||!req.headers.get('content-type')?.startsWith('application/json'))throw Error('invalid JSON');
 let raw='',size=0;const reader=req.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
 if(size>16000){await reader.cancel();throw Error('too large')}raw+=decoder.decode(value,{stream:true})}
 raw+=decoder.decode();}finally{reader.releaseLock()}
 return parseJsonBody(raw,16000);
}
async function freshAdmin(env,user,now){
 if(user.globalRole!=='super_admin')return false;
 return !!await env.CONTROL_DB.prepare('SELECT m.enabled_at FROM human_mfa_settings m JOIN human_sessions s ON s.user_id=m.user_id WHERE m.user_id=? AND s.token_hash=? AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1')
 .bind(user.id,user.token_hash,now).first();
}
export const CONSENT_SOURCES=['website_enquiry','site_visit_register','existing_customer','referral','advertisement_lead','other'];
async function consentMode(env,tid){
 try{const r=await env.CONTROL_DB.prepare('SELECT consent_mode AS mode FROM calling_company_settings WHERE tenant_id=?').bind(tid).first();return r?.mode==='client_declared'?'client_declared':'reviewed'}
 catch{return 'reviewed'}
}
async function audit(db,tid,user,action,target,at){
 await db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) VALUES(?,?,'human:'||?,?,?,?)")
 .bind(tid,crypto.randomUUID(),user.id,action,target,at).run();
}
async function creditPreflight(env,tid,policy,configuration){
 const position=await minutePosition(env.CONTROL_DB,tid);
 const requiredSeconds=policy?BILLING_PULSE_SECONDS:null;
 const unavailable={availableSeconds:position.uncommittedSeconds,requiredSeconds,ready:false};
 if(!policy?.enabled||requiredSeconds===null)return {...unavailable,reason:'approval_required'};
 const manual=configuration.funding?.source==='manual_balance';
 if(!configuration.ready){
  let reason='approval_required';
  // Missing funds do not revoke an owner's existing company authorization.
  // Keep carrier/policy problems distinct from copying or replenishing money.
  if(manual&&configuration.carrierReady===true&&configuration.funding.status!=='ready'){
   reason=configuration.funding.status==='disabled'?'funding_disabled':
    configuration.funding.status==='money_budget_exhausted'?'provider_balance_exhausted':'provider_balance_required';
  }
  return {...unavailable,reason};
 }
 if(position.uncommittedSeconds<requiredSeconds)return {availableSeconds:position.uncommittedSeconds,requiredSeconds,ready:false,reason:'insufficient_credits'};
 const funding=await fundingPosition(env.CONTROL_DB,fundingCap(env));
 const money=await providerBudgetPosition(env.CONTROL_DB,moneyBudgetConfig(env));
 const maxCallSeconds=affordableCallSeconds(policy.maxSeconds,position.uncommittedSeconds,Math.min(funding.remainingFundedSeconds,money.remainingSeconds));
 const ready=maxCallSeconds>=requiredSeconds;
 return {availableSeconds:position.uncommittedSeconds,requiredSeconds,maxCallSeconds,ready,
  reason:ready?null:manual?'provider_balance_exhausted':'funding_review_required'};
}
export async function handleScriptedCallingRequest(req,env,user,{now=Date.now()}={}){
 const url=new URL(req.url),path=url.pathname;
 if(!path.startsWith(BASE+'/'))return null;
 const action=path.slice(BASE.length+1);
 if(!['GET','POST'].includes(req.method))return fail('method_not_allowed',405);
 if(req.method==='POST'&&!mutationOriginAllowed(req))return fail('same_origin_required',403);
 const admin=['policy','clearances','reconcile','release-unused-reservation'].includes(action);
 if(!['policy','clearances','runs','state','results','reconcile','review-partial','capacity','enable-clients','release-unused-reservation'].includes(action))return fail('not_found',404);
 try{
  const d=req.method==='POST'?await body(req):Object.fromEntries(url.searchParams);
  if(action==='enable-clients'){
   if(req.method!=='POST')return fail('method_not_allowed',405);
   if(!await freshAdmin(env,user,now))return fail('current_super_admin_mfa_required',403);
   if(url.search||Object.keys(d).length!==1||!Object.hasOwn(d,'reference')||
      !validCallingActivationReference(d.reference))return fail('invalid_activation');
   if(!await approvedCampaignPhone(env))return fail('scripted_campaign_setup_required',409);
   const control=await env.CONTROL_DB.prepare('SELECT enabled,revision FROM provider_manual_funding_control WHERE id=1').first();
   if(control?.enabled!==1){
    const enabled=await setManualFundingEnabled(env.CONTROL_DB,{enabled:true,expectedRevision:control?.revision??0},user.id,now);
    if(!enabled.ok)return fail('manual_funding_control_changed',409);
   }
   return json(await enableClientCalling(env,{reference:d.reference,actor:user.id,now}));
  }
  env=await resolveFundingEnv(env);
  // Platform-wide calling capacity (not company-scoped).
  if(action==='capacity'){
   if(!await freshAdmin(env,user,now))return fail('current_super_admin_mfa_required',403);
   if(req.method==='POST'){
    if(Object.keys(d).some(k=>!['maxConcurrent','maxPerCompany'].includes(k))||!Number.isInteger(d.maxConcurrent)||d.maxConcurrent<1||d.maxConcurrent>2000||
     !Number.isInteger(d.maxPerCompany)||d.maxPerCompany<1||d.maxPerCompany>500)return fail('invalid_capacity');
    await env.CONTROL_DB.prepare(`INSERT INTO calling_dispatch_settings(id,max_concurrent_calls,max_calls_per_company,updated_by,updated_at) VALUES(1,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET max_concurrent_calls=excluded.max_concurrent_calls,max_calls_per_company=excluded.max_calls_per_company,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
     .bind(d.maxConcurrent,d.maxPerCompany,user.id,new Date(now).toISOString()).run();
   }else if(Object.keys(d).length)return fail('invalid_query');
   const settings=await dispatchSettings(env);
   let liveCalls=null;
   try{liveCalls=Number((await env.CRM_DB.prepare("SELECT COUNT(*) AS n FROM calling_jobs WHERE state IN('reserved','submitted')").first())?.n)}catch{}
   const until=await providerThrottledUntil(env);
   return json({maxConcurrent:settings.maxConcurrent,maxPerCompany:settings.maxPerCompany,saved:settings.saved,updatedAt:settings.updatedAt,
    liveCalls,sarvamPausedUntil:until>now?new Date(until).toISOString():null,queryBudget:settings.queryBudget});
  }
  if(!UUID.test(d.tenantId||''))return fail('invalid_tenant');
  let member;
  const adminRead=req.method==='GET'&&['state','results'].includes(action)&&user?.globalRole==='super_admin';
  if(admin||adminRead){
   if(!await freshAdmin(env,user,now))return fail('current_super_admin_mfa_required',403);
   const t=await env.CONTROL_DB.prepare("SELECT id AS tenant_id,storage_mode,dedicated_binding,status FROM tenants WHERE id=? AND status IN('trial','active')").bind(d.tenantId).first();
   if(!t)return fail('tenant_unavailable',404);member=t;
  }else{
   member=await requireMembership(env.CONTROL_DB,user,d.tenantId,req.method==='POST');
   if(!member)return fail('forbidden',403);
  }
  const db=resolveCrmDb(env,member),tid=member.tenant_id,at=new Date(now).toISOString();
  if(action==='release-unused-reservation'){
   if(req.method!=='POST')return fail('method_not_allowed',405);
   if(url.search||Object.keys(d).length!==2||Object.keys(d).some(k=>!['tenantId','jobId'].includes(k))||
      !(UUID.test(d.jobId||'')||/^[a-f0-9]{32}$/i.test(d.jobId||'')))return fail('invalid_reservation_selection');
   const result=await releaseUnusedReservation(env,db,{tenantId:tid,jobId:d.jobId},user.id,now);
   return result.ok?json(result):fail(result.state,409);
  }
  if(action==='policy'&&req.method==='GET')return json({consentMode:await consentMode(env,tid),policy:await db.prepare('SELECT enabled,approval_reference AS approvalReference,expires_at AS expiresAt,daily_limit AS dailyLimit,max_seconds AS maxSeconds FROM calling_policies WHERE tenant_id=? AND flow_id=?').bind(tid,SCRIPTED_CALLING_POLICY).first(),configuration:await scriptedCampaignConfiguration(env)});
  if(action==='policy'){
   if(Object.keys(d).some(k=>!['tenantId','enabled','approvalReference','expiresAt','dailyLimit','maxSeconds','consentMode'].includes(k))||(d.consentMode!==undefined&&!['reviewed','client_declared'].includes(d.consentMode))||
    typeof d.enabled!=='boolean'||!reference(d.approvalReference)||!expiry(d.expiresAt,now)||
    (d.dailyLimit!==undefined&&(!Number.isInteger(d.dailyLimit)||d.dailyLimit<1||d.dailyLimit>100))||!Number.isInteger(d.maxSeconds)||d.maxSeconds<180||d.maxSeconds>300)return fail('invalid_policy');
   if(d.enabled&&!(await scriptedCampaignConfiguration(env)).ready)return fail('scripted_campaign_setup_required',409);
   await db.batch([
    db.prepare('INSERT INTO calling_policies(tenant_id,enabled,flow_id,approval_reference,expires_at,daily_limit,max_seconds,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET enabled=excluded.enabled,flow_id=excluded.flow_id,approval_reference=excluded.approval_reference,expires_at=excluded.expires_at,daily_limit=excluded.daily_limit,max_seconds=excluded.max_seconds,updated_by=excluded.updated_by,updated_at=excluded.updated_at')
    .bind(tid,Number(d.enabled),SCRIPTED_CALLING_POLICY,d.approvalReference,d.expiresAt,d.dailyLimit??100,d.maxSeconds,user.id,at), // daily_limit is legacy and not enforced
    db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) VALUES(?,?,'human:'||?,'calling.policy_reviewed',?,?)").bind(tid,crypto.randomUUID(),user.id,tid,at)
   ]);
   if(d.consentMode)await env.CONTROL_DB.prepare(`INSERT INTO calling_company_settings(tenant_id,consent_mode,updated_by,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET consent_mode=excluded.consent_mode,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(tid,d.consentMode,user.id,at).run();
   if(d.enabled&&member.status==='trial'){
    await env.CONTROL_DB.batch([
     env.CONTROL_DB.prepare("UPDATE tenants SET status='active',updated_at=? WHERE id=? AND status='trial'").bind(at,tid),
     env.CONTROL_DB.prepare("INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,created_at) VALUES(?,?,?,'tenant.calling_activated',?,?)").bind(crypto.randomUUID(),tid,user.id,tid,at)
    ]);
   }
   return json({saved:true,enabled:d.enabled});
  }
  if(action==='clearances'&&req.method==='GET'){
   const rows=await db.prepare('SELECT v.lead_id AS leadId,l.name,v.purpose,v.expires_at AS expiresAt,v.consent_reference AS consentReference,v.dnd_reference AS dndReference FROM calling_clearances v JOIN leads l ON l.tenant_id=v.tenant_id AND l.id=v.lead_id WHERE v.tenant_id=? ORDER BY v.reviewed_at DESC LIMIT 200').bind(tid).all();
   if(d.campaignId!==undefined&&!UUID.test(d.campaignId))return fail('invalid_campaign');
   const campaign=d.campaignId??null,offset=Number(d.offset??0);
   if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return fail('invalid_pagination');
   const leads=await db.prepare(`SELECT l.id,l.name,l.consent_status AS consentStatus,l.dnd_status AS dndStatus
    FROM leads l WHERE l.tenant_id=? AND (? IS NULL OR EXISTS(
     SELECT 1 FROM call_campaign_candidates c WHERE c.tenant_id=l.tenant_id AND c.lead_id=l.id AND c.campaign_id=?
    )) ORDER BY l.created_at DESC,l.id DESC LIMIT 201 OFFSET ?`).bind(tid,campaign,campaign,offset).all();
   const drafts=await db.prepare('SELECT id,name FROM call_campaign_drafts WHERE tenant_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(tid).all();
   return json({campaigns:drafts.results,clearances:rows.results,leads:leads.results.slice(0,200),hasMore:leads.results.length>200});
  }
  if(action==='clearances'){
   if(Object.keys(d).some(k=>!['tenantId','leadIds','purpose','consentReference','dndReference','expiresAt'].includes(k))||
    !Array.isArray(d.leadIds)||d.leadIds.length<1||d.leadIds.length>200||d.leadIds.some(x=>!UUID.test(x))||new Set(d.leadIds).size!==d.leadIds.length||
    !['property_information','site_visit'].includes(d.purpose)||!reference(d.consentReference)||!reference(d.dndReference)||!expiry(d.expiresAt,now))return fail('invalid_clearance');
   const reviewed=await db.batch([
    db.prepare(`INSERT INTO calling_clearances(tenant_id,lead_id,purpose,consent_reference,dnd_reference,expires_at,reviewed_by,reviewed_at)
     SELECT tenant_id,id,?,?,?,?,?,? FROM leads WHERE tenant_id=? AND id IN (SELECT value FROM json_each(?))
     AND consent_status!='denied' AND dnd_status!='blocked' AND NOT EXISTS(
       SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=leads.tenant_id AND o.lead_id=leads.id)
     ON CONFLICT(tenant_id,lead_id,purpose) DO UPDATE SET consent_reference=excluded.consent_reference,dnd_reference=excluded.dnd_reference,
      expires_at=excluded.expires_at,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at`)
     .bind(d.purpose,d.consentReference,d.dndReference,d.expiresAt,user.id,at,tid,JSON.stringify(d.leadIds)),
    db.prepare(`INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)
     VALUES(?,?,'human:'||?,'calling.clearances_reviewed',?,?)`).bind(tid,crypto.randomUUID(),user.id,tid,at)
   ]);
   return json({reviewed:Number(reviewed[0].meta?.changes||0)});
  }
  if(action==='reconcile'){
   const cutoff=new Date(now-30*60000).toISOString();
   if(req.method==='GET'){
    const locked=await db.prepare(`SELECT j.id,l.name AS customer,c.name AS campaign,j.reserved_at AS reservedAt,
     r.state AS runState,j.reserved_at<=? AS canClose
     FROM calling_jobs j JOIN calling_runs r ON r.tenant_id=j.tenant_id AND r.id=j.run_id
     JOIN call_campaign_drafts c ON c.tenant_id=r.tenant_id AND c.id=r.campaign_id
     JOIN leads l ON l.tenant_id=j.tenant_id AND l.id=j.lead_id
     WHERE j.tenant_id=? AND j.flow_id=? AND j.state='unknown' LIMIT 1`).bind(cutoff,tid,SCRIPTED_CALLING_POLICY).first();
    return json({locked});
   }
   if(Object.keys(d).some(key=>!['tenantId','jobId','evidenceReference'].includes(key))||
      !/^[a-f0-9]{32}$/.test(d.jobId||'')||!reference(d.evidenceReference))return fail('invalid_carrier_review');
   // Only a paused run may be unlocked, and only after the provider has had time to finish.
   // The original attempt is closed, preserving its reservation for future consent checks.
   const result=await db.batch([
    db.prepare(`UPDATE calling_jobs SET state=CASE WHEN EXISTS(SELECT 1 FROM scripted_call_results a
      WHERE a.tenant_id=calling_jobs.tenant_id AND a.job_id=calling_jobs.id AND a.saved_to_lead=1) THEN 'completed' ELSE 'failed' END,
      error_code='closed_after_carrier_review',provider_status='operator_reviewed',updated_at=?
      WHERE tenant_id=? AND id=? AND flow_id=? AND state='unknown' AND reserved_at<=? AND EXISTS(
       SELECT 1 FROM calling_runs r WHERE r.tenant_id=calling_jobs.tenant_id AND r.id=calling_jobs.run_id AND r.state='paused')`)
     .bind(at,tid,d.jobId,SCRIPTED_CALLING_POLICY,cutoff),
    db.prepare(`INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)
      SELECT tenant_id,?,'human:'||?,'calling.carrier_reviewed',id||':'||?,? FROM calling_jobs
      WHERE tenant_id=? AND id=? AND changes()=1`).bind(crypto.randomUUID(),user.id,d.evidenceReference.trim(),at,tid,d.jobId)
   ]);
   return result[0].meta.changes===1?json({closed:true}):fail('pause_campaign_and_verify_carrier_status_before_closing',409);
  }
  if(action==='review-partial'){
   if(req.method!=='POST')return fail('method_not_allowed',405);
   if(Object.keys(d).length!==3||Object.keys(d).some(k=>!['tenantId','jobId','expectedUpdatedAt'].includes(k))||
      !(UUID.test(d.jobId||'')||/^[a-f0-9]{32}$/i.test(d.jobId||''))||typeof d.expectedUpdatedAt!=='string'||d.expectedUpdatedAt.length>40||!Number.isFinite(Date.parse(d.expectedUpdatedAt)))return fail('invalid_partial_review');
   const row=await db.prepare(`SELECT j.lead_id AS leadId,a.answers_json AS answersJson,a.captured_at AS capturedAt,
    l.updated_at AS leadUpdatedAt,l.requirements_json AS requirements,l.consent_status AS consent,l.dnd_status AS dnd,l.interest_status AS interest,
    l.preferred_location AS location,l.plot_size_preference AS size,l.budget_min_inr AS min,l.budget_max_inr AS max
    FROM scripted_call_results a JOIN calling_jobs j ON j.tenant_id=a.tenant_id AND j.id=a.job_id
    JOIN leads l ON l.tenant_id=j.tenant_id AND l.id=j.lead_id
    WHERE a.tenant_id=? AND a.job_id=? AND j.state IN ('completed','failed') AND a.saved_to_lead=0`).bind(tid,d.jobId).first();
   if(!row)return fail('partial_result_unavailable',404);
   const reviewed=await db.prepare("SELECT 1 AS done FROM crm_audit_events WHERE tenant_id=? AND action='calling.partial_reviewed' AND target_id=? LIMIT 1").bind(tid,d.jobId).first();
   if(reviewed)return json({reviewed:true,replayed:true});
   if(row.leadUpdatedAt!==d.expectedUpdatedAt||row.interest==='converted'||row.consent==='denied'||row.dnd==='blocked')return fail('customer_changed_or_suppressed',409);
   const snapshot=JSON.parse(row.answersJson),prior=JSON.parse(row.requirements||'{}');
   if(snapshot?.__partial!==true||!prior||typeof prior!=='object'||Array.isArray(prior))return fail('partial_result_unavailable',409);
   delete snapshot.__partial;
   const text=(s,max)=>typeof s==='string'&&s.trim().length>=2&&s.length<=max&&!/[\u0000-\u001f\u007f]/u.test(s)?s:null;
   const money=n=>Number.isSafeInteger(n)&&n>=10000&&n<=1000000000000?n:null;
   const budget=money(snapshot.budgetInr),min=money(snapshot.budgetMinInr);
   // Fill only blank fields. Existing budget endpoints are an indivisible
   // pair; never combine older values and a new partial answer.
   const fillBudget=row.min===null&&row.max===null&&budget!==null&&(min===null||min<=budget);
   const serialized=JSON.stringify({...prior,reviewedPartialCall:{jobId:d.jobId,capturedAt:row.capturedAt,answers:snapshot}});
   if(serialized.length>8000)return fail('customer_notes_require_manual_review',409);
   const updated=new Date(Math.max(now,Date.parse(row.leadUpdatedAt)+1)).toISOString();
   const changes=await db.batch([
    db.prepare(`UPDATE leads SET preferred_location=COALESCE(preferred_location,?),plot_size_preference=COALESCE(plot_size_preference,?),
     budget_min_inr=CASE WHEN budget_min_inr IS NULL AND budget_max_inr IS NULL THEN ? ELSE budget_min_inr END,
     budget_max_inr=CASE WHEN budget_min_inr IS NULL AND budget_max_inr IS NULL THEN ? ELSE budget_max_inr END,
     requirements_json=?,updated_at=? WHERE tenant_id=? AND id=? AND updated_at=? AND interest_status!='converted'
     AND consent_status!='denied' AND dnd_status!='blocked' AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=leads.tenant_id AND o.lead_id=leads.id)
     AND NOT EXISTS(SELECT 1 FROM crm_audit_events e WHERE e.tenant_id=leads.tenant_id AND e.action='calling.partial_reviewed' AND e.target_id=?)`)
     .bind(text(snapshot.location,120),text(snapshot.size,80),fillBudget?min:null,fillBudget?budget:null,serialized,updated,tid,row.leadId,row.leadUpdatedAt,d.jobId),
    db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) SELECT ?,?,'human:'||?,'calling.partial_reviewed',?,? WHERE changes()=1")
     .bind(tid,crypto.randomUUID(),user.id,d.jobId,updated)
   ]);
   if(changes[0].meta.changes!==1)return fail('customer_changed_or_suppressed',409);
   return json({reviewed:true,replayed:false,updatedAt:updated,notice:'Only blank CRM fields were filled. Existing values, consent, call history and visit bookings remain unchanged.'});
  }
  if(action==='results'){
   if(req.method!=='GET')return fail('method_not_allowed',405);
   const offset=Number(d.offset??0),limit=50;
   if(!Number.isSafeInteger(offset)||offset<0||offset>100000||
      (d.campaignId!==undefined&&!UUID.test(d.campaignId)))return fail('invalid_results_filter');
   const campaign=d.campaignId??null;
   const scope=`FROM calling_jobs j JOIN calling_runs r ON r.tenant_id=j.tenant_id AND r.id=j.run_id
    WHERE j.tenant_id=? AND (? IS NULL OR r.campaign_id=?)`;
   const [rows,count]=await Promise.all([
    db.prepare(`SELECT j.id,j.lead_id AS leadId,l.name,c.name AS campaign,j.state,j.provider_status AS outcome,
     j.duration_seconds AS durationSeconds,j.error_code AS errorCode,j.updated_at AS updatedAt,
     j.created_at AS createdAt,j.reserved_at AS reservedAt,${targetColumns},
     a.answers_json AS answersJson,a.saved_to_lead AS savedToLead,a.captured_at AS capturedAt,l.updated_at AS leadUpdatedAt,
     EXISTS(SELECT 1 FROM crm_audit_events e WHERE e.tenant_id=j.tenant_id AND e.action='calling.partial_reviewed' AND e.target_id=j.id) AS partialReviewed
     FROM calling_jobs j JOIN calling_runs r ON r.tenant_id=j.tenant_id AND r.id=j.run_id
     JOIN call_campaign_drafts c ON c.tenant_id=r.tenant_id AND c.id=r.campaign_id
     JOIN leads l ON l.tenant_id=j.tenant_id AND l.id=j.lead_id
     LEFT JOIN scripted_call_results a ON a.tenant_id=j.tenant_id AND a.job_id=j.id
     WHERE j.tenant_id=? AND (? IS NULL OR r.campaign_id=?)
     ORDER BY j.created_at DESC,j.id DESC LIMIT ? OFFSET ?`).bind(tid,campaign,campaign,limit,offset).all(),
    db.prepare('SELECT COUNT(*) AS total '+scope).bind(tid,campaign,campaign).first()
   ]);
   const callEvidence=await readCallingAttemptEvidence(env.CONTROL_DB,tid,rows.results.map(row=>row.id));
   const results=rows.results.map(({answersJson,savedToLead,...row})=>{
    const stored=answersJson?JSON.parse(answersJson):null;
    const partial=stored?.__partial===true;
    if(partial)delete stored.__partial;
    return {...row,partialReviewed:row.partialReviewed===1,answers:stored,partial,savedToLead:savedToLead===1&&!partial,
     callEvidence:callEvidence.get(row.id)};
   });
   return json({results,total:count.total,limit,offset});
  }
  if(action==='state'){
   if(req.method!=='GET')return fail('method_not_allowed',405);
   const [runs,jobs,policy]=await Promise.all([
    db.prepare('SELECT r.id,r.campaign_id AS campaignId,c.name,r.state,r.created_at AS createdAt FROM calling_runs r JOIN call_campaign_drafts c ON c.tenant_id=r.tenant_id AND c.id=r.campaign_id WHERE r.tenant_id=? ORDER BY r.created_at DESC LIMIT 50').bind(tid).all(),
    db.prepare(`SELECT j.id,j.run_id AS runId,j.lead_id AS leadId,l.name,j.state,j.provider_status AS providerStatus,j.duration_seconds AS durationSeconds,j.error_code AS errorCode,j.updated_at AS updatedAt,j.created_at AS createdAt,j.reserved_at AS reservedAt,${targetColumns} FROM calling_jobs j JOIN leads l ON l.tenant_id=j.tenant_id AND l.id=j.lead_id WHERE j.tenant_id=? ORDER BY j.created_at DESC,j.id DESC LIMIT 200`).bind(tid).all(),
    db.prepare('SELECT enabled,expires_at AS expiresAt,daily_limit AS dailyLimit,max_seconds AS maxSeconds FROM calling_policies WHERE tenant_id=? AND flow_id=?').bind(tid,SCRIPTED_CALLING_POLICY).first()
   ]);
   const configuration=await scriptedCampaignConfiguration(env);
   const activePolicy=policy?.enabled&&Date.parse(policy.expiresAt)>now&&member.status==='active'?policy:null;
   const credits=member.role==='client_admin'?await creditPreflight(env,tid,activePolicy,configuration):null;
   return json({runs:runs.results,jobs:jobs.results,policy,configuration,credits,consentMode:await consentMode(env,tid),consentSources:CONSENT_SOURCES,window:'09:00–20:00 Asia/Kolkata',recordingEnabled:true});
  }
  if(req.method!=='POST')return fail('method_not_allowed',405);
  if(Object.keys(d).some(k=>!['tenantId','campaignId','action','consent'].includes(k))||!UUID.test(d.campaignId||'')||!['start','pause'].includes(d.action))return fail('invalid_run');
  if(d.consent!==undefined&&(!d.consent||typeof d.consent!=='object'||Object.keys(d.consent).sort().join(',')!=='confirmed,source'||d.consent.confirmed!==true||!CONSENT_SOURCES.includes(d.consent.source)))return fail('invalid_consent_declaration');
  if(d.action==='pause'){
   await db.prepare("UPDATE calling_runs SET state='paused',updated_at=? WHERE tenant_id=? AND campaign_id=? AND state='running'").bind(at,tid,d.campaignId).run();
   await audit(db,tid,user,'calling.paused',d.campaignId,at);return json({state:'paused',notice:'A call already submitted to Plivo may finish.'});
  }
  if(member.status!=='active')return fail('super_admin_must_activate_tenant',409);
  const configuration=await scriptedCampaignConfiguration(env);
  if(!configuration.ready)return fail('scripted_customer_campaigns_unconfigured',503);
  const policy=await db.prepare('SELECT tenant_id,flow_id,enabled,max_seconds AS maxSeconds,expires_at AS expiresAt FROM calling_policies WHERE tenant_id=? AND enabled=1 AND expires_at>? AND flow_id=?').bind(tid,at,SCRIPTED_CALLING_POLICY).first();
  if(!policy)return fail('super_admin_calling_approval_required',409);
  const mode=await consentMode(env,tid);
  if(mode==='client_declared'&&!d.consent)return fail('consent_declaration_required',409);
  const credits=await creditPreflight(env,tid,policy,configuration);
  if(!credits.ready)return fail(credits.reason,409);
  const draft=await db.prepare('SELECT language_mode FROM call_campaign_drafts WHERE tenant_id=? AND id=?').bind(tid,d.campaignId).first();
  if(!['hi','en'].includes(draft?.language_mode))return fail('choose_hindi_or_english_recordings',409);
  if(!await scriptedPromptsReady(env,draft.language_mode,tid))return fail('campaign_prompt_recordings_incomplete',409);
  const existing=await db.prepare(`SELECT r.id FROM calling_runs r WHERE r.tenant_id=? AND r.campaign_id=?
   AND NOT EXISTS(SELECT 1 FROM calling_jobs j WHERE j.tenant_id=r.tenant_id AND j.run_id=r.id AND j.flow_id=?)`)
   .bind(tid,d.campaignId,SCRIPTED_CALLING_POLICY).first();
  if(existing)return fail('create_a_new_campaign_after_provider_cutover',409);
  const count=await db.prepare('SELECT COUNT(*) AS n FROM call_campaign_candidates WHERE tenant_id=? AND campaign_id=?').bind(tid,d.campaignId).first();
  if(!count||count.n<1||count.n>2000)return fail('campaign_requires_1_to_2000_customers',409);
  if(mode==='client_declared'){
   // Client Admin declares, once per start, where these customers' consent came from.
   // Each eligible customer gets a clearance tied to this declaration; opted-out,
   // denied and DND-blocked customers are never cleared.
   const draftPurpose=await db.prepare('SELECT purpose FROM call_campaign_drafts WHERE tenant_id=? AND id=?').bind(tid,d.campaignId).first();
   const ref='client-declared:'+d.consent.source+':'+at;
   await db.batch([
    db.prepare(`INSERT INTO calling_clearances(tenant_id,lead_id,purpose,consent_reference,dnd_reference,expires_at,reviewed_by,reviewed_at)
     SELECT l.tenant_id,l.id,?,?,'client-declared',?,?,? FROM call_campaign_candidates cc JOIN leads l ON l.tenant_id=cc.tenant_id AND l.id=cc.lead_id
     WHERE cc.tenant_id=? AND cc.campaign_id=? AND l.consent_status!='denied' AND l.dnd_status!='blocked'
     AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id)
     ON CONFLICT(tenant_id,lead_id,purpose) DO UPDATE SET consent_reference=excluded.consent_reference,dnd_reference=excluded.dnd_reference,
      expires_at=excluded.expires_at,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at`)
     .bind(draftPurpose?.purpose||'property_information',ref,policy.expiresAt,'client:'+user.id,at,tid,d.campaignId),
    db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) VALUES(?,?,'human:'||?,'calling.consent_declared',?,?)").bind(tid,crypto.randomUUID(),user.id,d.campaignId,at)
   ]);
  }
  const id=crypto.randomUUID();
  // Retry-safe run creation + bounded snapshot of the existing tenant campaign.
  // A completed campaign cannot be restarted accidentally; create a new campaign.
  await db.batch([
   db.prepare("INSERT INTO calling_runs(tenant_id,id,campaign_id,state,created_by,created_at,updated_at) SELECT tenant_id,?,id,'running',?,?,? FROM call_campaign_drafts WHERE tenant_id=? AND id=? AND EXISTS(SELECT 1 FROM call_campaign_candidates cc WHERE cc.tenant_id=call_campaign_drafts.tenant_id AND cc.campaign_id=call_campaign_drafts.id) ON CONFLICT(tenant_id,campaign_id) DO UPDATE SET state=CASE WHEN calling_runs.state='paused' THEN 'running' ELSE calling_runs.state END,updated_at=excluded.updated_at")
    .bind(id,user.id,at,at,tid,d.campaignId),
   db.prepare("INSERT OR IGNORE INTO calling_jobs(tenant_id,id,run_id,lead_id,state,flow_id,created_at,updated_at) SELECT cc.tenant_id,lower(hex(randomblob(16))),r.id,cc.lead_id,'queued',?,?,? FROM call_campaign_candidates cc JOIN calling_runs r ON r.tenant_id=cc.tenant_id AND r.campaign_id=cc.campaign_id WHERE cc.tenant_id=? AND cc.campaign_id=? AND r.id=? ORDER BY cc.created_at,cc.lead_id LIMIT 2000")
    .bind(SCRIPTED_CALLING_POLICY,at,at,tid,d.campaignId,id)
  ]);
  const run=await db.prepare('SELECT id,state FROM calling_runs WHERE tenant_id=? AND campaign_id=?').bind(tid,d.campaignId).first();
  if(!run)return fail('campaign_missing_or_empty',409);
  await audit(db,tid,user,'calling.'+run.state,run.id,at);
  return json({runId:run.id,state:run.state},202);
 }catch{return fail('calling_unavailable_check_migration',503)}
}
