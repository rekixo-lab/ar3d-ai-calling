import {requireMembership,mutationOriginAllowed} from './human-auth.mjs';
import {resolveCrmDb,parseJsonBody} from './core.mjs';
import {campaignConfig} from './campaign-dispatch.mjs';
import {requirePublishedAgent} from './published-agent.mjs';
import {readSharedGateway} from './shared-voice-gateway.mjs';
const BASE='/v1/human/calling';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(error,status=400)=>json({error},status);
const reference=v=>typeof v==='string'&&v.trim().length>=4&&v.length<=160&&!/[\u0000-\u001f]/.test(v);
const expiry=(v,now)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Date.parse(v)>now&&Date.parse(v)<=now+30*86400000;
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
async function audit(db,tid,user,action,target,at){
 await db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) VALUES(?,?,'human:'||?,?,?,?)")
 .bind(tid,crypto.randomUUID(),user.id,action,target,at).run();
}
export async function handleCallingRequest(req,env,user,{now=Date.now(),fetcher=fetch}={}){
 const url=new URL(req.url),path=url.pathname;
 if(!path.startsWith(BASE+'/'))return null;
 const action=path.slice(BASE.length+1);
 if(!['GET','POST'].includes(req.method))return fail('method_not_allowed',405);
 if(req.method==='POST'&&!mutationOriginAllowed(req))return fail('same_origin_required',403);
 const admin=['policy','clearances'].includes(action);
 if(!['policy','clearances','runs','state'].includes(action))return fail('not_found',404);
 try{
  const d=req.method==='POST'?await body(req):Object.fromEntries(url.searchParams);
  if(!UUID.test(d.tenantId||''))return fail('invalid_tenant');
  let member;
  if(admin){
   if(!await freshAdmin(env,user,now))return fail('current_super_admin_mfa_required',403);
   const t=await env.CONTROL_DB.prepare("SELECT id AS tenant_id,storage_mode,dedicated_binding,status FROM tenants WHERE id=? AND status IN('trial','active')").bind(d.tenantId).first();
   if(!t)return fail('tenant_unavailable',404);member=t;
  }else{
   member=await requireMembership(env.CONTROL_DB,user,d.tenantId,req.method==='POST');
   if(!member)return fail('forbidden',403);
  }
  const db=resolveCrmDb(env,member),tid=member.tenant_id,at=new Date(now).toISOString();
  if(action==='policy'&&req.method==='GET')return json({policy:await db.prepare('SELECT enabled,flow_id AS flowId,approval_reference AS approvalReference,expires_at AS expiresAt,daily_limit AS dailyLimit,max_seconds AS maxSeconds FROM calling_policies WHERE tenant_id=?').bind(tid).first(),configuration:campaignConfig(env)});
  if(action==='policy'){
   if(Object.keys(d).some(k=>!['tenantId','enabled','flowId','approvalReference','expiresAt','dailyLimit','maxSeconds'].includes(k))||
    typeof d.enabled!=='boolean'||!/^[1-9]\d{0,11}$/.test(d.flowId||'')||!reference(d.approvalReference)||!expiry(d.expiresAt,now)||
    !Number.isInteger(d.dailyLimit)||d.dailyLimit<1||d.dailyLimit>100||!Number.isInteger(d.maxSeconds)||d.maxSeconds<30||d.maxSeconds>600)return fail('invalid_policy');
   if(d.enabled&&env.EXOTEL_REQUIRE_PUBLISHED_AGENT==='enabled'){
    const gateway=await readSharedGateway(env);
    if(!gateway||gateway.state!=='ready'||gateway.flow_id!==d.flowId)return fail('verified_shared_calling_gateway_required',409);
   }
   await db.batch([
    db.prepare('INSERT INTO calling_policies(tenant_id,enabled,flow_id,approval_reference,expires_at,daily_limit,max_seconds,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET enabled=excluded.enabled,flow_id=excluded.flow_id,approval_reference=excluded.approval_reference,expires_at=excluded.expires_at,daily_limit=excluded.daily_limit,max_seconds=excluded.max_seconds,updated_by=excluded.updated_by,updated_at=excluded.updated_at')
    .bind(tid,Number(d.enabled),d.flowId,d.approvalReference,d.expiresAt,d.dailyLimit,d.maxSeconds,user.id,at),
    db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) VALUES(?,?,'human:'||?,'calling.policy_reviewed',?,?)").bind(tid,crypto.randomUUID(),user.id,tid,at)
   ]);
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
   const leads=await db.prepare('SELECT id,name,consent_status AS consentStatus,dnd_status AS dndStatus FROM leads WHERE tenant_id=? ORDER BY created_at DESC,id DESC LIMIT 200').bind(tid).all();
   return json({clearances:rows.results,leads:leads.results});
  }
  if(action==='clearances'){
   if(Object.keys(d).some(k=>!['tenantId','leadIds','purpose','consentReference','dndReference','expiresAt'].includes(k))||
    !Array.isArray(d.leadIds)||d.leadIds.length<1||d.leadIds.length>200||d.leadIds.some(x=>!UUID.test(x))||new Set(d.leadIds).size!==d.leadIds.length||
    !['property_information','site_visit'].includes(d.purpose)||!reference(d.consentReference)||!reference(d.dndReference)||!expiry(d.expiresAt,now))return fail('invalid_clearance');
   const results=await db.batch(d.leadIds.map(id=>db.prepare("INSERT INTO calling_clearances(tenant_id,lead_id,purpose,consent_reference,dnd_reference,expires_at,reviewed_by,reviewed_at) SELECT tenant_id,id,?,?,?,?,?,? FROM leads WHERE tenant_id=? AND id=? AND consent_status!='denied' AND dnd_status!='blocked' AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=leads.tenant_id AND o.lead_id=leads.id) ON CONFLICT(tenant_id,lead_id,purpose) DO UPDATE SET consent_reference=excluded.consent_reference,dnd_reference=excluded.dnd_reference,expires_at=excluded.expires_at,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at")
    .bind(d.purpose,d.consentReference,d.dndReference,d.expiresAt,user.id,at,tid,id)));
   await audit(db,tid,user,'calling.clearances_reviewed',tid,at);
   return json({reviewed:results.reduce((n,r)=>n+Number(r.meta?.changes||0),0)});
  }
  if(action==='state'){
   if(req.method!=='GET')return fail('method_not_allowed',405);
   const [runs,jobs,policy]=await Promise.all([
    db.prepare('SELECT r.id,r.campaign_id AS campaignId,c.name,r.state,r.created_at AS createdAt FROM calling_runs r JOIN call_campaign_drafts c ON c.tenant_id=r.tenant_id AND c.id=r.campaign_id WHERE r.tenant_id=? ORDER BY r.created_at DESC LIMIT 50').bind(tid).all(),
    db.prepare('SELECT j.id,j.run_id AS runId,j.lead_id AS leadId,l.name,j.state,j.provider_status AS providerStatus,j.duration_seconds AS durationSeconds,j.error_code AS errorCode,j.updated_at AS updatedAt FROM calling_jobs j JOIN leads l ON l.tenant_id=j.tenant_id AND l.id=j.lead_id WHERE j.tenant_id=? ORDER BY j.created_at DESC,j.id DESC LIMIT 200').bind(tid).all(),
    db.prepare('SELECT enabled,expires_at AS expiresAt,daily_limit AS dailyLimit FROM calling_policies WHERE tenant_id=?').bind(tid).first()
   ]);
   return json({runs:runs.results,jobs:jobs.results,policy,configuration:campaignConfig(env),window:'09:00–20:00 Asia/Kolkata',recordingEnabled:false});
  }
  if(req.method!=='POST')return fail('method_not_allowed',405);
  if(Object.keys(d).some(k=>!['tenantId','campaignId','action'].includes(k))||!UUID.test(d.campaignId||'')||!['start','pause'].includes(d.action))return fail('invalid_run');
  if(d.action==='pause'){
   await db.prepare("UPDATE calling_runs SET state='paused',updated_at=? WHERE tenant_id=? AND campaign_id=? AND state='running'").bind(at,tid,d.campaignId).run();
   await audit(db,tid,user,'calling.paused',d.campaignId,at);return json({state:'paused',notice:'A call already submitted to Exotel may finish.'});
  }
  if(member.status!=='active')return fail('super_admin_must_activate_tenant',409);
  if(!campaignConfig(env).ready)return fail('exotel_customer_campaigns_unconfigured',503);
  const policy=await db.prepare('SELECT tenant_id,flow_id FROM calling_policies WHERE tenant_id=? AND enabled=1 AND expires_at>?').bind(tid,at).first();
  if(!policy)return fail('super_admin_calling_approval_required',409);
  try{await requirePublishedAgent(env,tid,policy.flow_id,{fetcher})}catch(e){return fail(e.message,409)}
  const count=await db.prepare('SELECT COUNT(*) AS n FROM call_campaign_candidates WHERE tenant_id=? AND campaign_id=?').bind(tid,d.campaignId).first();
  if(!count||count.n<1||count.n>2000)return fail('campaign_requires_1_to_2000_customers',409);
  const id=crypto.randomUUID();
  // Retry-safe run creation + bounded snapshot of the existing tenant campaign.
  // A completed campaign cannot be restarted accidentally; create a new campaign.
  await db.batch([
   db.prepare("INSERT INTO calling_runs(tenant_id,id,campaign_id,state,created_by,created_at,updated_at) SELECT tenant_id,?,id,'running',?,?,? FROM call_campaign_drafts WHERE tenant_id=? AND id=? AND EXISTS(SELECT 1 FROM call_campaign_candidates cc WHERE cc.tenant_id=call_campaign_drafts.tenant_id AND cc.campaign_id=call_campaign_drafts.id) ON CONFLICT(tenant_id,campaign_id) DO UPDATE SET state=CASE WHEN calling_runs.state='paused' THEN 'running' ELSE calling_runs.state END,updated_at=excluded.updated_at")
    .bind(id,user.id,at,at,tid,d.campaignId),
   db.prepare("INSERT OR IGNORE INTO calling_jobs(tenant_id,id,run_id,lead_id,state,created_at,updated_at) SELECT cc.tenant_id,lower(hex(randomblob(16))),r.id,cc.lead_id,'queued',?,? FROM call_campaign_candidates cc JOIN calling_runs r ON r.tenant_id=cc.tenant_id AND r.campaign_id=cc.campaign_id WHERE cc.tenant_id=? AND cc.campaign_id=? AND r.id=? ORDER BY cc.created_at,cc.lead_id LIMIT 2000")
    .bind(at,at,tid,d.campaignId,id)
  ]);
  const run=await db.prepare('SELECT id,state FROM calling_runs WHERE tenant_id=? AND campaign_id=?').bind(tid,d.campaignId).first();
  if(!run)return fail('campaign_missing_or_empty',409);
  await audit(db,tid,user,'calling.'+run.state,run.id,at);
  return json({runId:run.id,state:run.state},202);
 }catch{return fail('calling_unavailable_check_migration',503)}
}
