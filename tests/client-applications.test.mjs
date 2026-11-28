import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {publicLanding,listClientApplications} from '../src/client-applications.mjs';
import {fixture,admin,client} from './helpers/calling-fixture.mjs';

const origin='https://aicalling.ar3dstudio.in';
const url=origin+'/v1/public/client-applications';
test('public page, signed-out boundary, application receipt, replay and current-MFA inbox',async()=>{
 const f=fixture(),objects=new Map();
 try{
  const env={...f.env,LOGIN_RATE_LIMIT_SECRET:'x'.repeat(32),RECORDINGS:{
   async put(k,v,o){assert.deepEqual(o.onlyIf,{etagDoesNotMatch:'*'});if(objects.has(k))return null;objects.set(k,v);return {key:k}},
   async list({prefix}){return {objects:[...objects.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),truncated:false}},
   async get(k){return {json:async()=>JSON.parse(objects.get(k))}}
  }};
  const request=new Request(origin+'/v1/human/client-applications');
  assert.equal((await worker.fetch(request,env)).status,401);
  const page=await worker.fetch(new Request(origin),env);assert.equal(page.status,200);assert.match(await page.text(),/id="apply"/);
  const data={requestId:Date.now()+'-'+crypto.randomUUID(),company:'Example',name:'आशा',city:'रायपुर',email:'team@example.com',mobile:'9876543210',purpose:'प्रॉपर्टी पूछताछ',consent:true};
  const post=(body,from=origin)=>publicLanding(new Request(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:from,'cf-connecting-ip':'192.0.2.1'},body:JSON.stringify(body)}),env);
  assert.equal((await post(data,'https://other.example')).status,403);
  assert.equal((await post({...data,consent:false})).status,400);
  assert.equal((await post({...data,email:'invalid'})).status,400);
  const first=await post(data);assert.equal(first.status,201);
  const replay=await post(data);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),await first.json());assert.equal(objects.size,1);
  assert.equal((await listClientApplications(request,env,client)).status,403);
  f.c.db.prepare("UPDATE human_sessions SET created_at=?,expires_at=? WHERE user_id='admin'").run(new Date().toISOString(),Date.now()+3600000);
  const list=await listClientApplications(request,env,admin);assert.equal(list.status,200);
  assert.equal((await list.json()).applications[0].mobile,'+919876543210');
 }finally{f.close()}
});

test('policy topics are published without a motion button, complaint uses a private receipt with repeat protection',async()=>{
 const f=fixture(),writes=new Map();try{
  const env={...f.env,LOGIN_RATE_LIMIT_SECRET:'s'.repeat(32),RECORDINGS:{async put(key,value){if(writes.has(key))return null;writes.set(key,value);return {key}}}};
  const page=await publicLanding(new Request(origin+'/policies'),env);
  const html=await page.text();
  for(const id of ['privacy','terms','calling','messaging','acceptable-use','billing','retention','cookies','security','copyright','contact'])assert.ok(html.includes('id="'+id+'"'),id);
  for(const path of ['/','/policies']){
   const response=await publicLanding(new Request(origin+path),env);
   assert.doesNotMatch(await response.text(),/motion-toggle|कम ऐनिमेशन/);
  }
  const data={requestId:Date.now()+'-'+crypto.randomUUID(),purpose:'अनचाही कॉल या संदेश',email:'reader@example.com',message:'Please stop calls.'};
  const post=body=>publicLanding(new Request(origin+'/v1/public/policy-requests',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','cf-connecting-ip':'192.0.2.3'},body:JSON.stringify(body)}),env);
  assert.equal((await post({...data,message:''})).status,400);
  const res=await post(data);assert.equal(res.status,201);assert.match((await res.json()).reference,/^REQ-/);assert.equal((await post(data)).status,200);
  const record=JSON.parse([...writes.values()][0]);assert.equal(record.kind,'policy');assert.equal(record.message,data.message);
 }finally{f.close()}
});
