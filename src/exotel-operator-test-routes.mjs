// Server-side, SUPER ADMIN ONLY, single-recipient Exotel Voicebot flow trial.
// Nothing is enabled by default. Does not enable campaigns, CRM call creation,
// consent grants, automatic transcripts, payment, or customer dialing.
// https://developer.exotel.com/docs/agentstream/connect-voice-ai-flow
import {exotelApiBase,configuredExotelRegion} from './exotel-region.mjs';

const PATH='/v1/human/engineering/exotel-self-test';
const E164=/^\+91[6-9][0-9]{9}$/;
const SID=/^[A-Za-z0-9_-]{4,128}$/;
const EXOPHONE=/^\+?[0-9]{6,19}$/;
const FLOW=/^[1-9][0-9]{1,11}$/;
const CRED=/^[\x21-\x7e]{8,256}$/;
const ACK='CALL_MY_VERIFIED_NUMBER_ONCE';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
const json=(body,status=200)=>Response.json(body,{status,headers});
const error=(code,status=400)=>json({error:code},status);
const string=v=>typeof v==='string'?v:'';

export function operatorTestConfig(env={}){
  const missing=[];
  if(env.EXOTEL_OPERATOR_TEST_ENABLED!=='enabled')missing.push('operator_explicit_opt_in');
  if(!SID.test(string(env.EXOTEL_ACCOUNT_SID)))missing.push('account_sid');
  if(!CRED.test(string(env.EXOTEL_API_KEY))||
      string(env.EXOTEL_API_KEY).includes(':'))missing.push('api_key');
  if(!CRED.test(string(env.EXOTEL_API_TOKEN))||
      string(env.EXOTEL_API_TOKEN).includes(':'))missing.push('api_token');
  if(!configuredExotelRegion(env))missing.push('region');
  if(!EXOPHONE.test(string(env.EXOTEL_CALLER_ID)))missing.push('caller_id');
  if(!FLOW.test(string(env.EXOTEL_VOICE_AI_FLOW_ID)))missing.push('voicebot_flow_id');
  if(!E164.test(string(env.EXOTEL_VERIFIED_TEST_NUMBER)))missing.push('verified_destination');
  return {ready:missing.length===0,missing};
}
async function readBody(req){
  if(!req.body||Number(req.headers.get('content-length'))>256)
    throw Error('invalid self-test request');
  const reader=req.body.getReader();let parts=[],size=0;
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>256)throw Error('invalid self-test request');
      parts.push(value);
    }
  }finally{reader.releaseLock()}
  const bytes=new Uint8Array(size);let pos=0;
  for(const chunk of parts){bytes.set(chunk,pos);pos+=chunk.length}
  const obj=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!obj||Array.isArray(obj)||typeof obj!=='object'||
      Object.keys(obj).length!==1||obj.confirm!==ACK)
    throw Error('invalid self-test request');
}
async function boundedJson(response){
  if(!response||response.status<200||response.status>=300||
     !(response.headers?.get('content-type')||'').toLowerCase().includes('application/json'))
    throw Error('provider response not confirmed');
  const reader=response.body?.getReader();
  if(!reader)throw Error('provider response not confirmed');
  let size=0,chunks=[];
  try{
    while(true){
      const next=await reader.read();
      if(next.done)break;
      size+=next.value.byteLength;
      if(size>16384)throw Error('provider response too large');
      chunks.push(next.value);
    }
  }finally{reader.releaseLock()}
  const bytes=new Uint8Array(size);let pos=0;
  for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export function validateOperatorTestResult(raw,caller){
  const call=raw?.Call;
  if(!call||typeof call!=='object'||Array.isArray(call)||
    !SID.test(string(call.Sid))||
    !['queued','in-progress','completed'].includes(call.Status)||
    call.Direction!=='outbound-api'||
    call.PhoneNumberSid!==caller||
    call.RecordingUrl!=null)
    throw Error('provider response identity mismatch');
  return {providerCallSid:call.Sid,status:call.Status};
}
export function makeOperatorTestRequest(env){
  if(!operatorTestConfig(env).ready)throw Error('self-test configuration missing');
  const url=exotelApiBase(env.EXOTEL_REGION)+'/v1/Accounts/'+env.EXOTEL_ACCOUNT_SID+'/Calls/connect';
  // Exotel documents curl -d parameters: application/x-www-form-urlencoded.
  const body=new URLSearchParams();
  body.set('From',env.EXOTEL_VERIFIED_TEST_NUMBER);
  body.set('CallerId',env.EXOTEL_CALLER_ID);
  body.set('Url','http://my.exotel.com/'+env.EXOTEL_ACCOUNT_SID+
    '/exoml/start_voice/'+env.EXOTEL_VOICE_AI_FLOW_ID);
  body.set('Record','false');
  body.set('TimeLimit','120');
  body.set('TimeOut','30');
  // No StatusCallbackEvents: Exotel rejects this field with a Flow URL.
  // No unauthenticated status callback or vendor-controlled URLs.
  const req=new Request(url,{
    method:'POST',
    headers:{Authorization:'Basic '+btoa(env.EXOTEL_API_KEY+':'+env.EXOTEL_API_TOKEN),
      Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},
    body,redirect:'manual'
  });
  return req;
}
async function reserve(db,userId,now){
  const slot=String(Math.floor(now/(30*60*1000)));
  const at=new Date(now).toISOString();
  const earliest=new Date(now-24*60*60*1000).toISOString();
  const id=crypto.randomUUID();
  // The quota check and reservation are ONE write, serialized by D1.
  // Global 30-minute slot + TWO attempts per rolling 24h, across admins.
  const row=await db.prepare(
    "INSERT INTO exotel_operator_test_calls "+
    "(id,actor_user_id,rate_slot,state,created_at,updated_at) "+
    "SELECT ?,?,?,'reserved',?,? WHERE "+
    "(SELECT COUNT(*) FROM exotel_operator_test_calls WHERE created_at>=?)<2 "+
    "ON CONFLICT(rate_slot) DO NOTHING"
  ).bind(id,userId,slot,at,at,earliest).run();
  if(Number(row?.meta?.changes)!==1)return null;
  return {id,at};
}
async function finalize(db,id,state,{sid=null,code=null}={}){
  const result=await db.prepare(
    "UPDATE exotel_operator_test_calls SET state=?,provider_call_sid=?,error_code=?,updated_at=? "+
    "WHERE id=? AND state='reserved'"
  ).bind(state,sid,code,new Date().toISOString(),id).run();
  if(Number(result?.meta?.changes)!==1)
    throw Error('self-test audit finalization failed');
}
async function lastCalls(db,userId){
  const result=await db.prepare(
    'SELECT t.id,t.state,t.error_code AS errorCode,t.created_at AS createdAt, '+
    'sc.state AS checkState,sc.provider_status AS providerStatus, '+
    'sc.duration_seconds AS durationSeconds,sc.error_code AS checkError, '+
    'sc.created_at AS checkedAt '+
    'FROM exotel_operator_test_calls t '+
    'LEFT JOIN exotel_operator_status_checks sc ON sc.id=('+
    'SELECT c.id FROM exotel_operator_status_checks c '+
    'WHERE c.call_request_id=t.id ORDER BY c.created_at DESC LIMIT 1) '+
    'WHERE t.actor_user_id=? ORDER BY t.created_at DESC LIMIT 5'
  ).bind(userId).all();
  return result.results||[];
}
export async function handleExotelOperatorTest(req,env,user,{apiFetch=fetch,now=Date.now()}={}){
  const path=new URL(req.url).pathname;
  if(path!==PATH)return null;
  if(user?.globalRole!=='super_admin')return error('forbidden',403);
  if(!env?.CONTROL_DB?.prepare)return error('control_database_unavailable',503);
  if(!['GET','POST'].includes(req.method))return error('method_not_allowed',405);
  // MFA must have happened as part of THIS login: old sessions that
  // predate enrollment are not strong enough to initiate even a test call.
  const mfa=await env.CONTROL_DB.prepare(
    'SELECT m.enabled_at FROM human_mfa_settings m JOIN human_sessions s '+
    'ON s.user_id=m.user_id WHERE m.user_id=? AND s.token_hash=? '+
    'AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at '+
    'AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1'
  ).bind(user.id,user.token_hash,now).first();
  const mfaEnabled=!!mfa?.enabled_at;
  const cfg=operatorTestConfig(env);
  if(req.method==='GET'){
    let recent=[];
    try{recent=await lastCalls(env.CONTROL_DB,user.id)}
    catch{return error('self_test_schema_not_provisioned',503)}
    return json({
      mode:'operator_verified_number_only',configured:cfg.ready,
      missing:cfg.missing,mfaEnabled,recent,realCallsStartedByRead:0,
      purpose:'one verified self-test only; no customers or campaigns',
      voicebotFlowId:FLOW.test(string(env.EXOTEL_VOICE_AI_FLOW_ID))?
        env.EXOTEL_VOICE_AI_FLOW_ID:null,
      destinationLast4:E164.test(string(env.EXOTEL_VERIFIED_TEST_NUMBER))?
        env.EXOTEL_VERIFIED_TEST_NUMBER.slice(-4):null
    });
  }
  if(!mfaEnabled)return error('enable_super_admin_mfa_first',403);
  if(!cfg.ready)return error('self_test_disabled_or_unconfigured',503);
  try{await readBody(req)}catch{return error('explicit_confirmation_required',400)}
  let attempt;
  try{attempt=await reserve(env.CONTROL_DB,user.id,now)}
  catch{return error('self_test_reservation_unavailable',503)}
  if(!attempt)return error('self_test_rate_limited',429);
  try{
    const request=makeOperatorTestRequest(env);
    let result;
    try{
      result=await apiFetch(request,{signal:AbortSignal.timeout(9000),
        redirect:'manual',cache:'no-store'});
    }catch{
      await finalize(env.CONTROL_DB,attempt.id,'unknown',{code:'provider_transport_uncertain'});
      return json({requestId:attempt.id,state:'unknown',
        notice:'Call outcome uncertain. Do not retry; check Exotel reports.'},502);
    }
    if(result.status===400||result.status===401||result.status===403||
       result.status===404||result.status===422||result.status===429){
      await finalize(env.CONTROL_DB,attempt.id,'rejected',{code:'provider_http_'+result.status});
      return json({requestId:attempt.id,state:'rejected',
        code:'provider_http_'+result.status},502);
    }
    let parsed;
    try{
      parsed=validateOperatorTestResult(await boundedJson(result),env.EXOTEL_CALLER_ID);
    }catch{
      await finalize(env.CONTROL_DB,attempt.id,'unknown',{code:'unconfirmed_provider_response'});
      return json({requestId:attempt.id,state:'unknown',
        notice:'Provider may have started a call. Do not retry.'},502);
    }
    await finalize(env.CONTROL_DB,attempt.id,'submitted',{sid:parsed.providerCallSid});
    return json({requestId:attempt.id,state:'submitted',
      providerStatus:parsed.status,realCallsRequested:1,
      crmUpdated:false,consentChanged:false,recordingRequested:false},202);
  }catch{
    // Reservation was created; never retry on an unknown execution result.
    return json({requestId:attempt.id,state:'unknown',
      notice:'Audit/dispatch uncertainty; do not retry without operator review.'},502);
  }
}
