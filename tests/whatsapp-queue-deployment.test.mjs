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
test('documented optional success and null empty collections retain exact list, create and detail validation',async()=>{
 const s=scripted([
  Response.json({result:[],errors:null}),
  Response.json({result:{queue_id:Q,queue_name:WHATSAPP_QUEUE_NAME},errors:null}),
  Response.json({result:queue({consumers:null,producers:null}),errors:null})
 ]);
 const result=await ensureWhatsAppQueue(credentials,s);assert.equal(result.created,true);
 assert.deepEqual(s.calls.map(c=>c.method),['GET','POST','GET']);
 const explicit=scripted([ok([queue()],{errors:null}),ok(queue({consumers:null,producers:null}),{errors:null})]);
 assert.equal((await ensureWhatsAppQueue(credentials,explicit)).created,false);
 for(const change of [{consumers:null,consumers_total_count:1},{producers:null,producers_total_count:undefined}])
  assert.throws(()=>validateWhatsAppQueue(queue(change)));
 for(const envelope of [
  {success:false,result:[],errors:null},{success:null,result:[],errors:null},{success:'true',result:[],errors:[]},
  {result:[],errors:[{code:10000}]},{result:[],errors:{}},{result:[],errors:'none'},
  {result:null,errors:null},{result:{},errors:null},{errors:null}
 ]){
  const failed=scripted([Response.json(envelope)]);await assert.rejects(ensureWhatsAppQueue(credentials,failed));
  assert.deepEqual(failed.calls.map(c=>c.method),['GET']);
 }
 const wrong=scripted([Response.json({result:[queue()]}),Response.json({result:queue({queue_id:OTHER})})]);
 await assert.rejects(ensureWhatsAppQueue(credentials,wrong),/different (?:or invalid|queue identity)/);
});
test('a server-capped declared page size cannot hide a later matching queue',async()=>{
 const s=scripted([
  list([{queue_id:OTHER,queue_name:'unrelated'}],{per_page:1,total_pages:undefined}),
  list([queue()],{page:2,per_page:1,total_pages:undefined}),
  list([],{page:3,per_page:1,total_pages:undefined}),ok(queue())
 ]);
 assert.equal((await ensureWhatsAppQueue(credentials,s)).created,false);
 assert.ok(s.calls[2].url.endsWith('page=3&per_page=500'));assert.ok(s.calls.every(c=>c.method==='GET'));
 for(const info of [{per_page:0},{per_page:501},{per_page:'100'},{per_page:1.5}]){
  const bad=scripted([list([],info)]);await assert.rejects(ensureWhatsAppQueue(credentials,bad),/pagination/);
 }
});
test('failed envelopes identify request stage, HTTP status, safe field types and numeric codes only',async()=>{
 const environment={CLOUDFLARE_ACCOUNT_ID:credentials.account,CLOUDFLARE_API_TOKEN:credentials.token,CONTROL_DB_ID:credentials.control,CRM_DB_ID:credentials.crm};
 const secret=credentials.token+' '+credentials.account+' private-provider-message';
 const cases=[
  {steps:[Response.json({success:false,result:null,errors:[{code:10023,message:secret},{code:secret,message:secret}]})],stage:'list-page-1',status:200,shape:'success=boolean(false); result=null; errors=array(2); cf_codes=10023'},
  {steps:[list([]),Response.json({success:false,result:null,errors:[{code:10000,message:secret}]},{status:403})],stage:'create',status:403,shape:'cf_codes=10000'},
  {steps:[list([queue()]),Response.json({success:secret,result:secret,errors:secret})],stage:'detail',status:200,shape:'success=string; result=string; errors=string; cf_codes=none'},
  {steps:[new Response(secret,{status:503})],stage:'list-page-1',status:503,shape:'envelope=unparsed'},
 ];
 for(const {steps,stage,status,shape} of cases){
  const s=scripted(steps),output=[];
  assert.equal(await runEnsureWhatsAppQueueCli(environment,{...s,log:x=>output.push(x),error:x=>output.push(x)}),1);
  assert.equal(output.length,1);assert.ok(output[0].includes('stage='+stage+'; HTTP='+status));assert.ok(output[0].includes(shape));
  for(const privateValue of [credentials.token,credentials.account,'private-provider-message'])assert.ok(!output[0].includes(privateValue));
 }
});

