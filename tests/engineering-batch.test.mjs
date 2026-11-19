import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {productionReadiness} from '../src/release-gates.mjs';
import {previewSandboxUsage} from '../src/sandbox-usage.mjs';
import {runSyntheticPilot} from '../src/sandbox-pilot.mjs';

const host='https://aicalling.ar3dstudio.in';
const cookie='ar3d_calling_session='+'a'.repeat(64);
const session=(role='super_admin')=>{
  const statements=[];
  const db={prepare(sql){
    statements.push(sql);
    return {bind(){return {
      async first(){
        if(!sql.includes('FROM human_sessions'))throw Error('unexpected D1 query');
        return {id:'sandbox-operator',email:'operator@example.test',globalRole:role,token_hash:'x'};
      }
    }}};
  }};
  return {env:{CONTROL_DB:db},statements};
};
function request(path,{method='GET',body,headers={}}={}){
  return new Request(host+path,{method,headers:{
    cookie,...(method==='POST'?{origin:host,'content-type':'application/json'}:{}),...headers
  },...(body!==undefined?{body:JSON.stringify(body)}:{})});
}

test('workstream A: immutable release gates never claim verified real calling or paid production',()=>{
  const r=productionReadiness();
  assert.equal(r.product,'AR3D AI Calling');
  assert.equal(r.capabilities.authenticatedCrmDemo,true);
  assert.equal(r.capabilities.syntheticSandbox,true);
  assert.equal(r.capabilities.realCalling,false);
  assert.equal(r.capabilities.billableUsage,false);
  assert.equal(r.capabilities.paymentCollection,false);
  assert.equal(r.productionLaunchAuthorized,false);
  assert.ok(r.gates.some(g=>g.id==='admin_mfa_enrollment'&&g.state==='operator_pending'));
  assert.ok(r.gates.some(g=>g.id==='consent_and_dnd'&&g.state==='blocked'));
  assert.ok(r.gates.some(g=>g.id==='paid_subscriptions'&&g.state==='blocked'));
  r.gates.push({id:'injected',state:'available'});
  assert.equal(productionReadiness().gates.some(g=>g.id==='injected'),false);
});

test('workstream B: a 100-scenario mixed mock batch has opt-outs, no dialing, zero audio',()=>{
  const result=runSyntheticPilot({count:100,scenario:'mixed'});
  assert.equal(result.mode,'synthetic_only');
  assert.equal(result.count,100);
  assert.equal(result.outcomes.completed,80);
  assert.equal(result.outcomes.opted_out,20);
  assert.equal(result.outcomes.repeat_requested,20);
  assert.equal(result.outcomes.pricing_deferred,20);
  assert.equal(result.outcomes.low_confidence_repeated,20);
  assert.equal(result.realCallsStarted,0);
  assert.equal(result.realAudioGenerated,0);
  assert.equal(result.databaseWrites,0);
  assert.equal(result.providerConnected,false);
  assert.equal(result.phoneNumbersProcessed,false);
  assert.equal(result.leadDataAccessed,false);
  assert.equal(result.usagePreview.acceptedCalls,100);
  assert.equal(result.usagePreview.billable,false);
  assert.equal(result.usagePreview.paymentCollected,false);
  assert.equal(result.usagePreview.hypotheticalCostPaise,null);
});

test('workstream B: all pilot scenarios are deterministic, bounded and fail closed on PII',()=>{
  for(const scenario of ['completed','opt_out','repeat','pricing','low_confidence']){
    const r=runSyntheticPilot({count:2,scenario});
    assert.equal(r.count,2);
    assert.equal(r.outcomes.opted_out,scenario==='opt_out'?2:0);
    assert.equal(r.outcomes.completed,scenario==='opt_out'?0:2);
  }
  for(const invalid of [
    {count:0},{count:101},{count:1.2},{scenario:'live'},
    {count:'100'},{count:1,mobile:'+919999999999'},
    {count:1,tenantId:'stolen-id'},{count:1,providerToken:'abc'}
  ])assert.throws(()=>runSyntheticPilot(invalid),/invalid|unexpected/);
  assert.throws(()=>runSyntheticPilot(null),/unexpected/);
});

