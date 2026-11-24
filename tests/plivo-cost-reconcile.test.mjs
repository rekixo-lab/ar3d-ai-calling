import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,cid,lead,at,admin,client} from './helpers/calling-fixture.mjs';
import {handlePlivoCostReconcile} from '../src/plivo-cost-reconcile-routes.mjs';

const job='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const run='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const call='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const body={tenantId:tid,jobId:job};
const request=(d=body,method='POST')=>new Request(
 'https://app.example.invalid/v1/human/plivo-cost-reconcile',
 {method,headers:{Origin:'https://app.example.invalid','Content-Type':'application/json'},
  ...(method==='POST'?{body:JSON.stringify(d)}:{})}
);
function seed(f){
 const t=Date.now(),iso=new Date(t).toISOString();
 f.c.db.prepare("UPDATE human_sessions SET created_at=?,expires_at=? WHERE user_id='admin'")
 .run(iso,t+3600000);
 f.env.PLIVO_AUTH_ID='TESTACCOUNT123';
 f.env.PLIVO_AUTH_TOKEN='SYNTHETICAUTHTOKEN123';
 f.r.db.prepare(
  "INSERT INTO calling_runs(tenant_id,id,campaign_id,state,created_by,created_at,updated_at) VALUES(?,?,?,'completed','client',?,?)"
 ).run(tid,run,cid,at,at);
 f.r.db.prepare(
  "INSERT INTO calling_jobs(tenant_id,id,run_id,lead_id,state,account_sid,caller_id,destination,provider_call_sid,created_at,updated_at) VALUES(?,?,?,?,'completed',?,?,?,?,?,?)"
 ).run(tid,job,run,lead,f.env.PLIVO_AUTH_ID,
  '+918000000000','+919000000001',call,at,at);
}
const good={
 call_uuid:call,call_direction:'outbound',
 from_number:'918000000000',to_number:'919000000001',
 billed_duration:60,call_duration:40,total_amount:'0.01234'
};
const gateway=data=>async(url,options)=>{
 assert.equal(url,'https://api.plivo.com/v1/Account/TESTACCOUNT123/Call/'+call+'/');
 assert.equal(options.method,'GET');
 assert.equal(options.redirect,'manual');
 assert.ok(options.headers.Authorization.startsWith('Basic '));
 return Response.json(data);
};

test('current MFA operator records real provider CDR once without wallet charges',async()=>{
 const f=fixture();
 try{
  seed(f);
  const opts={fetcher:gateway(good)};
  assert.equal((await handlePlivoCostReconcile(request(),f.env,client,opts)).status,403);
  let r=await handlePlivoCostReconcile(request(),f.env,admin,opts);
  assert.equal(r.status,200,await r.clone().text());
  let d=await r.json();
  assert.equal(d.recorded,true);
  assert.equal(d.alreadyRecorded,false);
  assert.equal(d.currency,'unverified');
  assert.equal(d.providerReportedAmount,'0.01234');
  assert.equal(d.billedSeconds,60);
  assert.equal(d.clientCreditsDebited,false);
  const n=()=>f.r.db.prepare('SELECT COUNT(*) AS n FROM verified_provider_call_costs').get().n;
  const audits=()=>f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='plivo.cdr_observed'").get().n;
  assert.equal(n(),1);assert.equal(audits(),1);
  r=await handlePlivoCostReconcile(request(),f.env,admin,opts);
  assert.equal(r.status,200,await r.clone().text());
  d=await r.json();
  assert.equal(d.alreadyRecorded,true);
  assert.equal(n(),1);assert.equal(audits(),1);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_credit_audit').get().n,0);
  const raw=JSON.stringify(d);
  for(const secret of ['+919000000001','+918000000000','SYNTHETICAUTHTOKEN123','TESTACCOUNT123'])
   assert.ok(!raw.includes(secret));
 }finally{f.close()}
});

