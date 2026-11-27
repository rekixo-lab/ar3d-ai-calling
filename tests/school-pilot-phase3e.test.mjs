import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {fixture,tid,admin,client,now,at} from './helpers/calling-fixture.mjs';
import {compileDraftToFlow} from '../src/call-flow-dsl.mjs';
import {defaultIndustryAgentDraft} from '../src/industry-template-catalog.mjs';
import {approveSchoolInternalPilot,stopSchoolInternalPilot,readActiveSchoolPermit} from '../src/school-internal-permits.mjs';
import {generateSchoolPilotAudio} from '../src/school-pilot-audio.mjs';
import {dispatchSchoolStageCall,stopSchoolStageCall} from '../src/school-stage-dispatch.mjs';
import {handleSchoolStageRequest,SCHOOL_STAGE_AUDIO_PATH} from '../src/school-stage-voice-runtime.mjs';
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

function stage(f){
 Object.assign(f.env,{PLIVO_AUTH_ID:'LEGACYACCOUNT001',AR3D_SCHOOL_STAGE_ENABLED:'approved',
  AR3D_SCHOOL_STAGE_PLIVO_AUTH_ID:'STAGEACCOUNT001',AR3D_SCHOOL_STAGE_PLIVO_AUTH_TOKEN:'synthetic-stage-plivo-token',
  AR3D_SCHOOL_STAGE_SARVAM_API_KEY:'synthetic-stage-sarvam-key',AR3D_SCHOOL_STAGE_ORIGIN:'https://stage.example.invalid',
  AR3D_SCHOOL_STAGE_MEDIA_SECRET:'synthetic-media-key-at-least-32-bytes',AR3D_SCHOOL_STAGE_RECORDING_AUTH:'confirmed',
  AR3D_SCHOOL_STAGE_PLIVO_CAP_USD_MICROS:'200000',AR3D_SCHOOL_STAGE_PLIVO_RESERVE_USD_MICROS:'100000',
  AR3D_SCHOOL_STAGE_SARVAM_CAP_INR_MICROS:'2000000',AR3D_SCHOOL_STAGE_SARVAM_RESERVE_INR_MICROS:'1000000',
  AR3D_SCHOOL_STAGE_FUNDING_REF:'synthetic-reviewed-stage-budget'});
 return f;
}
async function ready(f){
 const p=await approve(f),audio=await generate(f,p.permitId,fakeTts({count:0}));
 return {tenantId:tid,permitId:p.permitId,manifestSha256:audio.manifestSha256,confirm:'ONE_STAGE_STAFF_CALL_AUDIO_LISTENED_AND_FUNDING_APPROVED'};
}
function callback(f,id,step,changes={}){
 const u=new URL(f.env.AR3D_SCHOOL_STAGE_ORIGIN+SCHOOL_CALLBACK_PATH);
 const values={permitId:id,step,RequestUUID:requestUUID,CallUUID:callUUID,From:'918000000000',To:'919000000009',Direction:'outbound',
  ...(step==='answer'?{Event:'StartApp',CallStatus:'in-progress'}:step==='hangup'?{Event:'Hangup',CallStatus:'completed'}:{}),...changes};
 for(const [k,v] of Object.entries(values))u.searchParams.set(k,String(v));
 const nonce='synthetic-nonce-'+step+'-'+(changes.turn??'0');
 const pairs=[...u.searchParams].sort(([a],[b])=>a<b?-1:a>b?1:0);
 const signature=createHmac('sha256',f.env.AR3D_SCHOOL_STAGE_PLIVO_AUTH_TOKEN).update(u.origin+u.pathname+'?'+pairs.map(([k,v])=>k+'='+v).join('&')+'.'+nonce).digest('base64');
 return new Request(u,{headers:{'X-Plivo-Signature-V3':signature,'X-Plivo-Signature-V3-Nonce':nonce}});
}
const dispatch=(f,input,fetcher,user=admin)=>dispatchSchoolStageCall(f.env,user,input,{clock:()=>now,fetcher});
const route=(f,req,fetcher=async()=>{throw Error('unexpected external call')},time=now)=>handleSchoolStageRequest(req,f.env,{clock:()=>time,fetcher});
function mediaURLs(xml){return [...xml.matchAll(/<Play>([^<]+)<\/Play>/g)].map(x=>x[1].replaceAll('&amp;','&'))}
function provider(f,counters){
 return async(url,opts)=>{
  const u=new URL(url);
  assert.equal(opts.redirect,'manual');
  if(u.hostname==='api.plivo.com'){
   assert.equal(opts.headers.Authorization,'Basic '+btoa('STAGEACCOUNT001:synthetic-stage-plivo-token'));
   if(opts.method==='POST'){
    counters.dial++;assert.equal(u.pathname,'/v1/Account/STAGEACCOUNT001/Call/');
    const b=JSON.parse(opts.body);assert.equal(b.to,'+919000000009');assert.equal(b.from,'+918000000000');
    assert.equal(b.time_limit,60);assert.equal(b.ring_timeout,15);assert.equal(b.hangup_on_ring,75);
    assert.equal(new URL(b.answer_url).origin,f.env.AR3D_SCHOOL_STAGE_ORIGIN);
    return Response.json({request_uuid:requestUUID},{status:202});
   }
   if(opts.method==='DELETE'){
    counters.hangup++;assert.equal(u.pathname,'/v1/Account/STAGEACCOUNT001/Call/'+callUUID+'/');return new Response(null,{status:204});
   }
   counters.metadata++;
   const record=u.pathname.split('/').filter(Boolean).at(-1);
   return Response.json({recording_id:record,call_uuid:callUUID,recording_type:'normal',recording_format:'mp3',recording_duration_ms:'2000.000',
    recording_url:'https://media.plivo.com/v1/Account/STAGEACCOUNT001/Recording/'+record+'.mp3'});
  }
  if(u.hostname==='media.plivo.com'){
   counters.media++;return new Response(mp3,{headers:{'content-type':'audio/mpeg'}});
  }
  assert.equal(u.href,'https://api.sarvam.ai/speech-to-text');
  counters.stt++;assert.equal(opts.headers['api-subscription-key'],'synthetic-stage-sarvam-key');
  return Response.json({transcript:'fictional answer'});
 };
}
const counts=()=>({dial:0,hangup:0,metadata:0,media:0,stt:0});
test('stage one-shot dial claims reviewed funding, uses carrier limits, and never redials on timeout',async()=>{
 const f=stage(setup());
 try{
  const input=await ready(f),c=counts(),fetcher=provider(f,c);
  await assert.rejects(dispatch(f,input,fetcher,client),/mfa_required/);
  await assert.rejects(dispatch(f,{...input,manifestSha256:'0'.repeat(64)},fetcher),/reviewed_audio_required/);
  f.env.AR3D_SCHOOL_STAGE_PLIVO_AUTH_ID=f.env.PLIVO_AUTH_ID;
  await assert.rejects(dispatch(f,input,fetcher),/not_configured/);
  f.env.AR3D_SCHOOL_STAGE_PLIVO_AUTH_ID='STAGEACCOUNT001';
  const results=await Promise.allSettled([dispatch(f,input,fetcher),dispatch(f,input,fetcher)]);
  assert.equal(results.filter(x=>x.status==='fulfilled'&&x.value.state==='submitted').length,1);
  assert.equal(c.dial,1);
  assert.equal(f.c.db.prepare('SELECT plivo_reserved_usd_micros FROM school_stage_dispatches').get().plivo_reserved_usd_micros,100000);
  assert.throws(()=>f.c.db.prepare('DELETE FROM school_stage_dispatches').run(),/cannot be deleted/);
 }finally{f.close()}
 const unknown=stage(setup());
 try{
  const input=await ready(unknown);let attempts=0;
  const result=await dispatch(unknown,input,async()=>{attempts++;throw Error('lost response')});
  assert.equal(result.state,'unknown');assert.equal(result.retryAllowed,false);
  await assert.rejects(dispatch(unknown,input,async()=>{attempts++}),/already_claimed_or_budget_exhausted/);
  assert.equal(attempts,1);
  assert.equal(unknown.c.db.prepare('SELECT dispatch_state FROM school_stage_dispatches').get().dispatch_state,'unknown');
 }finally{unknown.close()}
});
test('full mocked staff voice flow: consent, signed private MP3, three bounded STT turns, no raw transcript persistence',async()=>{
 const f=stage(setup());
 try{
  const input=await ready(f),id=input.permitId,c=counts(),fetcher=provider(f,c);
  assert.equal((await dispatch(f,input,fetcher)).state,'submitted');
  assert.equal((await route(f,new Request(callback(f,id,'answer').url))).status,403);
  const early=await route(f,callback(f,id,'turn',{turn:0,RecordingID:'synthetic-recording-0'}),fetcher);
  assert.equal(early.status,403);assert.equal(c.stt,0);
  const first=await route(f,callback(f,id,'answer'),fetcher);
  assert.match(await first.text(),/GetDigits/);
  const consent=await route(f,callback(f,id,'consent',{Digits:'1'}),fetcher),opening=await consent.text(),urls=mediaURLs(opening);
  assert.equal(urls.length,2);assert.match(opening,/maxLength="8"/);
  assert.equal((await route(f,new Request(urls[0]))).status,200);
  assert.equal((await route(f,new Request(urls[0].replace('node=start','node=closing')))).status,403);
  for(let turn=0;turn<3;turn++){
   const req=()=>callback(f,id,'turn',{turn,RecordingID:'synthetic-recording-'+turn,RecordUrl:'https://untrusted.example.invalid/ignored'});
   const response=await route(f,req(),fetcher),xml=await response.text(),next=mediaURLs(xml);
   assert.equal(next.length,1);assert.equal(new URL(next[0]).pathname,SCHOOL_STAGE_AUDIO_PATH);
   assert.equal((await route(f,new Request(next[0]))).status,200);
   if(turn===0)assert.equal((await route(f,new Request(urls[0]))).status,403);
   await route(f,req(),fetcher);
   assert.equal(c.stt,turn+1);
   if(turn===2){assert.match(xml,/Hangup/);assert.doesNotMatch(xml,/<Record/)}
  }
  const row=f.c.db.prepare('SELECT * FROM school_stage_dispatches').get();
  assert.equal(row.phase,'finished');assert.equal(row.turn,3);
  assert.equal(JSON.parse(row.recordings_json).length,3);
  assert.doesNotMatch(JSON.stringify(row),/fictional answer|untrusted.example/);
  assert.equal(c.dial,1);assert.equal(c.metadata,3);assert.equal(c.media,3);
  const hangup=await route(f,callback(f,id,'hangup'),fetcher);
  assert.equal(hangup.status,204);assert.equal(f.c.db.prepare('SELECT phase FROM school_stage_dispatches').get().phase,'ended');
 }finally{f.close()}
});
test('declined consent does not record, revoked pilot only hangs up its verified UUID',async()=>{
 const f=stage(setup());
 try{
  const input=await ready(f),id=input.permitId,c=counts(),fetcher=provider(f,c);
  await dispatch(f,input,fetcher);await route(f,callback(f,id,'answer'),fetcher);
  const declined=await route(f,callback(f,id,'consent',{Digits:'2'}),fetcher);
  assert.doesNotMatch(await declined.text(),/<Record/);assert.equal(c.stt,0);
  const result=await stopSchoolStageCall(f.env,admin,{tenantId:tid,permitId:id},{clock:()=>now,fetcher});
  assert.equal(result.state,'hangup_requested');assert.equal(c.hangup,1);
  const late=await route(f,callback(f,id,'turn',{turn:0,RecordingID:'synthetic-recording-0'}),fetcher);
  assert.match(await late.text(),/Hangup/);assert.equal(c.stt,0);
 }finally{f.close()}
});

test('stage entrypoint denies missing isolated binding, production routes, and unauthenticated dispatch',async()=>{
 const {handleSchoolStageWorker}=await import('../src/school-stage-worker.mjs');
 const f=stage(setup());
 try{
  const origin=f.env.AR3D_SCHOOL_STAGE_ORIGIN;
  const req=new Request(origin+'/health');
  assert.equal((await handleSchoolStageWorker(req,f.env)).status,503);
  const isolated={...f.env,CONTROL_DB:undefined,SCHOOL_STAGE_CONTROL_DB:f.env.CONTROL_DB,AR3D_SCHOOL_STAGE_ISOLATED_DB_CONFIRMED:'yes'};
  assert.equal((await handleSchoolStageWorker(req,isolated)).status,200);
  assert.equal((await handleSchoolStageWorker(new Request(origin+'/v1/human/scripted-phone-pilot'),isolated)).status,404);
  assert.equal((await handleSchoolStageWorker(new Request(origin+'/v1/human/school-stage/dispatch',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'}),isolated)).status,403);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM school_stage_dispatches').get().n,0);
 }finally{f.close()}
});
