import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {assessTelecomPreflight} from '../src/telecom-preflight.mjs';
import {buildExotelVoiceAiContract,parseUnverifiedExotelCallback,
  normalizeExotelCallStatus} from '../src/exotel-voice-adapter.mjs';
import {runExotelMockPilot} from '../src/exotel-mock-pilot.mjs';

const url='https://aicalling.ar3dstudio.in';
const cookie='ar3d_calling_session='+'a'.repeat(64);
const verified='independently_verified';
const approved={
  customerSegment:'prior_inquiry',purpose:'promotional',
  consentReview:verified,dndReview:verified,optedOut:false,
  callerApproval:verified,callerClassification:'promotional',
  providerApproval:verified,callingWindow:verified,
  disclosure:verified,humanHandoff:verified,recordingNotice:verified
};
const good={
  accountSid:'fictional_account',from:'+919000000001',callerId:'01234567890',
  streamUrl:'wss://voicebot.example.invalid/media',
  statusCallback:'https://callback.example.invalid/v1/provider',
  customField:'fictional-only'
};
const fakeEnv=(role='super_admin')=>{
  const sql=[];
  const db={prepare(statement){
    sql.push(statement);
    if(!statement.includes('FROM human_sessions'))throw Error('unexpected database access');
    return {bind(){return {first:async()=>({id:'fake-user',email:'fake@example.invalid',
      globalRole:role,token_hash:'test'})}}};
  }};
  return {env:{CONTROL_DB:db},sql};
};
const req=(path,opts={})=>new Request(url+path,{
  method:opts.method||'GET',
  headers:{cookie,...(opts.method==='POST'?{
    origin:url,'Content-Type':'application/json'}:{}),...opts.headers},
  ...(opts.body===undefined?{}:{body:JSON.stringify(opts.body)})
});

test('missing telecom verification, opt-out and known DND blocks all carrier approvals',()=>{
  const missing=assessTelecomPreflight();
  assert.equal(missing.executionAllowed,false);
  assert.equal(missing.checksPassing,false);
  assert.ok(missing.reasons.length>=8);
  for(const input of [
    {...approved,optedOut:true},
    {...approved,optedOut:undefined},
    {...approved,consentReview:'pending'},
    {...approved,dndReview:'unknown'},
    {...approved,providerApproval:'manual'},
    {...approved,callerApproval:'pending'},
    {...approved,callerClassification:'service'},
    {...approved,callingWindow:'unknown'},
    {...approved,humanHandoff:'missing'},
    {...approved,recordingNotice:'pending'},
    {...approved,customerSegment:'unknown_contact',consentReview:'inferred'}
  ]) {
    const out=assessTelecomPreflight(input);
    assert.equal(out.executionAllowed,false);
    assert.equal(out.checksPassing,false);
    assert.ok(out.reasons.length>0);
  }
});

test('even supposedly verified flags never authorize a real call',()=>{
  const out=assessTelecomPreflight(approved);
  assert.equal(out.checksPassing,true);
  assert.equal(out.outcome,'manual_review_only');
  assert.equal(out.executionAllowed,false);
  assert.equal(out.immutableNoDialGate,true);
  assert.ok(out.reasons.some(x=>x.includes('Independent legal/provider approval')));
  assert.throws(()=>assessTelecomPreflight({...approved,mobile:'+919000000001'}),/invalid/);
  assert.throws(()=>assessTelecomPreflight({...approved,execute:true}),/invalid/);
  assert.throws(()=>assessTelecomPreflight(null),/invalid/);
});

test('Exotel India Voice AI contract matches documented fields but cannot dispatch',()=>{
  const result=buildExotelVoiceAiContract(good);
  assert.equal(result.method,'POST');
  assert.equal(result.endpoint,'https://api.in.exotel.com/v1/Accounts/fictional_account/Calls/connect');
  assert.equal(result.fields.StreamType,'bidirectional');
  assert.equal(result.fields.Record,'false');
  assert.equal(result.fields.From,good.from);
  assert.equal(result.fields.CallerId,good.callerId);
  assert.equal(result.fields.StreamUrl,good.streamUrl);
  assert.equal(result.fields.StatusCallback,good.statusCallback);
  assert.equal(result.fields['StatusCallbackEvents[]'],'terminal');
  assert.equal(result.encoding,'multipart/form-data');
  assert.equal(result.transportRegistered,false);
  assert.equal(result.headersAttached,false);
  assert.equal(result.executionAllowed,false);
  assert.ok(!JSON.stringify(result).includes('Authorization'));
});

test('Exotel adapter rejects endpoint injection, unexpected data, non-TLS media and bad numbers',()=>{
  for(const raw of [
    {...good,apiBase:'https://evil.example'},
    {...good,apiToken:'secret'},
    {...good,execute:true},
    {...good,accountSid:'../foo'},
    {...good,accountSid:'x'},
    {...good,from:'1234567890'},
    {...good,from:'+19876543210'},
    {...good,callerId:'abc'},
    {...good,streamUrl:'ws://bot.example.invalid/stream'},
    {...good,streamUrl:'wss://u:pass@bot.example.invalid/path'},
    {...good,streamUrl:'wss://bot.example.invalid:9999/path'},
    {...good,statusCallback:'http://callback.example.invalid/hook'},
    {...good,customField:'bad newline\n'}
  ])assert.throws(()=>buildExotelVoiceAiContract(raw),/invalid/);
  assert.throws(()=>buildExotelVoiceAiContract(null),/invalid/);
});

