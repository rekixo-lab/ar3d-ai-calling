// Current-MFA Super Admin may record a verified Plivo CDR for one completed
// Calling job, exactly once. This NEVER debits client credits or authorizes
// new calls. Trial/India currency and fundability remain independently gated.
import {mutationOriginAllowed} from './human-auth.mjs';
import {resolveCrmDb} from './core.mjs';
const PATH='/v1/human/plivo-cost-reconcile';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const JOB_ID=/^[a-f0-9]{32}$/i;
const validJobId=value=>UUID.test(value||'')||JOB_ID.test(value||'');
const HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200)=>Response.json(data,{status,headers:HEADERS});
const fail=(error,status=400)=>json({error},status);
const phone=x=>typeof x==='string'?x.replace(/^\+/,''):null;
const seconds=x=>Number.isSafeInteger(x)&&x>=0&&x<=86400;
const money=x=>typeof x==='string'&&/^(?:0|[1-9]\d{0,8})(?:\.\d{1,8})?$/.test(x);

async function input(req){
 if(!req.headers.get('content-type')?.startsWith('application/json')||
    !req.body||Number(req.headers.get('content-length'))>512)
  throw Error('invalid body');
 const reader=req.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,raw='';
 try{
  while(true){
   const {value,done}=await reader.read();
   if(done)break;
   bytes+=value.byteLength;
   if(bytes>512){await reader.cancel();throw Error('invalid length')}
   raw+=decoder.decode(value,{stream:true});
  }
  raw+=decoder.decode();
 }finally{reader.releaseLock()}
 return JSON.parse(raw);
}
async function currentMfa(db,user){
 if(user?.globalRole!=='super_admin'||!/^[a-f0-9]{64}$/i.test(user.token_hash||''))
  return false;
 return !!await db.prepare(
  'SELECT 1 FROM human_mfa_settings m JOIN human_sessions s ON s.user_id=m.user_id '+
  'WHERE m.user_id=? AND s.token_hash=? AND m.enabled_at IS NOT NULL '+
  'AND s.created_at>=m.enabled_at AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1'
 ).bind(user.id,user.token_hash,Date.now()).first();
}

