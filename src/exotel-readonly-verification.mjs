// Read-only Exotel provider verification. NEVER initiates or modifies calls.
// Validates Exotel's own HTTPS Call Details response for an existing authorized
// correlation only; not a signature for the incoming webhook nor a consent grant.
// https://developer.exotel.com/docs/voice-v1/api-reference/call-details
import {exotelApiBase} from './exotel-region.mjs';
const SID=/^[a-zA-Z0-9_-]{4,128}$/;
const CRED=/^[\x21-\x7e]{8,256}$/;
const VALID_STATUS=new Set(['queued','in-progress','completed','failed','busy','no-answer']);
const MAX_BYTES=65536;
// Codes are fixed and non-sensitive. Never forward vendor error bodies,
// full URLs, account IDs, credentials or transient HTTP exception messages.
function safeProviderError(code,message){
  const error=new Error(message);
  error.diagnosticCode=code;
  return error;
}
function responseCode(response){
  const status=response?.status;
  if(status===401)return 'http_401';
  if(status===403)return 'http_403';
  if(status===404)return 'http_404';
  if(status===429)return 'http_429';
  if(Number.isInteger(status)&&status>=500&&status<600)return 'http_5xx';
  return 'unexpected_http_status';
}
function validateString(value,pattern){return typeof value==='string'&&pattern.test(value)}
function credentials(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
     !validateString(input.accountSid,SID)||!validateString(input.apiKey,CRED)||
     !validateString(input.apiToken,CRED)||input.apiKey.includes(':')||
     input.apiToken.includes(':')||Object.keys(input).some(x=>!['accountSid','apiKey','apiToken','region'].includes(x)))
    throw Error('Exotel credentials are missing or invalid');
  // Region is optional only for backward-compatible pure test clients; the
  // deployed connectivity adapter requires it explicitly to prevent wrong-host
  // API lookups for newly connected accounts.
  exotelApiBase(input.region??'india');
  return input;
}
function urlFor(accountSid,suffix,region){
  return exotelApiBase(region)+'/v1/Accounts/'+accountSid+'/'+suffix;
}
async function boundedProviderGet(url,auth,apiFetch){
  const authorization='Basic '+btoa(auth.apiKey+':'+auth.apiToken);
  let response;
  try {
    response=await apiFetch(url,{
      method:'GET',headers:{Authorization:authorization,Accept:'application/json'},
      redirect:'error',cache:'no-store',signal:AbortSignal.timeout(7000)
    });
  } catch {throw safeProviderError('transport_unavailable','Exotel read-only lookup transport unavailable')}
  if(!response||response.status!==200)throw safeProviderError(
    responseCode(response),'Exotel read-only lookup not authorized or unavailable');
  if(!(response.headers?.get('content-type')||'').toLowerCase().includes('application/json'))
    throw safeProviderError('unexpected_content_type','Exotel read-only lookup returned unexpected format');
  let size=0,payload='';
  const reader=response.body?.getReader();
  if(!reader)throw Error('Exotel read-only lookup body missing');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  try{
    while(true){
      const next=await reader.read();if(next.done)break;
      size+=next.value.byteLength;
      if(size>MAX_BYTES){await reader.cancel();throw Error('Exotel response too large')}
      payload+=decoder.decode(next.value,{stream:true});
    }
    payload+=decoder.decode();
  }catch{throw safeProviderError('response_unreadable','Exotel read-only response rejected')}finally{reader.releaseLock()}
  try {
    const result=JSON.parse(payload);
    if(!result||typeof result!=='object'||Array.isArray(result))
      throw Error('invalid');
    return result;
  }catch{throw safeProviderError('invalid_response_json','Exotel response JSON invalid')}
}
export async function checkExotelAccountReadOnly(auth,{apiFetch=fetch}={}){
  const c=credentials(auth);
  const data=await boundedProviderGet(urlFor(c.accountSid,'Calls.json?PageSize=1',c.region??'india'),c,apiFetch);
  if(!Array.isArray(data.Calls))throw safeProviderError('unexpected_call_list_schema','Exotel account response schema mismatch');
  return Object.freeze({
    provider:'exotel',reachable:true,accountLookupSucceeded:true,
    callsCreated:0,existingCallDataReturned:false,tokenMaterialReturned:false,
    callbackSourceAuthenticated:false,liveCallingAuthorized:false,
    note:'Credentials authorize a read-only Exotel API query only. Caller ID, KYC, DLT, consent and DND approvals remain independent.'
  });
}
export async function verifyExotelExistingCallReadOnly(auth,expected,{apiFetch=fetch}={}){
  const c=credentials(auth);
  if(!expected||typeof expected!=='object'||Array.isArray(expected)||
     Object.keys(expected).some(k=>!['callSid','status','direction','callerId'].includes(k))||
     !validateString(expected.callSid,SID)||!VALID_STATUS.has(expected.status)||
     expected.direction!=='outbound-api'||
     !validateString(expected.callerId,/^[+0-9]{6,20}$/))
    throw Error('invalid expected Exotel call context');
  const url=urlFor(c.accountSid,'Calls/'+expected.callSid+'.json?details=true',c.region??'india');
  const body=await boundedProviderGet(url,c,apiFetch);
  const record=body.Call;
  if(!record||typeof record!=='object'||Array.isArray(record)||
     record.Sid!==expected.callSid||record.Status!==expected.status||
     record.Direction!==expected.direction||
     record.PhoneNumberSid!==expected.callerId||
     record.AccountSid!==c.accountSid)
    throw Error('Exotel read-only call details mismatch');
  return Object.freeze({
    source:'exotel_server_lookup',callSidMatched:true,
    statusMatched:true,callerIdMatched:true,accountMatched:true,
    providerLookupSucceeded:true,rawWebhookAuthenticated:false,
    durableReplayProof:false,consentVerified:false,dndVerified:false,
    leadModified:false,callLedgerUpdated:false,recordingDownloaded:false,
    invoiceGenerated:false,billable:false,liveCallingAuthorized:false,
    note:'Read-only provider status independently fetched; no callback authenticity, customer consent, ledger or charging authority follows.'
  });
}
