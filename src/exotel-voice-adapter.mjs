// Exotel India Voice AI Connect contract prepared against official docs.
// Pure contract builder and UNTRUSTED callback shape parser ONLY.
// There is no fetch(), no API Basic Auth, no keys and NO network execution.
//
// https://developer.exotel.com/docs/agentstream/connect-voice-ai
// https://developer.exotel.com/docs/references/authentication
const TARGET='https://api.in.exotel.com';
const number=/^\+91[6-9][0-9]{9}$/;
const sid=/^[A-Za-z0-9_-]{4,64}$/;
// A legitimate ExoPhone cannot be only plus signs or contain repeated '+'.
const caller=/^\+?[0-9]{6,19}$/;
const key=/^[A-Za-z0-9._-]{1,128}$/;
const validWss=v=>{
  try {
    const u=new URL(v);
    return u.protocol==='wss:'&&!!u.hostname&&!u.username&&!u.password&&
      !u.hash&&!u.port&&v.length<=600&&!u.hostname.endsWith('.local');
  }catch{return false}
};
const validHttps=v=>{
  try{
    const u=new URL(v);
    return u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password&&
      !u.hash&&!u.port&&v.length<=600;
  }catch{return false}
};
export function buildExotelVoiceAiContract(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     Object.keys(raw).some(k=>!['accountSid','from','callerId','streamUrl','statusCallback','customField'].includes(k))||
     !sid.test(raw.accountSid)||!number.test(raw.from)||
     !caller.test(raw.callerId)||!validWss(raw.streamUrl)||
     (raw.statusCallback!==undefined&&!validHttps(raw.statusCallback))||
     (raw.customField!==undefined&&(!key.test(raw.customField))))
    throw Error('invalid Exotel Voice AI contract');
  const fields={
    From:raw.from,CallerId:raw.callerId,StreamUrl:raw.streamUrl,
    StreamType:'bidirectional',Record:'false'
  };
  if(raw.statusCallback!==undefined){
    fields.StatusCallback=raw.statusCallback;
    fields['StatusCallbackEvents[]']='terminal';
  }
  if(raw.customField!==undefined)fields.CustomField=raw.customField;
  return Object.freeze({
    method:'POST',endpoint:TARGET+'/v1/Accounts/'+raw.accountSid+'/Calls/connect',
    encoding:'multipart/form-data',fields:Object.freeze(fields),
    executionAllowed:false,transportRegistered:false,headersAttached:false,
    notice:'Validated Exotel contract only. No API token, no HTTP request, no approved caller ID and no live dialer.'
  });
}
const validStatuses=new Set(['queued','in-progress','completed','failed','busy','no-answer']);
const validTypes=new Set(['answered','terminal','ringing']);
const cbFields=new Set(['CallSid','Status','EventType','DateUpdated','ConversationDuration',
 'Direction','PhoneNumberSid','From','To','DateCreated','RecordingUrl',
 'StartTime','EndTime','CustomField']);
// Parse form-encoded callback *shape*. No server authentication is inferred.
// Official Exotel security docs advise IP allowlisting and replay handling;
// neither constitutes a cryptographic webhook signature by itself.
export function parseUnverifiedExotelCallback(raw){
  if(!(raw instanceof Uint8Array)||raw.byteLength<10||raw.byteLength>4096)
    throw Error('invalid Exotel callback bytes');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
  const form=new URLSearchParams(text),seen=new Set();
  for(const [name] of form){
    if(!cbFields.has(name)||seen.has(name))throw Error('invalid or duplicate Exotel callback field');
    seen.add(name);
  }
  const callSid=form.get('CallSid'),status=form.get('Status'),eventType=form.get('EventType');
  if(!callSid||!key.test(callSid)||!validStatuses.has(status)||!validTypes.has(eventType))
    throw Error('invalid Exotel callback status');
  const duration=form.get('ConversationDuration');
  if(duration!==null&&(!/^[0-9]{1,5}$/.test(duration)||Number(duration)>14400))
    throw Error('invalid Exotel callback duration');
  return Object.freeze({
    callSid,status,eventType,durationSeconds:duration===null?null:Number(duration),
    vendor:'exotel',trusted:false,authenticated:false,
    consentAuthorized:false,dndCleared:false,callLedgerUpdated:false,
    billable:false,recordingImported:false,
    notice:'This raw provider callback is NOT authenticated and cannot alter customer state.'
  });
}
export function normalizeExotelCallStatus(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     Object.keys(raw).some(k=>!['Sid','Status','Duration','Direction','RecordingUrl'].includes(k))||
     !key.test(raw.Sid)||!validStatuses.has(raw.Status))
    throw Error('invalid Exotel status result');
  return Object.freeze({
    vendor:'exotel',status:raw.Status,trusted:false,
    billable:false,usableForLiveReconciliation:false,
    notice:'Provider status is not reconciled or trusted by the production calling ledger.'
  });
}
