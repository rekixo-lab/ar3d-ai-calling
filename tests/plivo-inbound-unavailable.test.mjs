import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {handleUnavailableInboundVoice} from '../src/plivo-inbound-unavailable.mjs';

const ENDPOINT='https://aicalling.ar3dstudio.in/v1/provider/plivo/inbound-unavailable';
test('production application Answer URL returns valid terminating Plivo XML on POST',async()=>{
 const req=new Request(ENDPOINT,{method:'POST',body:'CallUUID=untrusted',headers:{'Content-Type':'application/x-www-form-urlencoded'}});
 const res=await worker.fetch(req,{});
 assert.equal(res.status,200);
 assert.match(res.headers.get('content-type'),/application\/xml/);
 assert.match(res.headers.get('cache-control'),/no-store/);
 assert.equal(await res.text(),'<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
});
test('this inbound-only endpoint cannot be used to call, schedule, or write data',async()=>{
 const r=await worker.fetch(new Request(ENDPOINT,{method:'GET'}),{});
 assert.equal(r.status,405);
 assert.equal(r.headers.get('allow'),'POST');
 const unrelated=handleUnavailableInboundVoice(new Request('https://aicalling.ar3dstudio.in/v1/provider/plivo/unrelated',{method:'POST'}));
 assert.equal(unrelated,null);
 const normal=await worker.fetch(new Request('https://aicalling.ar3dstudio.in/v1/provider/plivo/unrelated',{method:'POST'}),{});
 assert.equal(normal.status,404);
});
