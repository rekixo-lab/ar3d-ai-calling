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
const good={
 call_uuid:call,call_direction:'outbound',
 from_number:'918000000000',to_number:'919000000001',
 billed_duration:60,call_duration:43,total_amount:'0.01234'
};
const gateway=(data=good)=>async(url,options)=>{
 assert.equal(url,'https://api.plivo.com/v1/Account/TESTACCOUNT123/Call/'+call+'/');
 assert.equal(options.method,'GET');
 assert.equal(options.redirect,'manual');
 assert.match(options.headers.Authorization,/^Basic /);
 return Response.json(data);
};

test('client sees read-only Plivo CDR tied to their own completed job, without INR claim',async()=>{
 const f=fixture();
 try{
  configured(f);
  const before=f.r.db.prepare('SELECT total_changes() AS n').get().n;
  const r=await handlePlivoCdrRequest(req(),f.env,client,{fetcher:gateway()});
  assert.equal(r.status,200,await r.clone().text());
  const data=await r.json();
  assert.equal(data.providerReportedAmount,'0.01234');
  assert.equal(data.billedSeconds,60);
  assert.equal(data.callSeconds,43);
  assert.equal(data.currency,'unverified_for_India_account');
  assert.equal(data.providerRecordMatched,true);
  assert.equal(data.creditDeducted,false);
  assert.equal(data.spentInr,null);
  const text=JSON.stringify(data);
  for(const secret of ['+919000000001','+918000000000','SYNTHETICAUTHTOKEN123','TESTACCOUNT123'])
   assert.ok(!text.includes(secret),'sensitive data in response: '+secret);
  assert.equal(f.r.db.prepare('SELECT total_changes() AS n').get().n,before);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_credit_audit').get().n,0);
 }finally{f.close()}
});

test('CDR denies viewers, other tenants, unsupported methods and uncertain or missing calls',async()=>{
 const f=fixture();
 try{
  configured(f);
  const viewer={id:'viewer',globalRole:'user'};
  assert.equal((await handlePlivoCdrRequest(req(),f.env,viewer,{fetcher:gateway()})).status,403);
  assert.equal((await handlePlivoCdrRequest(req('99999999-9999-4999-8999-999999999999'),f.env,client,{fetcher:gateway()})).status,403);
  assert.equal((await handlePlivoCdrRequest(req(tid,'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),f.env,client,{fetcher:gateway()})).status,404);
  assert.equal((await handlePlivoCdrRequest(req(tid,job,'POST'),f.env,client,{fetcher:gateway()})).status,405);
  assert.equal((await handlePlivoCdrRequest(req(tid,job,'GET','&jobId='+job),f.env,client,{fetcher:gateway()})).status,400);
  f.r.db.prepare("UPDATE calling_jobs SET state='unknown' WHERE id=?").run(job);
  assert.equal((await handlePlivoCdrRequest(req(),f.env,client,{fetcher:gateway()})).status,409);
 }finally{f.close()}
});

test('CDR rejects mismatched Plivo identity, untrusted amount or cross-account data',async()=>{
 const f=fixture();
 try{
  configured(f);
  for(const data of [
   {...good,call_uuid:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},
   {...good,call_direction:'inbound'},
   {...good,to_number:'919000000099'},
   {...good,from_number:'918000000099'},
   {...good,total_amount:'not-a-number'},
   {...good,billed_duration:-1}
  ]){
   const r=await handlePlivoCdrRequest(req(),f.env,client,{fetcher:gateway(data)});
   assert.equal(r.status,503,JSON.stringify(data));
  }
  assert.equal((await handlePlivoCdrRequest(req(),{...f.env,PLIVO_AUTH_TOKEN:undefined},client,{fetcher:gateway()})).status,503);
  f.r.db.prepare("UPDATE calling_jobs SET account_sid='OTHERACCOUNT999' WHERE id=?").run(job);
  assert.equal((await handlePlivoCdrRequest(req(),f.env,client,{fetcher:gateway()})).status,503);
 }finally{f.close()}
});

test('CDR accepts actual compact campaign job IDs but keeps provider UUID validation',async()=>{
 const f=fixture();try{
  configured(f);
  const compact='a'.repeat(32);
  f.r.db.prepare('UPDATE calling_jobs SET id=? WHERE tenant_id=? AND id=?').run(compact,tid,job);
  const r=await handlePlivoCdrRequest(req(tid,compact),f.env,client,{fetcher:gateway()});
  assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).jobId,compact);
  assert.equal((await handlePlivoCdrRequest(req(tid,'z'.repeat(32)),f.env,client,{fetcher:gateway()})).status,400);
  f.r.db.prepare('UPDATE calling_jobs SET provider_call_sid=? WHERE id=?').run(compact,compact);
  assert.equal((await handlePlivoCdrRequest(req(tid,compact),f.env,client,{fetcher:gateway()})).status,409);
 }finally{f.close()}
});
