import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {buildPlivoReadinessSnapshot} from '../src/launch-readiness-routes.mjs';
import {inspectScriptedPromptPack} from '../src/scripted-phone-pilot.mjs';
import {fixture} from './helpers/calling-fixture.mjs';
import {newSession,COOKIE} from '../src/human-auth.mjs';

const origin='https://calling.example.test';
function request(token,{method='GET',query=''}={}){
 return new Request(origin+'/v1/human/launch-readiness'+query,{
  method,headers:{...(token?{cookie:COOKIE+'='+token}:{}),
   ...(method!=='GET'?{origin}:{} )}
 });
}
test('Plivo go-live readiness is unavailable without login, Super Admin and current MFA',async()=>{
 const f=fixture();
 try{
  // Non-admin callers must not probe private R2 audio metadata at all.
  f.env.RECORDINGS={head:()=>assert.fail('Unauthorized private R2 HEAD'),
   get:()=>assert.fail('Unauthorized R2 audio read')};
  assert.equal((await worker.fetch(request(null),f.env)).status,401);
  const client=await newSession(f.env.CONTROL_DB,'client'),
    viewer=await newSession(f.env.CONTROL_DB,'viewer');
  assert.equal((await worker.fetch(request(client),f.env)).status,403);
  assert.equal((await worker.fetch(request(viewer),f.env)).status,403);
  const admin=await newSession(f.env.CONTROL_DB,'admin');
  f.c.db.prepare("UPDATE human_mfa_settings SET enabled_at=NULL WHERE user_id='admin'").run();
  assert.equal((await worker.fetch(request(admin),f.env)).status,403);
 }finally{f.close()}
});

test('MFA Super Admin sees nonsecret configuration checks and honest launch blockers without DB writes',async()=>{
 const f=fixture();
 try{
  const admin=await newSession(f.env.CONTROL_DB,'admin');
  const beforeControl=f.c.db.prepare('SELECT total_changes() AS n').get().n,
    beforeCrm=f.r.db.prepare('SELECT total_changes() AS n').get().n;
  const audioHeads=[];
  const env={...f.env,
   PLIVO_AUTH_ID:'TESTAUTH12345',PLIVO_AUTH_TOKEN:'syntheticPlivoToken123456789ABC',
   AR3D_PLIVO_CALLER_NUMBER:'+919000000008',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_SCRIPTED_PILOT_ENABLED:'enabled',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:'+919000000009',
   AR3D_SCRIPTED_PILOT_TENANT_ID:'11111111-1111-4111-8111-111111111111',
   AR3D_SCRIPTED_PILOT_LEAD_ID:'33333333-3333-4333-8333-333333333333',
   AR3D_SCRIPTED_CAMPAIGNS_ENABLED:'enabled',
   AI:{run:async()=>assert.fail('Never call transcription from readiness')},
   RECORDINGS:{get:async()=>assert.fail('Never read audio bytes'),head:async key=>{
    assert.match(key,/^scripted-phone-pilot\/(?:hi|en)\/[A-Za-z-]+\.mp3$/);
    audioHeads.push(key);
    return {size:4};
   }}
  };
  const response=await worker.fetch(request(admin),env);
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(response.headers.get('cache-control'),'no-store');
  const data=await response.json();
  assert.equal(data.provider,'Plivo');
  assert.equal(data.mode,'prelaunch_read_only');
  assert.equal(data.canClaimProductionReady,false);
  assert.equal(data.credentialsValidatedWithProvider,false);
  assert.equal(data.kycStatusVerified,false);
  assert.equal(data.customerCallsAuthorizedByThisReport,false);
  assert.equal(data.liveCallAttempted,false);
  assert.equal(data.realTimeConversationImplemented,false);
  assert.equal(data.scriptedCallingImplemented,true);
  assert.equal(data.environment.length,12);
  assert.ok(data.environment.every(x=>x.configured));
  assert.equal(audioHeads.length,24,'11 essential clips plus optional retry per language');
  assert.deepEqual(data.audioPacks.map(pack=>[pack.language,pack.requiredTotal,pack.requiredReady,
    pack.optionalRepeat,pack.ready]),[['hi',11,11,'present',true],['en',11,11,'present',true]]);
  assert.ok(data.audioPacks.every(pack=>pack.scope==='internal_pilot'));
  assert.ok(audioHeads.every(key=>key.startsWith('scripted-phone-pilot/')));
  assert.ok(data.engineering.some(x=>x.id==='open_conversation'&&x.ready===false));
  assert.ok(data.external.some(x=>x.id==='india_kyc'&&x.verified===false));
  const text=JSON.stringify(data);
  for(const secret of [env.PLIVO_AUTH_ID,env.PLIVO_AUTH_TOKEN,env.AR3D_PLIVO_CALLER_NUMBER,
    env.AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER,env.AR3D_SCRIPTED_PILOT_TENANT_ID])
    assert.ok(!text.includes(secret),'private configuration leaked');
  assert.equal(f.c.db.prepare('SELECT total_changes() AS n').get().n,beforeControl);
  assert.equal(f.r.db.prepare('SELECT total_changes() AS n').get().n,beforeCrm);
  for(const table of ['calls','calling_jobs','scripted_phone_pilots'])
   assert.equal((table==='scripted_phone_pilots'?f.c.db:f.r.db).prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
 }finally{f.close()}
});

test('Missing credentials cannot be confused with provider approval; GET is strictly read-only',async()=>{
 const f=fixture();
 try{
  const admin=await newSession(f.env.CONTROL_DB,'admin');
  const res=await worker.fetch(request(admin),f.env);
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.environment.filter(x=>x.configured).length,0);
  assert.equal(data.canClaimProductionReady,false);
  assert.equal(data.audioPacks.length,2);
  assert.ok(data.audioPacks.every(x=>x.ready===false&&x.requiredReady===0&&
   x.unavailable.length===11&&x.optionalRepeat==='unavailable'));
  assert.equal((await worker.fetch(request(admin,{method:'POST'}),f.env)).status,405);
  for(const query of ['?enableCalling=true','?tenantId=11111111-1111-4111-8111-111111111111'])
   assert.equal((await worker.fetch(request(admin,{query}),f.env)).status,400);
 }finally{f.close()}
});
test('Readiness pure function cannot be coerced into a live or KYC-approved status',()=>{
 const evil={PLIVO_AUTH_ID:'VALIDAUTHID',PLIVO_AUTH_TOKEN:'X'.repeat(40),
  AR3D_PLIVO_CALLER_NUMBER:'+919999999999',
  AR3D_PLIVO_RECORDING_AUTH:'confirmed',AR3D_SCRIPTED_PILOT_ENABLED:'enabled',
  AR3D_SCRIPTED_CAMPAIGNS_ENABLED:'enabled',AI:{run(){}},
  RECORDINGS:{get(){},head(){}}};
 const report=buildPlivoReadinessSnapshot(evil);
 assert.equal(report.canClaimProductionReady,false);
 assert.equal(report.credentialsValidatedWithProvider,false);
 assert.equal(report.kycStatusVerified,false);
 assert.equal(report.engineering.filter(x=>!x.ready).length,4);
});

