import test from 'node:test';
import assert from 'node:assert/strict';
import {smoke,validateSmokeBase} from '../scripts/smoke-main.mjs';
import {css,js} from '../src/app-assets.mjs';

const host='https://aicalling.ar3dstudio.in';
const xml='<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
const simulated=(calls,{wrongXml=false}={})=>async(url,init)=>{
 const path=new URL(url).pathname;
 calls.push({path,method:init.method,host:new URL(url).host});
 if(path==='/v1/provider/plivo/inbound-unavailable'){
  assert.equal(init.method,'POST');
  return new Response(wrongXml?'<Response><Dial>+911111111111</Dial></Response>':xml,
   {status:200,headers:{'Content-Type':'application/xml; charset=utf-8'}});
 }
 assert.equal(init.method,'GET');
 if(path==='/health')return Response.json({service:'AR3D AI Calling',status:'foundation'});
 if(path==='/app')return new Response('<title>AR3D AI Calling</title>',
  {headers:{'Content-Type':'text/html'}});
 if(path==='/app/assets/style.css')return new Response(css,
  {headers:{'Content-Type':'text/css'}});
 if(path==='/app/assets/app.js')return new Response(js,
  {headers:{'Content-Type':'text/javascript'}});
 if(path==='/v1/provider/unknown-transport')return Response.json({error:'not found'},{status:404});
 return Response.json({error:'sign in required'},{status:401});
};

test('Production smoke includes one no-dial Answer POST only on the exact Calling hostname',async()=>{
 const calls=[];
 assert.equal(await smoke(host,simulated(calls)),true);
 assert.equal(calls.filter(c=>c.method==='POST').length,1);
 assert.deepEqual(calls.filter(c=>c.method==='POST').map(c=>c.path),
  ['/v1/provider/plivo/inbound-unavailable']);
 assert.ok(calls.every(c=>c.host==='aicalling.ar3dstudio.in'));
});

test('deployed Answer URL must return immediate Hangup and never Dial',async()=>{
 const calls=[];
 assert.equal(await smoke(host,simulated(calls,{wrongXml:true})),false);
 assert.equal(calls.filter(c=>c.method==='POST').length,1);
});

test('smoke accepts only calling hostname and calling Worker URL',()=>{
 assert.equal(validateSmokeBase(host),host);
 assert.equal(validateSmokeBase('https://ar3d-ai-calling.sample.workers.dev'),
  'https://ar3d-ai-calling.sample.workers.dev');
 for(const url of [
  'https://admin.rekixo.com','http://aicalling.ar3dstudio.in',
  'https://other.ar3dstudio.in','https://aicalling.ar3dstudio.in/path',
  'https://aicalling.ar3dstudio.in?x=true'
 ])assert.throws(()=>validateSmokeBase(url),/isolated Calling Worker|invalid smoke target/);
});
