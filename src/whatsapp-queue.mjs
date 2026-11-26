import {CAMPAIGN_CRON} from './scripted-campaign-dispatch.mjs';
import {runWhatsAppCron} from './whatsapp-dispatch.mjs';

export const WHATSAPP_TICK_QUEUE='ar3d-calling-whatsapp';
export const WHATSAPP_TICK_INTERVAL_MS=120000;
const TICK_TYPE='ar3d.whatsapp.tick';
const RETAIN_TICKS_MS=2*24*60*60*1000;

// This producer performs no D1 work. Queue errors cannot stop the independent
// every-minute voice dispatcher; the next even minute publishes another tick.
export async function enqueueWhatsAppTick(controller,env){
 const at=controller?.scheduledTime;
 if(controller?.cron!==CAMPAIGN_CRON)return {queued:false,reason:'different_schedule'};
 if(!Number.isSafeInteger(at)||at<0)return {queued:false,reason:'invalid_time'};
 if(Math.floor(at/60000)%2!==0)return {queued:false,reason:'between_ticks'};
 if(typeof env.WHATSAPP_TICKS?.send!=='function')return {queued:false,reason:'queue_not_configured'};
 const slotStartMs=Math.floor(at/WHATSAPP_TICK_INTERVAL_MS)*WHATSAPP_TICK_INTERVAL_MS;
 try{
  await env.WHATSAPP_TICKS.send({version:1,type:TICK_TYPE,slotStartMs},{contentType:'json'});
  return {queued:true,slotStartMs};
 }catch{
  console.error('AR3D WhatsApp tick enqueue unavailable');
  return {queued:false,reason:'queue_unavailable'};
 }
}

function validTick(body,now){
 return body&&typeof body==='object'&&!Array.isArray(body)&&
  Object.keys(body).length===3&&body.version===1&&body.type===TICK_TYPE&&
  Number.isSafeInteger(body.slotStartMs)&&body.slotStartMs>=0&&
  body.slotStartMs%WHATSAPP_TICK_INTERVAL_MS===0&&
  body.slotStartMs<=now&&now-body.slotStartMs<WHATSAPP_TICK_INTERVAL_MS;
}

export async function handleWhatsAppQueue(batch,env,{
 now=Date.now(),dispatch=runWhatsAppCron,fetcher=fetch
}={}){
 // Refuse another app's queue rather than silently acknowledging its messages.
 if(batch?.queue!==WHATSAPP_TICK_QUEUE)throw Error('unexpected WhatsApp queue');
 if(!Number.isSafeInteger(now)||now<0)throw Error('invalid WhatsApp queue timestamp');
 if(!Array.isArray(batch.messages))throw Error('invalid WhatsApp queue batch');
 let attempted=false,processed=0,duplicates=0,discarded=0,retried=0;
 for(const message of batch.messages){
  if(!validTick(message.body,now)){message.ack();discarded++;continue;}
  // Deployment fixes batch size and concurrency at one. Also enforce a single
  // candidate here so config drift cannot multiply this invocation's D1 work.
  if(attempted){message.retry({delaySeconds:5});retried++;continue;}
  attempted=true;
  const slot=message.body.slotStartMs,at=new Date(now).toISOString();
  let changes;
  try{
   const claim=await env.CONTROL_DB.prepare(`INSERT INTO whatsapp_dispatch_ticks
    (slot_start_ms,claimed_at,outcome) VALUES(?,?,'claimed')
    ON CONFLICT(slot_start_ms) DO NOTHING`).bind(slot,at).run();
   changes=Number(claim?.meta?.changes);
   if(changes!==0&&changes!==1)throw Error('unconfirmed WhatsApp tick claim');
  }catch{
   // No dispatch has begun. If D1 committed but its response was lost, the
   // durable claim makes this retry a harmless duplicate.
   message.retry({delaySeconds:30});retried++;continue;
  }
  if(changes===0){message.ack();duplicates++;continue;}
  let outcome='completed';
  try{
   await dispatch(env,{now,fetcher,maxTenants:1,maxSends:1});
  }catch{
   outcome='failed';
   console.error('AR3D WhatsApp queued dispatch unavailable');
  }
  // Once claimed, never rerun this slot, even after a crash/ambiguous provider
  // acceptance. The next fresh tick scans the durable outbox; unknown sends
  // remain excluded by its existing atomic send claim.
  try{
   await env.CONTROL_DB.prepare('UPDATE whatsapp_dispatch_ticks SET finished_at=?,outcome=? WHERE slot_start_ms=?')
    .bind(new Date(now).toISOString(),outcome,slot).run();
  }catch{console.error('AR3D WhatsApp tick completion unavailable');}
  try{
   await env.CONTROL_DB.prepare(`DELETE FROM whatsapp_dispatch_ticks WHERE slot_start_ms IN
    (SELECT slot_start_ms FROM whatsapp_dispatch_ticks WHERE slot_start_ms<? ORDER BY slot_start_ms LIMIT 20)`)
    .bind(now-RETAIN_TICKS_MS).run();
  }catch{console.error('AR3D WhatsApp tick cleanup unavailable');}
  message.ack();processed++;
 }
 return {whatsappQueue:{processed,duplicates,discarded,retried}};
}
