import test from 'node:test';
import assert from 'node:assert/strict';
import {WEBHOOK_WINDOW_MS,encodeSignedMessage,verifySignedWebhook,validateProviderEnvelope,
  planCallStatusTransition} from '../src/provider-contract.mjs';

const secret='synthetic-internal-event-secret-never-use-in-production';
const eventId='33333333-3333-4333-8333-333333333333';
const tenantId='22222222-2222-4222-8222-222222222222';
const callId='55555555-5555-4555-8555-555555555555';
const time=1795000000000,timestamp=Math.floor(time/1000);
const encoder=new TextEncoder();
async function signed(body,id=eventId,seconds=timestamp){
  const message=encodeSignedMessage(seconds,id,body);
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const result=await crypto.subtle.sign('HMAC',key,message);
  return Array.from(new Uint8Array(result),b=>b.toString(16).padStart(2,'0')).join('');
}
test('signed internal webhook verifies exact unmodified bytes in a short time window',async()=>{
  const body=encoder.encode(JSON.stringify({hello:'नमस्ते'}));
  const signature=await signed(body);
  assert.equal(await verifySignedWebhook({bodyBytes:body,signature,timestamp,eventId,secret,now:time}),true);
  assert.equal(await verifySignedWebhook({bodyBytes:encoder.encode('tampered'),signature,timestamp,eventId,secret,now:time}),false);
  assert.equal(await verifySignedWebhook({bodyBytes:body,signature,timestamp,eventId,secret,now:time+WEBHOOK_WINDOW_MS+1000}),false);
  assert.equal(await verifySignedWebhook({bodyBytes:body,signature,timestamp,eventId:'44444444-4444-4444-8444-444444444444',secret,now:time}),false);
});
test('missing signing secret is always fatal; malformed signatures never pass',async()=>{
  const bytes=encoder.encode('{}');
  await assert.rejects(verifySignedWebhook({bodyBytes:bytes,signature:'0'.repeat(64),timestamp,eventId,secret:'short',now:time}),/not configured/);
  assert.equal(await verifySignedWebhook({bodyBytes:bytes,signature:'not-hex',timestamp,eventId,secret,now:time}),false);
  assert.throws(()=>encodeSignedMessage(timestamp,eventId,new Uint8Array(16385)),/invalid/);
});
test('normalized provider data is non-executable, cannot grant DND or bill callers',()=>{
  const good=validateProviderEnvelope({eventId,tenantId,callId,kind:'call.completed',
    occurredAt:'2026-11-18T20:30:00+05:30',durationSeconds:21});
  assert.equal(good.executable,false);assert.equal(good.billable,false);
  assert.equal(good.durationSeconds,21);assert.equal(good.occurredAt,'2026-11-18T15:00:00.000Z');
  for(const raw of [
    {eventId,tenantId,callId,kind:'consent.granted',occurredAt:'2026-11-18T15:00:00Z'},
    {eventId,tenantId,callId,kind:'call.completed',occurredAt:'2026-11-18T15:00:00Z',durationSeconds:-5},
    {eventId,tenantId,callId,kind:'call.completed',occurredAt:'2026-11-18T15:00:00Z',recordingUrl:'https://x'},
    {eventId,tenantId,kind:'call.ringing',occurredAt:'2026-11-18T15:00:00Z'},
  ])assert.throws(()=>validateProviderEnvelope(raw),/invalid|required/);
});
test('call status transitions reject terminal rewrites and illegal jumps',()=>{
  assert.equal(planCallStatusTransition('pending','initiating').allowed,true);
  assert.equal(planCallStatusTransition('initiating','completed').allowed,false);
  assert.equal(planCallStatusTransition('connected','completed').allowed,true);
  assert.equal(planCallStatusTransition('completed','ringing').allowed,false);
  assert.equal(planCallStatusTransition('failed','connected').allowed,false);
  assert.equal(planCallStatusTransition('active','completed').allowed,false);
});
