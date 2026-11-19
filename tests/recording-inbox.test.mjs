import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingContext,putEncryptedRecording,decryptRecordingForAuthorizedWorker} from '../src/recording-storage.mjs';
import {quarantineSyntheticEvent} from '../src/provider-inbox.mjs';
import {encodeSignedMessage} from '../src/provider-contract.mjs';
import {sha256hex} from '../src/core.mjs';
const tenant='22222222-2222-4222-8222-222222222222',call='33333333-3333-4333-8333-333333333333';
const eventId='44444444-4444-4444-8444-444444444444';
const secret='not-real-synthetic-hmac-signing-secret-12345678';
const recordingKey='not-real-independent-recording-encryption-key-12345';
const good={tenantId:tenant,callId:call,source:'provider_verified',consentVerified:true,
  callerNumberApproved:true,recordingNoticeGiven:true,contentType:'audio/wav',retentionDays:30};
test('recordings encrypt before private R2 write, scope to tenant and verify AEAD tags',async()=>{
  let written=null;
  const env={RECORDING_STORAGE_ENABLED:'true',RECORDING_ENCRYPTION_KEY:recordingKey,RECORDINGS:{
    async put(key,body,opts){written={key,body,opts}}
  }};
  const input=new Uint8Array([82,73,70,70,0,0,1,5,7]);
  const result=await putEncryptedRecording(env,good,input);
  assert.ok(result.objectKey.startsWith('tenant/'+tenant+'/calls/'+call+'/'));
  assert.equal(result.publicUrl,null);
  assert.equal(written.opts.httpMetadata.contentType,'application/octet-stream');
  assert.equal(written.opts.customMetadata.tenantId,tenant);
  assert.ok(written.body.length>input.length);
  assert.notDeepEqual(written.body,input);
  const recovered=await decryptRecordingForAuthorizedWorker(env,result.objectKey,tenant,call,written.body);
  assert.deepEqual(recovered,input);
  await assert.rejects(decryptRecordingForAuthorizedWorker(env,result.objectKey,tenant,'55555555-5555-4555-8555-555555555555',written.body),/outside authorized/);
  const tampered=written.body.slice();tampered[tampered.length-1]^=1;
  await assert.rejects(decryptRecordingForAuthorizedWorker(env,result.objectKey,tenant,call,tampered));
});
test('R2 recording writes require opt-in, approved caller, consent and notice',async()=>{
  const mock={RECORDING_STORAGE_ENABLED:'true',RECORDING_ENCRYPTION_KEY:recordingKey,RECORDINGS:{put(){throw Error('must not write')}}};
  for(const bad of [
    {...good,consentVerified:false}, {...good,callerNumberApproved:false},
    {...good,recordingNoticeGiven:false},{...good,retentionDays:0},
    {...good,source:'synthetic_demo'}
  ])await assert.rejects(putEncryptedRecording(mock,bad,new Uint8Array([1])),/requirements/);
  await assert.rejects(putEncryptedRecording({...mock,RECORDING_STORAGE_ENABLED:'false'},good,new Uint8Array([1])),/disabled/);
  await assert.rejects(putEncryptedRecording({...mock,RECORDING_ENCRYPTION_KEY:''},good,new Uint8Array([1])),/key missing/);
  assert.throws(()=>recordingContext({...good,contentType:'text/html'}),/requirements/);
});
async function signedEnvelope(body,timestamp,evt){
  const bytes=new TextEncoder().encode(JSON.stringify(body)),msg=encodeSignedMessage(timestamp,evt,bytes);
  const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',k,msg)),
    b=>b.toString(16).padStart(2,'0')).join('');
  return {bodyBytes:bytes,signature,timestamp,eventId:evt,secret,now:timestamp*1000};
}
function mockInbox(inserted=true,recorded=null){
  const log=[];
  const db={prepare(sql){return {bind(...params){log.push({sql,params});return {
    async first(){
      if(sql.includes('FROM tenants'))return {id:tenant};
      if(sql.includes('FROM provider_event_inbox'))return recorded;
      throw Error('unrecognized mock inbox query');
    },
    async run(){return {meta:{changes:inserted?1:0}}}
  }}}}};
  return {db,log};
}
test('signed synthetic event is idempotently quarantined with digest only',async()=>{
  const ts=Math.floor(Date.now()/1000);
  const envelope={eventId,tenantId:tenant,callId:call,kind:'call.completed',
    occurredAt:new Date(ts*1000).toISOString(),durationSeconds:15};
  const input=await signedEnvelope(envelope,ts,eventId);
  const f=mockInbox();
  const out=await quarantineSyntheticEvent(f.db,input);
  assert.equal(out.quarantined,true);assert.equal(out.duplicate,false);
  assert.ok(f.log.some(x=>x.sql.includes('INSERT OR IGNORE INTO provider_event_inbox')));
  assert.ok(f.log.some(x=>x.params.some(y=>typeof y==='string'&&y.length===64)));
  assert.ok(!f.log.some(x=>/INSERT INTO calls|consent_status|paid_minutes|billable/.test(x.sql)));
  const digest=await sha256hex(Array.from(input.bodyBytes,b=>b.toString(16).padStart(2,'0')).join(''));
  const recorded={payload_digest:digest,event_kind:'call.completed',status:'quarantined'};
  const duplicate=await quarantineSyntheticEvent(mockInbox(false,recorded).db,input);
  assert.equal(duplicate.duplicate,true);
  const mismatched=mockInbox(false,{...recorded,payload_digest:'0'.repeat(64)});
  await assert.rejects(quarantineSyntheticEvent(mismatched.db,input),/conflicting/);
  const missing=mockInbox(false,null);
  await assert.rejects(quarantineSyntheticEvent(missing.db,input),/unconfirmed/);
  const kindTamper=mockInbox(false,{...recorded,event_kind:'call.failed'});
  await assert.rejects(quarantineSyntheticEvent(kindTamper.db,input),/conflicting/);
  const statusTamper=mockInbox(false,{...recorded,status:'processed'});
  await assert.rejects(quarantineSyntheticEvent(statusTamper.db,input),/conflicting/);
  assert.ok(mismatched.log.every(x=>!/UPDATE .*calls|lead.*consent|invoice/.test(x.sql)));
});
test('invalid signed synthetic event never reaches database',async()=>{
  const ts=Math.floor(Date.now()/1000),payload={eventId,tenantId:tenant,callId:call,
    kind:'consent.granted',occurredAt:new Date(ts*1000).toISOString()};
  const input=await signedEnvelope(payload,ts,eventId);
  const f=mockInbox();
  await assert.rejects(quarantineSyntheticEvent(f.db,input),/invalid provider event/);
  assert.ok(!f.log.some(x=>x.sql.includes('INSERT INTO provider_event_inbox')));
  const valid=await signedEnvelope({...payload,kind:'call.ringing'},ts,eventId);
  valid.signature='0'.repeat(64);
  await assert.rejects(quarantineSyntheticEvent(f.db,valid),/signature/);
});
