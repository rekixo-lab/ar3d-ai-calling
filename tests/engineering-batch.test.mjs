import test from 'node:test';
import assert from 'node:assert/strict';
import {previewSandboxUsage} from './helpers/sandbox-usage.mjs';
import {runSyntheticPilot} from './helpers/sandbox-pilot.mjs';

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
