import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../src/index.mjs';
import {js} from '../src/app-assets.mjs';
import {ownSipSetup} from '../src/own-sip-readiness.mjs';

const site='https://aicalling.ar3dstudio.in';
const url=site+'/v1/human/engineering/own-sip-setup';
const cookie='ar3d_calling_session='+'a'.repeat(64);
const env=(role='super_admin')=>{
  const queries=[];
  return {
    queries,
    value:{CONTROL_DB:{prepare(sql){
      queries.push(sql);
      if(!sql.includes('FROM human_sessions'))
        throw Error('no client database or provider should be touched');
      return {bind(){return {first:async()=>({id:'test-operator',globalRole:role,
        email:'test@example.invalid'})}}};
    }}}
  };
};
test('own SIP route is honestly no-Exotel but 140 caller number never sufficient alone',()=>{
  const p=ownSipSetup();
  assert.equal(p.exotelRequired,false);
  assert.equal(p.method,'self_hosted_Asterisk_plus_authorized_telecom_SIP_trunk');
  assert.equal(p.callerNumberOnlySufficient,false);
  assert.equal(p.actual140NumberAssigned,false);
  assert.equal(p.authorizedSipTrunkConnected,false);
  assert.equal(p.liveOutboundEnabled,false);
  assert.equal(p.voiceToCrmLive,false);
  assert.equal(p.needsAlwaysOnPbxHost,true);
  assert.equal(p.paymentGatewayRequired,false);
  assert.equal(p.questions.length,2);
  for(const language of p.questions){
    assert.equal(language.plot.length,7);
    assert.equal(language.flat.length,7);
    assert.equal(language.plot[0],'propertyType');
    assert.equal(language.flat[3],'size');
  }
  assert.ok(p.steps.some(t=>t.id==='legal_sender'));
  assert.ok(p.steps.some(t=>t.id==='trunk'));
  assert.ok(p.steps.some(t=>t.id==='permissions'));
  assert.ok(p.steps.some(t=>t.id==='speech'));
  assert.ok(p.steps.every(t=>t.owner));
});
test('own SIP setup endpoint only allows authenticated Super Admin GET and never makes calls',async()=>{
  const f=env();
  const response=await worker.fetch(new Request(url,{headers:{Cookie:cookie}}),f.value);
  assert.equal(response.status,200);
  const j=await response.json();
  assert.equal(j.liveOutboundEnabled,false);
  assert.equal(j.callerNumberOnlySufficient,false);
  assert.equal(j.voiceToCrmLive,false);
  assert.equal(j.exotelRequired,false);
  assert.equal(f.queries.length,1);
  const client=env('user');
  assert.equal((await worker.fetch(new Request(url,{headers:{Cookie:cookie}}),client.value)).status,403);
  assert.equal((await worker.fetch(new Request(url),f.value)).status,401);
  const write=new Request(url,{method:'POST',headers:{Origin:site,Cookie:cookie}});
  assert.equal((await worker.fetch(write,f.value)).status,405);
  const forged=new Request(url,{method:'POST',headers:{Origin:'https://attacker.invalid',Cookie:cookie}});
  assert.equal((await worker.fetch(forged,f.value)).status,403);
  assert.ok(f.queries.every(x=>x.includes('FROM human_sessions')));
});
test('admin interface exposes Jio/SIP alternative without activating telecom calls',()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  assert.match(js,/Our Own Calling Engine — No Exotel Required/);
  assert.match(js,/A 140 caller number ALONE cannot place calls/);
  assert.match(js,/own-sip-setup/);
  assert.match(js,/Real 140 calls: NOT enabled/);
  assert.ok(!js.includes('/v1/human/calls/start'));
});