test('changed provider cost requires manual review; does not overwrite a verified observation',async()=>{
 const f=fixture();
 try{
  seed(f);
  assert.equal((await handlePlivoCostReconcile(request(),f.env,admin,{
   fetcher:gateway(good)
  })).status,200);
  const revised={...good,total_amount:'0.09234'};
  assert.equal((await handlePlivoCostReconcile(request(),f.env,admin,{
   fetcher:gateway(revised)
  })).status,409);
  const saved=f.r.db.prepare('SELECT reported_amount AS amount FROM verified_provider_call_costs WHERE tenant_id=? AND job_id=?')
   .get(tid,job);
  assert.equal(saved.amount,good.total_amount);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM verified_provider_call_costs').get().n,1);
 }finally{f.close()}
});

test('deny stale MFA, foreign tenant, unknown job, requests with untrusted fields, and in-flight calls',async()=>{
 const f=fixture();
 try{
  seed(f);
  const opts={fetcher:gateway(good)};
  const foreign='99999999-9999-4999-8999-999999999999';
  assert.equal((await handlePlivoCostReconcile(request({...body,tenantId:foreign}),f.env,admin,opts)).status,404);
  assert.equal((await handlePlivoCostReconcile(request({...body,jobId:foreign}),f.env,admin,opts)).status,404);
  assert.equal((await handlePlivoCostReconcile(request({...body,force:true}),f.env,admin,opts)).status,400);
  assert.equal((await handlePlivoCostReconcile(request(body,'GET'),f.env,admin,opts)).status,405);
  f.c.db.prepare("UPDATE human_mfa_settings SET enabled_at=NULL WHERE user_id='admin'").run();
  assert.equal((await handlePlivoCostReconcile(request(),f.env,admin,opts)).status,403);
  f.c.db.prepare("UPDATE human_mfa_settings SET enabled_at=? WHERE user_id='admin'").run(at);
  f.r.db.prepare("UPDATE calling_jobs SET state='unknown' WHERE tenant_id=? AND id=?").run(tid,job);
  assert.equal((await handlePlivoCostReconcile(request(),f.env,admin,opts)).status,409);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM verified_provider_call_costs').get().n,0);
 }finally{f.close()}
});

test('reject mismatched provider call, currency-unsafe cost and wrong provider account',async()=>{
 const f=fixture();
 try{
  seed(f);
  const cases=[
   {...good,call_uuid:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},
   {...good,call_direction:'inbound'},
   {...good,to_number:'919000000099'},
   {...good,from_number:'918000000099'},
   {...good,total_amount:'not-amount'},
   {...good,billed_duration:-1}
  ];
  for(const data of cases){
   const r=await handlePlivoCostReconcile(request(),f.env,admin,{fetcher:gateway(data)});
   assert.equal(r.status,503,JSON.stringify(data));
  }
  f.r.db.prepare("UPDATE calling_jobs SET account_sid='OTHERACCOUNT999' WHERE tenant_id=? AND id=?")
   .run(tid,job);
  assert.equal((await handlePlivoCostReconcile(request(),f.env,admin,{
   fetcher:gateway(good)
  })).status,503);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM verified_provider_call_costs').get().n,0);
 }finally{f.close()}
});

test('reconcile accepts compact campaign IDs and observes a CDR only once',async()=>{
 const f=fixture();try{
  seed(f);
  const compact='a'.repeat(32);
  f.r.db.prepare('UPDATE calling_jobs SET id=? WHERE tenant_id=? AND id=?').run(compact,tid,job);
  const opts={fetcher:gateway(good)},data={tenantId:tid,jobId:compact};
  const first=await handlePlivoCostReconcile(request(data),f.env,admin,opts);
  assert.equal(first.status,200,await first.clone().text());
  assert.equal((await first.json()).alreadyRecorded,false);
  const again=await handlePlivoCostReconcile(request(data),f.env,admin,opts);
  assert.equal(again.status,200);assert.equal((await again.json()).alreadyRecorded,true);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM verified_provider_call_costs').get().n,1);
  assert.equal((await handlePlivoCostReconcile(request({...data,jobId:'z'.repeat(32)}),f.env,admin,opts)).status,400);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_credit_audit').get().n,0);
 }finally{f.close()}
});
