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
  const changed=Number(result.meta?.changes);
  if(changed!==0&&changed!==1)throw Error('unconfirmed synthetic inbox insert');
  // INSERT OR IGNORE alone is not sufficient: a repeated event ID with an
  // altered signed payload would otherwise be treated as an innocent replay.
  // Read back the immutable digest/kind on every replay and fail closed.
  if(changed===0){
    const recorded=await db.prepare(
      "SELECT payload_digest,event_kind,status FROM provider_event_inbox WHERE tenant_id=? AND provider='internal_test' AND event_id=?"
    ).bind(normalized.tenantId,normalized.eventId).first();
    if(recorded?.payload_digest!==digest||recorded?.event_kind!==normalized.kind||
       recorded?.status!=='quarantined')
      throw Error('conflicting or unconfirmed synthetic event replay');
  }
  return {quarantined:true,duplicate:changed===0,
    provider:'internal_test',eventId:normalized.eventId,
    note:'Only synthetic event metadata stored; no real provider or call execution.'};
}
