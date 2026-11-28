// Current-MFA Super Admin may record a verified Plivo CDR for one completed
// Calling job, exactly once. A matched held call may settle billed seconds;
// this never authorizes new calls or asserts currency/funding.
import {mutationOriginAllowed,currentSuperAdminMfa} from './human-auth.mjs';
import {readVerifiedPlivoCdr} from './plivo-verified-cdr.mjs';
import {resolveCrmDb} from './core.mjs';
import {closeMinuteHold} from './minute-holds.mjs';
import {resolveFundingEnv,resolvedFunding} from './provider-funding.mjs';
const PATH='/v1/human/plivo-cost-reconcile';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const JOB_ID=/^[a-f0-9]{32}$/i;
const validJobId=value=>UUID.test(value||'')||JOB_ID.test(value||'');
const HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200)=>Response.json(data,{status,headers:HEADERS});
const fail=(error,status=400)=>json({error},status);


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
// Only a persisted, matched CDR plus a signed-ended session may settle a
// hold. Older jobs without holds remain observations. Retry after a crash
// between databases is safe because the CDR and terminal hold are idempotent.
async function settleObservedCall(env,job,tid,jid,cdr){
 const hold=await env.CONTROL_DB.prepare('SELECT state FROM tenant_minute_holds WHERE tenant_id=? AND job_id=?').bind(tid,jid).first();
 if(!hold)return {state:'no_hold',clientCreditsDebited:false};
 const session=await env.CONTROL_DB.prepare(`SELECT id FROM scripted_phone_pilots WHERE tenant_id=? AND job_id=? AND provider_account_id=?
 AND provider_call_id=? AND caller=? AND destination=? AND hangup_at IS NOT NULL
 AND phase IN ('completed','declined','ended','needs_review')`).bind(tid,jid,job.accountSid,job.callUuid,job.caller,job.destination).first();
 if(!session||cdr.billed_duration%30!==0)return {state:'needs_review',clientCreditsDebited:false};
 const result=await closeMinuteHold(env.CONTROL_DB,{tenantId:tid,job:jid,billedSeconds:cdr.billed_duration,kind:'verified_cdr',evidenceRef:'plivo-cdr:'+job.callUuid});
 return {state:result.ok?'settled':result.state,clientCreditsDebited:result.ok&&cdr.billed_duration>0&&result.replayed!==true,chargedSeconds:result.ok?cdr.billed_duration:null,replayed:result.replayed===true};
}
export async function handlePlivoCostReconcile(req,env,user,{fetcher=fetch}={}){
 const url=new URL(req.url);
 if(url.pathname!==PATH)return null;
 if(req.method!=='POST')return fail('method not allowed',405);
 if(url.search)return fail('unsupported query',400);
 if(!mutationOriginAllowed(req))return fail('same origin required',403);
 try{
  if(!env.CONTROL_DB||!await currentSuperAdminMfa(env.CONTROL_DB,user))
   return fail('current Super Admin MFA required',403);
  const data=await input(req);
  if(!data||Array.isArray(data)||typeof data!=='object'||
     Object.keys(data).length!==2||!Object.hasOwn(data,'tenantId')||
     !Object.hasOwn(data,'jobId')||
     !UUID.test(data.tenantId||'')||!validJobId(data.jobId))
   return fail('invalid call selection');
  return await observeCampaignCdr(env,data.tenantId,data.jobId,user.id,'human:'+user.id,fetcher,()=>currentSuperAdminMfa(env.CONTROL_DB,user));
 }catch(e){
  if(/JSON|invalid/i.test(String(e?.message||'')))return fail('invalid request');
  console.error('AR3D Plivo CDR observation unavailable');
  return fail('cost reconciliation unavailable',503);
 }
}

