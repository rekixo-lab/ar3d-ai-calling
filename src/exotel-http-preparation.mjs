// Build genuine-format Exotel HTTP requests, WITHOUT sending them.
// This module is intentionally NOT wired into any Worker HTTP route.
// No helper here invokes fetch(), opens a socket or authorizes a call.
import {buildExotelVoiceAiContract} from './exotel-voice-adapter.mjs';
const safeCredential=/^[\x21-\x7e]{8,256}$/;
function basicAuth(key,token){
  if(typeof key!=='string'||typeof token!=='string'||
     !safeCredential.test(key)||!safeCredential.test(token)||
     key.includes(':')||token.includes('\r')||token.includes('\n'))
    throw Error('invalid Exotel API credential material');
  return 'Basic '+btoa(key+':'+token);
}
export function prepareExotelConnectRequest(config,{apiKey,apiToken}={}){
  const contract=buildExotelVoiceAiContract(config);
  const authorization=basicAuth(apiKey,apiToken);
  const form=new FormData();
  for(const [field,value] of Object.entries(contract.fields))form.append(field,value);
  // The Request object can only be used by server-side approved orchestration,
  // currently absent. Never log it or expose it to UI / serialization.
  return new Request(contract.endpoint,{
    method:'POST',body:form,headers:{
      Authorization:authorization,Accept:'application/json'
    },redirect:'error',referrerPolicy:'no-referrer'
  });
}
export function summarizeUntrustedExotelConnectResponse(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!raw.Call||
     typeof raw.Call!=='object'||Array.isArray(raw.Call))
    throw Error('invalid Exotel Connect API response');
  const allowed=['Sid','Status','From','PhoneNumberSid','Direction',
    'DateCreated','RecordingUrl'];
  if(Object.keys(raw.Call).some(x=>!allowed.includes(x))||
     typeof raw.Call.Sid!=='string'||!/^[A-Za-z0-9_-]{4,128}$/.test(raw.Call.Sid)||
     !['queued','in-progress','completed','failed','busy','no-answer'].includes(raw.Call.Status))
    throw Error('invalid Exotel Connect API response fields');
  return Object.freeze({
    vendor:'exotel',status:raw.Call.Status,providerCallSid:raw.Call.Sid,
    authenticated:false,customerCallCreated:false,consentAuthorized:false,
    usageBillable:false,recordingStored:false,
    note:'Parsed response has not been reconciled with a server-authorized call.'
  });
}
// Explicit denial of live dispatch until authenticated provider integration,
// telecom consent and signed/allowlisted callback security are separately approved.
export async function submitExotelConnect(){
  throw Error('Exotel live call dispatch is disabled until provider approval and runtime integration');
}
