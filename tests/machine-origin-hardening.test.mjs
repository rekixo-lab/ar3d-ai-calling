import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';

const target='https://aicalling.ar3dstudio.in/v1/me';
const env={CONTROL_DB:{}};

test('machine endpoint fails closed on malformed or other-origin requests',async()=>{
  for(const origin of ['%%%', 'null','https://example.invalid',
    'http://aicalling.ar3dstudio.in','https://aicalling.ar3dstudio.in.evil.invalid']){
    const res=await worker.fetch(new Request(target,{headers:{Origin:origin}}),env);
    assert.equal(res.status,403,origin);
    const body=await res.json();
    assert.equal(body.error,'cross-origin request not allowed');
  }
});

test('matching or omitted Origin does not grant machine credentials',async()=>{
  const matching=await worker.fetch(new Request(target,{
    headers:{Origin:'https://aicalling.ar3dstudio.in'}
  }),env);
  assert.equal(matching.status,401);
  const omitted=await worker.fetch(new Request(target),env);
  assert.equal(omitted.status,401);
});
