import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {js,css} from '../src/app-assets.mjs';

test('client workspace shows five primary views including independent AI Testing',()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  for(const name of ['Customers / Excel','AI Testing','Calling','Company details','Results / CRM'])assert.ok(js.includes(name));
  assert.match(js,/section\.hidden=name!==key/);
  assert.match(js,/aria-current/);
  assert.match(js,/campaignResultsPanel\(id,section\)/);
  assert.match(js,/Import & prepare campaign/);
  assert.match(js,/client-reports/);
  assert.doesNotMatch(js,/Advanced campaign planning and project links|Publish AI agent for calls/);
  assert.match(css,/\.client-content/);
});

test('client overview shows only the selected tenant CRM counts and current role',()=>{
  assert.match(js,/function clientDashboardOverview\(data,onRefresh\)/);
  assert.match(js,/clientDashboardOverview\(d,\(\)=>renderClient\(id,content\)\)/);
  assert.match(js,/if\(roleLabel\)roleLabel\.textContent=d\.role==='client_admin'/);
  assert.match(js,/Client Admin · Can manage customers/);
  assert.match(js,/Viewer · Read-only/);
  assert.match(js,/content\.replaceChildren\(node\('p',\{class:'muted',text:'Loading workspace…'\}\)\)/);
  assert.match(css,/\.client-summary/);
  assert.match(css,/\.client-metrics/);
});

test('AI Testing UI defaults to preview only; explicit auto-save is scoped to selected CRM customer',()=>{
  assert.match(js,/function aiTestingPanel\(content,tenantId,role\)/);
  assert.match(js,/'ai-test':section=>aiTestingPanel\(section,id,d.role\)/);
  const code=js.slice(js.indexOf('function aiTestingPanel('),js.indexOf('function manualCustomerPanel('));
  assert.match(code,/action:'start'/);
  assert.match(code,/action:'turn'/);
  assert.match(code,/By default results are not saved/i);
  assert.match(code,/\/v1\/human\/ai-test-crm/);
  assert.match(code,/canSave&&autoSave.checked/);
  assert.doesNotMatch(code,/\/v1\/human\/calls\/start|\/v1\/human\/calling\/runs/);
});
