import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {fixture} from './helpers/calling-fixture.mjs';
import {compileDraftToFlow} from '../src/call-flow-dsl.mjs';
import {defaultIndustryAgentDraft} from '../src/industry-template-catalog.mjs';
import {startStoredSchoolSession,applyStoredSchoolCallback} from '../src/synthetic-school-store.mjs';
import {SCHOOL_CALLBACK_PATH,verifySchoolPlivoGet,buildSchoolAudioManifest,verifySchoolAudioBytes,schoolLivePilotStatus} from '../src/school-pilot-readiness.mjs';

const now=1700000000000;
const key=new Uint8Array(32).fill(9);
const sha=x=>createHash('sha256').update(x).digest('hex');
function input(template='school_admission_v1'){
 const graphJson=JSON.stringify(compileDraftToFlow(defaultIndustryAgentDraft(template)));
 return {tenantId:'synthetic-tenant',sessionId:'synthetic-session',snapshotId:'synthetic-snapshot',graphJson,
  graphSha256:sha('ar3d:offline-flow:v1:'+graphJson),now};
}
function event(s,answer='yes',overrides={}){
 return {tenantId:s.tenantId,sessionId:s.sessionId,snapshotId:s.snapshotId,graphSha256:s.graphSha256,
  sequence:s.sequence+1,expectedNode:s.expectedNode,eventId:'synthetic-event-'+(s.sequence+1),answer,issuedAt:now,...overrides};
}
function signed(e){
 const rawBody=JSON.stringify(e);
 return {rawBody,signature:createHmac('sha256',key).update('ar3d:synthetic-school-callback:v1:'+rawBody).digest('hex')};
}
function apply(db,s,e,overrides={}){
 return applyStoredSchoolCallback(db,{tenantId:s.tenantId,sessionId:s.sessionId,...signed(e),key,now,...overrides});
}
test('durable synthetic School state suppresses all earlier identical signed retries and rejects conflicts',async()=>{
 const f=fixture();
 try{
  const db=f.env.CONTROL_DB,initial=input(),{session:s0}=await startStoredSchoolSession(db,initial);
  await assert.rejects(startStoredSchoolSession(db,initial));
  const e1=event(s0),r1=await apply(db,s0,e1),e2=event(r1.session,'Class 5'),r2=await apply(db,r1.session,e2);
  const retry=await apply(db,s0,e1);
  assert.equal(retry.duplicate,true);assert.deepEqual(retry.commands,[]);
  assert.deepEqual(retry.session,r2.session);
  await assert.rejects(apply(db,s0,e1,{signature:'0'.repeat(64)}),/signature/);
  await assert.rejects(apply(db,s0,{...e1,answer:'changed'}),/event_conflict/);
  await assert.rejects(apply(db,r2.session,event(r2.session,'Please call',{eventId:e1.eventId})),/event_conflict/);
  await assert.rejects(apply(db,s0,e1,{tenantId:'synthetic-other'}),/not_found/);
  await assert.rejects(apply(db,s0,e1,{now:s0.expiresAt}),/expired/);
  const r3=await apply(db,r2.session,event(r2.session,'Please call'));
  assert.equal(r3.session.status,'virtual_preview_complete');
  assert.equal(r3.liveCall,false);
  assert.deepEqual([r3.providerRequests,r3.r2Requests,r3.crmMutations,r3.billedSeconds],[0,0,0,0]);
  const row=f.c.db.prepare('SELECT revision,events_json FROM synthetic_school_sessions').get();
  assert.equal(row.revision,3);assert.equal(JSON.parse(row.events_json).length,3);
  assert.throws(()=>f.c.db.prepare("UPDATE synthetic_school_sessions SET graph_json='{}'").run(),/invalid synthetic school transition/);
 }finally{f.close()}
});
test('atomic CAS allows one winner for simultaneous identical or conflicting signed callbacks',async()=>{
 const f=fixture();
 try{
  const db=f.env.CONTROL_DB,{session:s}=await startStoredSchoolSession(db,input());
  const e=event(s);
  const both=await Promise.all([apply(db,s,e),apply(db,s,e)]);
  assert.equal(both.filter(r=>!r.duplicate).length,1);
  assert.equal(both.filter(r=>r.duplicate&&r.commands.length===0).length,1);
  const next=both[0].session;
  const results=await Promise.allSettled([apply(db,next,event(next,'Class 5')),apply(db,next,event(next,'Class 6',{eventId:'synthetic-conflict'}))]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,1);
  assert.equal(f.c.db.prepare('SELECT revision FROM synthetic_school_sessions').get().revision,2);
 }finally{f.close()}
});
test('isolated Plivo GET signature candidate accepts signed canonical URL only',async()=>{
 const origin='https://example.invalid',token='synthetic-provider-token',nonce='nonce-123';
 const url=origin+SCHOOL_CALLBACK_PATH+'?To=%2B919000000001&CallUUID=synthetic-id';
 const signature=createHmac('sha256',token).update(origin+SCHOOL_CALLBACK_PATH+'?CallUUID=synthetic-id&To=+919000000001.'+nonce).digest('base64');
 const headers={'X-Plivo-Signature-V3':signature,'X-Plivo-Signature-V3-Nonce':nonce};
 const verify=(u,h=headers,method='GET')=>verifySchoolPlivoGet(new Request(u,{headers:h,method}),{origin,token});
 assert.equal(await verify(url),true);
 assert.equal(await verify(url,{...headers,'X-Plivo-Signature-V3':'A'.repeat(43)+'=, '+signature}),true);
 for(const u of [url.replace('000001','000002'),url.replace('example.invalid','other.invalid'),
  url.replace('school-pilot','scripted-pilot'),url+'&To=duplicate',url+'&ambiguous=x%26y%3Dz'])
  assert.equal(await verify(u),false);
 assert.equal(await verify(url,{...headers,'X-Plivo-Signature-V3-Nonce':'changed'}),false);
 assert.equal(await verify(url,headers,'POST'),false);
 assert.equal(await verify(url,{}),false);
 assert.equal(await verifySchoolPlivoGet(new Request(url,{headers}),{origin,token:'wrong-token'}),false);
});
test('manifest binds every School speech node and exact audio bytes to frozen graph and approved digest',async()=>{
 const f=input(),bytes=new Uint8Array([73,68,51,1,2,3]),audioSha256=sha(bytes);
 const assets=JSON.parse(f.graphJson).nodes.filter(n=>typeof n.text==='string').map(n=>({nodeId:n.id,audioSha256,bytes:bytes.length}));
 const {manifest,manifestSha256}=await buildSchoolAudioManifest({...f,assets});
 assert.equal(manifest.entries.length,5);
 const args={...f,manifest,expectedManifestSha256:manifestSha256,nodeId:'q_1',bytes};
 const checked=await verifySchoolAudioBytes(args);
 assert.equal(checked.verified,true);assert.equal(checked.callable,false);
 assert.equal(checked.key,'school-pilot/v1/'+f.graphSha256+'/q_1/'+audioSha256+'.mp3');
 await assert.rejects(verifySchoolAudioBytes({...args,bytes:new Uint8Array([73,68,51,1,2,4])}),/invalid_school_audio_bytes/);
 await assert.rejects(verifySchoolAudioBytes({...args,expectedManifestSha256:'0'.repeat(64)}),/invalid_school_audio_manifest/);
 await assert.rejects(verifySchoolAudioBytes({...args,manifest:{...manifest,entries:manifest.entries.map((a,i)=>i? a:{...a,key:'https://example.invalid/audio.mp3'})}}),/invalid_school_audio_manifest/);
 await assert.rejects(buildSchoolAudioManifest({...f,assets:assets.slice(1)}),/invalid_school_audio_assets/);
 await assert.rejects(buildSchoolAudioManifest({...input('finance_due_notice_v1'),assets}),/school_audio_only/);
 assert.deepEqual(schoolLivePilotStatus({enabled:true}),{enabled:false,callable:false,reason:'separate_live_authorization_and_provider_adapter_required'});
});