export async function handlePlivoCostReconcile(req,env,user,{fetcher=fetch}={}){
 const url=new URL(req.url);
 if(url.pathname!==PATH)return null;
 if(req.method!=='POST')return fail('method not allowed',405);
 if(url.search)return fail('unsupported query',400);
 if(!mutationOriginAllowed(req))return fail('same origin required',403);
 try{
  if(!env.CONTROL_DB||!await currentMfa(env.CONTROL_DB,user))
   return fail('current Super Admin MFA required',403);
  const data=await input(req);
  if(!data||Array.isArray(data)||typeof data!=='object'||
     Object.keys(data).length!==2||!Object.hasOwn(data,'tenantId')||
     !Object.hasOwn(data,'jobId')||
     !UUID.test(data.tenantId||'')||!validJobId(data.jobId))
   return fail('invalid call selection');
  const tid=data.tenantId,jid=data.jobId;
  const tenant=await env.CONTROL_DB.prepare(
   "SELECT id AS tenant_id,storage_mode,dedicated_binding FROM tenants WHERE id=? AND status IN('trial','active')"
  ).bind(tid).first();
  if(!tenant)return fail('tenant not found',404);
  const db=resolveCrmDb(env,tenant);
  const job=await db.prepare(
   'SELECT id,state,account_sid AS accountSid,provider_call_sid AS callUuid,'+
   'caller_id AS caller,destination FROM calling_jobs WHERE tenant_id=? AND id=?'
  ).bind(tid,jid).first();
  if(!job)return fail('job not found',404);
  if(!['completed','failed'].includes(job.state)||!UUID.test(job.callUuid||''))
   return fail('final call record not available',409);
  const auth=env.PLIVO_AUTH_ID,token=env.PLIVO_AUTH_TOKEN;
  if(typeof auth!=='string'||!/^[A-Za-z0-9]{8,64}$/.test(auth)||
     typeof token!=='string'||!/^[A-Za-z0-9]{16,128}$/.test(token)||
     job.accountSid!==auth)
   return fail('Plivo billing credentials unavailable',503);
  let cdr;
  try{
   const response=await fetcher(
    'https://api.plivo.com/v1/Account/'+encodeURIComponent(auth)+
    '/Call/'+encodeURIComponent(job.callUuid)+'/',{
     method:'GET',redirect:'manual',signal:AbortSignal.timeout(5000),
     headers:{Authorization:'Basic '+btoa(auth+':'+token),Accept:'application/json'}
    });
   if(!response.ok||!response.headers.get('content-type')?.toLowerCase().includes('json')||
      Number(response.headers.get('content-length'))>8192)
    return fail('provider CDR unavailable',503);
   const raw=await response.text();
   if(raw.length>8192)return fail('provider CDR unavailable',503);
   cdr=JSON.parse(raw);
  }catch{return fail('provider CDR unavailable',503)}
  if(cdr?.call_uuid!==job.callUuid||cdr?.call_direction!=='outbound'||
     phone(cdr.from_number)!==phone(job.caller)||
     phone(cdr.to_number)!==phone(job.destination)||
     !seconds(cdr.billed_duration)||!seconds(cdr.call_duration)||
     !money(cdr.total_amount))
   return fail('provider call identity or amount did not match',503);
  const at=new Date().toISOString();
  const recorded=await db.batch([
   db.prepare(
    'INSERT OR IGNORE INTO verified_provider_call_costs('+
    'tenant_id,job_id,provider_call_uuid,reported_amount,billed_seconds,'+
    'call_seconds,currency_status,verified_by,verified_at) '+
    "VALUES(?,?,?,?,?,?,'unverified',?,?)"
   ).bind(tid,jid,job.callUuid,cdr.total_amount,
    cdr.billed_duration,cdr.call_duration,user.id,at),
   db.prepare(
    "INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) "+
    "SELECT ?,?,'human:'||?,'plivo.cdr_observed',?,? WHERE changes()=1"
   ).bind(tid,crypto.randomUUID(),user.id,jid,at)
  ]);
  if(Number(recorded[0]?.meta?.changes)===1&&
     Number(recorded[1]?.meta?.changes)===1)
   return json({tenantId:tid,jobId:jid,recorded:true,alreadyRecorded:false,
    currency:'unverified',providerReportedAmount:cdr.total_amount,
    billedSeconds:cdr.billed_duration,clientCreditsDebited:false,
    notice:'The provider CDR was recorded once for later review. No wallet credit was deducted.'});
  const old=await db.prepare(
   'SELECT provider_call_uuid AS callUuid,reported_amount AS amount,'+
   'billed_seconds AS billedSeconds,call_seconds AS callSeconds '+
   'FROM verified_provider_call_costs WHERE tenant_id=? AND job_id=?'
  ).bind(tid,jid).first();
  if(!old||old.callUuid!==job.callUuid||old.amount!==cdr.total_amount||
     old.billedSeconds!==cdr.billed_duration||old.callSeconds!==cdr.call_duration)
   return fail('provider CDR changed; billing needs manual review',409);
  return json({tenantId:tid,jobId:jid,recorded:true,alreadyRecorded:true,
   currency:'unverified',providerReportedAmount:old.amount,
   billedSeconds:old.billedSeconds,clientCreditsDebited:false,
   notice:'This identical provider CDR was already recorded. No duplicate or wallet debit.'});
 }catch(e){
  if(/JSON|invalid/i.test(String(e?.message||'')))return fail('invalid request');
  console.error('AR3D Plivo CDR observation unavailable');
  return fail('cost reconciliation unavailable',503);
 }
}
