// Internal signed synthetic event ingestion into QUARANTINE ONLY.
// No HTTP route, provider callbacks, dialing, consent mutation, or billing.
import {verifySignedWebhook,validateProviderEnvelope,WEBHOOK_MAX_BYTES} from './provider-contract.mjs';
import {sha256hex} from './core.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function quarantineSyntheticEvent(db,{
  bodyBytes,signature,timestamp,eventId,secret,now=Date.now()
}={}){
  if(!db?.prepare||!(bodyBytes instanceof Uint8Array)||bodyBytes.length>WEBHOOK_MAX_BYTES)
    throw Error('invalid internal event ingestion');
  const good=await verifySignedWebhook({bodyBytes,signature,timestamp,eventId,secret,now});
  if(!good)throw Error('synthetic event signature expired or invalid');
  const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bodyBytes));
  const normalized=validateProviderEnvelope(raw);
  if(normalized.eventId.toLowerCase()!==eventId.toLowerCase()||!uuid.test(normalized.tenantId))
    throw Error('internal event ID or tenant mismatch');
  const owner=await db.prepare('SELECT id FROM tenants WHERE id=? LIMIT 1')
    .bind(normalized.tenantId).first();
  if(!owner)throw Error('tenant not found for quarantined event');
  const digest=await sha256hex(Array.from(bodyBytes,b=>b.toString(16).padStart(2,'0')).join(''));
  const result=await db.prepare(
    "INSERT OR IGNORE INTO provider_event_inbox (tenant_id,provider,event_id,event_kind,payload_digest,status,received_at) VALUES (?,'internal_test',?,?,?,'quarantined',?)"
  ).bind(normalized.tenantId,normalized.eventId,normalized.kind,digest,
    new Date(now).toISOString()).run();
  return {quarantined:true,duplicate:Number(result.meta?.changes||0)===0,
    provider:'internal_test',eventId:normalized.eventId,
    note:'Only synthetic event metadata stored; no real provider or call execution.'};
}
