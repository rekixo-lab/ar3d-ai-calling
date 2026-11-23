import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPlivoReadinessSnapshot,productionSetupActions} from '../src/launch-readiness-routes.mjs';

const audio=[{language:'hi',ready:true,requiredReady:11,requiredTotal:11}];
const present={
 PLIVO_AUTH_ID:'TESTACCOUNT123',
 PLIVO_AUTH_TOKEN:'SYNTHETICAUTHTOKEN123',
 AR3D_PLIVO_CALLER_NUMBER:'+918065491333',
 AR3D_SCRIPTED_PILOT_ORIGIN:'https://aicalling.ar3dstudio.in',
 AR3D_PLIVO_RECORDING_AUTH:'confirmed',
 AR3D_SCRIPTED_PILOT_ENABLED:'enabled',
 AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:'+919876543210',
 AR3D_SCRIPTED_PILOT_TENANT_ID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 AR3D_SCRIPTED_PILOT_LEAD_ID:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 AI:{run:()=>{}},
 RECORDINGS:{get:()=>{},head:()=>{}}
};

test('setup list isolates real manual blockers while detecting correctly shaped bindings',()=>{
 const s=buildPlivoReadinessSnapshot(present);
 const list=productionSetupActions(s,audio);
 const by=Object.fromEntries(list.map(x=>[x.id,x]));
 assert.equal(by.plivo_secrets.ready,true);
 assert.equal(by.caller.ready,true);
 assert.equal(by.callback.ready,true);
 assert.equal(by.hindi_audio.ready,true);
 assert.equal(by.recording.ready,true);
 assert.equal(by.recipient.ready,true);
 for(const name of ['deploy','traffic','internal_call','customer_campaigns'])
  assert.equal(by[name].ready,false,'provider and deployment cannot be inferred from secrets: '+name);
 assert.equal(s.customerCallsAuthorizedByThisReport,false);
 assert.equal(s.liveCallAttempted,false);
 const raw=JSON.stringify({snapshot:s,steps:list});
 assert.ok(!raw.includes(present.PLIVO_AUTH_TOKEN));
 assert.ok(!raw.includes(present.PLIVO_AUTH_ID));
 assert.ok(!raw.includes(present.AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER));
 assert.equal(new Set(list.map(x=>x.id)).size,list.length);
});

test('missing secrets, voice prompt, wrong caller or origin remain pending',()=>{
 const s=buildPlivoReadinessSnapshot({
  ...present,
  PLIVO_AUTH_TOKEN:'invalid',
  AR3D_PLIVO_CALLER_NUMBER:'+912269833332',
  AR3D_SCRIPTED_PILOT_ORIGIN:'https://attacker.example.com',
  AR3D_PLIVO_RECORDING_AUTH:'no',
  AR3D_SCRIPTED_PILOT_TENANT_ID:'bad-tenant'
 });
 const list=productionSetupActions(s,[{language:'hi',ready:false}]);
 const by=Object.fromEntries(list.map(x=>[x.id,x]));
 for(const name of ['plivo_secrets','caller','callback','hindi_audio','recording','recipient'])
  assert.equal(by[name].ready,false,'unsafe config considered ready: '+name);
 assert.equal(s.approvedLocalCallerBinding,false);
 assert.equal(s.productionOriginMatched,false);
});

test('R2 metadata and configured pilot can never prove traffic authorization or successful call',()=>{
 const s=buildPlivoReadinessSnapshot({...present,AR3D_SCRIPTED_CAMPAIGNS_ENABLED:'enabled'});
 const steps=productionSetupActions(s,audio);
 assert.equal(s.canClaimProductionReady,false);
 assert.equal(steps.find(x=>x.id==='customer_campaigns').ready,false);
 assert.equal(steps.find(x=>x.id==='internal_call').ready,false);
 assert.equal(steps.find(x=>x.id==='traffic').ready,false);
});
