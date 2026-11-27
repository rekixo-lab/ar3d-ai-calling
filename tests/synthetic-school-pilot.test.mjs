import test from 'node:test';
import assert from 'node:assert/strict';
import {compileDraftToFlow} from '../src/call-flow-dsl.mjs';
import {defaultIndustryAgentDraft} from '../src/industry-template-catalog.mjs';
import {createSyntheticSchoolSession,applySyntheticSchoolCallback} from '../src/synthetic-school-pilot.mjs';

const now=1700000000000;
const enc=new TextEncoder();
const key=new Uint8Array(32).fill(7);
const hex=b=>Buffer.from(b).toString('hex');
async function fixture(template='school_admission_v1'){
 const graphJson=JSON.stringify(compileDraftToFlow(defaultIndustryAgentDraft(template)));
 const graphSha256=hex(await crypto.subtle.digest('SHA-256',enc.encode('ar3d:offline-flow:v1:'+graphJson)));
 return {sessionId:'synthetic-session',tenantId:'synthetic-tenant',snapshotId:'synthetic-version',graphJson,graphSha256,now};
}
async function signed(event,signingKey=key){
 const rawBody=JSON.stringify(event);
 const k=await crypto.subtle.importKey('raw',signingKey,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return {rawBody,signature:hex(await crypto.subtle.sign('HMAC',k,enc.encode('ar3d:synthetic-school-callback:v1:'+rawBody)))};
}
function event(s,answer='yes',overrides={}){
 return {sessionId:s.sessionId,tenantId:s.tenantId,snapshotId:s.snapshotId,graphSha256:s.graphSha256,
  eventId:'synthetic-event-'+(s.sequence+1),sequence:s.sequence+1,expectedNode:s.expectedNode,
  answer,issuedAt:now,...overrides};
}
async function apply(f,s,e,overrides={}){
 return applySyntheticSchoolCallback({session:s,graphJson:f.graphJson,...await signed(e),key,now,...overrides});
}
test('School signed synthetic callbacks advance only new commands, finish and retry without effects',async()=>{
 const f=await fixture(),start=await createSyntheticSchoolSession(f);
 assert.equal(start.session.expectedNode,'q_1');
 let s=start.session;
 for(const answer of ['yes','Class 5','Please call']){
  const e=event(s,answer);
  const r=await apply(f,s,e);
  assert.equal(r.session.sequence,s.sequence+1);
  assert.equal(r.commands.filter(x=>x.kind==='would_speak_reviewed_text').length,1);
  assert.equal(r.callable,false);assert.equal(r.liveCall,false);
  assert.deepEqual([r.providerRequests,r.r2Requests,r.crmMutations,r.billedSeconds],[0,0,0,0]);
  const retry=await apply(f,r.session,e);
  assert.equal(retry.duplicate,true);assert.deepEqual(retry.commands,[]);
  assert.deepEqual(retry.session,r.session);
  await assert.rejects(apply(f,r.session,{...e,answer:'changed'}),/event_conflict/);
  s=r.session;
 }
 assert.equal(s.status,'virtual_preview_complete');
 assert.equal(s.expectedNode,null);
 await assert.rejects(apply(f,s,event(s,'extra',{expectedNode:'q_3'})),/invalid_synthetic_sequence/);
 assert.equal(start.session.sequence,0);
});
test('fails closed for wrong signature, changed body, tenant/version/session mismatch, stale or out-of-order events',async()=>{
 const f=await fixture(),{session:s}=await createSyntheticSchoolSession(f);
 const e=event(s),valid=await signed(e);
 await assert.rejects(apply(f,s,e,{signature:'00'.repeat(32)}),/signature/);
 await assert.rejects(apply(f,s,e,{rawBody:valid.rawBody.replace('yes','no')}),/signature/);
 await assert.rejects(apply(f,s,e,{key:new Uint8Array(32).fill(8)}),/signature/);
 for(const fields of [{tenantId:'synthetic-other'},{snapshotId:'synthetic-other'},{sessionId:'synthetic-other'},
  {graphSha256:'a'.repeat(64)},{issuedAt:now-1},{unexpected:true}]){
  await assert.rejects(apply(f,s,event(s,'yes',fields)),/invalid_synthetic_event/);
 }
 await assert.rejects(apply(f,s,event(s,'yes',{sequence:2})),/sequence/);
 await assert.rejects(apply(f,s,event(s,'yes',{expectedNode:'q_2'})),/sequence/);
 await assert.rejects(apply(f,s,e,{now:now+121000}),/invalid_synthetic_event/);
 await assert.rejects(apply(f,s,e,{now:s.expiresAt}),/expired/);
 await assert.rejects(apply(f,s,event(s,'x'.repeat(161))),/invalid_fictional_voice_answers/);
 await assert.rejects(apply(f,s,e,{graphJson:f.graphJson+' '}),/graph_digest/);
 const r=await apply(f,s,e);
 await assert.rejects(apply(f,r.session,event(r.session,'Class 5'),{session:{...r.session,expectedNode:'q_3'}}),/invalid_synthetic_state/);
});
test('non-School drafts and modified graph digests cannot enter the synthetic pilot',async()=>{
 for(const template of ['property_enquiry_v1','finance_due_notice_v1','banking_service_v1','insurance_renewal_v1','appointment_reminder_v1']){
  await assert.rejects(createSyntheticSchoolSession(await fixture(template)),/school_synthetic_only/);
 }
 const f=await fixture();
 await assert.rejects(createSyntheticSchoolSession({...f,graphJson:f.graphJson+' '}),/graph_digest/);
 await assert.rejects(createSyntheticSchoolSession({...f,tenantId:'real-tenant'}),/invalid_synthetic_session/);
});
