import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {js,css} from '../src/app-assets.mjs';

test('client workspace is divided into four practical tabs without dropping any previous workflow',()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  for(const name of ['Customers / Excel','Calling','Company / AI','Results / CRM'])assert.ok(js.includes(name));
  assert.match(js,/section\.hidden=name!==key/);
  assert.match(js,/await crmWorkflow\(id,sections\.customers,d\.role,content\)/);
  assert.match(js,/await customerCallingPanel\(id,sections\.calling,d\.role\)/);
  assert.match(js,/await callingScriptEditor\(id,sections\.company\)/);
  assert.match(js,/await usageAndExport\(id,reports,d\.role\)/);
  assert.match(js,/await voicebotReviewPanel\(id,reports,content\)/);
  assert.match(js,/state\.clientTab=key/);
  assert.ok(js.includes('client-reports'));
  assert.match(css,/\.client-content/);
});
