// Durable, opt-in Exotel Flow dispatcher. No browser-supplied numbers or SIDs.
import {exotelApiBase,configuredExotelRegion} from './exotel-region.mjs';
import {getExotelOperatorTestStatusReadOnly} from './exotel-readonly-verification.mjs';
import {validateOperatorTestResult} from './exotel-operator-test-routes.mjs';
export const CAMPAIGN_CRON='* * * * *';
const SID=/^[A-Za-z0-9_-]{4,128}$/;
export function campaignConfig(env){
 const missing=[];
 if(env.EXOTEL_CUSTOMER_CAMPAIGNS_ENABLED!=='enabled')missing.push('EXOTEL_CUSTOMER_CAMPAIGNS_ENABLED');
 if(!SID.test(env.EXOTEL_ACCOUNT_SID||''))missing.push('EXOTEL_ACCOUNT_SID');
 for(const k of ['EXOTEL_API_KEY','EXOTEL_API_TOKEN'])if(!/^[\x21-\x7e]{8,256}$/.test(env[k]||'')||env[k].includes(':'))missing.push(k);
 if(!configuredExotelRegion(env))missing.push('EXOTEL_REGION');
 if(!/^\+?[0-9]{6,19}$/.test(env.EXOTEL_CALLER_ID||''))missing.push('EXOTEL_CALLER_ID');
 return {ready:missing.length===0,missing};
}
export function inCallingWindow(now){
 const minutes=Math.floor((now+330*60000)/60000)%1440;
 return minutes>=9*60&&minutes<20*60; // explicit India-only product window
}
export function campaignRequest(env,job,policy){
 if(!campaignConfig(env).ready||!/^\+91[6-9]\d{9}$/.test(job.destination)||
   !/^[1-9]\d{0,11}$/.test(policy.flow_id)||!Number.isInteger(policy.max_seconds)||
   policy.max_seconds<30||policy.max_seconds>600)throw Error('invalid campaign configuration');
 const form=new URLSearchParams({From:job.destination,CallerId:env.EXOTEL_CALLER_ID,
  Url:'http://my.exotel.com/'+env.EXOTEL_ACCOUNT_SID+'/exoml/start_voice/'+policy.flow_id,
  Record:'false',TimeLimit:String(policy.max_seconds),TimeOut:'30'});
 return new Request(exotelApiBase(env.EXOTEL_REGION)+'/v1/Accounts/'+env.EXOTEL_ACCOUNT_SID+'/Calls/connect',{
  method:'POST',headers:{Authorization:'Basic '+btoa(env.EXOTEL_API_KEY+':'+env.EXOTEL_API_TOKEN),
  Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:form,redirect:'manual'});
}
async function boundedResult(response){
 if(!response.ok||!(response.headers.get('content-type')||'').includes('application/json'))throw Error('unconfirmed response');
 const reader=response.body?.getReader();if(!reader)throw Error('missing response');
 let size=0,raw='';const decoder=new TextDecoder('utf-8',{fatal:true});
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
 if(size>16384){await reader.cancel();throw Error('oversized response')}raw+=decoder.decode(value,{stream:true})}
 raw+=decoder.decode();}finally{reader.releaseLock()}
 return JSON.parse(raw);
}
async function audit(db,tid,action,id,at){
 await db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) VALUES(?,?,'campaign_worker',?,?,?)")
 .bind(tid,crypto.randomUUID(),action,id,at).run();
}
async function finish(db,job,state,at,code=null,sid=null,status=null,duration=null){
 const result=await db.prepare("UPDATE calling_jobs SET state=?,error_code=?,provider_call_sid=COALESCE(?,provider_call_sid),provider_status=COALESCE(?,provider_status),duration_seconds=COALESCE(?,duration_seconds),updated_at=? WHERE tenant_id=? AND id=? AND state IN('reserved','submitted')")
 .bind(state,code,sid,status,duration,at,job.tenant_id,job.id).run();
 if(Number(result?.meta?.changes)!==1)throw Error('dispatch finalization uncertain');
 await audit(db,job.tenant_id,'calling.'+state,job.id,at);
}
export async function tickTenant(env,db,tid,{apiFetch=fetch,now=Date.now()}={}){
 const at=new Date(now).toISOString();
 const pending=await db.prepare("SELECT * FROM calling_jobs WHERE tenant_id=? AND state IN('reserved','submitted','unknown') LIMIT 1").bind(tid).first();
 if(pending){
  // Reserved after a crash remains uncertain. No retry and no next call.
  if(pending.state!=='submitted'||!pending.provider_call_sid)return {state:'locked'};
  if(pending.checked_at&&now-Date.parse(pending.checked_at)<60000)return {state:'waiting'};
  if(!campaignConfig(env).ready||pending.account_sid!==env.EXOTEL_ACCOUNT_SID)return {state:'disabled'};
  const lock=await db.prepare("UPDATE calling_jobs SET checked_at=? WHERE tenant_id=? AND id=? AND state='submitted' AND (checked_at IS NULL OR checked_at<=?)")
   .bind(at,tid,pending.id,new Date(now-60000).toISOString()).run();
  if(Number(lock.meta?.changes)!==1)return {state:'waiting'};
  try{
   const verified=await getExotelOperatorTestStatusReadOnly({accountSid:pending.account_sid,
    apiKey:env.EXOTEL_API_KEY,apiToken:env.EXOTEL_API_TOKEN,region:env.EXOTEL_REGION},
    {callSid:pending.provider_call_sid,callerId:pending.caller_id},{apiFetch});
   const terminal=['completed','failed','busy','no-answer'].includes(verified.status);
   if(terminal)await finish(db,pending,verified.status==='completed'?'completed':'failed',at,null,null,verified.status,verified.durationSeconds);
   return {state:terminal?'reconciled':'waiting'};
  }catch{return {state:'status_unavailable'}}
 }
 if(!campaignConfig(env).ready||!inCallingWindow(now))return {state:'disabled_or_outside_hours'};
 const policy=await db.prepare('SELECT * FROM calling_policies WHERE tenant_id=? AND enabled=1 AND expires_at>?').bind(tid,at).first();
 if(!policy)return {state:'approval_required'};
 // Snapshot destination only at reservation; eligibility is rechecked atomically below.
 const job=await db.prepare("SELECT j.*,l.mobile_e164 AS destination,c.purpose FROM calling_jobs j JOIN calling_runs r ON r.tenant_id=j.tenant_id AND r.id=j.run_id JOIN call_campaign_drafts c ON c.tenant_id=r.tenant_id AND c.id=r.campaign_id JOIN leads l ON l.tenant_id=j.tenant_id AND l.id=j.lead_id WHERE j.tenant_id=? AND j.state='queued' AND r.state='running' ORDER BY j.created_at,j.id LIMIT 1").bind(tid).first();
 if(!job){await db.prepare("UPDATE calling_runs SET state='completed',updated_at=? WHERE tenant_id=? AND state='running' AND NOT EXISTS(SELECT 1 FROM calling_jobs j WHERE j.tenant_id=calling_runs.tenant_id AND j.run_id=calling_runs.id AND j.state IN('queued','reserved','submitted','unknown'))").bind(at,tid).run();return {state:'idle'}}
 const clearance=await db.prepare("SELECT v.lead_id FROM calling_clearances v JOIN leads l ON l.tenant_id=v.tenant_id AND l.id=v.lead_id WHERE v.tenant_id=? AND v.lead_id=? AND v.purpose=? AND v.expires_at>? AND v.reviewed_at>COALESCE((SELECT MAX(h.reserved_at) FROM calling_jobs h WHERE h.tenant_id=v.tenant_id AND h.lead_id=v.lead_id),'') AND l.consent_status!='denied' AND l.dnd_status!='blocked' AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id)")
 .bind(tid,job.lead_id,job.purpose,at).first();
 if(!clearance){await db.prepare("UPDATE calling_jobs SET state='blocked',error_code='clearance_required_or_opted_out',updated_at=? WHERE tenant_id=? AND id=? AND state='queued'").bind(at,tid,job.id).run();return {state:'blocked'}}
 const dayStart=new Date(Math.floor((now+330*60000)/86400000)*86400000-330*60000).toISOString();
 // D1 serializes this ONE reservation statement, including quotas and uniqueness.
 const reserved=await db.prepare("UPDATE calling_jobs SET state='reserved',reserved_at=?,updated_at=?,account_sid=?,caller_id=?,flow_id=?,destination=? WHERE tenant_id=? AND id=? AND state='queued' AND EXISTS(SELECT 1 FROM calling_runs r WHERE r.tenant_id=calling_jobs.tenant_id AND r.id=calling_jobs.run_id AND r.state='running') AND EXISTS(SELECT 1 FROM calling_policies p WHERE p.tenant_id=? AND p.enabled=1 AND p.expires_at>? AND p.updated_at=?) AND EXISTS(SELECT 1 FROM calling_clearances v JOIN leads l ON l.tenant_id=v.tenant_id AND l.id=v.lead_id WHERE v.tenant_id=? AND v.lead_id=? AND v.purpose=? AND v.expires_at>? AND v.reviewed_at>COALESCE((SELECT MAX(h.reserved_at) FROM calling_jobs h WHERE h.tenant_id=v.tenant_id AND h.lead_id=v.lead_id),'') AND l.consent_status!='denied' AND l.dnd_status!='blocked' AND l.mobile_e164=? AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id)) AND NOT EXISTS(SELECT 1 FROM calling_jobs x WHERE x.tenant_id=? AND x.state IN('reserved','submitted','unknown')) AND (SELECT COUNT(*) FROM calling_jobs x WHERE x.tenant_id=? AND x.reserved_at>=?)<?")
 .bind(at,at,env.EXOTEL_ACCOUNT_SID,env.EXOTEL_CALLER_ID,policy.flow_id,job.destination,tid,job.id,tid,at,policy.updated_at,tid,job.lead_id,job.purpose,at,job.destination,tid,tid,dayStart,policy.daily_limit).run();
 if(Number(reserved.meta?.changes)!==1)return {state:'quota_or_concurrent_change'};
 // No exception from this point is ever retried; reservation survives process death.
 try{
  await audit(db,tid,'calling.reserved',job.id,at);
  const response=await apiFetch(campaignRequest(env,job,policy),{signal:AbortSignal.timeout(9000),redirect:'manual'});
  if([400,401,403,404,422,429].includes(response.status)){
   await finish(db,job,'failed',at,'provider_http_'+response.status);return {state:'failed'};
  }
  const call=validateOperatorTestResult(await boundedResult(response),env.EXOTEL_CALLER_ID);
  await finish(db,job,'submitted',at,null,call.providerCallSid,call.status);
  return {state:'submitted'};
 }catch{
  try{await finish(db,job,'unknown',at,'provider_outcome_uncertain')}catch{}
  return {state:'unknown'};
 }
}
export async function runCampaignCron(env,{now=Date.now(),apiFetch=fetch}={}){
 // Kill switch checked before even looking at customer data.
 if(!campaignConfig(env).ready)return {processed:0};
 const tenants=await env.CONTROL_DB.prepare("SELECT id,storage_mode,dedicated_binding FROM tenants WHERE status='active' ORDER BY id LIMIT 100").all();
 let processed=0;
 const rows=tenants.results||[],offset=rows.length?Math.floor(now/60000)%rows.length:0;
 for(const t of [...rows.slice(offset),...rows.slice(0,offset)]){
  // At most ten active/inflight tenants per invocation; rotate by minute.
  const db=t.storage_mode==='shared'?env.CRM_DB:env[t.dedicated_binding];
  if(!db)continue;
  const work=await db.prepare("SELECT id FROM calling_runs WHERE tenant_id=? AND state='running' UNION ALL SELECT id FROM calling_jobs WHERE tenant_id=? AND state='submitted' LIMIT 1").bind(t.id,t.id).first();
  if(!work)continue;
  try{await tickTenant(env,db,t.id,{apiFetch,now})}catch{console.error('AR3D campaign tenant processing unavailable')}processed++;
  if(processed>=10)break;
 }
 return {processed};
}