test('Read-only pack check distinguishes complete, missing, invalid and R2-outage recordings',async()=>{
 const seen=[];
 const env={RECORDINGS:{head:async key=>{
  seen.push(key);
  if(key==='scripted-phone-pilot/hi/repeat.mp3')return null;
  if(key==='scripted-phone-pilot/hi/location.mp3')return {size:524289};
  if(key==='scripted-phone-pilot/hi/budgetInr.mp3')throw Error('private infrastructure details');
  return {size:4000};
 }}};
 const hi=await inspectScriptedPromptPack(env,'hi');
 assert.equal(hi.requiredTotal,11);
 assert.equal(hi.requiredReady,9);
 assert.equal(hi.ready,false);
 assert.deepEqual(hi.missing,[]);
 assert.deepEqual(hi.invalid,['location.mp3']);
 assert.deepEqual(hi.unavailable,['budgetInr.mp3']);
 assert.equal(hi.optionalRepeat,'missing');
 assert.equal(seen.length,12);
 assert.ok(seen.every(key=>key.startsWith('scripted-phone-pilot/hi/')));
 assert.ok(!JSON.stringify(hi).includes('private infrastructure details'));
 assert.throws(()=>inspectScriptedPromptPack(env,'fr'),/invalid audio pack language/);
 const en=await inspectScriptedPromptPack(env,'en');
 assert.equal(en.requiredReady,11);
 assert.equal(en.optionalRepeat,'present');
 assert.equal(en.ready,true);
 const unavailable=await inspectScriptedPromptPack({RECORDINGS:{
  head:async()=>{throw Error('R2 outage with sensitive error')}
 }},'hi');
 assert.equal(unavailable.ready,false);
 assert.equal(unavailable.unavailable.length,11);
 assert.equal(unavailable.optionalRepeat,'unavailable');
 assert.ok(!JSON.stringify(unavailable).includes('sensitive error'));
});
