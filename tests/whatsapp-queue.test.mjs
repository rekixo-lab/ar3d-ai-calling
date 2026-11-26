import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../src/index.mjs';
import {enqueueWhatsAppTick,handleWhatsAppQueue,WHATSAPP_TICK_QUEUE,WHATSAPP_TICK_INTERVAL_MS} from '../src/whatsapp-queue.mjs';

const NOW=Date.parse('2026-11-26T12:02:00.000Z');
const tick=(slot=NOW)=>({version:1,type:'ar3d.whatsapp.tick',slotStartMs:slot});
function message(body=tick()){
 const state={acks:0,retries:[]};
 return {body,state,ack(){state.acks++;},retry(options){state.retries.push(options);}};
}
const batch=(messages)=>({queue:WHATSAPP_TICK_QUEUE,messages});
function fixture(){
 const sqlite=new DatabaseSync(':memory:');let queries=0;
 for(const file of readdirSync(new URL('../migrations/control/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/control/'+file,import.meta.url),'utf8'));
 const CONTROL_DB={prepare(sql){
  const stmt=sqlite.prepare(sql);
  return {bind(...params){return {
   async run(){queries++;return {meta:{changes:Number(stmt.run(...params).changes)}};},
   async all(){queries++;return {results:stmt.all(...params)};}
  };}};
 }};
 return {env:{CONTROL_DB},sqlite,get queries(){return queries;}};
}

test('existing minute cron publishes small ticks every two minutes with zero SQL work',async()=>{
 const sent=[],env={WHATSAPP_TICKS:{async send(body,options){sent.push({body,options});}},CONTROL_DB:{prepare(){throw Error('producer must not query');}}};
 assert.equal((await enqueueWhatsAppTick({cron:'* * * * *',scheduledTime:NOW},env)).queued,true);
 assert.deepEqual(sent,[{body:tick(),options:{contentType:'json'}}]);
 for(const controller of [
  {cron:'* * * * *',scheduledTime:NOW+60000},
  {cron:'*/2 * * * *',scheduledTime:NOW},
  {cron:'* * * * *',scheduledTime:-1},
  {cron:'* * * * *',scheduledTime:NaN}
 ])assert.equal((await enqueueWhatsAppTick(controller,env)).queued,false);
 assert.equal(sent.length,1);
 assert.equal((await enqueueWhatsAppTick({cron:'* * * * *',scheduledTime:NOW},{})).reason,'queue_not_configured');
});

test('a slow or failed queue publish cannot delay or stop the voice cron',async()=>{
 let resolve;const pending=[],env={WHATSAPP_TICKS:{send(){return new Promise(r=>{resolve=r;});}},CONTROL_DB:{prepare(){throw Error('no WhatsApp SQL in the voice invocation');}}};
 const result=await worker.scheduled({cron:'* * * * *',scheduledTime:NOW},env,{waitUntil(p){pending.push(p);}});
 assert.equal(result.processed,0);assert.equal(pending.length,1);
 resolve();await Promise.all(pending);
 env.WHATSAPP_TICKS.send=async()=>{throw Error('transient queue error');};
 assert.equal((await worker.scheduled({cron:'* * * * *',scheduledTime:NOW},env)).processed,0);
 assert.equal((await worker.scheduled({cron:'* * * * *',scheduledTime:NOW+60000},env)).processed,0);
 await assert.rejects(worker.scheduled({cron:'*/2 * * * *',scheduledTime:NOW},env),/unknown/);
});

test('durable slot claim prevents duplicate and simultaneous deliveries from dispatching twice',async()=>{
 const f=fixture(),a=message(),b=message();let dispatches=0;
 const dispatch=async(env,options)=>{dispatches++;assert.equal(env,f.env);assert.equal(options.now,NOW);assert.equal(options.maxTenants,1);assert.equal(options.maxSends,1);};
 await Promise.all([
  handleWhatsAppQueue(batch([a]),f.env,{now:NOW,dispatch}),
  handleWhatsAppQueue(batch([b]),f.env,{now:NOW,dispatch})
 ]);
 assert.equal(dispatches,1);assert.equal(a.state.acks,1);assert.equal(b.state.acks,1);
 assert.equal(f.sqlite.prepare('SELECT outcome FROM whatsapp_dispatch_ticks').get().outcome,'completed');
 const c=message();const result=await handleWhatsAppQueue(batch([c]),f.env,{now:NOW+1000,dispatch});
 assert.equal(result.whatsappQueue.duplicates,1);assert.equal(dispatches,1);
});

