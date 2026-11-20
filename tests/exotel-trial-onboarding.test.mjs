import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../src/index.mjs';
import {js} from '../src/app-assets.mjs';
import {exotelTrialReadiness,managedVoicebotInstructions}
  from '../src/exotel-trial-readiness.mjs';
const base='https://aicalling.ar3dstudio.in',cookie='ar3d_calling_session='+'a'.repeat(64);
const route=base+'/v1/human/engineering/exotel-trial-setup';
function demoEnv(role='super_admin'){
  const queries=[];
  return {
    env:{CONTROL_DB:{prepare(sql){
      queries.push(sql);
      if(!sql.includes('FROM human_sessions'))throw Error('unexpected database access');
      return {bind(){return {first:async()=>({id:'fictional-admin',
        email:'fake@example.invalid',globalRole:role})}}};
    }}},
    queries
  };
}
test('managed Voicebot draft contains exactly seven boss-approved questions in Hindi and English',()=>{
  const draft=managedVoicebotInstructions();
  assert.equal(typeof draft,'string');
  assert.ok(draft.length>1500&&draft.length<7500);
  for(const v of ['1) Property type','2) City/location','3) Area/neighborhood',
    '4) Conditional size','5) Approximate budget','6) Interest','7) ONLY if interested',
    '1BHK','2BHK','3BHK','4BHK','[BUILDER_NAME]','किस शहर','आपका लगभग बजट']){
    assert.ok(draft.includes(v),v);
  }
  assert.match(draft,/NAME and MOBILE are ALREADY in the Excel/);
  assert.match(draft,/do NOT ask again/);
  assert.match(draft,/stop immediately/);
  assert.match(draft,/Never claim a visit is confirmed/);
  assert.match(draft,/UNTRUSTED/);
  assert.ok(!draft.includes('EXOTEL_API_TOKEN'));
  assert.ok(!draft.includes('Your Exotel API Token'));
});
test('readiness reports presence only, never falsely reports permission to dial or auto-save',()=>{
  const missing=exotelTrialReadiness({});
  assert.equal(missing.accountReadyForReadOnlyCheck,false);
  assert.equal(missing.canPlaceRealCalls,false);
  assert.equal(missing.canAutoSaveProviderTranscript,false);
  assert.equal(missing.credentialsAloneAreSufficient,false);
  assert.equal(missing.manualSteps.length,7);
  assert.ok(missing.engineeringRemaining.length>=4);
  const creds={
    EXOTEL_ACCOUNT_SID:'fictional_account_12345',
    EXOTEL_API_KEY:'testing_key_super_secret_0123456789',
    EXOTEL_API_TOKEN:'testing_token_super_secret_9876543210',
    EXOTEL_REGION:'singapore'
  };
  const ok=exotelTrialReadiness(creds);
  assert.equal(ok.apiRegion,'singapore');
  assert.equal(ok.apiRegionConfigured,true);
  assert.equal(ok.accountReadyForReadOnlyCheck,true);
  assert.equal(exotelTrialReadiness({...creds,EXOTEL_REGION:'invalid'}).accountReadyForReadOnlyCheck,false);
  assert.equal(exotelTrialReadiness({...creds,EXOTEL_REGION:undefined}).accountReadyForReadOnlyCheck,false);
  assert.equal(ok.accountApiConnectivityVerified,false);
  assert.equal(ok.canPlaceRealCalls,false);
  assert.equal(ok.canAutoSaveProviderTranscript,false);
  for(const item of Object.keys(creds))assert.equal(ok.credentialsPresent[item],true);
  for(const secret of Object.values(creds))
    assert.ok(!JSON.stringify(ok).includes(secret));
  assert.equal(exotelTrialReadiness({...creds,EXOTEL_API_TOKEN:'x'}).accountReadyForReadOnlyCheck,false);
  assert.throws(()=>exotelTrialReadiness(null),/environment/);
});
test('trial setup is Super Admin-only, GET-only, no provider calls or CRM reads',async()=>{
  const f=demoEnv();
  const result=await worker.fetch(new Request(route,{headers:{Cookie:cookie}}),f.env);
  assert.equal(result.status,200);
  const j=await result.json();
  assert.equal(j.mode,'trial_setup_only');
  assert.equal(j.canPlaceRealCalls,false);
  assert.equal(j.canAutoSaveProviderTranscript,false);
  assert.match(j.managedVoicebotPrompt,/Hindi:/);
  assert.equal(f.queries.length,1);
  const client=demoEnv('user');
  assert.equal((await worker.fetch(new Request(route,{headers:{Cookie:cookie}}),client.env)).status,403);
  assert.equal((await worker.fetch(new Request(route),f.env)).status,401);
  const post=new Request(route,{method:'POST',headers:{Cookie:cookie,Origin:base}});
  assert.equal((await worker.fetch(post,f.env)).status,405);
  const otherOrigin=new Request(route,{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.example'}});
  assert.equal((await worker.fetch(otherOrigin,f.env)).status,403);
  assert.ok(f.queries.every(q=>q.includes('FROM human_sessions')));
});
test('main UI exposes Exotel onboarding without any active dial or telecom callback',()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  assert.match(js,/Exotel Trial Setup — What Is Ready/);
  assert.match(js,/Copy 7-question Exotel Voicebot instructions/);
  assert.match(js,/Setting API keys alone will NOT make live calls possible/);
  assert.match(js,/\/v1\/human\/engineering\/exotel-trial-setup/);
  assert.ok(!js.includes('/v1/human/calls/start'));
});
