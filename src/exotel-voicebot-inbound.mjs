// Exotel Managed Voicebot inbound callbacks: authenticated, metadata-only,
// replay-safe quarantine. NO live dialing, no transcript/phone storage,
// no tenant/lead guess, no consent changes or CRM writes.
// Vendor wire contract: https://docs.exotel.com/intelligent-voice-agents/voicebot-webhooks
import {parseExotelVoicebotEvent,exotelVoicebotAck} from './exotel-voicebot-webhook-contract.mjs';

const ROOT='/v1/provider/exotel/voicebot/';
const PATHS=Object.freeze({
  'transcript-events':'transcript',
  'session-end':'session_end'
});
const MAX_BODY=16384;
const MAX_EVENTS=8;
const RETENTION_MS=30*86400000;
const OPT_OUT=/(?:stop calling|do not call|don't call|remove my number|unsubscribe|कॉल मत|फोन मत|दोबारा कॉल मत|नंबर हटा|नम्बर हटा|बात नहीं करनी)/iu;
const HEX_TOKEN=/^[0-9a-f]{64}$/i;
const HEADERS=Object.freeze({
  'Cache-Control':'no-store',
  'Content-Type':'application/json; charset=utf-8',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY'
});
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const fail=(status,code)=>response({error:code},status);
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
async function tokenIsValid(expected,authorization){
  if(typeof expected!=='string'||!HEX_TOKEN.test(expected))return false;
  const matched=typeof authorization==='string'?
    /^Bearer ([0-9a-f]{64})$/i.exec(authorization):null;
  if(!matched)return false;
  const bytes=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest('SHA-256',bytes.encode(expected)),
    crypto.subtle.digest('SHA-256',bytes.encode(matched[1]))
  ]);
  const u=new Uint8Array(a),v=new Uint8Array(b);
  let mismatch=0;
  for(let i=0;i<u.length;i++)mismatch|=u[i]^v[i];
  return mismatch===0;
}
async function readBounded(req){
  if(!req.body||Number(req.headers.get('content-length'))>MAX_BODY)
    throw Error('invalid webhook body');
  const reader=req.body.getReader();
  const chunks=[];let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_BODY)throw Error('invalid webhook body');
      chunks.push(value);
    }
  }finally{reader.releaseLock()}
  if(size<10)throw Error('invalid webhook body');
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  return bytes;
}
// Exotel's dashboard "Test URL" can send a connectivity probe rather than
// the documented call/session envelope. Its exact synthetic payload is not
// specified by the public vendor webhook contract. A strictly identified,
// authenticated, tiny probe may be acknowledged without treating it as a
// genuine voicebot session or writing anything to D1.
// This is deliberately NOT a fallback for malformed call/session events.
const PROBE_KEYS=new Set([
  'test','is_test','webhook_test','type','event','event_type',
  'webhook_type','message','timestamp','status','source'
]);
const REAL_EVENT_KEYS=new Set([
  'session_id','conversation_id','external_id','account_id','bot_id',
  'events','contact_uri','landing_number','metadata','custom_parameters',
  'session_state','trigger_reason','network_type','start_time','end_time'
]);
const SENSITIVE_KEYS=new Set([
  'phone','mobile','number','call_sid','lead_id','tenant_id','transcript',
  'customer','contact','recording'
]);
const PROBE_WORD=/^(?:test|test[_ -]?webhook|webhook[_ -]?test|ping|health[_ -]?check|verification|verify|validate|validation|webhook[_ -]?verification)$/i;
export function isExplicitExotelWebhookProbe(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<2||bytes.length>1024)
    return false;
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}
  catch{return false}
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const keys=Object.keys(value);
  if(keys.length<1||keys.length>9||
     keys.some(k=>!PROBE_KEYS.has(k)||REAL_EVENT_KEYS.has(k)||SENSITIVE_KEYS.has(k)))
    return false;
  const recognized=(value.test===true||value.is_test===true||
    value.webhook_test===true||
    ['type','event','event_type'].some(k=>typeof value[k]==='string'&&
      value[k].length<=48&&PROBE_WORD.test(value[k].trim())));
  return recognized;
}
// For troubleshooting EXOTEL's unpublicized Test URL shape, return only a
// fixed list of field PRESENCE indicators, NEVER values or raw body fragments.
// Authorization has already been confirmed before this can be called.
function invalidPayloadDiagnostics(bytes,error){
  const outcome={error:'invalid_webhook_payload'};
  if(!(bytes instanceof Uint8Array)||bytes.length>MAX_BODY)return outcome;
  try{
    const obj=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(obj&&typeof obj==='object'&&!Array.isArray(obj)){
      const documented=[
        'session_id','conversation_id','external_id','account_id',
        'session_state','trigger_reason','network_type','events',
        'test','is_test','webhook_test','type','event','event_type'
      ];
      outcome.present_fields=documented.filter(key=>Object.hasOwn(obj,key));
    }
  }catch{}
  const staticErrors=[
    'session identity','session state','network type','event list',
    'event','transcript turn','turn sequence','turn status',
    'turn segments','speaker','timestamp','raw bytes','JSON','envelope'
  ];
  const message=String(error?.message||'');
  outcome.validation=staticErrors.find(tag=>message.includes('invalid Exotel Voicebot '+tag))||'schema_or_body';
  return outcome;
}
async function receiptHmac(token,domain,value){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(token),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new TextEncoder().encode(domain+'\0'+JSON.stringify(value));
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes)));
}
async function makeReceipts(token,parsed,expectedKind,now){
  const id=[parsed.accountId||'',parsed.callId,parsed.sessionId,
    parsed.conversationId];
  const accountFingerprint=await receiptHmac(token,'account',parsed.accountId||'');
  const callFingerprint=await receiptHmac(token,'call',id.slice(0,2));
  const sessionFingerprint=await receiptHmac(token,'session',id);
  const conversationFingerprint=await receiptHmac(token,'conversation',
    [parsed.accountId||'',parsed.conversationId]);
  const events=expectedKind==='transcript'?parsed.events.map(ev=>({
    eventId:ev.eventId,eventKind:'transcript',turnStatus:ev.status,
    data:[ev.sequence,ev.status,ev.segments],
    possibleOptOut:ev.segments.some(x=>(x.speaker==='user'||x.speaker==='customer')&&OPT_OUT.test(x.text))
  })): [{
    eventId:'session_end',eventKind:'session_end',turnStatus:'none',
    data:[parsed.state,parsed.reason],possibleOptOut:false
  }];
  if(events.length===0||events.length>MAX_EVENTS)throw Error('missing transcript events');
  const out=[];
  for(const event of events){
    const receiptKey=await receiptHmac(token,'receipt',[...id,event.eventId]);
    const eventFingerprint=await receiptHmac(token,'event',[...id,event.eventId]);
    const payloadDigest=await receiptHmac(token,'payload',event.data);
    out.push(Object.freeze({
      receiptKey,accountFingerprint,callFingerprint,sessionFingerprint,
      conversationFingerprint,eventFingerprint,payloadDigest,
      eventKind:event.eventKind,turnStatus:event.turnStatus,
      possibleOptOut:event.possibleOptOut?1:0,
      receivedAt:new Date(now).toISOString(),expiresAt:now+RETENTION_MS
    }));
  }
  return out;
}
export async function quarantineExotelVoicebotDelivery(env,parsed,{
  kind,now=Date.now()
}={}){
  if(!env?.CONTROL_DB?.prepare||!env.CONTROL_DB.batch||
     typeof env.EXOTEL_VOICEBOT_WEBHOOK_TOKEN!=='string'||
     !HEX_TOKEN.test(env.EXOTEL_VOICEBOT_WEBHOOK_TOKEN)||
     !Number.isSafeInteger(now)||now<0||
     !['transcript','session_end'].includes(kind))
    throw Error('Exotel webhook receipt storage unavailable');
  if((kind==='transcript'&&parsed.state!=='session_in_progress')||
     (kind==='session_end'&&(parsed.state!=='session_end'||parsed.events.length!==0)))
    throw Error('invalid Exotel webhook event state');
  const receipts=await makeReceipts(env.EXOTEL_VOICEBOT_WEBHOOK_TOKEN,parsed,kind,now);
  const db=env.CONTROL_DB;
  // D1 batch is atomic. An event is never acknowledged until all receipts
  // are written AND read back to prove no conflicting replay.
  const stmts=receipts.map(item=>db.prepare(
    'INSERT INTO exotel_voicebot_event_receipts '+
    '(receipt_key,account_fingerprint,session_fingerprint,call_fingerprint,'+
    'conversation_fingerprint,event_fingerprint,payload_digest,event_kind,'+
    'turn_status,possible_opt_out,status,received_at,expires_at) '+
    "VALUES(?,?,?,?,?,?,?,?,?,?,'quarantined',?,?) "+
    'ON CONFLICT(receipt_key) DO NOTHING'
  ).bind(item.receiptKey,item.accountFingerprint,item.sessionFingerprint,
    item.callFingerprint,item.conversationFingerprint,item.eventFingerprint,
    item.payloadDigest,item.eventKind,item.turnStatus,item.possibleOptOut,
    item.receivedAt,item.expiresAt));
  const writes=await db.batch(stmts);
  if(!Array.isArray(writes)||writes.length!==receipts.length||
     writes.some(x=>![0,1].includes(Number(x?.meta?.changes))))
    throw Error('Exotel webhook receipt persistence unconfirmed');
  for(const item of receipts){
    const recorded=await db.prepare(
      'SELECT account_fingerprint,session_fingerprint,call_fingerprint,'+
      'conversation_fingerprint,event_fingerprint,payload_digest,event_kind,'+
      'turn_status,possible_opt_out,status FROM exotel_voicebot_event_receipts '+
      'WHERE receipt_key=? LIMIT 1'
    ).bind(item.receiptKey).first();
    if(!recorded||recorded.account_fingerprint!==item.accountFingerprint||
       recorded.session_fingerprint!==item.sessionFingerprint||
       recorded.call_fingerprint!==item.callFingerprint||
       recorded.conversation_fingerprint!==item.conversationFingerprint||
       recorded.event_fingerprint!==item.eventFingerprint||
       recorded.payload_digest!==item.payloadDigest||
       recorded.event_kind!==item.eventKind||
       recorded.turn_status!==item.turnStatus||
       Number(recorded.possible_opt_out)!==item.possibleOptOut||
       recorded.status!=='quarantined')
      throw Error('Exotel webhook conflicting or unconfirmed event replay');
  }
  return {accepted:true,receipts:receipts.length};
}
export async function handleExotelVoicebotWebhookRequest(req,env){
  const url=new URL(req.url);
  if(!url.pathname.startsWith(ROOT))return null;
  const kind=PATHS[url.pathname.slice(ROOT.length)];
  if(!kind||url.search)return fail(404,'not_found');
  if(req.method!=='POST')return fail(405,'method_not_allowed');
  // Browsers must not act as webhook clients; no CORS/credentialed traffic.
  if(req.headers.has('origin'))return fail(403,'forbidden');
  if(typeof env?.EXOTEL_VOICEBOT_WEBHOOK_TOKEN!=='string'||
     !HEX_TOKEN.test(env.EXOTEL_VOICEBOT_WEBHOOK_TOKEN))
    return fail(503,'webhook_not_configured');
  if(!await tokenIsValid(env.EXOTEL_VOICEBOT_WEBHOOK_TOKEN,
    req.headers.get('authorization')))
    return fail(401,'unauthorized');
  if(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')
    return fail(415,'json_required');
  if(!env?.CONTROL_DB?.prepare||!env.CONTROL_DB.batch)
    return fail(503,'webhook_storage_unavailable');
  let parsed,rawBytes;
  try{
    rawBytes=await readBounded(req);
    // A well-identified dashboard connectivity probe is never a call event:
    // return the documented ACK, no D1 records, no customer/CRM changes.
    if(isExplicitExotelWebhookProbe(rawBytes))
      return response(exotelVoicebotAck());
    parsed=parseExotelVoicebotEvent(rawBytes);
    if(parsed.accountId&&parsed.accountId!==env.EXOTEL_ACCOUNT_SID)
      return fail(422,'account_mismatch');
    if(kind==='transcript'&&
       (parsed.state!=='session_in_progress'||parsed.events.length===0))
      return fail(422,'invalid_transcript_event');
    if(kind==='session_end'&&
       (parsed.state!=='session_end'||parsed.events.length!==0))
      return fail(422,'invalid_session_end');
  }catch(error){
    return response(invalidPayloadDiagnostics(rawBytes,error),400);
  }
  try{
    await quarantineExotelVoicebotDelivery(env,parsed,{kind});
  }catch{
    // 503 encourages Exotel retry. Never expose raw text, IDs or DB errors.
    return fail(503,'webhook_quarantine_unavailable');
  }
  // Exact vendor-compatible success response; no customer data echoed.
  return response(exotelVoicebotAck());
}