test('claimed slots never rerun after ambiguous work; the next fresh slot can rescan the outbox',async()=>{
 const f=fixture();let dispatches=0;
 const dispatch=async()=>{dispatches++;throw Error('provider acceptance or worker outcome unknown');};
 const a=message();await handleWhatsAppQueue(batch([a]),f.env,{now:NOW,dispatch});
 const replay=message();await handleWhatsAppQueue(batch([replay]),f.env,{now:NOW+1000,dispatch});
 assert.equal(dispatches,1);assert.equal(a.state.acks,1);assert.equal(replay.state.acks,1);
 assert.equal(f.sqlite.prepare('SELECT outcome FROM whatsapp_dispatch_ticks').get().outcome,'failed');
 await handleWhatsAppQueue(batch([message(tick(NOW+WHATSAPP_TICK_INTERVAL_MS))]),f.env,{now:NOW+WHATSAPP_TICK_INTERVAL_MS,dispatch});
 assert.equal(dispatches,2);
});

test('D1 claim failures retry before dispatch and cannot turn into an unclaimed send',async()=>{
 let calls=0;const a=message(),env={CONTROL_DB:{prepare(){throw Error('D1 unavailable');}}};
 const result=await handleWhatsAppQueue(batch([a]),env,{now:NOW,dispatch:async()=>{calls++;}});
 assert.equal(calls,0);assert.equal(a.state.acks,0);assert.deepEqual(a.state.retries,[{delaySeconds:30}]);assert.equal(result.whatsappQueue.retried,1);
});

test('stale, future and malformed ticks are discarded without D1; other queues remain untouched',async()=>{
 const f=fixture(),messages=[
  message(tick(NOW-WHATSAPP_TICK_INTERVAL_MS)),message(tick(NOW+WHATSAPP_TICK_INTERVAL_MS)),
  message({...tick(),slotStartMs:NOW+1}),message({...tick(),version:2}),
  message({...tick(),tenantId:'untrusted'}),message(null)
 ];
 const result=await handleWhatsAppQueue(batch(messages),f.env,{now:NOW,dispatch:async()=>{throw Error('must not dispatch');}});
 assert.equal(result.whatsappQueue.discarded,messages.length);assert.equal(f.queries,0);assert.ok(messages.every(m=>m.state.acks===1));
 const other=message();await assert.rejects(handleWhatsAppQueue({queue:'another-app',messages:[other]},f.env,{now:NOW}),/unexpected/);
 assert.equal(other.state.acks,0);assert.equal(other.state.retries.length,0);assert.equal(f.queries,0);
});

test('consumer bounds each invocation even if batch configuration drifts',async()=>{
 const f=fixture(),messages=[message(),message(),message()];let dispatches=0;
 const result=await handleWhatsAppQueue(batch(messages),f.env,{now:NOW,dispatch:async()=>{dispatches++;}});
 assert.equal(dispatches,1);assert.equal(result.whatsappQueue.retried,2);assert.equal(f.queries,3);
 assert.equal(messages[0].state.acks,1);assert.ok(messages.slice(1).every(m=>m.state.retries[0].delaySeconds===5));
});

test('tick retention cleanup deletes at most twenty old slots and preserves current dedupe',async()=>{
 const f=fixture(),old=NOW-3*86400000;
 for(let i=0;i<25;i++)f.sqlite.prepare("INSERT INTO whatsapp_dispatch_ticks(slot_start_ms,claimed_at,outcome) VALUES(?,'old','completed')").run(old+i*WHATSAPP_TICK_INTERVAL_MS);
 await handleWhatsAppQueue(batch([message()]),f.env,{now:NOW,dispatch:async()=>{}});
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM whatsapp_dispatch_ticks').get().n,6);
 assert.ok(f.sqlite.prepare('SELECT slot_start_ms FROM whatsapp_dispatch_ticks WHERE slot_start_ms=?').get(NOW));assert.equal(f.queries,3);
});

test('unconnected queue processing makes no network request and has only four D1 statements',async()=>{
 const f=fixture();let network=0;
 const result=await handleWhatsAppQueue(batch([message()]),f.env,{now:NOW,fetcher:async()=>{network++;throw Error('unexpected external request');}});
 assert.equal(result.whatsappQueue.processed,1);assert.equal(network,0);assert.equal(f.queries,4);
});
