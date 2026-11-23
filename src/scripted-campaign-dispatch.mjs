import {resolveCrmDb} from './core.mjs';
import {SCRIPTED_CALLING_POLICY,approvedCampaignPhone,reserveCampaignQuestionnaire,scriptedPromptsReady,submitScriptedPhone} from './scripted-phone-pilot.mjs';

export const CAMPAIGN_CRON='* * * * *';
// Bounds total D1/R2 lookups in a single Worker invocation. The existing
// maximum of two attempted tenant dispatches per minute is NOT increased.
// Cloudflare Free D1 has a 50-query/invocation limit; a small candidate window
// leaves room for the safety checks and atomic reservations below.
export const CAMPAIGN_SCAN_LIMIT=16;
export const CAMPAIGN_WORK_LIMIT=2;

// Stateless rotating pages. Every active tenant is scanned, including those
// after the first 100, without loading all tenant rows into the Worker.
// Each pass covers the entire directory; the start within each page rotates
// by WORK_LIMIT after a full pass so heavily queued early tenants cannot
// permanently starve their neighbors. No schema migration or stored cursor.
export function campaignScanOffset(now,count){
 if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(count)||count<0)
  throw Error('invalid scheduler time or active tenant count');
 if(count===0)return 0;
 const pages=Math.ceil(count/CAMPAIGN_SCAN_LIMIT);
 const minute=Math.floor(now/60000);
 const page=minute%pages;
 const pass=Math.floor(minute/pages);
 return (page*CAMPAIGN_SCAN_LIMIT+
  (pass*CAMPAIGN_WORK_LIMIT)%CAMPAIGN_SCAN_LIMIT)%count;
}
export async function scriptedCampaignConfiguration(env){
 const ready=Boolean(await approvedCampaignPhone(env));
 return {ready,missing:ready?[]:['Plivo setup, a completed internal pilot and campaign authorization']};
}
export function inCallingWindow(now){
 const minutes=Math.floor((now+330*60000)/60000)%1440;
 return minutes>=9*60&&minutes<20*60; // explicit India-only product window
}

