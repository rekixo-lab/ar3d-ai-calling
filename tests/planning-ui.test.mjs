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