// Cloudflare may return null for an unset optional dead-letter destination.
test('existing worker with null dead-letter metadata is safe; actual DLQ remains forbidden',async()=>{
 const withNull=queue({consumers:[{type:'worker',script_name:CALLING_WORKER_NAME,queue_name:WHATSAPP_QUEUE_NAME,dead_letter_queue:null}],consumers_total_count:1});
 const s=scripted([list([withNull]),ok(withNull)]);
 const result=await ensureWhatsAppQueue(credentials,s);
 assert.equal(result.created,false);assert.equal(result.consumerCount,1);
 assert.deepEqual(s.calls.map(x=>x.method),['GET','GET']);
 assert.throws(()=>validateWhatsAppQueue(queue({consumers:[{type:'worker',script_name:CALLING_WORKER_NAME,dead_letter_queue:'foreign-dlq'}],consumers_total_count:1})),/unexpected consumer/);
});

test('queue rejection diagnostics reveal only safe field categories, never foreign worker identities',()=>{
 const foreign='secret-worker-name',q=queue({consumers:[{type:'worker',script_name:foreign,queue_name:'private-queue',dead_letter_queue:'private-dlq'}],consumers_total_count:1});
 assert.throws(()=>validateWhatsAppQueue(q),e=>e.message.includes('[type=worker; worker=other; queue=other; dead_letter=configured]')&&!e.message.includes(foreign)&&!e.message.includes('private-queue')&&!e.message.includes('private-dlq'));
 const missing=queue({consumers:[{script_name:CALLING_WORKER_NAME}],consumers_total_count:1});
 assert.throws(()=>validateWhatsAppQueue(missing),e=>e.message.includes('type=missing')&&!e.message.includes(CALLING_WORKER_NAME));
});

test('queue summary consumer ID is resolved using read-only consumer detail before trusting ownership',async()=>{
 const id='d'.repeat(32);
 const partial=queue({consumers:[{consumer_id:id,type:'worker'}],consumers_total_count:1});
 const full={consumer_id:id,type:'worker',script_name:CALLING_WORKER_NAME,queue_name:WHATSAPP_QUEUE_NAME,dead_letter_queue:null};
 const steps=scripted([list([partial]),ok(partial),ok(full)]);
 const result=await ensureWhatsAppQueue(credentials,steps);
 assert.equal(result.consumerCount,1);assert.equal(result.created,false);
 assert.deepEqual(steps.calls.map(x=>x.method),['GET','GET','GET']);
 assert.ok(steps.calls[2].url.endsWith('/queues/'+Q+'/consumers/'+id));
});
test('foreign consumer detail, missing IDs and differing IDs never pass the queue guard',async()=>{
 const id='d'.repeat(32),partial=queue({consumers:[{consumer_id:id,type:'worker'}],consumers_total_count:1});
 for(const variant of [
  {consumer_id:id,type:'worker',script_name:'foreign-worker'},
  {consumer_id:'e'.repeat(32),type:'worker',script_name:CALLING_WORKER_NAME},
  {consumer_id:id,type:'worker',script_name:CALLING_WORKER_NAME,dead_letter_queue:'secret-dead-letter'},
  {consumer_id:id,type:'http_pull',script_name:CALLING_WORKER_NAME}
 ]){
  const x=scripted([list([partial]),ok(partial),ok(variant)]);
  await assert.rejects(ensureWhatsAppQueue(credentials,x));
  assert.ok(x.calls.every(c=>c.method==='GET'));
 }
 const missing=queue({consumers:[{type:'worker'}],consumers_total_count:1});
 const x=scripted([list([missing]),ok(missing)]);
 await assert.rejects(ensureWhatsAppQueue(credentials,x),/identity was omitted/);
 assert.equal(x.calls.length,2);
});

