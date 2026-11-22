import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {js,css} from '../src/app-assets.mjs';

test('client workspace shows the four primary views through one navigation',()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  for(const name of ['Customers / Excel','Calling','Company details','Results / CRM'])assert.ok(js.includes(name));
  assert.match(js,/section\.hidden=name!==key/);
  assert.match(js,/aria-current/);
  assert.match(js,/campaignResultsPanel\(id,section\)/);
  assert.match(js,/Import & prepare campaign/);
  assert.match(js,/client-reports/);
  assert.doesNotMatch(js,/Advanced campaign planning and project links|Publish AI agent for calls/);
  assert.match(css,/\.client-content/);
});
