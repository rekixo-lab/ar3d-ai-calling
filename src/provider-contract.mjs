// INTERNAL provider integration contract (not any telecom vendor's signature format).
// Only safe pure validation. No HTTP route, dialing, customer data mutation,
// DND approval, call billing or Provider API connection is exported here.
const encoder=new TextEncoder();
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hex=/^[a-f0-9]{64}$/i;
const allowedEvents=new Set([
  'call.initiated','call.ringing','call.connected','call.completed','call.failed','consent.opted_out'
]);
const transitions=Object.freeze({
  pending:['initiating','blocked'],
  initiating:['ringing','failed'],
  ringing:['connected','failed'],
  connected:['completed','failed'],
  completed:[],failed:[],blocked:[]
});
export const WEBHOOK_MAX_BYTES=16384;
export const WEBHOOK_WINDOW_MS=5*60*1000;
export function encodeSignedMessage(timestamp,eventId,bodyBytes){
  if(!Number.isSafeInteger(timestamp)||timestamp<0||typeof eventId!=='string'||!uuid.test(eventId)||
     !(bodyBytes instanceof Uint8Array)||bodyBytes.length<2||bodyBytes.length>WEBHOOK_MAX_BYTES)
    throw Error('invalid webhook signature input');
  const prefix=encoder.encode('ar3d-provider-v1:'+timestamp+':'+eventId+':');
  const value=new Uint8Array(prefix.length+bodyBytes.length);
  value.set(prefix);value.set(bodyBytes,prefix.length);
  return value;
}
export async function verifySignedWebhook({bodyBytes,signature,timestamp,eventId,secret,now=Date.now()}){
  if(typeof secret!=='string'||secret.length<32)throw Error('webhook signing key is not configured');
  if(typeof signature!=='string'||!hex.test(signature)||!Number.isSafeInteger(timestamp)||
     !Number.isSafeInteger(now)||Math.abs(now-timestamp*1000)>WEBHOOK_WINDOW_MS)
    return false;
  let message;
  try{message=encodeSignedMessage(timestamp,eventId,bodyBytes)}
  catch{return false}
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const sig=Uint8Array.from(signature.match(/../g),n=>parseInt(n,16));
  return crypto.subtle.verify('HMAC',key,sig,message);
}
export function validateProviderEnvelope(raw){
  // An application-owned normalized contract. A real provider adapter must
  // independently authenticate its vendor-specific webhook before calling this.
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     Object.keys(raw).some(k=>!['eventId','tenantId','kind','callId','occurredAt','durationSeconds'].includes(k)))
    throw Error('invalid provider event envelope');
  if(!uuid.test(raw.eventId)||!uuid.test(raw.tenantId)||!allowedEvents.has(raw.kind)||
     (raw.callId!==undefined&&!uuid.test(raw.callId))||
     typeof raw.occurredAt!=='string'||!Number.isFinite(Date.parse(raw.occurredAt))||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(raw.occurredAt))
    throw Error('invalid provider event');
  if(raw.kind.startsWith('call.')&&!raw.callId)throw Error('callId required');
  if(raw.durationSeconds!==undefined&&(!Number.isSafeInteger(raw.durationSeconds)||
     raw.durationSeconds<0||raw.durationSeconds>86400||raw.kind!=='call.completed'))
    throw Error('invalid duration');
  return Object.freeze({
    eventId:raw.eventId,tenantId:raw.tenantId,kind:raw.kind,
    callId:raw.callId??null,occurredAt:new Date(raw.occurredAt).toISOString(),
    durationSeconds:raw.durationSeconds??null,
    // This contract only validates shape. No consent or billing authority.
    executable:false,billable:false
  });
}
export function planCallStatusTransition(from,to){
  if(typeof from!=='string'||typeof to!=='string'||!Object.hasOwn(transitions,from)||
     !Object.hasOwn(transitions,to))return {allowed:false};
  return {allowed:transitions[from].includes(to)};
}
