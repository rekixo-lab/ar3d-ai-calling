// CRM Step 3: real Worker routes backed by migrated, isolated SQLite D1 fixtures.
// No live CRM, telecom provider, keys, numbers or external calls are touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {parseLeadCsv} from '../src/csv-import.mjs';
import {fixture,tid,at} from './helpers/calling-fixture.mjs';
import {newSession,COOKIE} from '../src/human-auth.mjs';

const base='https://calling.example.test';
const other='77777777-7777-4777-8777-777777777777';
const csv='Name,Mobile,Preferred Location,Requirements\nExisting CSV name,9000000001,New unwanted location,please overwrite\nNew customer,9000000008,Raipur,1500 sqft plot';
const validBody=tenantId=>({tenantId,format:'csv',csv});
async function send(f,token,route,body){
 return worker.fetch(new Request(base+'/v1/human/import/'+route,{
  method:'POST',headers:{cookie:COOKIE+'='+token,origin:base,'content-type':'application/json'},
  body:JSON.stringify(body)
 }),f.env);
}
function secondTenant(f){
 f.c.db.prepare(`INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at)
   VALUES(?,'second-crm-builder','Second CRM Builder','starter','shared','active',?,?)`)
  .run(other,at,at);
 f.c.db.prepare(`INSERT INTO tenant_memberships(tenant_id,user_id,role,created_at) VALUES(?,'viewer','client_admin',?)`)
  .run(other,at);
}

test('CSV and XLSX-common parser requires a printable customer name and exact Name header',()=>{
 for(const input of [
  'Mobile,Preferred Location\n9000000008,Raipur',
  'Name,Mobile\n,9000000008',
  'Name,Mobile\n   ,9000000008',
  'Name,Mobile\nInvalid\\u0000Name,9000000008'.replace('\\u0000','\u0000'),
  'Name,Mobile,Preferred Location\nTest,9000000008,Bad\\u0001place'.replace('\\u0001','\u0001'),
  'Name,Mobile\nNew,9000000008\n,9000000009'
 ])assert.throws(()=>parseLeadCsv(input),/Name|name|location/);
 assert.equal(parseLeadCsv('Customer Name,Mobile\nपंकज कुमार,9000000008')[0].name,'पंकज कुमार');
});

test('CSV preview and commit remain tenant-scoped; existing customers are never overwritten',async()=>{
 const f=fixture();
 try{
  secondTenant(f);
  const own=await newSession(f.env.CONTROL_DB,'client');
  const adminOther=await newSession(f.env.CONTROL_DB,'viewer');
  const previewA=await send(f,own,'preview',validBody(tid));
  assert.equal(previewA.status,200,await previewA.clone().text());
  const a=await previewA.json();
  assert.equal(a.rows,2);assert.equal(a.existingCount,1);assert.equal(a.wouldInsert,1);
  assert.equal(a.preview[0].alreadyInCrm,true);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM leads').get().n,1);

  const before=f.r.db.prepare("SELECT name,preferred_location,consent_status,dnd_status FROM leads WHERE tenant_id=? AND mobile_e164='+919000000001'")
   .get(tid);
  const importedA=await send(f,own,'commit',validBody(tid));
  assert.equal(importedA.status,201,await importedA.clone().text());
  assert.deepEqual(((await importedA.json())),{
   processed:2,inserted:1,skipped:1,
   notice:'Imported records have unknown consent and DND status. No calls were placed.'
  });
  const after=f.r.db.prepare("SELECT name,preferred_location,consent_status,dnd_status FROM leads WHERE tenant_id=? AND mobile_e164='+919000000001'")
   .get(tid);
  assert.deepEqual(after,before);
  const newLead=f.r.db.prepare("SELECT name,preferred_location,requirements_json,consent_status,dnd_status FROM leads WHERE tenant_id=? AND mobile_e164='+919000000008'")
   .get(tid);
  assert.equal(newLead.name,'New customer');
  assert.equal(newLead.preferred_location,'Raipur');
  assert.deepEqual(JSON.parse(newLead.requirements_json),{raw:'1500 sqft plot'});
  assert.equal(newLead.consent_status,'unknown');
  assert.equal(newLead.dnd_status,'unknown');
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM crm_audit_events WHERE tenant_id=? AND action=?')
   .get(tid,'leads.csv_import').n,1);

  const replay=await send(f,own,'commit',validBody(tid));
  assert.equal(replay.status,201);
  const retry=await replay.json();
  assert.equal(retry.inserted,0);assert.equal(retry.skipped,2);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM leads WHERE tenant_id=?').get(tid).n,2);

  const previewB=await send(f,adminOther,'preview',validBody(other));
  assert.equal(previewB.status,200);
  assert.equal((await previewB.json()).existingCount,0);
  const importedB=await send(f,adminOther,'commit',validBody(other));
  assert.equal(importedB.status,201,await importedB.clone().text());
  assert.equal((await importedB.json()).inserted,2);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM leads WHERE tenant_id=?').get(other).n,2);
  assert.equal(f.r.db.prepare("SELECT name FROM leads WHERE tenant_id=? AND mobile_e164='+919000000001'").get(other).name,'Existing CSV name');
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM crm_audit_events WHERE tenant_id=? AND action=?').get(other,'leads.csv_import').n,1);
 }finally{f.close()}
});

test('CSV rejects unknown/invalid names before any tenant CRM changes, even with valid rows in the file',async()=>{
 const f=fixture();
 try{
  const token=await newSession(f.env.CONTROL_DB,'client');
  const start=f.r.db.prepare('SELECT COUNT(*) AS n FROM leads').get().n;
  const badCsv='Name,Mobile\nValid test,9000000008\n,9000000009';
  for(const route of ['preview','commit']){
   const r=await send(f,token,route,{tenantId:tid,csv:badCsv});
   assert.equal(r.status,400,await r.clone().text());
   const body=await r.json();
   assert.match(body.error,/name/);
  }
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM leads').get().n,start);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='leads.csv_import'").get().n,0);
 }finally{f.close()}
});

test('A viewer cannot import into a company where they have read-only access',async()=>{
 const f=fixture();
 try{
  const token=await newSession(f.env.CONTROL_DB,'viewer');
  assert.equal((await send(f,token,'preview',validBody(tid))).status,403);
  assert.equal((await send(f,token,'commit',validBody(tid))).status,403);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM leads').get().n,1);
 }finally{f.close()}
});
