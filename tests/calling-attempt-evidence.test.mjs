import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,setup,route,tid,lead,at,now,admin,client} from './helpers/calling-fixture.mjs';
import {readCallingAttemptEvidence} from '../src/calling-attempt-evidence.mjs';

const other='44444444-4444-4444-8444-444444444444';
const changes=f=>[f.c.db.prepare('SELECT total_changes() AS n').get().n,f.r.db.prepare('SELECT total_changes() AS n').get().n];
async function report(f,user=client){
 const response=await route(f,'results',{tenantId:tid},user,'GET');
 assert.equal(response.status,200,await response.clone().text());
 return response.json();
}
function session(f,job,{tenant=tid,request='private-provider-request',call='private-provider-call',hangup=now+1000,duration=0,meta={}}={}){
 f.c.db.prepare(`INSERT INTO scripted_phone_pilots(id,tenant_id,lead_id,lead_updated_at,actor_id,language,destination,caller,
  expires_at,phase,provider_account_id,provider_request_id,provider_call_id,survey_json,created_at,job_id,hangup_at,duration_seconds)
  VALUES(?,?,?,?,'admin','hi','+919000000001','+918000000000',?,'ended','PRIVATE_ACCOUNT',?,?,?,?,?,?,?)`)
  .run(crypto.randomUUID(),tenant,lead,at,now+600000,request,call,JSON.stringify({transcript:'private transcript',phoneMeta:meta}),at,job,hangup,duration);
}

test('queued reports label the current target without claiming a provider request, recording or credit charge',async()=>{
 const f=fixture(),originalFetch=globalThis.fetch;
 try{
  await setup(f);
  globalThis.fetch=()=>assert.fail('a read-only report must not contact providers');
  const before=changes(f),data=await report(f),row=data.results[0];
  assert.equal(row.destinationLast4,'0001');assert.equal(row.destinationSource,'queued_lead');
  assert.equal(row.createdAt,at);assert.equal(row.reservedAt,null);
  assert.equal(row.callEvidence.sessionPresent,false);assert.equal(row.callEvidence.requestAccepted,false);
  assert.equal(row.callEvidence.signedHangup,false);assert.equal(row.callEvidence.audioReceived,false);
  assert.equal(row.callEvidence.playbackAvailable,false);assert.equal(row.callEvidence.reservationState,null);
  assert.equal(row.callEvidence.reservedSeconds,null);assert.equal(row.callEvidence.chargedSeconds,null);
  const state=await (await route(f,'state',{tenantId:tid},client,'GET')).json();
  assert.equal(state.jobs[0].destinationSource,'queued_lead');assert.equal(state.jobs[0].destinationLast4,'0001');
  assert.equal(state.jobs[0].createdAt,at);assert.equal(state.jobs[0].reservedAt,null);
  assert.doesNotMatch(JSON.stringify({data,state}),/9000000001|SYNTHETIC123|synthetic-token/);
  assert.deepEqual(changes(f),before);
 }finally{globalThis.fetch=originalFetch;f.close()}
});

test('failed reservation reports retain the attempted target and expose a held reservation without inventing a session',async()=>{
 const f=fixture();try{
  await setup(f);const job=f.r.db.prepare('SELECT id FROM calling_jobs').get().id;
  f.r.db.prepare("UPDATE calling_jobs SET state='failed',error_code='credit_reservation_unavailable',destination='+919000001234',reserved_at=? WHERE id=?").run(at,job);
  f.r.db.prepare("UPDATE leads SET mobile_e164='+919000009876' WHERE id=?").run(lead);
  f.c.db.prepare('INSERT INTO tenant_minute_holds(tenant_id,job_id,reserved_seconds,created_at) VALUES(?,?,180,?)').run(tid,job,at);
  const before=changes(f),row=(await report(f)).results[0];
  assert.equal(row.destinationLast4,'1234');assert.equal(row.destinationSource,'attempt');
  assert.equal(row.errorCode,'credit_reservation_unavailable');assert.equal(row.reservedAt,at);
  assert.equal(row.callEvidence.sessionPresent,false);assert.equal(row.callEvidence.requestAccepted,false);
  assert.equal(row.callEvidence.reservationState,'held');assert.equal(row.callEvidence.reservedSeconds,180);
  assert.equal(row.callEvidence.chargedSeconds,null);assert.equal(row.callEvidence.durationSeconds,null);
  assert.doesNotMatch(JSON.stringify(row),/9876|9000001234/);assert.deepEqual(changes(f),before);
  // A nonqueued attempt with no captured target must not borrow a later lead edit.
  f.r.db.prepare('UPDATE calling_jobs SET destination=NULL WHERE id=?').run(job);
  const missing=(await report(f)).results[0];
  assert.equal(missing.destinationLast4,null);assert.equal(missing.destinationSource,'unavailable');
 }finally{f.close()}
});

