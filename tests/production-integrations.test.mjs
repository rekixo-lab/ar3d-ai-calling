import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {checkExotelAccountReadOnly,verifyExotelExistingCallReadOnly}
  from '../src/exotel-readonly-verification.mjs';
import {inspectSignedRazorpayWebhook} from '../src/razorpay-webhook-verification.mjs';
import {reconcileProviderUsage} from '../src/usage-reconciliation.mjs';
import {operationalReadiness} from '../src/operational-readiness.mjs';
const site='https://aicalling.ar3dstudio.in';
const cookie='ar3d_calling_session='+'a'.repeat(64);
const auth={
  accountSid:'fictional_account',apiKey:'test_only_private_key_1234',
  apiToken:'test_only_private_token_1234'
};
const expected={callSid:'fictionalcall12345',status:'completed',
  direction:'outbound-api',callerId:'01234567890'};
const record={Call:{
  Sid:expected.callSid,Status:expected.status,AccountSid:auth.accountSid,
  Direction:'outbound-api',PhoneNumberSid:expected.callerId,
  To:'+919000000001',From:'01234567890',RecordingUrl:null,Price:'1.23'
}};
const goodResult=o=>Response.json(o||record);
const spy=(reply=goodResult(record))=>{
  const requests=[];
  return {requests,fetchFn:async(url,options)=>{requests.push([url,options]);return reply}};
};

