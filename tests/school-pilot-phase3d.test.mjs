import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {fixture,tid,admin,client,now,at} from './helpers/calling-fixture.mjs';
import {compileDraftToFlow} from '../src/call-flow-dsl.mjs';
import {defaultIndustryAgentDraft} from '../src/industry-template-catalog.mjs';
import {approveSchoolInternalPilot,stopSchoolInternalPilot,readActiveSchoolPermit} from '../src/school-internal-permits.mjs';
import {generateSchoolPilotAudio} from '../src/school-pilot-audio.mjs';
import {recordAcceptedSchoolRequest,acceptSchoolProviderCallback} from '../src/school-pilot-provider-evidence.mjs';
import {SCHOOL_CALLBACK_PATH,schoolLivePilotStatus} from '../src/school-pilot-readiness.mjs';

const flowId='abababab-abab-4bab-8bab-abababababab',snapshotId='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
const requestUUID='12121212-1212-4212-8212-121212121212',callUUID='34343434-3434-4343-8343-343434343434';
const sha=s=>createHash('sha256').update(s).digest('hex');
const mp3=new Uint8Array([255,251,144,100,1,2,3,4,5]);
function setup({template='school_admission_v1',review='simulation_reviewed'}={}){
 const f=fixture(),c=defaultIndustryAgentDraft(template),g=compileDraftToFlow(c),config=JSON.stringify(c),graph=JSON.stringify(g);
 f.c.db.prepare("INSERT INTO ai_flow_definitions(tenant_id,id,template_id,industry_code,name,config_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,'client',?,'client',?)")
  .run(tid,flowId,c.templateId,g.industry,c.name,config,at,at);
 f.c.db.prepare("INSERT INTO ai_flow_snapshots(tenant_id,id,flow_id,source_revision,template_id,config_json,graph_json,graph_sha256,compiler_version,status,created_by,created_at) VALUES(?,?,?,1,?,?,?,?,1,'simulation_only','client',?)")
  .run(tid,snapshotId,flowId,c.templateId,config,graph,sha('ar3d:offline-flow:v1:'+graph),at);
 if(review)f.c.db.prepare("INSERT INTO ai_flow_preview_reviews(tenant_id,snapshot_id,decision,review_note,reviewed_by,reviewed_at) VALUES(?,?,?,'fictional test only','admin',?)").run(tid,snapshotId,review,at);
 const objects=new Map();
 Object.assign(f.env,{AR3D_SCHOOL_PILOT_APPROVAL_ENABLED:'approved',AR3D_SCHOOL_PILOT_TENANT_ID:tid,
  AR3D_SCHOOL_PILOT_CALLER:'+918000000000',AR3D_SCHOOL_PILOT_VERIFIED_STAFF_NUMBER:'+919000000009',
  AR3D_SCHOOL_PILOT_BINDING_SECRET:'synthetic-school-binding-secret-0000',
  AR3D_SCHOOL_PILOT_AUDIO_ENABLED:'approved',AR3D_SCHOOL_PILOT_LIVE_ENABLED:'approved',
  AR3D_SCHOOL_PILOT_ORIGIN:'https://app.example.invalid',PLIVO_AUTH_TOKEN:'synthetic-plivo-auth-token',SARVAM_API_KEY:'synthetic-sarvam-key',
  SCHOOL_PILOT_AUDIO:{
   async put(k,b,o){
    assert.ok(k.startsWith('school-private/'+tid+'/school-pilot/v1/'));
    assert.equal(o.onlyIf.get('If-None-Match'),'*');assert.equal(o.sha256,sha(b));
    if(objects.has(k))return null;
    objects.set(k,{b:new Uint8Array(b),httpMetadata:o.httpMetadata});return {};
   },
   async get(k){const x=objects.get(k);return x?{size:x.b.length,httpMetadata:x.httpMetadata,body:new Blob([x.b]).stream()}:null}
  }});
 return {...f,objects};
}
const approval={tenantId:tid,snapshotId,evidenceRef:'synthetic-consent-dnd-test',expiresAt:now+300000,maxAudioChars:1000,maxCallSeconds:60,
 confirm:'ONE_OPTED_IN_STAFF_DEVICE_ONLY_NO_CUSTOMER_CALLS'};
