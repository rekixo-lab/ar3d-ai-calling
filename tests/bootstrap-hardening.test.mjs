import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';

const site='https://ar3d-ai-calling.demo.workers.dev';
test('only simulator page can request browser microphone permission',async()=>{
  const app=await worker.fetch(new Request(site+'/app'));
  const simulator=await worker.fetch(new Request(site+'/app/simulator'));
  assert.equal(app.status,200);
  assert.equal(simulator.status,200);
  assert.match(app.headers.get('permissions-policy')||'',/microphone=\(\)/);
  assert.match(simulator.headers.get('permissions-policy')||'',/microphone=\(self\)/);
  assert.match(simulator.headers.get('content-security-policy')||'',/script-src 'self'/);
  assert.match(simulator.headers.get('content-security-policy')||'',/frame-ancestors 'none'/);
});
test('one-time bootstrap streaming request rejects >16 KiB BEFORE D1 access',async()=>{
  let dbReads=0;
  const secret='B'.repeat(48);
  const env={ADMIN_BOOTSTRAP_TOKEN:secret,CONTROL_DB:{prepare(){dbReads++;throw Error('DB must not be called')}}};
  const response=await worker.fetch(new Request(site+'/v1/human/bootstrap',{
    method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},
    body:JSON.stringify({email:'demo@example.test',password:'P'.repeat(17000)})
  }),env);
  assert.equal(response.status,400);
  assert.equal(dbReads,0);
  assert.match((await response.json()).error,/body/i);
});