async function updateJob(db,job,state,at,{error=null,phase=null,call=null,duration=null}={}){
 await db.batch([
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

async function reconcile(env,db,job,now,at){
 if(job.flow_id!==SCRIPTED_CALLING_POLICY)return {state:'legacy_job_locked'};
 const row=await env.CONTROL_DB.prepare(`SELECT phase,expires_at,hangup_at,provider_call_id,duration_seconds
  FROM scripted_phone_pilots WHERE tenant_id=? AND job_id=?`).bind(job.tenant_id,job.id).first();
 if(row?.phase==='rejected'){
  await updateJob(db,job,'failed',at,{error:'plivo_rejected',phase:row.phase});
  return {state:'reconciled'};
 }
 if(row?.hangup_at!==null&&['completed','declined','ended','needs_review'].includes(row?.phase)){
  await updateJob(db,job,row.phase==='completed'?'completed':'failed',at,{
   error:row.phase==='completed'?null:'questionnaire_'+row.phase,phase:row.phase,
   call:row.provider_call_id,duration:row.duration_seconds});
  return {state:'reconciled'};
 }
 if(job.state!=='unknown'&&now>= (row?.expires_at??Date.parse(job.reserved_at)+600000)){
  await updateJob(db,job,'unknown',at,{error:'provider_outcome_uncertain',phase:row?.phase??null});
 }
 return {state:'waiting_or_locked'};
}

export async function tickScriptedTenant(env,db,tid,config,{apiFetch=fetch,now=Date.now()}={}){
 const at=new Date(now).toISOString();
 const pending=await db.prepare("SELECT * FROM calling_jobs WHERE tenant_id=? AND state IN('reserved','submitted','unknown') LIMIT 1").bind(tid).first();
 if(pending)return reconcile(env,db,pending,now,at);
 if(!config||!inCallingWindow(now))return {state:'disabled_or_outside_hours'};
 const policy=await db.prepare('SELECT * FROM calling_policies WHERE tenant_id=? AND enabled=1 AND expires_at>? AND flow_id=?').bind(tid,at,SCRIPTED_CALLING_POLICY).first();
 if(!policy)return {state:'approval_required'};
 // Permanent suppression is terminal. Missing/expired approval stays queued so a later review can release it.
 await db.prepare(`UPDATE calling_jobs SET state='blocked',error_code='customer_suppressed',updated_at=?
  WHERE tenant_id=? AND state='queued' AND flow_id=? AND EXISTS(
   SELECT 1 FROM leads l WHERE l.tenant_id=calling_jobs.tenant_id AND l.id=calling_jobs.lead_id
   AND (l.consent_status='denied' OR l.dnd_status='blocked' OR EXISTS(
    SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id)))`)
  .bind(at,tid,SCRIPTED_CALLING_POLICY).run();
 // Choose the next eligible job, so an earlier unapproved lead cannot stall approved customers.
 const job=await db.prepare(`SELECT j.id,j.tenant_id,j.lead_id,l.mobile_e164 AS destination,l.updated_at AS lead_updated_at,
  c.purpose,c.language_mode AS language,r.created_by
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
 if(!await scriptedPromptsReady(env,job.language,tid))return {state:'prompts_incomplete'};
 const dayStart=new Date(Math.floor((now+330*60000)/86400000)*86400000-330*60000).toISOString();
 // D1 serializes this ONE reservation statement, including quotas and uniqueness.
 const reserved=await db.prepare("UPDATE calling_jobs SET state='reserved',reserved_at=?,updated_at=?,account_sid=?,caller_id=?,flow_id=?,destination=? WHERE tenant_id=? AND id=? AND state='queued' AND EXISTS(SELECT 1 FROM calling_runs r WHERE r.tenant_id=calling_jobs.tenant_id AND r.id=calling_jobs.run_id AND r.state='running') AND EXISTS(SELECT 1 FROM calling_policies p WHERE p.tenant_id=? AND p.enabled=1 AND p.expires_at>? AND p.updated_at=? AND p.flow_id=?) AND EXISTS(SELECT 1 FROM calling_clearances v JOIN leads l ON l.tenant_id=v.tenant_id AND l.id=v.lead_id WHERE v.tenant_id=? AND v.lead_id=? AND v.purpose=? AND v.expires_at>? AND v.reviewed_at>=? AND v.reviewed_at>COALESCE((SELECT MAX(h.reserved_at) FROM calling_jobs h WHERE h.tenant_id=v.tenant_id AND h.lead_id=v.lead_id),'') AND l.consent_status!='denied' AND l.dnd_status!='blocked' AND l.mobile_e164=? AND l.updated_at=? AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id)) AND NOT EXISTS(SELECT 1 FROM calling_jobs x WHERE x.tenant_id=? AND x.state IN('reserved','submitted','unknown')) AND (SELECT COUNT(*) FROM calling_jobs x WHERE x.tenant_id=? AND x.reserved_at>=?)<?")
 .bind(at,at,config.authId,config.caller,policy.flow_id,job.destination,tid,job.id,tid,at,policy.updated_at,SCRIPTED_CALLING_POLICY,tid,job.lead_id,job.purpose,at,policy.updated_at,job.destination,job.lead_updated_at,tid,tid,dayStart,policy.daily_limit).run();
 if(Number(reserved.meta?.changes)!==1)return {state:'quota_or_concurrent_change'};
 try{
  const id=await reserveCampaignQuestionnaire(env.CONTROL_DB,config,job,now);
  const outcome=await submitScriptedPhone(env.CONTROL_DB,config,id,job.destination,policy.max_seconds,apiFetch);
  const state=outcome==='rejected'?'failed':outcome;
  await updateJob(db,job,state,at,{error:state==='failed'?'plivo_rejected':state==='unknown'?'provider_outcome_uncertain':null});
  return {state};
 }catch{
  // A reservation survives crashes and ambiguous network responses. Never automatically redial.
  return {state:'locked'};
 }
}

export async function runScriptedCampaignCron(env,{
 now=Date.now(),apiFetch=fetch,tickTenant=tickScriptedTenant
}={}){
 if(env.AR3D_SCRIPTED_CAMPAIGNS_ENABLED!=='enabled')return {processed:0};
 // Bad schedule inputs fail closed before making any provider or CRM request.
 if(!Number.isSafeInteger(now)||now<0)throw Error('invalid Calling cron time');
 const config=await approvedCampaignPhone(env);
 if(!config)return {processed:0};
 const count=await env.CONTROL_DB.prepare(
  "SELECT COUNT(*) AS total FROM tenants WHERE status='active'"
 ).first();
 const total=Number(count?.total);
 if(!Number.isSafeInteger(total)||total<0)
  throw Error('invalid active tenant directory count');
 if(total===0)return {processed:0,scanned:0,activeTenants:0};
 const offset=campaignScanOffset(now,total);
 const batchSize=Math.min(total,CAMPAIGN_SCAN_LIMIT);
 const sql="SELECT id,storage_mode,dedicated_binding FROM tenants WHERE status='active' ORDER BY id LIMIT ? OFFSET ?";
 const first=(await env.CONTROL_DB.prepare(sql).bind(batchSize,offset).all()).results;
 if(!Array.isArray(first)||first.length>batchSize)
  throw Error('invalid scheduler tenant page');
 const remaining=batchSize-first.length;
 const wrap=remaining?(await env.CONTROL_DB.prepare(sql).bind(remaining,0).all()).results:[];
 if(!Array.isArray(wrap)||wrap.length>remaining)
  throw Error('invalid scheduler wrap page');
 const rows=[...first,...wrap],seen=new Set();
 let processed=0,scanned=0;
 for(const tenant of rows){
  if(!tenant||typeof tenant.id!=='string'||seen.has(tenant.id))continue;
  seen.add(tenant.id);scanned++;
  try{
   const db=resolveCrmDb(env,tenant);
   const work=await db.prepare(`SELECT id FROM calling_runs WHERE tenant_id=? AND state='running'
    UNION ALL SELECT id FROM calling_jobs WHERE tenant_id=? AND state IN('reserved','submitted','unknown') LIMIT 1`)
    .bind(tenant.id,tenant.id).first();
   if(!work)continue;
   // Count the attempt BEFORE the potentially failing network operation.
   // A provider timeout must not cause an unbounded number of new attempts.
   processed++;
   await tickTenant(env,db,tenant.id,config,{now,apiFetch});
  }catch{console.error('AR3D scripted campaign processing unavailable')}
  if(processed>=CAMPAIGN_WORK_LIMIT)break;
 }
 // Aggregate counters only: no customer names, tenant IDs, provider tokens or
 // CRM answers in scheduled logs.
 return {processed,scanned,activeTenants:total};
}
