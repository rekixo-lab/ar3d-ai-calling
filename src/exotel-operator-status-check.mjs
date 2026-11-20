// Real, read-only Exotel Call Details reconciliation for our own *previous*
// single-recipient operator self-test requests. No customer campaigns, no
// new calls, no generic CallSid lookup, no CRM writes, no recording playback.
import {getExotelOperatorTestStatusReadOnly} from './exotel-readonly-verification.mjs';
import {configuredExotelRegion} from './exotel-region.mjs';

const PATH='/v1/human/engineering/exotel-status-check';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const EXOPHONE=/^\+?[0-9]{6,19}$/;
const CRED=/^[\x21-\x7e]{8,256}$/;
const SID=/^[A-Za-z0-9_-]{4,128}$/;
const RESPONSE_HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(v,status=200)=>Response.json(v,{status,headers:RESPONSE_HEADERS});
const error=(code,status=400)=>json({error:code},status);

async function requestIdFromBody(req){
  if(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||
     !req.body||Number(req.headers.get('content-length'))>256)
    throw Error('invalid body');
  const reader=req.body.getReader(),chunks=[];let bytes=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;if(bytes>256)throw Error('too large');
      chunks.push(value);
    }
  }finally{reader.releaseLock()}
  const raw=new Uint8Array(bytes);let offset=0;
  for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length}
  const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object'||
     Object.keys(parsed).length!==1||!UUID.test(parsed.requestId))
    throw Error('invalid request');
  return parsed.requestId;
}
async function checkFreshMfaSession(db,user,now){
  const mfa=await db.prepare(
    'SELECT m.enabled_at FROM human_mfa_settings m JOIN human_sessions s '+
    'ON s.user_id=m.user_id WHERE m.user_id=? AND s.token_hash=? '+
    'AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at '+
    'AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1'
  ).bind(user.id,user.token_hash,now).first();
  return !!mfa?.enabled_at;
}
async function reserveOneCheck(db,requestId,userId,now){
  const id=crypto.randomUUID(),slot=String(Math.floor(now/300000));
  const at=new Date(now).toISOString();
  const result=await db.prepare(
    'INSERT INTO exotel_operator_status_checks '+
    '(id,call_request_id,actor_user_id,check_slot,state,created_at) '+
    "SELECT ?,id,actor_user_id,?,'reserved',? "+
    'FROM exotel_operator_test_calls WHERE id=? AND actor_user_id=? '+
    "AND state='submitted' AND provider_call_sid IS NOT NULL "+
    'AND (SELECT COUNT(*) FROM exotel_operator_status_checks '+
    'WHERE call_request_id=?)<12 '+
    'ON CONFLICT(call_request_id,check_slot) DO NOTHING'
  ).bind(id,slot,at,requestId,userId,requestId).run();
  return Number(result?.meta?.changes)===1?id:null;
}
async function finalize(db,id,state,{providerStatus=null,durationSeconds=null,code=null}={}){
  const result=await db.prepare(
    'UPDATE exotel_operator_status_checks '+
    'SET state=?,provider_status=?,duration_seconds=?,error_code=?,finished_at=? '+
    "WHERE id=? AND state='reserved'"
  ).bind(state,providerStatus,durationSeconds,code,new Date().toISOString(),id).run();
  if(Number(result?.meta?.changes)!==1)
    throw Error('unconfirmed provider status observation finalization');
}
export async function handleExotelOperatorStatusCheck(req,env,user,{
  apiFetch=fetch,now=Date.now()
}={}){
  if(new URL(req.url).pathname!==PATH)return null;
  if(req.method!=='POST')return error('method_not_allowed',405);
  if(user?.globalRole!=='super_admin'||!SID.test(String(user?.id||'')))
    return error('forbidden',403);
  if(!Number.isSafeInteger(now)||now<1||!env?.CONTROL_DB?.prepare)
    return error('control_database_unavailable',503);
  const db=env.CONTROL_DB;
  if(!await checkFreshMfaSession(db,user,now))
    return error('recent_mfa_login_required',403);
  let requestId;
  try{requestId=await requestIdFromBody(req)}
  catch{return error('invalid_request_id',400)}
  // Read ONLY registered Exotel call SID; never accept a browser-supplied
  // phone, account, CallSid, tenant ID, provider URL, or status assertion.
  let known;
  try{
    known=await db.prepare(
      'SELECT provider_call_sid AS callSid FROM exotel_operator_test_calls '+
      "WHERE id=? AND actor_user_id=? AND state='submitted' "+
      'AND provider_call_sid IS NOT NULL LIMIT 1'
    ).bind(requestId,user.id).first();
  }catch{return error('status_audit_unavailable',503)}
  if(!known?.callSid)return error('registered_call_not_found',404);
  const auth={
    accountSid:env.EXOTEL_ACCOUNT_SID,apiKey:env.EXOTEL_API_KEY,
    apiToken:env.EXOTEL_API_TOKEN,region:env.EXOTEL_REGION
  };
  if(!SID.test(String(auth.accountSid||''))||
     !CRED.test(String(auth.apiKey||''))||
     !CRED.test(String(auth.apiToken||''))||
     String(auth.apiKey).includes(':')||String(auth.apiToken).includes(':')||
     !configuredExotelRegion(env)||
     !EXOPHONE.test(String(env.EXOTEL_CALLER_ID||'')))
    return error('exotel_readonly_lookup_unconfigured',503);
  let auditId;
  try{auditId=await reserveOneCheck(db,requestId,user.id,now)}
  catch{return error('status_check_schema_unavailable',503)}
  if(!auditId)return error('status_refresh_rate_limited',429);
  let verified;
  try{
    verified=await getExotelOperatorTestStatusReadOnly(auth,{
      callSid:known.callSid,callerId:env.EXOTEL_CALLER_ID
    },{apiFetch});
  }catch(err){
    const code=err?.diagnosticCode==='provider_mismatch'?
      'provider_mismatch':'provider_unavailable';
    try{await finalize(db,auditId,'unknown',{code})}
    catch{return error('audit_unconfirmed_do_not_rely_on_status',503)}
    return json({checkId:auditId,state:'unknown',code,
      notice:'Exotel result could not be verified. No call was started or CRM lead updated.'},502);
  }
  try{
    await finalize(db,auditId,'verified',{
      providerStatus:verified.status,durationSeconds:verified.durationSeconds
    });
  }catch{return error('audit_unconfirmed_do_not_rely_on_status',503)}
  return json({
    checkId:auditId,requestId,state:'verified',providerStatus:verified.status,
    durationSeconds:verified.durationSeconds,
    source:'verified_exotel_call_details',dialRequestsStarted:0,
    crmLeadsUpdated:0,recordingsFetched:0,billingSettled:false,
    note:'Provider duration and prices may settle after the call. This is a status observation only.'
  });
}
