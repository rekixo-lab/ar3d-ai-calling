import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {js} from '../src/app-assets.mjs';
test('planning UI has valid browser JS and no call launch UI',()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  assert.match(js,/Calling Campaign Drafts/);
  assert.match(js,/AR3D Project Links/);
  assert.match(js,/No call started/);
  assert.doesNotMatch(js,/\/v1\/human\/calls\/start/);
});

test('CRM campaign editor has bounded candidate and lead paging controls',()=>{
  assert.match(js,/Previous candidates/);
  assert.match(js,/Next candidates/);
  assert.match(js,/candidateSearch/);
  assert.match(js,/offset='\+candidateOffset/);
});
