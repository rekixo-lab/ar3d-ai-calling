import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,cid,lead,at,client} from './helpers/calling-fixture.mjs';
import {handlePlivoCdrRequest} from '../src/plivo-cdr-routes.mjs';

const job='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const run='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const call='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const base='https://app.example.invalid/v1/human/plivo-cdr';
const req=(tenantId=tid,jobId=job,method='GET',extra='')=>
 new Request(base+'?tenantId='+tenantId+'&jobId='+jobId+extra,{method});
function configured(f){
 f.env.PLIVO_AUTH_ID='TESTACCOUNT123';
 f.env.PLIVO_AUTH_TOKEN='SYNTHETICAUTHTOKEN123';
 f.r.db.prepare(
  "INSERT INTO calling_runs(tenant_id,id,campaign_id,state,created_by,created_at,updated_at) VALUES(?,?,?,'completed','client',?,?)"
 ).run(tid,run,cid,at,at);
 f.r.db.prepare(
  "INSERT INTO calling_jobs(tenant_id,id,run_id,lead_id,state,account_sid,caller_id,destination,provider_call_sid,created_at,updated_at) VALUES(?,?,?,?, 'completed', ?,?,?,?, ?,?)"
 ).run(tid,job,run,lead,f.env.PLIVO_AUTH_ID,'+918000000000','+919000000001',call,at,at);
}
test('client credit lookup returns only local ledger facts; no carrier access or wholesale price',async()=>{
 const f=fixture();try{
  configured(f);
  const noFetch=()=>assert.fail('client must not query carrier');
  const get=async()=>{const r=await handlePlivoCdrRequest(req(),f.env,client,{fetcher:noFetch});assert.equal(r.status,200);return r.json()};
  let d=await get();assert.equal(d.settlementStatus,'not_recorded');assert.equal(d.chargedSeconds,null);
  f.c.db.prepare("INSERT INTO tenant_minute_ledger(id,tenant_id,kind,delta_seconds,previous_seconds,balance_seconds,actor,reason,created_at) VALUES('allocation',?,'allocation',180,0,180,'admin','Synthetic allocation',?)").run(tid,at);
  const {reserveMinutes,closeMinuteHold}=await import('../src/minute-holds.mjs');
  await reserveMinutes(f.env.CONTROL_DB,{tenantId:tid,job,maxSeconds:120});
  d=await get();assert.equal(d.settlementStatus,'held');assert.equal(d.reservedSeconds,120);assert.equal(d.chargedSeconds,null);
  await closeMinuteHold(f.env.CONTROL_DB,{tenantId:tid,job,billedSeconds:60,kind:'verified_cdr',evidenceRef:'synthetic-cdr'});
  d=await get();assert.equal(d.settlementStatus,'settled');assert.equal(d.chargedSeconds,60);assert.equal(d.reservedSeconds,0);
  for(const key of ['providerReportedAmount','currency','provider','spentInr','evidenceRef','accountSid'])assert.equal(Object.hasOwn(d,key),false);
  assert.doesNotMatch(JSON.stringify(d),/919000000001|TESTACCOUNT123|synthetic-cdr/);
 }finally{f.close()}
});
test('client credit lookup denies other tenant, viewer, malformed request and missing job',async()=>{
 const f=fixture();try{configured(f);
  assert.equal((await handlePlivoCdrRequest(req(),f.env,{id:'viewer',globalRole:'user'})).status,403);
  assert.equal((await handlePlivoCdrRequest(req('99999999-9999-4999-8999-999999999999'),f.env,client)).status,403);
  assert.equal((await handlePlivoCdrRequest(req(tid,'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),f.env,client)).status,404);
  assert.equal((await handlePlivoCdrRequest(req(tid,job,'POST'),f.env,client)).status,405);
  assert.equal((await handlePlivoCdrRequest(req(tid,job,'GET','&jobId='+job),f.env,client)).status,400);
  assert.equal((await handlePlivoCdrRequest(req(tid,'z'.repeat(32)),f.env,client)).status,400);
 }finally{f.close()}
});
test('compact job IDs and unknown outcomes never infer an amount',async()=>{
 const f=fixture();try{configured(f);const compact='a'.repeat(32);
  f.r.db.prepare("UPDATE calling_jobs SET id=?,state='unknown' WHERE tenant_id=? AND id=?").run(compact,tid,job);
  const r=await handlePlivoCdrRequest(req(tid,compact),f.env,client);assert.equal(r.status,200);const d=await r.json();assert.equal(d.callState,'unknown');assert.equal(d.chargedSeconds,null);
 }finally{f.close()}
});
