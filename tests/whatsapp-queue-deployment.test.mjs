import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureWhatsAppQueue,findWhatsAppQueue,validateWhatsAppQueue,runEnsureWhatsAppQueueCli,
 WHATSAPP_QUEUE_NAME,CALLING_WORKER_NAME} from '../scripts/ensure-whatsapp-queue.mjs';

const credentials={account:'a'.repeat(32),token:'SYNTHETIC-PRIVATE-TOKEN-'+ 'x'.repeat(20),control:'11111111-1111-4111-8111-111111111111',crm:'22222222-2222-4222-8222-222222222222'};
const Q='b'.repeat(32),OTHER='c'.repeat(32);
const queue=(overrides={})=>({queue_id:Q,queue_name:WHATSAPP_QUEUE_NAME,consumers:[],consumers_total_count:0,producers:[],producers_total_count:0,settings:{delivery_delay:0,delivery_paused:false},...overrides});
const ok=(result,extra={})=>Response.json({success:true,errors:[],result,...extra});
const list=(result,extra={})=>ok(result,{result_info:{page:1,per_page:500,total_pages:1,...extra}});
function scripted(steps){
 const calls=[];
 const fetcher=async(url,init)=>{
  calls.push({url,method:init.method,body:init.body,headers:init.headers,redirect:init.redirect});
  assert.ok(steps.length,'Unexpected extra Cloudflare request');const next=steps.shift();
  if(typeof next==='function')return next(url,init);
  return next;
 };
 return {fetcher,calls,remaining:()=>steps.length};
}
test('existing dedicated queue is read-only and exact worker relationships are verified',async()=>{
 const q=queue({consumers:[{type:'worker',script_name:CALLING_WORKER_NAME,queue_name:WHATSAPP_QUEUE_NAME}],consumers_total_count:1,producers:[{type:'worker',script:CALLING_WORKER_NAME}],producers_total_count:1});
 const s=scripted([list([{queue_id:OTHER,queue_name:'unrelated'},q]),ok(q)]);
 const result=await ensureWhatsAppQueue(credentials,s);assert.equal(result.created,false);assert.equal(result.consumerCount,1);assert.equal(result.producerCount,1);
 assert.deepEqual(s.calls.map(x=>x.method),['GET','GET']);
 assert.ok(s.calls[0].url.endsWith('/queues?page=1&per_page=500'));assert.ok(s.calls[1].url.endsWith('/queues/'+Q));
 assert.ok(s.calls.every(x=>x.headers.Authorization==='Bearer '+credentials.token&&x.redirect==='error'));
});
test('absent queue is created once with only the fixed name then independently read back',async()=>{
 const s=scripted([list([]),ok({queue_id:Q,queue_name:WHATSAPP_QUEUE_NAME}),ok(queue())]);
 const result=await ensureWhatsAppQueue(credentials,s);assert.equal(result.created,true);assert.equal(result.queueName,WHATSAPP_QUEUE_NAME);
 assert.deepEqual(s.calls.map(x=>x.method),['GET','POST','GET']);assert.deepEqual(JSON.parse(s.calls[1].body),{queue_name:WHATSAPP_QUEUE_NAME});
 assert.ok(s.calls.every(x=>new URL(x.url).pathname.startsWith('/client/v4/accounts/'+credentials.account+'/queues')));
});
test('queue listing follows documented pagination and cannot mistake a later-page queue for absence',async()=>{
 const s=scripted([list([{queue_id:OTHER,queue_name:'first-page'}],{total_pages:2}),list([queue()],{page:2,total_pages:2}),ok(queue())]);
 const result=await ensureWhatsAppQueue(credentials,s);assert.equal(result.created,false);assert.ok(s.calls[1].url.endsWith('page=2&per_page=500'));assert.ok(s.calls.every(c=>c.method==='GET'));
});
test('invalid credentials, denied listings and malformed pagination never issue a create',async()=>{
 let called=0;await assert.rejects(ensureWhatsAppQueue({...credentials,control:credentials.crm},{fetcher:async()=>{called++}}));assert.equal(called,0);
 for(const response of [new Response('private provider response',{status:403}),ok({}),list([],{page:2}),list([],{total_pages:30}),Response.json({success:false,errors:[{message:credentials.token}]}),list([], {total_pages:2})]){
  const s=scripted([response]);await assert.rejects(ensureWhatsAppQueue(credentials,s));assert.deepEqual(s.calls.map(c=>c.method),['GET']);
 }
});
test('foreign consumers/producers, omitted counts and truncated ownership metadata fail closed',()=>{
 for(const change of [
  {consumers:[{type:'worker',script_name:'other-worker'}],consumers_total_count:1},
  {consumers:[{type:'http_pull'}],consumers_total_count:1},
  {producers:[{type:'worker',script:'other-worker'}],producers_total_count:1},
  {producers:[{type:'r2_bucket',bucket_name:'some-bucket'}],producers_total_count:1},
  {consumers:[{type:'worker',script_name:CALLING_WORKER_NAME,dead_letter_queue:'other-queue'}],consumers_total_count:1},
  {consumers:[{type:'worker',script_name:CALLING_WORKER_NAME,queue_name:'wrong'}],consumers_total_count:1},
  {producers:[],producers_total_count:1},{producers:undefined,producers_total_count:undefined},
  {queue_name:'other-queue'},{queue_id:'../wrong'},{settings:{delivery_paused:true}},{settings:{delivery_delay:60}}
 ])assert.throws(()=>validateWhatsAppQueue(queue(change)),JSON.stringify(change));
 assert.equal(validateWhatsAppQueue(queue({consumers:undefined,producers:undefined})).consumerCount,0);
});
test('duplicate names, repeated pages and inconsistent detail identity cannot be reused',async()=>{
 const responses=[
  [list([queue(),queue({queue_id:OTHER})])],
  [list([queue()],{total_pages:2}),list([queue()],{page:2,total_pages:2})],
  [list([queue()]),ok(queue({queue_id:OTHER}))],
  [list([queue()]),ok(queue({producers:[{type:'worker',script:'foreign'}],producers_total_count:1}))]
 ];
 for(const steps of responses){const s=scripted(steps);await assert.rejects(ensureWhatsAppQueue(credentials,s));assert.ok(s.calls.every(c=>c.method==='GET'));}
});
test('successful create returning another queue never follows or mutates that resource',async()=>{
 const s=scripted([list([]),ok(queue({queue_name:'unrelated-queue'}))]);await assert.rejects(ensureWhatsAppQueue(credentials,s));
 assert.deepEqual(s.calls.map(c=>c.method),['GET','POST']);
});
test('concurrent or uncertain create is reconciled through reads without a second write',async()=>{
 for(const error of [new Response('conflict',{status:409}),new Response('server issue',{status:503}),()=>{throw Error('transport contains '+credentials.token)}]){
  const s=scripted([list([]),error,list([queue()]),ok(queue())]);const result=await ensureWhatsAppQueue(credentials,s);
  assert.equal(result.reconciled,true);assert.equal(s.calls.filter(c=>c.method==='POST').length,1);
 }
 const s=scripted([list([]),new Response('server issue',{status:500}),list([])]);
 await assert.rejects(ensureWhatsAppQueue(credentials,s));assert.equal(s.calls.filter(c=>c.method==='POST').length,1);
});
test('creation permission denial stops without reconciliation, plan changes or permission changes',async()=>{
 const s=scripted([list([]),new Response('secret detail '+credentials.token,{status:403})]);
 await assert.rejects(ensureWhatsAppQueue(credentials,s),e=>e.message.includes('access was denied')&&!e.message.includes(credentials.token));
 assert.deepEqual(s.calls.map(c=>c.method),['GET','POST']);
});
test('CLI diagnostics never print credentials, provider bodies or thrown fetcher details',async()=>{
 const environment={CLOUDFLARE_ACCOUNT_ID:credentials.account,CLOUDFLARE_API_TOKEN:credentials.token,CONTROL_DB_ID:credentials.control,CRM_DB_ID:credentials.crm};
 for(const fetcher of [async()=>new Response(credentials.token,{status:403}),async()=>{throw Error(credentials.token)},async()=>Response.json({success:false,errors:[{message:credentials.token}]})]){
  const output=[];const code=await runEnsureWhatsAppQueueCli(environment,{fetcher,log:x=>output.push(x),error:x=>output.push(x)});
  assert.equal(code,1);assert.ok(output.length);assert.ok(output.every(x=>!x.includes(credentials.token)&&!x.includes(credentials.account)));
 }
 const s=scripted([list([queue()]),ok(queue())]),output=[];
 assert.equal(await runEnsureWhatsAppQueueCli(environment,{...s,log:x=>output.push(x),error:x=>output.push(x)}),0);
 assert.equal(output.length,1);assert.match(output[0],/WhatsApp queue ready: ar3d-calling-whatsapp \(existing\)/);
});
test('list helper returns only a validated exact name and ID, without unrelated response data',async()=>{
 const s=scripted([list([queue({sensitive_metadata:'not-returned'})])]);
 assert.deepEqual(await findWhatsAppQueue(credentials,s),{queue_id:Q,queue_name:WHATSAPP_QUEUE_NAME});
});
