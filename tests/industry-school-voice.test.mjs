import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {fixture,tid,lead,admin,client,now,at,configureScriptedCampaign} from './helpers/calling-fixture.mjs';
import {compileDraftToFlow} from '../src/call-flow-dsl.mjs';
import {defaultIndustryAgentDraft} from '../src/industry-template-catalog.mjs';
import {sha256hex} from '../src/core.mjs';
import {handleIndustryLaunchRequests} from '../src/industry-launch-requests.mjs';
import {handleIndustryCampaigns,readIndustryRecipientScope} from '../src/industry-campaigns.mjs';
import {audioSha,schoolVoicePlan,buildSchoolAudioPack,validateSchoolAudioPack,readSchoolAudioAsset,beginSchoolVoiceSession,advanceSchoolVoice,schoolVoiceNodes} from '../src/industry-school-voice-plan.mjs';
import {handleScriptedPhoneCallback} from '../src/scripted-phone-pilot.mjs';
const version='abababab-abab-4bab-8bab-abababababab',flow='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
const session='56565656-5656-4565-8565-565656565656',job='78787878-7878-4787-8787-787878787878';
const call='12121212-1212-4212-8212-121212121212',request='34343434-3434-4343-8343-343434343434';
const origin='https://app.example.invalid',hook='/v1/provider/plivo/scripted-pilot';
const mp3=new Uint8Array([255,251,144,100,1,2,3,4,5]);
const iso=n=>new Date(n).toISOString();
function req(path,data,method='POST'){
 return new Request(origin+path+(method==='GET'?'?'+new URLSearchParams(data):''),{method,
  headers:{Origin:origin,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(data)}:{})});
}
async function launch(f){
 const c=defaultIndustryAgentDraft('school_admission_v1'),g=compileDraftToFlow(c),config=JSON.stringify(c),graph=JSON.stringify(g);
 f.c.db.prepare("INSERT INTO ai_flow_definitions(tenant_id,id,template_id,industry_code,name,config_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,'client',?,'client',?)").run(tid,flow,c.templateId,g.industry,c.name,config,at,at);
 f.c.db.prepare("INSERT INTO ai_flow_snapshots(tenant_id,id,flow_id,source_revision,template_id,config_json,graph_json,graph_sha256,compiler_version,status,created_by,created_at) VALUES(?,?,?,1,?,?,?,?,1,'simulation_only','client',?)").run(tid,version,flow,c.templateId,config,graph,await sha256hex('ar3d:offline-flow:v1:'+graph),at);
 const base='/v1/human/industry-launch-requests';
 let res=await handleIndustryLaunchRequests(req(base,{tenantId:tid,snapshotId:version,acknowledgeProductionReview:true}),f.env,client,{now});
 assert.equal(res.status,201);const {requestId}=await res.json();
 res=await handleIndustryLaunchRequests(req(base+'/'+requestId+'/review',{tenantId:tid,decision:'configuration_reviewed',reference:'Reviewed fictional School script',acknowledgeNoCalling:true}),f.env,admin,{now});
 assert.equal(res.status,200);
 const api=(path,data,user=client,method='POST')=>handleIndustryCampaigns(req('/v1/human/industry-campaigns'+path,data,method),f.env,user,{now});
 res=await api('',{tenantId:tid,launchRequestId:requestId,name:'School enquiries'});
 assert.equal(res.status,201);const {id}=await res.json();
 res=await api('/'+id+'/recipients',{tenantId:tid,leadIds:[lead]});assert.equal(res.status,201);
 res=await api('/'+id+'/recipients',{tenantId:tid},admin,'GET');assert.equal(res.status,200);
 const x=(await res.json()).recipients[0];
 res=await api('/'+id+'/review',{tenantId:tid,leadId:lead,baseRevision:0,decision:'cleared',
  consentReference:'fictional-guardian-evidence',dndReference:'fictional-dnd-evidence',expiresAt:iso(now+3600000),reviewTarget:x.reviewTarget,
  acknowledgeGuardianAndPurpose:true},admin);assert.equal(res.status,200);
 return readIndustryRecipientScope(f.env,{tenantId:tid,campaignId:id,leadId:lead,now});
}
async function setup({held=true,enabled=true}={}){
 const f=fixture();
 try{
  configureScriptedCampaign(f);
  const scope=await launch(f),plan=await schoolVoicePlan(scope.graph,scope.digest);
  const hash=await audioSha(mp3),pack=await buildSchoolAudioPack(scope,plan.spoken.map(n=>({nodeId:n.id,sha256:hash,bytes:mp3.length})));
  const doc=await beginSchoolVoiceSession(scope,pack),objects=new Map(pack.manifest.entries.map(e=>[e.key,mp3]));
  Object.assign(f.env,{AR3D_INDUSTRY_SCHOOL_VOICE_ENABLED:enabled?'enabled':'disabled',RECORDINGS:{
   async get(key){const bytes=objects.get(key);return bytes?{size:bytes.length,httpMetadata:{contentType:'audio/mpeg'},body:new Blob([bytes]).stream()}:null},
   async head(){return null}
  }});
  if(held)f.c.db.prepare("INSERT INTO provider_cost_reservations(tenant_id,job_id,reserved_seconds,plivo_currency,plivo_micros,sarvam_currency,sarvam_micros,created_at) VALUES(?,?,180,'USD',10000,'INR',100000,?)").run(tid,job,at);
  // In-memory server-owned session fixture only. No dispatcher or provider POST.
  f.c.db.prepare("INSERT INTO scripted_phone_pilots(id,tenant_id,lead_id,lead_updated_at,actor_id,language,destination,caller,expires_at,phase,provider_request_id,survey_json,created_at,provider_account_id,job_id) VALUES(?,?,?,?,'client',?,?,?,?,'requested',?,?,?,?,?)")
   .run(session,tid,lead,scope.leadUpdatedAt,plan.language,scope.destination,f.env.AR3D_PLIVO_CALLER_NUMBER,now+600000,request,JSON.stringify(doc),at,f.env.PLIVO_AUTH_ID,job);
  return {...f,scope,plan,pack,doc,objects};
 }catch(e){f.close();throw e}
}
function signed(f,step,changes={}){
 const url=new URL(origin+hook+'/'+session+'/'+step);
 const values={CallUUID:call,RequestUUID:request,Direction:'outbound',From:'918000000000',To:'919000000001',...changes};
 for(const [k,v] of Object.entries(values))url.searchParams.set(k,String(v));
 const nonce='school-fictional-nonce',pairs=[...url.searchParams].sort(([a],[b])=>a<b?-1:a>b?1:0);
 const canonical=url.origin+url.pathname+'?'+pairs.map(([k,v])=>k+'='+v).join('&')+'.'+nonce;
 const sig=createHmac('sha256',f.env.PLIVO_AUTH_TOKEN).update(canonical).digest('base64');
 return new Request(url,{headers:{'X-Plivo-Signature-V3':sig,'X-Plivo-Signature-V3-Nonce':nonce}});
}
const none=async()=>{throw Error('unexpected external request')};
const route=(f,r,fetcher=none,time=now)=>handleScriptedPhoneCallback(r,f.env,{now:time,fetcher});
const row=f=>f.c.db.prepare('SELECT * FROM scripted_phone_pilots WHERE id=?').get(session);
const state=f=>JSON.parse(row(f).survey_json);
const mediaTime=url=>Math.max(now,Number(new URL(url).searchParams.get('expires'))-59000);
const urls=body=>[...body.matchAll(/<Play>([^<]+)<\/Play>/g)].map(x=>x[1].replaceAll('&amp;','&'));
async function consent(f){
 let r=await route(f,signed(f,'answer'));assert.match(await r.text(),/GetDigits/);
 r=await route(f,signed(f,'consent',{Digits:'1'}));const body=await r.text();
 assert.match(body,/<Record /);return urls(body);
}
function speechProvider(f,counters,{answer='जी हाँ',wrongCall=false,status=200,beforeStt=null}={}){
 return async(url,opts)=>{
  const u=new URL(url);assert.equal(opts.redirect,'manual');
  if(u.hostname==='api.plivo.com'){
   counters.metadata++;assert.equal(opts.method,'GET');
   const id=u.pathname.split('/').filter(Boolean).at(-1);
   assert.equal(opts.headers.Authorization,'Basic '+btoa(f.env.PLIVO_AUTH_ID+':'+f.env.PLIVO_AUTH_TOKEN));
   return Response.json({recording_id:id,call_uuid:wrongCall?'different-call':call,recording_format:'mp3',recording_duration_ms:'2000.000',
    recording_url:'https://media.plivo.com/v1/Account/'+f.env.PLIVO_AUTH_ID+'/Recording/'+id+'.mp3'});
  }
  if(u.hostname==='media.plivo.com'){
   counters.media++;assert.equal(opts.method,'GET');return new Response(mp3,{headers:{'content-type':'audio/mpeg'}});
  }
  assert.equal(u.href,'https://api.sarvam.ai/speech-to-text');assert.equal(opts.method,'POST');counters.stt++;
  assert.equal(opts.headers['api-subscription-key'],f.env.SARVAM_API_KEY);
  if(beforeStt)await beforeStt();
  return Response.json({transcript:answer},{status});
 };
}
const counts=()=>({metadata:0,media:0,stt:0});
const answerReq=(f,i,record='fictional-recording-'+i)=>signed(f,'turn/'+i,{RecordingID:record,RecordUrl:'https://untrusted.example.invalid/do-not-fetch'});
test('frozen School voice plan requires exact graph and tenant-bound manifest; rejects altered MP3 bytes',async()=>{
 const f=await setup();
 try{
  await assert.rejects(schoolVoicePlan(f.scope.graph,'0'.repeat(64)),/graph_invalid/);
  await assert.rejects(buildSchoolAudioPack(f.scope,[]),/pack_incomplete/);
  const bad=structuredClone(f.pack);bad.manifest.entries[0].key='scripted-phone-pilot/hi/opening.mp3';
  await assert.rejects(validateSchoolAudioPack(f.scope,bad.manifest,bad.manifestSha256),/pack_integrity/);
  await assert.rejects(validateSchoolAudioPack({...f.scope,tenantId:'99999999-9999-4999-8999-999999999999'},f.pack.manifest,f.pack.manifestSha256),/pack_invalid/);
  const entry=f.pack.manifest.entries[0];
  assert.deepEqual(await readSchoolAudioAsset(f.env.RECORDINGS,f.scope,f.pack,entry.nodeId),mp3);
  const altered=mp3.slice();altered[8]=6;f.objects.set(entry.key,altered);
  await assert.rejects(readSchoolAudioAsset(f.env.RECORDINGS,f.scope,f.pack,entry.nodeId),/asset_integrity/);
  const state=f.doc.industryVoice,hash='a'.repeat(64);
  const next=advanceSchoolVoice(f.plan,state,{recordingSha256:hash,text:'123४५६'});
  assert.equal(next.attempt,1);assert.equal(next.answers.length,0);
  assert.throws(()=>advanceSchoolVoice(f.plan,next,{recordingSha256:hash,text:'yes'}),/turn_invalid/);
  const ended=advanceSchoolVoice(f.plan,next,{recordingSha256:'b'.repeat(64),text:'repeat'});
  assert.equal(ended.status,'needs_review');
  const opted=advanceSchoolVoice(f.plan,state,{recordingSha256:hash,text:'please stop calling me'});
  assert.equal(opted.status,'opted_out');assert.equal(opted.answers.length,0);
 }finally{f.close()}
});
test('School callback remains closed without separate enablement or shared funded hold',async()=>{
 for(const options of [{held:false},{enabled:false}]){
  const f=await setup(options);
  try{const r=await route(f,signed(f,'answer'));assert.match(await r.text(),/<Hangup\/>/);assert.equal(row(f).phase,'requested')}
  finally{f.close()}
 }
});
test('existing signed callback handles consent, scoped MP3 and three one-shot answers without property changes',async()=>{
 const f=await setup();
 try{
  const unsigned=await route(f,new Request(signed(f,'answer').url));assert.equal(unsigned.status,403);
  const wrong=await route(f,signed(f,'answer',{RequestUUID:'different-request'}));assert.equal(wrong.status,403);
  const before=await route(f,answerReq(f,0));assert.match(await before.text(),/<Hangup\/>/);
  const opening=await consent(f);assert.equal(opening.length,2);
  assert.equal((await route(f,new Request(opening[0]),none,mediaTime(opening[0]))).status,200);
  assert.equal((await route(f,new Request(opening[0].replace('start.mp3','closing.mp3')),none,mediaTime(opening[0]))).status,404);
  assert.equal((await route(f,new Request(origin+hook+'/'+session+'/audio/opening.mp3'))).status,404);
  const c=counts();
  for(let i=0;i<3;i++){
   const r=await route(f,answerReq(f,i),speechProvider(f,c,{answer:['हाँ','कक्षा पाँच','जी हाँ'][i]}));
   const body=await r.text(),next=urls(body);
   assert.equal(next.length,1,body);assert.equal((await route(f,new Request(next[0]),none,mediaTime(next[0]))).status,200);
   if(i===0)assert.equal((await route(f,new Request(opening[0]),none,mediaTime(opening[0]))).status,404);
   await route(f,answerReq(f,i),speechProvider(f,c));assert.equal(c.stt,i+1);
  }
  assert.equal(row(f).phase,'completed');assert.equal(row(f).turn,3);
  assert.deepEqual(state(f).industryVoice.answers.map(a=>a.value),['हाँ','कक्षा पाँच','जी हाँ']);
  assert.equal(state(f).phoneMeta.sttRoundedSeconds,6);assert.equal(state(f).phoneMeta.sttFailedRequests,0);
  assert.equal(c.metadata,3);assert.equal(c.media,3);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM scripted_call_results').get().n,0);
  const l=f.r.db.prepare('SELECT preferred_location,budget_max_inr FROM leads WHERE tenant_id=? AND id=?').get(tid,lead);
  assert.equal(l.preferred_location,null);assert.equal(l.budget_max_inr,null);
  const hang=await route(f,signed(f,'hangup',{Duration:'45'}));assert.equal(hang.status,204);assert.ok(row(f).hangup_at);
 }finally{f.close()}
});
test('concurrent recording callback only claims one STT; unknown provider cost remains conservative',async()=>{
 const f=await setup();
 try{
  await consent(f);
  const c=counts(),fetcher=speechProvider(f,c,{status:429});
  await Promise.all([route(f,answerReq(f,0),fetcher),route(f,answerReq(f,0),fetcher)]);
  assert.equal(c.stt,1);assert.equal(row(f).phase,'needs_review');
  assert.equal(state(f).phoneMeta.sttFailedRequests,1);assert.equal(state(f).industryVoice.answers.length,0);
  assert.equal((await route(f,signed(f,'hangup',{Duration:'10'}))).status,204);
  assert.ok(f.c.db.prepare("SELECT * FROM calling_capacity_signals WHERE provider='sarvam'").get());
 }finally{f.close()}
});
test('wrong-call recording metadata never reaches Sarvam; consent withdrawal invalidates further playback',async()=>{
 const f=await setup();
 try{
  await consent(f);const c=counts();
  await route(f,answerReq(f,0),speechProvider(f,c,{wrongCall:true}));
  assert.deepEqual(c,{metadata:1,media:0,stt:0});assert.equal(row(f).phase,'needs_review');
 }finally{f.close()}
 const g=await setup();
 try{
  const opening=await consent(g),c=counts();
  g.r.db.prepare('UPDATE industry_campaigns SET archived_at=?,archived_by=? WHERE tenant_id=? AND id=?').run(at,'client',tid,g.scope.campaignId);
  assert.equal((await route(g,new Request(opening[0]),none,mediaTime(opening[0]))).status,404);
  assert.match(await (await route(g,answerReq(g,0),speechProvider(g,c))).text(),/<Hangup\/>/);
  assert.equal(c.stt,0);
  assert.equal((await route(g,signed(g,'hangup',{Duration:'10'}),none,now+700000)).status,204);
 }finally{g.close()}
});
test('keypad or speech opt-out uses global suppression, no transcript or property answer saved',async()=>{
 for(const spoken of [false,true]){
  const f=await setup();
  try{
   if(spoken){await consent(f);await route(f,answerReq(f,0),speechProvider(f,counts(),{answer:'do not call me again'}))}
   else{await route(f,signed(f,'answer'));await route(f,signed(f,'consent',{Digits:'2'}))}
   assert.equal(row(f).phase,'declined');
   const l=f.r.db.prepare('SELECT consent_status,dnd_status FROM leads WHERE tenant_id=? AND id=?').get(tid,lead);
   assert.equal(l.consent_status,'denied');assert.equal(l.dnd_status,'blocked');
   assert.equal(state(f).industryVoice.answers.length,0);
   assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM lead_opt_out_events').get().n,1);
   assert.equal((await route(f,signed(f,'hangup',{Duration:'10'}))).status,204);
  }finally{f.close()}
 }
});