test('unsigned Exotel callbacks parse shape but remain untrusted and non-billable',()=>{
  const body=new TextEncoder().encode(new URLSearchParams({
    CallSid:'mockcallabc123',Status:'completed',EventType:'terminal',
    ConversationDuration:'31',RecordingUrl:'https://private.example.invalid/recording'
  }).toString());
  const out=parseUnverifiedExotelCallback(body);
  assert.equal(out.status,'completed');
  assert.equal(out.durationSeconds,31);
  assert.equal(out.trusted,false);
  assert.equal(out.authenticated,false);
  assert.equal(out.consentAuthorized,false);
  assert.equal(out.billable,false);
  assert.equal(out.callLedgerUpdated,false);
  assert.equal(out.recordingImported,false);
  assert.ok(!JSON.stringify(out).includes('RecordingUrl'));
  const state=normalizeExotelCallStatus({Sid:'mockcallabc123',Status:'no-answer'});
  assert.equal(state.usableForLiveReconciliation,false);
  assert.throws(()=>normalizeExotelCallStatus({Sid:'mockcallabc123',Status:'completed',Price:'99'}),/invalid/);
});

test('callback schema rejects unknown, repeated, invalid and oversized forms',()=>{
  const e=s=>new TextEncoder().encode(s);
  for(const raw of [
    'CallSid=abcde&Status=completed&EventType=terminal&Status=failed',
    'CallSid=abcde&Status=completed&EventType=terminal&amount=1234',
    'CallSid=abcde&Status=unverified&EventType=terminal',
    'CallSid=abcde&Status=completed&EventType=not-signed',
    'CallSid=abcde&Status=completed&EventType=terminal&ConversationDuration=15000',
    'CallSid=abcde&Status=completed&EventType=terminal&ConversationDuration=-1',
    'CallSid=abcde&Status=completed&EventType=terminal&InvoiceGenerated=yes'
  ])assert.throws(()=>parseUnverifiedExotelCallback(e(raw)),/invalid|duplicate/);
  assert.throws(()=>parseUnverifiedExotelCallback(e('a'.repeat(5000))),/invalid/);
});

test('100 synthetic vendor lifecycle runs without media, D1, provider HTTP or billing',()=>{
  const r=runExotelMockPilot({count:100});
  assert.equal(r.count,100);
  assert.deepEqual(r.outcomes,{
    completed:17,busy:17,no_answer:17,failed:17,
    opt_out_blocked:16,consent_dnd_blocked:16
  });
  assert.equal(r.endpointContractValidated,true);
  assert.equal(r.callbackShapeValidated,true);
  assert.equal(r.providerApprovalVerified,false);
  assert.equal(r.providerNetworkRequests,0);
  assert.equal(r.realCallsStarted,0);
  assert.equal(r.realAudioFrames,0);
  assert.equal(r.verifiedWebhooksReceived,0);
  assert.equal(r.billableEvents,0);
  assert.equal(r.customerDbWrites,0);
  assert.equal(r.customerNumbersProcessed,0);
  assert.equal(r.commercialLaunchAllowed,false);
  for(const scenario of ['complete','busy','no_answer','failed','opt_out','unverified']){
    const result=runExotelMockPilot({count:2,scenario});
    assert.equal(result.count,2);
    assert.equal(result.realCallsStarted,0);
  }
  for(const bad of [{count:0},{count:101},{count:'100'},{
    count:100,scenario:'live'},{count:1,phone:'+919000000001'}])
    assert.throws(()=>runExotelMockPilot(bad),/invalid/);
});

test('provider simulation API requires valid Super Admin session and same-origin',async()=>{
  const unauth=await worker.fetch(new Request(url+'/v1/human/engineering/provider-pilot'),{
    CONTROL_DB:{prepare(){throw Error('must not access DB for invalid cookie')}}
  });
  assert.equal(unauth.status,401);
  const other=fakeEnv('user');
  const blocked=await worker.fetch(req('/v1/human/engineering/provider-pilot',{
    method:'POST',body:{count:100}
  }),other.env);
  assert.equal(blocked.status,403);
  const f=fakeEnv();
  const get=await worker.fetch(req('/v1/human/engineering/provider-pilot'),f.env);
  assert.equal(get.status,405);
  const ok=await worker.fetch(req('/v1/human/engineering/provider-pilot',{
    method:'POST',body:{count:100,scenario:'mixed'}
  }),f.env);
  assert.equal(ok.status,200);
  const result=await ok.json();
  assert.equal(result.count,100);
  assert.equal(result.providerNetworkRequests,0);
  assert.equal(result.realCallsStarted,0);
  assert.ok(f.sql.every(q=>q.includes('FROM human_sessions')));
  assert.equal(f.sql.length,2);
  const forged=await worker.fetch(req('/v1/human/engineering/provider-pilot',{
    method:'POST',body:{count:1,source:'real_vendor'}
  }),f.env);
  assert.equal(forged.status,400);
  const dnd=await worker.fetch(req('/v1/human/engineering/provider-pilot',{
    method:'POST',body:{count:1,callerApproved:true}
  }),f.env);
  assert.equal(dnd.status,400);
  const cross=await worker.fetch(req('/v1/human/engineering/provider-pilot',{
    method:'POST',body:{count:1},headers:{origin:'https://evil.example'}
  }),f.env);
  assert.equal(cross.status,403);
});
