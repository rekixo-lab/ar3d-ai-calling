import test from 'node:test';
import assert from 'node:assert/strict';
import {readVerifiedPlivoCdr} from '../src/plivo-verified-cdr.mjs';

const env={PLIVO_AUTH_ID:'TESTACCOUNT123',PLIVO_AUTH_TOKEN:'SYNTHETICAUTHTOKEN123'};
const job={accountSid:env.PLIVO_AUTH_ID,callUuid:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',caller:'+918000000000',destination:'+919000000001'};
const good={call_uuid:job.callUuid,call_direction:'outbound',from_number:'918000000000',to_number:'919000000001',billed_duration:60,call_duration:40,total_amount:'0.01234'};
const gateway=data=>async()=>Response.json(data);

test('shared CDR verifier uses the configured account and exact call identity, and projects only needed fields',async()=>{
 let reads=0;
 const result=await readVerifiedPlivoCdr(env,job,{fetcher:async(url,opts)=>{
  reads++;
  assert.equal(url,'https://api.plivo.com/v1/Account/TESTACCOUNT123/Call/'+job.callUuid+'/');
  assert.equal(opts.method,'GET');assert.equal(opts.redirect,'manual');
  assert.equal(opts.headers.Authorization,'Basic '+btoa(env.PLIVO_AUTH_ID+':'+env.PLIVO_AUTH_TOKEN));
  return Response.json({...good,private_metadata:'must not escape'});
 }});
 assert.equal(reads,1);
 assert.deepEqual(result,{ok:true,cdr:{call_uuid:job.callUuid,billed_duration:60,call_duration:40,total_amount:'0.01234'}});
});

test('invalid expected account, call UUID or phone identity fails before provider access',async()=>{
 let reads=0;
 for(const bad of [{...job,accountSid:'OTHERACCOUNT'},{...job,callUuid:'../untrusted'},{...job,caller:null},{...job,destination:''},{...job,caller:'91800-000-0000'},{...job,destination:'0000000000'}]){
  const result=await readVerifiedPlivoCdr(env,bad,{fetcher:async()=>{reads++;throw Error('unexpected provider access')}});
  assert.equal(result.ok,false);
 }
 assert.equal(reads,0);
});

test('malformed, contradictory, or non-outbound CDR evidence is rejected',async()=>{
 for(const bad of [null,[],{...good,from_number:null},{...good,to_number:'919000000099'},{...good,call_direction:'inbound'},{...good,call_uuid:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},{...good,billed_duration:30},{...good,billed_duration:'60'},{...good,total_amount:0.01},{...good,total_amount:'1e-5'}]){
  assert.equal((await readVerifiedPlivoCdr(env,job,{fetcher:gateway(bad)})).ok,false);
 }
});

test('CDR body is bounded by actual UTF-8 bytes even without content-length',async()=>{
 let cancelled=false;
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4096));controller.enqueue(new Uint8Array(4097));},cancel(){cancelled=true;}});
 const result=await readVerifiedPlivoCdr(env,job,{fetcher:async()=>new Response(stream,{headers:{'Content-Type':'application/json'}})});
 assert.equal(result.ok,false);assert.equal(cancelled,true);
 const invalidUtf8=new Uint8Array([0x7b,0x22,0xff,0x22,0x7d]);
 for(const response of [
  new Response(invalidUtf8,{headers:{'Content-Type':'application/json'}}),
  new Response(JSON.stringify(good),{headers:{'Content-Type':'text/html'}}),
  new Response(JSON.stringify(good),{headers:{'Content-Type':'application/json','Content-Length':'8193'}}),
  new Response(JSON.stringify(good),{status:302,headers:{'Content-Type':'application/json'}})
 ]){
  assert.equal((await readVerifiedPlivoCdr(env,job,{fetcher:async()=>response})).ok,false);
 }
});
