import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {js,css} from '../src/app-assets.mjs';

test('client workspace shows daily views with AI practice inside Calling',()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  for(const name of ['Customers / Excel','Practice with AI','Calling','Company details','Results / CRM'])assert.ok(js.includes(name));
  assert.match(js,/section\.hidden=name!==key/);
  assert.match(js,/aria-current/);
  assert.match(js,/campaignResultsPanel\(id,section,d\.role\)/);
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
  assert.match(js,/aiTestingPanel\(practice,id,d.role\)/);
  const code=js.slice(js.indexOf('function aiTestingPanel('),js.indexOf('function manualCustomerPanel('));
  assert.match(code,/action:'start'/);
  assert.match(code,/action:'turn'/);
  assert.match(code,/By default results are not saved/i);
  assert.match(code,/\/v1\/human\/ai-test-crm/);
  assert.match(code,/canSave&&autoSave.checked/);
  assert.doesNotMatch(code,/\/v1\/human\/calls\/start|\/v1\/human\/calling\/runs/);
});

test('Operations & Security Report is tenant scoped, aggregate-only and cannot retry a call',()=>{
  assert.match(js,/function operationsReportPanel\(tenantId,content\)/);
  assert.match(js,/operationsReportPanel\(id,section\)/);
  const panel=js.slice(js.indexOf('function operationsReportPanel('),js.indexOf('function campaignResultsPanel('));
  assert.match(panel,/\/v1\/human\/operations\/report\?tenantId=/);
  assert.match(panel,/Unknown provider outcomes/);
  assert.match(panel,/must be reviewed manually/);
  assert.doesNotMatch(panel,/\/v1\/human\/calling\/runs|action:'start'|\.startCall\(/);
});


test('both admin and client use charcoal theme, scoped ledger and reduced motion',()=>{
 assert.match(css,/color-scheme: dark/);assert.match(css,/background: #212121/);assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(js,/function adminDashboard\(main,openView\)/);assert.match(js,/\/v1\/human\/credits\/admin-dashboard/);
 const overview=js.slice(js.indexOf('async function renderClient('),js.indexOf('function aiTestingPanel('));
 assert.match(overview,/\/v1\/human\/credits\/minute-ledger\?tenantId=/);assert.doesNotMatch(overview,/\/v1\/human\/credits\/admin-dashboard/);
 assert.match(overview,/uncommittedSeconds/);assert.match(overview,/content\.renderVersion===version/);
});

test('client workspace opens on Home and restores the tab from the URL after refresh',()=>{
 assert.match(js,/\['home','Home','grid'/);
 assert.match(js,/clientTab:'home'/);
 assert.match(js,/if\(items\.some\(x=>x\[0\]===hashTab\)\)state\.clientTab=hashTab;/);
 assert.match(js,/sections\.home\.append\(overview\)/);
 // Duplicated counts table and repeated overview on every tab were removed.
 assert.doesNotMatch(js,/table\(\['Measure','Count'\]/);
 assert.doesNotMatch(js,/content\.replaceChildren\(overview,/);
});

test('rarely used admin review and provider tools are folded away from daily work',()=>{
 assert.match(js,/Advanced · provider safety, settlement and funding review/);
 assert.match(js,/aria-label':'Needs attention'/);
 assert.match(js,/Provider costs & reports/);
 assert.match(js,/Test tools · verify last call/);
});
