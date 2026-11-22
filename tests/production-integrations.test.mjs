import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSignedRazorpayWebhook} from '../src/razorpay-webhook-verification.mjs';
import {reconcileProviderUsage} from '../src/usage-reconciliation.mjs';
async function signedRazorpay(body,secret){
  const bytes=new TextEncoder().encode(JSON.stringify(body));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes));
  return {bodyBytes:bytes,signature:Array.from(mac,b=>b.toString(16).padStart(2,'0')).join('')};
}
test('Razorpay HMAC verifies unchanged raw event but never activates subscriptions or invoices',async()=>{
  const secret='synthetic_razorpay_webhook_secret_123456789';
  const input=await signedRazorpay({event:'payment.captured',
    payload:{payment:{entity:{id:'synthetic_payment_abc',amount:99900}}}},secret);
  const x=await inspectSignedRazorpayWebhook({...input,secret,eventId:'evt_synthetic_12345'});
  assert.equal(x.hmacVerified,true);
  assert.equal(x.accountAssociated,false);
  assert.equal(x.duplicateEventChecked,false);
  assert.equal(x.paymentReconciled,false);
  assert.equal(x.subscriptionActivated,false);
  assert.equal(x.customerChargedByThisSystem,false);
  assert.equal(x.usableForFulfillment,false);
  assert.ok(!JSON.stringify(x).includes('99900'));
  const tampered=new Uint8Array(input.bodyBytes);tampered[tampered.length-2]^=1;
  await assert.rejects(inspectSignedRazorpayWebhook({...input,bodyBytes:tampered,
    secret,eventId:'evt_synthetic_12345'}),/signature/);
  await assert.rejects(inspectSignedRazorpayWebhook({...input,secret:'incorrect_and_different_secret_123',
    eventId:'evt_synthetic_12345'}),/signature/);
  const unsupported=await signedRazorpay({event:'subscription.activated'},secret);
  await assert.rejects(inspectSignedRazorpayWebhook({...unsupported,secret,
    eventId:'evt_synthetic_67890'}),/unsupported/);
  await assert.rejects(inspectSignedRazorpayWebhook({...input,secret,
    eventId:'evt.bad'}),/invalid/);
  await assert.rejects(inspectSignedRazorpayWebhook({...input,secret,
    eventId:'evt_synthetic_12345',bodyBytes:new Uint8Array(70000)}),/invalid/);
});

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