// Shared internal path. No route accepts actor identity or provider URL from clients.
async function observeCampaignCdr(env,tid,jid,actor,auditActor,fetcher,authorize=null){
  const tenant=await env.CONTROL_DB.prepare(
   "SELECT id AS tenant_id,storage_mode,dedicated_binding FROM tenants WHERE id=? AND status IN('trial','active','suspended')"
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
  const verified=await readVerifiedPlivoCdr(env,job,{fetcher});
  if(!verified.ok)return fail(verified.error,503);
  const {cdr}=verified;
  // The provider GET can outlive the privileged session. A manual request
  // must still have current MFA and an active Super Admin before any write.
  if(authorize&&!await authorize())return fail('current Super Admin MFA required',403);
  const at=new Date().toISOString();
  const recorded=await db.batch([
   db.prepare(
    'INSERT OR IGNORE INTO verified_provider_call_costs('+
    'tenant_id,job_id,provider_call_uuid,reported_amount,billed_seconds,'+
    'call_seconds,currency_status,verified_by,verified_at) '+
    "VALUES(?,?,?,?,?,?,'unverified',?,?)"
   ).bind(tid,jid,job.callUuid,cdr.total_amount,
    cdr.billed_duration,cdr.call_duration,actor,at),
   db.prepare(
    "INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) "+
    "SELECT ?,?,?,'plivo.cdr_observed',?,? WHERE changes()=1"
   ).bind(tid,crypto.randomUUID(),auditActor,jid,at)
  ]);
  const newlyRecorded=Number(recorded[0]?.meta?.changes)===1&&Number(recorded[1]?.meta?.changes)===1;
  if(newlyRecorded){
   const settlement=await settleObservedCall(env,job,tid,jid,cdr);
   return json({tenantId:tid,jobId:jid,recorded:true,alreadyRecorded:false,
    currency:'unverified',providerReportedAmount:cdr.total_amount,
    billedSeconds:cdr.billed_duration,clientCreditsDebited:settlement.clientCreditsDebited,settlement,
    notice:settlement.state==='settled'?'Matched call minutes settled once.':'CDR recorded; no new client debit.'});
  }
  const old=await db.prepare(
   'SELECT provider_call_uuid AS callUuid,reported_amount AS amount,'+
   'billed_seconds AS billedSeconds,call_seconds AS callSeconds '+
   'FROM verified_provider_call_costs WHERE tenant_id=? AND job_id=?'
  ).bind(tid,jid).first();
  if(!old||old.callUuid!==job.callUuid||old.amount!==cdr.total_amount||
     old.billedSeconds!==cdr.billed_duration||old.callSeconds!==cdr.call_duration)
   return fail('provider CDR changed; billing needs manual review',409);
  const settlement=await settleObservedCall(env,job,tid,jid,cdr);
  return json({tenantId:tid,jobId:jid,recorded:true,alreadyRecorded:true,
   currency:'unverified',providerReportedAmount:old.amount,
   billedSeconds:old.billedSeconds,clientCreditsDebited:settlement.clientCreditsDebited,settlement,
   notice:'Identical provider CDR; settlement is idempotent.'});

}

// Manual dashboard funding includes automatic, identity-matched minute
// settlement. Older deployments retain their explicit settlement switch.
export const automaticMinuteSettlementApproved=env=>env.AR3D_AUTO_CDR_SETTLEMENT==='approved'||
 resolvedFunding(env)?.source==='manual_balance';
// Product-side settlement, not an assistant automation.
// At most three sequential CDR GETs per existing Worker tick (5 seconds each).
// Select a rotating, distinct snapshot before processing; failure of one row
// must not block other eligible calls. Uncertain calls never qualify.
export async function runAutomaticMinuteSettlement(env,{now=Date.now(),fetcher=fetch,maxCalls=3}={}){
 if(!Number.isSafeInteger(now)||now<0)throw Error('invalid settlement time');
 if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>3)throw Error('invalid settlement limit');
 env=await resolveFundingEnv(env);
 if(!automaticMinuteSettlementApproved(env))return {attempted:0};
 const eligible=" FROM tenant_minute_holds h JOIN scripted_phone_pilots p ON p.tenant_id=h.tenant_id AND p.job_id=h.job_id WHERE h.state='held' AND p.hangup_at IS NOT NULL AND p.hangup_at<=? AND p.provider_call_id IS NOT NULL AND p.phase IN ('completed','declined','ended','needs_review') AND COALESCE(CASE WHEN json_valid(p.survey_json) THEN json_extract(p.survey_json,'$.phoneMeta.mode') END,'')<>'industry_school_v1'";
 const cutoff=now-60000;
 const count=(await env.CONTROL_DB.prepare('SELECT COUNT(*) AS total'+eligible).bind(cutoff).first())?.total;
 if(!Number.isSafeInteger(count)||count<0)throw Error('invalid settlement queue');
 if(count===0)return {attempted:0};
 const limit=Math.min(maxCalls,count),offset=(Math.floor(now/60000)*maxCalls)%count;
 const select=async(n,skip)=>(await env.CONTROL_DB.prepare('SELECT h.tenant_id AS tenantId,h.job_id AS jobId'+eligible+' ORDER BY h.created_at,h.tenant_id,h.job_id LIMIT ? OFFSET ?').bind(cutoff,n,skip).all()).results;
 const rows=await select(limit,offset);
 if(rows.length<limit)rows.push(...await select(limit-rows.length,0));
 const seen=new Set();let attempted=0,settled=0;
 for(const row of rows){
  if(!UUID.test(row.tenantId)||!validJobId(row.jobId))continue;
  const key=row.tenantId+':'+row.jobId;
  if(seen.has(key))continue;seen.add(key);attempted++;
  try{
   const response=await observeCampaignCdr(env,row.tenantId,row.jobId,'system:plivo-cdr','system:plivo-cdr',fetcher);
   const result=await response.json();
   if(response.ok&&result.settlement?.state==='settled')settled++;
  }catch{/* Preserve the hold and continue the bounded batch. */}
 }
 return attempted?{attempted,settled}:{attempted:0};
}