test('consumer detail may omit its own ID but must explicitly confirm the expected Worker',async()=>{
 const id='d'.repeat(32);
 const summary=queue({consumers:[{consumer_id:id,type:'worker'}],consumers_total_count:1});
 const full={type:'worker',script_name:CALLING_WORKER_NAME,queue_name:WHATSAPP_QUEUE_NAME};
 const s=scripted([list([summary]),ok(summary),ok(full)]);
 const result=await ensureWhatsAppQueue(credentials,s);
 assert.equal(result.consumerCount,1);
 assert.deepEqual(s.calls.map(x=>x.method),['GET','GET','GET']);
});
test('when consumer detail omits script_name, separately list and match the exact consumer IDs',async()=>{
 const id='d'.repeat(32);
 const summary=queue({consumers:[{consumer_id:id,type:'worker'}],consumers_total_count:1});
 const detail={consumer_id:id,type:'worker'};
 const listed={consumer_id:id,type:'worker',script_name:CALLING_WORKER_NAME,queue_name:WHATSAPP_QUEUE_NAME};
 const s=scripted([list([summary]),ok(summary),ok(detail),ok([listed])]);
 const result=await ensureWhatsAppQueue(credentials,s);
 assert.equal(result.consumerCount,1);
 assert.deepEqual(s.calls.map(x=>x.method),['GET','GET','GET','GET']);
 assert.ok(s.calls[3].url.endsWith('/queues/'+Q+'/consumers'));
});
test('list fallback never trusts a foreign script, mismatched ID, changed type, missing script or configured DLQ',async()=>{
 const id='d'.repeat(32);
 const summary=queue({consumers:[{consumer_id:id,type:'worker'}],consumers_total_count:1});
 for(const consumer of [
  {consumer_id:id,type:'worker',script_name:'another-worker'},
  {consumer_id:'e'.repeat(32),type:'worker',script_name:CALLING_WORKER_NAME},
  {consumer_id:id,type:'http_pull',script_name:CALLING_WORKER_NAME},
  {consumer_id:id,type:'worker'},
  {consumer_id:id,type:'worker',script_name:CALLING_WORKER_NAME,dead_letter_queue:'other-queue'}
 ]){
  const s=scripted([list([summary]),ok(summary),ok({consumer_id:id,type:'worker'}),ok([consumer])]);
  await assert.rejects(ensureWhatsAppQueue(credentials,s));
  assert.ok(s.calls.every(c=>c.method==='GET'));
 }
 const noList=scripted([list([summary]),ok(summary),ok({consumer_id:id,type:'worker'}),ok({unexpected:'object'})]);
 await assert.rejects(ensureWhatsAppQueue(credentials,noList));
 assert.ok(noList.calls.every(c=>c.method==='GET'));
});
test('consumer diagnostics never reveal the actual foreign worker or queue identifiers',async()=>{
 const id='d'.repeat(32);
 const summary=queue({consumers:[{consumer_id:id,type:'worker'}],consumers_total_count:1});
 const bad={consumer_id:id,type:'worker',script_name:'private-other-worker',queue_name:'private-queue',dead_letter_queue:'secret-dlq'};
 const env={CLOUDFLARE_ACCOUNT_ID:credentials.account,CLOUDFLARE_API_TOKEN:credentials.token,CONTROL_DB_ID:credentials.control,CRM_DB_ID:credentials.crm};
 const s=scripted([list([summary]),ok(summary),ok(bad)]),messages=[];
 assert.equal(await runEnsureWhatsAppQueueCli(env,{...s,log:x=>messages.push(x),error:x=>messages.push(x)}),1);
 assert.equal(messages.length,1);
 assert.match(messages[0],/worker=other; queue=other; dead_letter=configured/);
 for(const secret of ['private-other-worker','private-queue','secret-dlq',credentials.token,credentials.account,id])assert.ok(!messages[0].includes(secret));
});