test('workstream C: usage previews round per synthetic call and ignore exact replay duplicates',()=>{
  const a={source:'synthetic_sandbox',eventId:'sandbox-event-1',callId:'sandbox-call-1',durationSeconds:61};
  const b={source:'synthetic_sandbox',eventId:'sandbox-event-2',callId:'sandbox-call-2',durationSeconds:10};
  const result=previewSandboxUsage([a,a,b],{quotaCalls:1,ratePaisePerMinute:123});
  assert.equal(result.acceptedCalls,2);
  assert.equal(result.duplicatesIgnored,1);
  assert.equal(result.totalSeconds,71);
  assert.equal(result.hypotheticalRoundedMinutes,3);
  assert.equal(result.hypotheticalCostPaise,369);
  assert.equal(result.quotaPreview.overLimit,true);
  assert.equal(result.billable,false);
  assert.equal(result.paymentCollected,false);
  assert.equal(result.invoiceGenerated,false);
});

test('workstream C: usage cannot ingest real call/phone data or conflicting provider events',()=>{
  const event={source:'synthetic_sandbox',eventId:'sandbox-e-1',callId:'sandbox-c-1',durationSeconds:30};
  for(const invalid of [
    {...event,source:'telecom_provider'},
    {...event,mobile:'+919876543210'},
    {...event,durationSeconds:3601},
    {...event,durationSeconds:-1}
  ])assert.throws(()=>previewSandboxUsage([invalid]),/invalid|untrusted/);
  assert.throws(()=>previewSandboxUsage([event,{...event,durationSeconds:31}]),/conflicting/);
  assert.throws(()=>previewSandboxUsage([event,{...event,eventId:'sandbox-new-id'}]),/duplicate call/);
  assert.throws(()=>previewSandboxUsage([event],{ratePaisePerMinute:-1}),/invalid/);
  assert.throws(()=>previewSandboxUsage(new Array(101).fill(event)),/invalid/);
});

test('workstream A: unauthenticated engineering GET is rejected',async()=>{
  const env={CONTROL_DB:{prepare(){return {bind(){return {first:async()=>null}}}}}};
  const response=await worker.fetch(new Request(host+'/v1/human/engineering/status'),env);
  assert.equal(response.status,401);
  assert.equal((await response.json()).error,'sign in required');
});
test('workstream A: client role cannot access global readiness or synthetic pilot',async()=>{
  const {env,statements}=session('user');
  const read=await worker.fetch(request('/v1/human/engineering/status'),env);
  assert.equal(read.status,403);
  const run=await worker.fetch(request('/v1/human/engineering/pilot',{
    method:'POST',body:{count:100,scenario:'mixed'}
  }),env);
  assert.equal(run.status,403);
  assert.ok(statements.every(sql=>sql.includes('FROM human_sessions')));
});
test('workstream A: Super Admin can run isolated synthetic pilot without any D1 mutation',async()=>{
  const {env,statements}=session();
  const status=await worker.fetch(request('/v1/human/engineering/status'),env);
  assert.equal(status.status,200);
  assert.equal(status.headers.get('cache-control'),'no-store');
  const statusData=await status.json();
  assert.equal(statusData.capabilities.realCalling,false);
  const res=await worker.fetch(request('/v1/human/engineering/pilot',{
    method:'POST',body:{count:100,scenario:'mixed',quotaCalls:100}
  }),env);
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.realCallsStarted,0);
  assert.equal(body.count,100);
  assert.equal(body.usagePreview.invoiceGenerated,false);
  assert.equal(statements.length,2);
  assert.ok(statements.every(sql=>sql.includes('FROM human_sessions')));
});

test('workstream A: same-origin required, strict method and request body',async()=>{
  const {env}=session();
  const withoutOrigin=await worker.fetch(new Request(host+'/v1/human/engineering/pilot',{
    method:'POST',headers:{cookie,'content-type':'application/json'},
    body:JSON.stringify({count:1})
  }),env);
  assert.equal(withoutOrigin.status,403);
  const unsafeOrigin=await worker.fetch(request('/v1/human/engineering/pilot',{
    method:'POST',body:{count:1},headers:{origin:'https://evil.example'}
  }),env);
  assert.equal(unsafeOrigin.status,403);
  const wrongMethod=await worker.fetch(request('/v1/human/engineering/pilot'),env);
  assert.equal(wrongMethod.status,405);
  const oversized=await worker.fetch(request('/v1/human/engineering/pilot',{
    method:'POST',body:{count:1,padding:'x'.repeat(700)}
  }),env);
  assert.equal(oversized.status,400);
  const injected=await worker.fetch(request('/v1/human/engineering/pilot',{
    method:'POST',body:{count:1,leadPhone:'+919000000000'}
  }),env);
  assert.equal(injected.status,400);
  const unknown=await worker.fetch(request('/v1/human/engineering/activate'),env);
  assert.equal(unknown.status,404);
});
