import {boundedText,decryptCredentials,verifySignature,sha256hex,resolveCrmDb,iso,text,phone,json,fail} from './whatsapp-core.mjs';

const PATH='/v1/provider/whatsapp';
export function isStopMessage(value){return /^(?:stop|unsubscribe|opt\s*out|cancel|बंद|बंद\s*करें|बंद\s*करो|नहीं\s*भेजें|मत\s*भेजो|mat\s*bhejo)[.!।\s]*$/iu.test(String(value||'').trim());}
export function statusTransition(current,next){
 if(current==='replied')return current;
 const ranks={unknown:0,failed:0,submitted:1,delivered:2,read:3};
 if(next==='failed')return ['unknown','submitted'].includes(current)?'failed':current;
 if(!['submitted','delivered','read'].includes(next)||!Object.hasOwn(ranks,current))return current;
 return ranks[next]>ranks[current]?next:current;
}
function providerTime(value,now){const n=Number(value)*1000;return Number.isSafeInteger(n)&&n>=now-30*86400000&&n<=now+300000?iso(n):null;}
function messageText(message){return text(message.text?.body||message.button?.text||message.button?.payload||message.interactive?.button_reply?.title||message.interactive?.list_reply?.title||'['+text(message.type,30)+']',2000);}
async function recordIncoming(db,tid,lead,entry,now){
 const stamp=providerTime(entry.timestamp,now);if(!stamp||typeof entry.id!=='string'||entry.id.length>250)return;
 const content=messageText(entry),stop=isStopMessage(content)||isStopMessage(entry.button?.payload)||isStopMessage(entry.interactive?.button_reply?.id),key='in:'+entry.id,date=iso(now);
 const pending="EXISTS(SELECT 1 FROM whatsapp_event_receipts r WHERE r.tenant_id=? AND r.event_key=? AND r.processed_at IS NULL)";
 const ops=[
  db.prepare('INSERT INTO whatsapp_event_receipts(tenant_id,event_key,received_at) VALUES(?,?,?) ON CONFLICT(tenant_id,event_key) DO NOTHING').bind(tid,key,date),
  db.prepare('INSERT INTO whatsapp_inbound_messages(tenant_id,id,lead_id,text,message_type,received_at) SELECT ?,?,?,?,?,? WHERE '+pending+' ON CONFLICT(tenant_id,id) DO NOTHING').bind(tid,entry.id,lead.id,content,text(entry.type,30),stamp,tid,key),
  db.prepare('INSERT INTO whatsapp_threads(tenant_id,lead_id,paused,last_inbound_at,updated_at) SELECT ?,?,1,?,? WHERE '+pending+' ON CONFLICT(tenant_id,lead_id) DO UPDATE SET paused=1,last_inbound_at=MAX(COALESCE(whatsapp_threads.last_inbound_at,\'\'),excluded.last_inbound_at),updated_at=excluded.updated_at').bind(tid,lead.id,stamp,date,tid,key),
  db.prepare("UPDATE whatsapp_messages SET status='cancelled',reason=?,updated_at=? WHERE tenant_id=? AND lead_id=? AND status IN('scheduled','pending_setup') AND "+(stop?'1=1':"kind IN('property_details','followup')")+' AND '+pending).bind(stop?'Customer requested no further messages':'Customer replied; salesperson follow-up required',date,tid,lead.id,tid,key),
  db.prepare("UPDATE whatsapp_messages SET status='replied',updated_at=? WHERE tenant_id=? AND lead_id=? AND kind IN('property_details','followup') AND status IN('submitted','delivered','read') AND source_at<=? AND "+pending).bind(date,tid,lead.id,stamp,tid,key)
 ];
 if(stop){
  ops.push(db.prepare("INSERT INTO lead_opt_out_events(tenant_id,id,lead_id,source,reason,actor,created_at) SELECT ?,?,?,'customer_request','WhatsApp opt-out','whatsapp_webhook',? WHERE "+pending).bind(tid,crypto.randomUUID(),lead.id,stamp,tid,key));
  ops.push(db.prepare("UPDATE leads SET consent_status='denied',dnd_status='blocked',updated_at=? WHERE tenant_id=? AND id=? AND "+pending).bind(date,tid,lead.id,tid,key));
  ops.push(db.prepare("UPDATE whatsapp_permissions SET status='revoked',updated_at=?,actor='whatsapp_webhook' WHERE tenant_id=? AND lead_id=? AND "+pending).bind(date,tid,lead.id,tid,key));
 }
 ops.push(db.prepare('UPDATE whatsapp_event_receipts SET processed_at=? WHERE tenant_id=? AND event_key=? AND processed_at IS NULL').bind(date,tid,key));
 await db.batch(ops);
}
export async function applyPendingStatusEvents(db,tid,{now=Date.now(),limit=10}={}){
 const events=await db.prepare("SELECT r.event_key,r.payload_json FROM whatsapp_event_receipts r WHERE r.tenant_id=? AND r.processed_at IS NULL AND r.event_key LIKE 'status:%' AND EXISTS(SELECT 1 FROM whatsapp_messages m WHERE m.tenant_id=r.tenant_id AND m.provider_message_id=json_extract(r.payload_json,'$.id')) ORDER BY r.received_at,r.event_key LIMIT ?").bind(tid,Math.min(20,Math.max(1,limit))).all();
 let applied=0;
 for(const event of events.results||[]){
  let payload;try{payload=JSON.parse(event.payload_json);}catch{continue;}
  const row=await db.prepare('SELECT id,status,lead_id FROM whatsapp_messages WHERE tenant_id=? AND provider_message_id=?').bind(tid,payload.id).first();
  if(!row)continue;
  const lead=await db.prepare('SELECT mobile_e164 FROM leads WHERE tenant_id=? AND id=?').bind(tid,row.lead_id).first();
  if(payload.recipient&&phone(payload.recipient)!==lead?.mobile_e164)continue;
  await db.batch([
   db.prepare(`UPDATE whatsapp_messages SET status=CASE
    WHEN status='replied' THEN status
    WHEN ?='failed' AND status IN('unknown','submitted') THEN 'failed'
    WHEN ?='read' AND status IN('unknown','failed','submitted','delivered') THEN 'read'
    WHEN ?='delivered' AND status IN('unknown','failed','submitted') THEN 'delivered'
    WHEN ?='submitted' AND status='unknown' THEN 'submitted' ELSE status END,
    reason=CASE WHEN ?='failed' AND status IN('unknown','submitted') THEN ? WHEN ? IN('read','delivered') THEN '' ELSE reason END,
    delivered_at=CASE WHEN ? IN('delivered','read') THEN MIN(COALESCE(delivered_at,?),?) ELSE delivered_at END,
    read_at=CASE WHEN ?='read' THEN MIN(COALESCE(read_at,?),?) ELSE read_at END,updated_at=? WHERE tenant_id=? AND id=?`).bind(payload.status,payload.status,payload.status,payload.status,payload.status,payload.errorCode?'Meta delivery failed (code '+payload.errorCode+')':'Meta delivery failed',payload.status,payload.status,payload.at,payload.at,payload.status,payload.at,payload.at,iso(now),tid,row.id),
   db.prepare('UPDATE whatsapp_event_receipts SET processed_at=? WHERE tenant_id=? AND event_key=? AND processed_at IS NULL').bind(iso(now),tid,event.event_key)
  ]);applied++;
 }
 return applied;
}
async function recordStatus(db,tid,status,now){
 const mapped={sent:'submitted',delivered:'delivered',read:'read',failed:'failed'}[status.status],stamp=providerTime(status.timestamp,now);
 if(!mapped||!stamp||typeof status.id!=='string'||status.id.length>250)return;
 const payload={id:status.id,status:mapped,at:stamp,recipient:text(status.recipient_id,40),errorCode:Number(status.errors?.[0]?.code)||null};
 const key='status:'+status.id+':'+mapped+':'+status.timestamp;
 await db.prepare('INSERT INTO whatsapp_event_receipts(tenant_id,event_key,received_at,payload_json) VALUES(?,?,?,?) ON CONFLICT(tenant_id,event_key) DO NOTHING').bind(tid,key,iso(now),JSON.stringify(payload)).run();
}
export async function handleWhatsAppWebhook(req,env,{now=Date.now()}={}){
 const url=new URL(req.url);if(url.pathname!==PATH)return null;
 if(!['GET','POST'].includes(req.method))return fail('method not allowed',405);
 try{
  if(req.method==='GET'){
   const token=url.searchParams.get('hub.verify_token'),challenge=url.searchParams.get('hub.challenge');
   if(url.searchParams.get('hub.mode')!=='subscribe'||!token||token.length>256||!/^\d{1,100}$/.test(challenge||''))return fail('invalid verification',403);
   const row=await env.CONTROL_DB.prepare('SELECT tenant_id FROM whatsapp_connections WHERE verify_token_hash=? LIMIT 1').bind(await sha256hex(token)).first();
   if(!row)return fail('verification failed',403);
   // GET proves callback configuration; readiness additionally requires a signed POST.
   return new Response(challenge,{headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
  }
  if(!req.headers.get('content-type')?.startsWith('application/json'))return fail('JSON required',400);
  const raw=await boundedText(req,262144),signature=req.headers.get('x-hub-signature-256');
  let data;try{data=JSON.parse(raw);}catch{return fail('invalid payload');}
  if(data.object!=='whatsapp_business_account'||!Array.isArray(data.entry)||data.entry.length>10)return fail('invalid webhook object');
  let accepted=0,total=0;
  for(const entry of data.entry){
   if(!Array.isArray(entry.changes)||entry.changes.length>20)return fail('invalid webhook changes');
   for(const change of entry.changes){
    if(change.field!=='messages')continue;
    const value=change.value||{},phoneId=String(value.metadata?.phone_number_id||'');
    if(!/^\d{5,30}$/.test(phoneId))continue;
    const connection=await env.CONTROL_DB.prepare("SELECT c.*,t.storage_mode,t.dedicated_binding FROM whatsapp_connections c JOIN tenants t ON t.id=c.tenant_id WHERE c.phone_number_id=? AND t.status IN('trial','active') LIMIT 1").bind(phoneId).first();
    if(!connection)continue;
    if(String(entry.id)!==connection.messaging_account_id)return fail('account mismatch',403);
    const credentials=await decryptCredentials(env,connection.tenant_id,connection.credentials_ciphertext);
    if(!await verifySignature(raw,signature,credentials.appSecret))return fail('invalid signature',403);
    const db=resolveCrmDb(env,{tenant_id:connection.tenant_id,storage_mode:connection.storage_mode,dedicated_binding:connection.dedicated_binding}),tid=connection.tenant_id;
    const messages=Array.isArray(value.messages)?value.messages:[],statuses=Array.isArray(value.statuses)?value.statuses:[];
    total+=messages.length+statuses.length;if(total>50)return fail('webhook batch too large',413);
    await env.CONTROL_DB.prepare('UPDATE whatsapp_connections SET webhook_verified_at=COALESCE(webhook_verified_at,?),updated_at=? WHERE tenant_id=?').bind(iso(now),iso(now),tid).run();
    for(const message of messages){
     const mobile=phone(message.from);if(!mobile)continue;
     const lead=await db.prepare('SELECT id,mobile_e164 FROM leads WHERE tenant_id=? AND mobile_e164=? LIMIT 1').bind(tid,mobile).first();
     if(lead)await recordIncoming(db,tid,lead,message,now);
    }
    for(const status of statuses)await recordStatus(db,tid,status,now);
    await applyPendingStatusEvents(db,tid,{now,limit:Math.min(20,statuses.length||1)});accepted++;
   }
  }
  return json({received:true,accepted});
 }catch{console.error('AR3D WhatsApp webhook unavailable');return fail('webhook temporarily unavailable',503);}
}