const approve=(f,overrides={},user=admin)=>approveSchoolInternalPilot(f.env,user,{...approval,...overrides},{now});
function generate(f,id,fetcher,user=admin){
 return generateSchoolPilotAudio(f.env,user,{tenantId:tid,permitId:id},{clock:()=>now,fetcher});
}
function fakeTts(counter){
 return async (url,opts)=>{
  counter.count++;
  assert.equal(url,'https://api.sarvam.ai/text-to-speech/stream');
  assert.equal(opts.method,'POST');assert.equal(opts.redirect,'manual');
  const b=JSON.parse(opts.body);
  assert.equal(b.output_audio_codec,'mp3');assert.equal(b.language_code,'hi-IN');assert.equal(b.model,'bulbul:v3');
  assert.ok(b.text.length>0);assert.equal(opts.headers['api-subscription-key'],'synthetic-sarvam-key');
  return new Response(mp3,{headers:{'content-type':'audio/mpeg'}});
 };
}
function callback(f,permitId,{event='StartApp',nonce='nonce-test-answer',changes={}}={}){
 const u=new URL(f.env.AR3D_SCHOOL_PILOT_ORIGIN+SCHOOL_CALLBACK_PATH);
 for(const [k,v] of Object.entries({permitId,RequestUUID:requestUUID,CallUUID:callUUID,From:'918000000000',To:'919000000009',
  Direction:'outbound',Event:event,CallStatus:event==='Hangup'?'completed':'in-progress',...changes}))u.searchParams.set(k,v);
 const pairs=[...u.searchParams].sort(([a],[b])=>a<b?-1:a>b?1:0);
 const canonical=u.origin+u.pathname+'?'+pairs.map(([k,v])=>k+'='+v).join('&')+'.'+nonce;
 const signature=createHmac('sha256',f.env.PLIVO_AUTH_TOKEN).update(canonical).digest('base64');
 return new Request(u,{headers:{'X-Plivo-Signature-V3':signature,'X-Plivo-Signature-V3-Nonce':nonce}});
}
test('school internal permission requires authenticated MFA, review, configured staff and caps',async()=>{
 const f=setup();
 try{
  await assert.rejects(approve(f,{},client),/mfa_required/);
  f.env.AR3D_SCHOOL_PILOT_APPROVAL_ENABLED='disabled';
  await assert.rejects(approve(f),/approval_disabled/);
  f.env.AR3D_SCHOOL_PILOT_APPROVAL_ENABLED='approved';
  for(const change of [{maxCallSeconds:61},{maxAudioChars:4001},{expiresAt:now+3600001},{confirm:'yes'},{extra:true}])
   await assert.rejects(approve(f,change),/invalid_school_pilot_approval/);
  await assert.rejects(approve(f,{maxAudioChars:1}),/audio_budget_exceeded/);
  const p=await approve(f);assert.equal(p.liveCall,false);
  await assert.rejects(approve(f),/active_permit_exists/);
  f.env.AR3D_SCHOOL_PILOT_VERIFIED_STAFF_NUMBER='+919000000008';
  await assert.rejects(readActiveSchoolPermit(f.env,tid,p.permitId,now),/permit_unavailable/);
  f.env.AR3D_SCHOOL_PILOT_VERIFIED_STAFF_NUMBER='+919000000009';
  assert.equal((await stopSchoolInternalPilot(f.env,admin,tid,p.permitId,{now})).stopped,true);
  await assert.rejects(readActiveSchoolPermit(f.env,tid,p.permitId,now),/permit_unavailable/);
  assert.deepEqual(schoolLivePilotStatus(),{enabled:false,callable:false,reason:'separate_live_authorization_and_provider_adapter_required'});
 }finally{f.close()}
 for(const options of [{review:null},{review:'simulation_rejected'},{template:'finance_due_notice_v1'}]){
  const other=setup(options);try{await assert.rejects(approve(other),/review_required/)}finally{other.close()}
 }
});
test('one-time approved Sarvam MP3 job uses private R2 content addresses; duplicate job never charges again',async()=>{
 const f=setup();
 try{
  const p=await approve(f),counter={count:0},fetcher=fakeTts(counter);
  f.env.AR3D_SCHOOL_PILOT_AUDIO_ENABLED='disabled';
  await assert.rejects(generate(f,p.permitId,fetcher),/disabled_or_unconfigured/);
  assert.equal(counter.count,0);
  f.env.AR3D_SCHOOL_PILOT_AUDIO_ENABLED='approved';
  await assert.rejects(generate(f,p.permitId,fetcher,client),/mfa_required/);
  const both=await Promise.allSettled([generate(f,p.permitId,fetcher),generate(f,p.permitId,fetcher)]);
  assert.equal(both.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(counter.count,5);assert.equal(f.objects.size,5);
  const result=both.find(x=>x.status==='fulfilled').value;
  assert.equal(result.prepared,true);assert.equal(result.liveCall,false);assert.equal(result.assetCount,5);
  const row=f.c.db.prepare('SELECT audio_state,manifest_json,manifest_sha256 FROM school_internal_pilot_permits').get();
  assert.equal(row.audio_state,'ready');assert.equal(row.manifest_sha256,result.manifestSha256);
  assert.equal(JSON.parse(row.manifest_json).entries.length,5);
  await assert.rejects(generate(f,p.permitId,fetcher),/already_claimed/);
  assert.equal(counter.count,5);
 }finally{f.close()}
});
test('audio failure or stop is terminal: no automatic retry, no readiness',async()=>{
 const f=setup();
 try{
  const p=await approve(f);let n=0;
  await assert.rejects(generate(f,p.permitId,async()=>{n++;return new Response('not audio',{headers:{'content-type':'audio/mpeg'}})}),/failed_no_auto_retry/);
  assert.equal(n,1);assert.equal(f.objects.size,0);
  assert.equal(f.c.db.prepare('SELECT audio_state FROM school_internal_pilot_permits').get().audio_state,'failed');
  await assert.rejects(generate(f,p.permitId,async()=>{n++}),/already_claimed/);assert.equal(n,1);
 }finally{f.close()}
 const stopped=setup();
 try{
  const p=await approve(stopped);let n=0;
  await assert.rejects(generate(stopped,p.permitId,async()=>{
   n++;await stopSchoolInternalPilot(stopped.env,admin,tid,p.permitId,{now});
   return new Response(mp3,{headers:{'content-type':'audio/mpeg'}});
  }),/failed_no_auto_retry/);
  assert.equal(n,1);assert.equal(stopped.objects.size,0);
 }finally{stopped.close()}
});
test('signed Plivo callback binds accepted RequestUUID, From, To and CallUUID; stop still allows hangup evidence',async()=>{
 const f=setup();
 try{
  const p=await approve(f),id=p.permitId;
  await assert.rejects(recordAcceptedSchoolRequest(f.env,{tenantId:tid,permitId:id,requestUUID,now}),/audio_not_ready/);
  await generate(f,id,fakeTts({count:0}));
  await assert.rejects(acceptSchoolProviderCallback(callback(f,id),f.env,{now}),/request_unknown/);
  f.env.AR3D_SCHOOL_PILOT_LIVE_ENABLED='disabled';
  await assert.rejects(recordAcceptedSchoolRequest(f.env,{tenantId:tid,permitId:id,requestUUID,now}),/dispatch_disabled/);
  f.env.AR3D_SCHOOL_PILOT_LIVE_ENABLED='approved';
  await recordAcceptedSchoolRequest(f.env,{tenantId:tid,permitId:id,requestUUID,now});
  await assert.rejects(recordAcceptedSchoolRequest(f.env,{tenantId:tid,permitId:id,requestUUID,now}));
  for(const changes of [{From:'918000000003'},{To:'919000000007'}])
   await assert.rejects(acceptSchoolProviderCallback(callback(f,id,{changes}),f.env,{now}),/binding_mismatch/);
  await assert.rejects(acceptSchoolProviderCallback(new Request(callback(f,id).url),f.env,{now}),/signature_invalid/);
  const both=await Promise.all([acceptSchoolProviderCallback(callback(f,id),f.env,{now}),acceptSchoolProviderCallback(callback(f,id),f.env,{now})]);
  assert.equal(both.filter(x=>x.duplicate).length,1);
  await assert.rejects(acceptSchoolProviderCallback(callback(f,id,{changes:{CallUUID:'56565656-5656-4565-8565-565656565656'}}),f.env,{now}),/binding_mismatch/);
  await stopSchoolInternalPilot(f.env,admin,tid,id,{now});
  await assert.rejects(acceptSchoolProviderCallback(callback(f,id,{event:'Hangup'}),f.env,{now}),/nonce_conflict/);
  const ended=await acceptSchoolProviderCallback(callback(f,id,{event:'Hangup',nonce:'nonce-test-end'}),f.env,{now});
  assert.equal(ended.ended,true);assert.equal(ended.liveCall,false);
  assert.equal((await acceptSchoolProviderCallback(callback(f,id,{event:'Hangup',nonce:'nonce-test-end-retry'}),f.env,{now})).duplicate,true);
  const row=f.c.db.prepare('SELECT call_uuid,ended,revision FROM school_internal_provider_evidence').get();
  assert.equal(row.call_uuid,callUUID);assert.equal(row.ended,1);assert.equal(row.revision,2);
 }finally{f.close()}
});
