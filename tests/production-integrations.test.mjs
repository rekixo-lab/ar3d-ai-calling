import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileProviderUsage} from '../src/usage-reconciliation.mjs';

test('read-only provider usage is duplicate-safe and non-billable with honest previews',()=>{
  const a={source:'verified_carrier_readonly',eventId:'event12345678',
    callSid:'CA123456789',tenantId:'tenant123456789',status:'completed',durationSeconds:61};
  const b={...a,eventId:'event87654321',callSid:'CA987654321',
    status:'busy',durationSeconds:0};
  const output=reconcileProviderUsage([a,a,b],{quota:1,ratePaisePerMinute:90});
  assert.equal(output.events,2);
  assert.equal(output.duplicatesIgnored,1);
  assert.equal(output.hypotheticalRoundedMinutes,2);
  assert.equal(output.hypotheticalChargePaise,180);
  assert.equal(output.quotaPreviewOnly.overLimit,true);
  assert.equal(output.billable,false);
  assert.equal(output.invoiceIssued,false);
  assert.equal(output.paymentCollected,false);
  assert.equal(output.durableEventsWritten,0);
  const tamper={...a,durationSeconds:60};
  assert.throws(()=>reconcileProviderUsage([a,tamper]),/conflicting/);
  const alternate={...a,eventId:'eventnew12345'};
  assert.throws(()=>reconcileProviderUsage([a,alternate]),/duplicate provider call/);
  for(const invalid of [
    {...a,phone:'+919000000001'},
    {...a,source:'unverified_callback'},
    {...a,status:'busy',durationSeconds:20},
    {...a,durationSeconds:-1},
    {...a,tenantId:'../wrong'}
  ])assert.throws(()=>reconcileProviderUsage([invalid]),/invalid|untrusted/);
  assert.throws(()=>reconcileProviderUsage([a],{ratePaisePerMinute:-1}),/invalid/);
});