test('spoken STOP persists after a concurrent signed hangup during the claimed STT',async()=>{
 const f=await setup();try{
  await consent(f);const c=counts();
  const fetcher=speechProvider(f,c,{answer:'do not call me again',beforeStt:async()=>{
   const hang=await route(f,signed(f,'hangup',{Duration:'15'}));assert.equal(hang.status,204);
   assert.equal(row(f).phase,'needs_review');
  }});
  const r=await route(f,answerReq(f,0),fetcher);
  assert.match(await r.text(),/<Hangup\/>/);
  assert.equal(row(f).phase,'declined');assert.ok(row(f).hangup_at);
  assert.equal(state(f).industryVoice.status,'opted_out');assert.equal(state(f).industryVoice.answers.length,0);
  assert.equal(state(f).phoneMeta.sttRoundedSeconds,2);assert.equal(state(f).phoneMeta.sttFailedRequests,0);
  const l=f.r.db.prepare('SELECT consent_status,dnd_status FROM leads WHERE tenant_id=? AND id=?').get(tid,lead);
  assert.deepEqual([l.consent_status,l.dnd_status],['denied','blocked']);
  await route(f,answerReq(f,0),fetcher);
  assert.equal(c.stt,1);assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM lead_opt_out_events').get().n,1);
 }finally{f.close()}
});
test('signed keypad STOP remains valid after consent-stage hangup and campaign archive',async()=>{
 const f=await setup();try{
  await route(f,signed(f,'answer'));
  assert.equal((await route(f,signed(f,'hangup',{Duration:'9'}))).status,204);
  assert.equal(row(f).phase,'ended');
  f.r.db.prepare('UPDATE industry_campaigns SET archived_at=?,archived_by=? WHERE tenant_id=? AND id=?').run(at,'client',tid,f.scope.campaignId);
  await route(f,signed(f,'consent',{Digits:'2'}));await route(f,signed(f,'consent',{Digits:'2'}));
  assert.equal(row(f).phase,'declined');assert.equal(state(f).industryVoice.status,'opted_out');
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM lead_opt_out_events').get().n,1);
 }finally{f.close()}
});
test('admission refusal closes politely; bare no for other questions is not reinterpreted',async()=>{
 const f=await setup();try{
  const c=counts();await consent(f);
  const response=await route(f,answerReq(f,0),speechProvider(f,c,{answer:'जी नहीं'}));
  const body=await response.text();assert.match(body,/<Hangup\/>/);assert.doesNotMatch(body,/<Record |<Play>/);
  assert.equal(row(f).phase,'declined');assert.equal(state(f).industryVoice.status,'declined');
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM lead_opt_out_events').get().n,0);
  const other={...f.plan,questions:f.plan.questions.map((q,i)=>i===0?{...q,text:'Have you visited the campus before?'}:q)};
  const next=advanceSchoolVoice(other,f.doc.industryVoice,{recordingSha256:'a'.repeat(64),text:'no'});
  assert.equal(next.index,1);assert.equal(next.status,'active');
 }finally{f.close()}
});
test('ordinary speech received after hangup stores metering but no answer or further prompt',async()=>{
 const f=await setup();try{
  await consent(f);const c=counts();
  const r=await route(f,answerReq(f,0),speechProvider(f,c,{answer:'yes',beforeStt:()=>route(f,signed(f,'hangup',{Duration:'15'}))}));
  assert.doesNotMatch(await r.text(),/<Record |<Play>/);
  assert.equal(row(f).phase,'needs_review');assert.equal(row(f).turn,1);
  assert.equal(state(f).industryVoice.answers.length,0);
  assert.equal(state(f).phoneMeta.sttRoundedSeconds,2);
 }finally{f.close()}
});

test('already claimed STOP survives tenant suspension and hangup without granting ordinary access',async()=>{
 const f=await setup();try{
  await consent(f);const c=counts();
  const fetcher=speechProvider(f,c,{answer:'do not call me again',beforeStt:async()=>{
   f.c.db.prepare("UPDATE tenants SET status='suspended',suspended_from_status='active' WHERE id=?").run(tid);
   const h=await route(f,signed(f,'hangup',{Duration:'12'}));assert.equal(h.status,204);
  }});
  await route(f,answerReq(f,0),fetcher);
  assert.equal(row(f).phase,'declined');assert.equal(state(f).industryVoice.status,'opted_out');
  const l=f.r.db.prepare('SELECT consent_status,dnd_status FROM leads WHERE tenant_id=? AND id=?').get(tid,lead);
  assert.deepEqual([l.consent_status,l.dnd_status],['denied','blocked']);
  assert.equal(f.c.db.prepare('SELECT status FROM tenants WHERE id=?').get(tid).status,'suspended');
  assert.equal(c.stt,1);assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM lead_opt_out_events').get().n,1);
 }finally{f.close()}
});