test('real Exotel account GET is bounded, read-only, India host fixed, no PII/secret output',async()=>{
  const s=spy(goodResult({Calls:[],Metadata:{Total:0}}));
  const r=await checkExotelAccountReadOnly(auth,{apiFetch:s.fetchFn});
  assert.equal(r.accountLookupSucceeded,true);
  assert.equal(r.callsCreated,0);
  assert.equal(r.liveCallingAuthorized,false);
  assert.equal(s.requests.length,1);
  const [url,opts]=s.requests[0];
  assert.equal(url,'https://api.in.exotel.com/v1/Accounts/fictional_account/Calls.json?PageSize=1');
  assert.equal(opts.method,'GET');
  assert.equal(opts.redirect,'error');
  assert.equal(opts.cache,'no-store');
  assert.equal(opts.headers.Accept,'application/json');
  assert.ok(opts.headers.Authorization.startsWith('Basic '));
  assert.ok(!JSON.stringify(r).includes(auth.apiToken));
  assert.ok(!JSON.stringify(r).includes('To'));
});
test('Exotel Call Details independent lookup checks AccountSid, CallerId, Sid and Status',async()=>{
  const s=spy();
  const x=await verifyExotelExistingCallReadOnly(auth,expected,{apiFetch:s.fetchFn});
  assert.equal(x.providerLookupSucceeded,true);
  assert.equal(x.statusMatched,true);
  assert.equal(x.rawWebhookAuthenticated,false);
  assert.equal(x.billable,false);
  assert.equal(x.invoiceGenerated,false);
  assert.equal(x.liveCallingAuthorized,false);
  const [url,opts]=s.requests[0];
  assert.equal(opts.method,'GET');
  assert.equal(url,'https://api.in.exotel.com/v1/Accounts/fictional_account/Calls/fictionalcall12345.json?details=true');
  assert.ok(!JSON.stringify(x).includes('919000000001'));
  assert.ok(!JSON.stringify(x).includes(auth.apiKey));
});
test('Exotel lookups reject wrong fields, missing auth, non-JSON, redirects and large responses',async()=>{
  const bad={
    ...record,Call:{...record.Call,AccountSid:'other_company'}
  };
  await assert.rejects(verifyExotelExistingCallReadOnly(auth,expected,{
    apiFetch:spy(goodResult(bad)).fetchFn}),/mismatch/);
  for(const field of ['Sid','Status','Direction','PhoneNumberSid']){
    const wrong={Call:{...record.Call,[field]:'not-the-requested-value'}};
    await assert.rejects(verifyExotelExistingCallReadOnly(auth,expected,{
      apiFetch:spy(goodResult(wrong)).fetchFn}),/mismatch/);
  }
  await assert.rejects(verifyExotelExistingCallReadOnly({
    ...auth,accountSid:'../unsafe'
  },expected,{apiFetch:spy().fetchFn}),/invalid/);
  await assert.rejects(verifyExotelExistingCallReadOnly(auth,{
    ...expected,callSid:'../untrusted'
  },{apiFetch:spy().fetchFn}),/invalid/);
  await assert.rejects(checkExotelAccountReadOnly({
    ...auth,apiToken:'bad'
  },{apiFetch:spy().fetchFn}),/invalid/);
  await assert.rejects(checkExotelAccountReadOnly(auth,{
    apiFetch:async()=>new Response('Access denied',{status:403})}),/not authorized/);
  await assert.rejects(checkExotelAccountReadOnly(auth,{
    apiFetch:async()=>new Response('<html>Redirect</html>',{status:200,
      headers:{'Content-Type':'text/html'}})}),/unexpected format/);
  await assert.rejects(checkExotelAccountReadOnly(auth,{
    apiFetch:async()=>new Response(JSON.stringify({Calls:[]})+' '.repeat(70000),{
      status:200,headers:{'Content-Type':'application/json'}})}),/rejected/);
  await assert.rejects(checkExotelAccountReadOnly(auth,{
    apiFetch:async()=>{throw Error('secret token in private network trace')}}),/transport unavailable/);
  await assert.rejects(checkExotelAccountReadOnly(auth,{
    apiFetch:async()=>goodResult({error:'bad schema'})}),/schema mismatch/);
});

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
  const a={source:'exotel_verified_readonly',eventId:'event12345678',
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
test('operational readiness reports only binding presence, never claims live provider approval',()=>{
  const setup=operationalReadiness({
    LOGIN_RATE_LIMIT_SECRET:'synthetic_login_secret_long',
    MFA_ENCRYPTION_KEY:'synthetic_mfa_secret_long',
    EXOTEL_API_TOKEN:'synthetic_exotel_token_long',
    EXOTEL_API_KEY:'synthetic_exotel_key_long',
    EXOTEL_ACCOUNT_SID:'synthetic_account',
    RAZORPAY_WEBHOOK_SECRET:'synthetic_payment_secret',
  });
  assert.equal(setup.credentialBindingsConfigured.loginRateLimit,true);
  assert.equal(setup.credentialBindingsConfigured.exotelApiKey,true);
  assert.equal(setup.credentialBindingsConfigured.voiceProvider,false);
  assert.equal(setup.liveCallingEnabled,false);
  assert.equal(setup.paymentCollectionEnabled,false);
  assert.equal(setup.commercialLaunchApproved,false);
  assert.ok(setup.operatorActions.length>=8);
  assert.ok(!JSON.stringify(setup).includes('synthetic_login_secret_long'));
  assert.equal(operationalReadiness({}).credentialBindingsConfigured.exotelApiKey,false);
});
test('Super Admin operational API never returns secrets or exposes status to client role',async()=>{
  function env(role='super_admin'){
    const seen=[];
    const control={prepare(sql){
      seen.push(sql);
      if(!sql.includes('FROM human_sessions'))throw Error('Unexpected D1 access');
      return {bind(){return {first:async()=>({id:'synthetic-user',
        email:'operator@example.invalid',globalRole:role,token_hash:'fake'})}}};
    }};
    return {env:{CONTROL_DB:control,EXOTEL_API_TOKEN:'private-secret-do-not-echo'},
      seen};
  }
  const request=new Request(site+'/v1/human/engineering/status',{headers:{Cookie:cookie}});
  const admin=env();
  const res=await worker.fetch(request,admin.env);
  assert.equal(res.status,200);
  const result=await res.json();
  assert.equal(result.operational.commercialLaunchApproved,false);
  assert.equal(result.operational.liveCallingEnabled,false);
  assert.ok(!JSON.stringify(result).includes('private-secret-do-not-echo'));
  assert.ok(admin.seen.every(sql=>sql.includes('FROM human_sessions')));
  const client=env('user');
  const forbidden=await worker.fetch(request,client.env);
  assert.equal(forbidden.status,403);
});