test('saved callback evidence distinguishes request reference, signed hangup and received audio without exposing provider media',async()=>{
 const f=fixture();try{
  await setup(f);const job=f.r.db.prepare('SELECT id FROM calling_jobs').get().id;
  session(f,job,{duration:12,meta:{audioBytes:1000,audioMs:4000,sttAudioMs:8000,sttFailedRequests:0,lastAudioOutcome:'recognized',recordingUrl:'https://private.invalid/secret'}});
  const before=changes(f),row=(await report(f)).results[0],e=row.callEvidence;
  assert.equal(e.sessionPresent,true);assert.equal(e.sessionPhase,'ended');assert.equal(e.sessionCreatedAt,at);
  assert.equal(e.requestAccepted,true);assert.equal(e.signedHangup,true);assert.equal(e.hangupAt,new Date(now+1000).toISOString());
  assert.equal(e.durationSeconds,12);assert.equal(e.audioReceived,true);assert.equal(e.audioBytes,1000);
  assert.equal(e.audioMs,4000);assert.equal(e.sttAudioMs,8000);assert.equal(e.sttFailedRequests,0);
  assert.equal(e.lastAudioOutcome,'recognized');assert.equal(e.playbackAvailable,false);
  assert.doesNotMatch(JSON.stringify(row),/private-provider|PRIVATE_ACCOUNT|private transcript|recordingUrl|private\.invalid/);
  assert.deepEqual(changes(f),before);
  // Hangup can set call UUID without an accepted request or audio evidence.
  f.c.db.prepare("UPDATE scripted_phone_pilots SET provider_request_id=NULL,duration_seconds=0,survey_json='{}' WHERE job_id=?").run(job);
  const onlyHangup=(await report(f)).results[0].callEvidence;
  assert.equal(onlyHangup.requestAccepted,false);assert.equal(onlyHangup.signedHangup,true);
  assert.equal(onlyHangup.audioReceived,false);assert.equal(onlyHangup.durationSeconds,0);
 }finally{f.close()}
});

test('evidence reads remain tenant scoped and sanitize unrecognized audio data',async()=>{
 const f=fixture();try{
  await setup(f);const job=f.r.db.prepare('SELECT id FROM calling_jobs').get().id;
  f.c.db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,'other','Other','starter','shared','active',?,?)").run(other,at,at);
  session(f,job,{tenant:other,meta:{audioBytes:2000,lastAudioOutcome:'recognized'}});
  assert.equal((await readCallingAttemptEvidence(f.c.wrap,tid,[job])).get(job).sessionPresent,false);
  session(f,job,{call:null,request:null,hangup:null,meta:{audioBytes:-1,audioMs:'4000',sttAudioMs:0,sttFailedRequests:1.5,lastAudioOutcome:'raw private transcript'}});
  const evidence=(await readCallingAttemptEvidence(f.c.wrap,tid,[job])).get(job);
  assert.equal(evidence.sessionPresent,true);assert.equal(evidence.audioReceived,false);
  assert.equal(evidence.audioBytes,null);assert.equal(evidence.audioMs,null);assert.equal(evidence.sttFailedRequests,null);
  assert.equal(evidence.lastAudioOutcome,null);assert.equal(evidence.requestAccepted,false);assert.equal(evidence.signedHangup,false);
 }finally{f.close()}
});

test('Super Admin report access requires current MFA and normal users still require tenant membership',async()=>{
 const f=fixture();try{
  await setup(f);
  for(const action of ['state','results']){
   assert.equal((await route(f,action,{tenantId:tid},admin,'GET')).status,200);
   assert.equal((await route(f,action,{tenantId:tid},{id:'foreign',globalRole:'user'},'GET')).status,403);
   assert.equal((await route(f,action,{tenantId:other},client,'GET')).status,403);
   assert.equal((await route(f,action,{tenantId:other},admin,'GET')).status,404);
  }
  f.c.db.prepare('UPDATE human_sessions SET revoked_at=? WHERE user_id=?').run(now,admin.id);
  for(const action of ['state','results'])assert.equal((await route(f,action,{tenantId:tid},admin,'GET')).status,403);
  assert.equal((await route(f,'results',{tenantId:tid},client,'GET')).status,200);
 }finally{f.close()}
});

test('evidence batches at most 90 jobs, rejects invalid selections and performs no writes',async()=>{
 const f=fixture();try{
  const ids=Array.from({length:200},(_,index)=>(index+1).toString(16).padStart(32,'0'));
  let queries=0,maxBindings=0;
  const control={prepare(sql){
   assert.match(sql,/^WITH wanted/);assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/);
   const statement=f.c.wrap.prepare(sql);
   return {bind(...args){queries++;maxBindings=Math.max(maxBindings,args.length);return statement.bind(...args)}};
  }};
  const before=changes(f),results=await readCallingAttemptEvidence(control,tid,ids);
  assert.equal(results.size,200);assert.equal(queries,3);assert.equal(maxBindings,92);
  assert.equal([...results.values()].every(x=>!x.sessionPresent&&x.reservationState===null),true);
  assert.deepEqual(changes(f),before);
  assert.equal((await readCallingAttemptEvidence(control,tid,[])).size,0);assert.equal(queries,3);
  for(const [tenant,jobs] of [['bad',ids],[tid,['bad']],[tid,[...ids,ids[0]]]])
   await assert.rejects(readCallingAttemptEvidence(control,tenant,jobs),/invalid call evidence/);
  assert.equal(queries,3);
 }finally{f.close()}
});
