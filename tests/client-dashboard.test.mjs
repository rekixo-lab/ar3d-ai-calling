// Client Dashboard tenancy regression: the selected company must be authorized
// by the server, not only by a browser dropdown or URL query parameter.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {fixture,tid,at} from './helpers/calling-fixture.mjs';
import {newSession,COOKIE} from '../src/human-auth.mjs';

const otherTenant='77777777-7777-4777-8777-777777777777';
const otherLead='88888888-8888-4888-8888-888888888888';
const base='https://calling.example.test';
function seedSecondCompany(f){
 f.c.db.prepare(`INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at)
  VALUES(?,'secondary-builder','Secondary Builder','starter','shared','active',?,?)`).run(otherTenant,at,at);
 f.c.db.prepare(`INSERT INTO tenant_memberships(tenant_id,user_id,role,created_at)
  VALUES(?,'viewer','client_admin',?)`).run(otherTenant,at);
 f.r.db.prepare(`INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at)
  VALUES(?,?,'Secondary-only buyer','+919000000080','excel',?,?)`).run(otherTenant,otherLead,at,at);
}
async function get(f,token,path){
 return worker.fetch(new Request(base+path,{headers:{cookie:COOKIE+'='+token}}),f.env);
}
async function post(f,token,path,data){
 return worker.fetch(new Request(base+path,{
  method:'POST',headers:{cookie:COOKIE+'='+token,origin:base,'content-type':'application/json'},
  body:JSON.stringify(data)
 }),f.env);
}

test('a single-company client cannot access another builder by changing tenantId',async()=>{
 const f=fixture();
 try{
  seedSecondCompany(f);
  const token=await newSession(f.env.CONTROL_DB,'client');
  const me=await get(f,token,'/v1/human/me');
  assert.equal(me.status,200);
  const own=(await me.json()).tenants;
  assert.deepEqual(own.map(x=>x.id),[tid]);
  const good=await get(f,token,'/v1/human/overview?tenantId='+tid);
  assert.equal(good.status,200);
  assert.equal((await good.json()).metrics.leads,1);
  for(const path of [
   '/v1/human/overview?tenantId='+otherTenant,
   '/v1/human/leads?tenantId='+otherTenant,
   '/v1/human/campaigns?tenantId='+otherTenant,
   '/v1/human/usage?tenantId='+otherTenant,
   '/v1/human/company-profile?tenantId='+otherTenant
  ]){
   const response=await get(f,token,path);
   assert.equal(response.status,403,path);
   assert.equal(JSON.stringify(await response.json()).includes('Secondary-only buyer'),false);
  }
  assert.equal((await get(f,token,'/v1/human/me?tenantId='+otherTenant)).status,200);
  const denied=await post(f,token,'/v1/human/leads',
   {tenantId:otherTenant,name:'Forged client insert',mobile:'9000000091',sourceType:'other'});
  assert.equal(denied.status,403);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM leads WHERE tenant_id=?').get(otherTenant).n,1);
 }finally{f.close()}
});

test('a member of two companies sees isolated CRM records and each company-specific role',async()=>{
 const f=fixture();
 try{
  seedSecondCompany(f);
  const token=await newSession(f.env.CONTROL_DB,'viewer');
  const me=await get(f,token,'/v1/human/me');
  assert.equal(me.status,200);
  const tenants=(await me.json()).tenants;
  assert.deepEqual(tenants.map(x=>[x.name,x.role]),[['Demo','viewer'],['Secondary Builder','client_admin']]);
  const first=await get(f,token,'/v1/human/overview?tenantId='+tid);
  const second=await get(f,token,'/v1/human/overview?tenantId='+otherTenant);
  assert.equal(first.status,200);
  assert.equal(second.status,200);
  const a=await first.json(),b=await second.json();
  assert.equal(a.role,'viewer');
  assert.equal(b.role,'client_admin');
  assert.equal(a.tenant.name,'Demo');
  assert.equal(b.tenant.name,'Secondary Builder');
  assert.equal(a.metrics.leads,1);
  assert.equal(b.metrics.leads,1);
  const aLeads=await get(f,token,'/v1/human/leads?tenantId='+tid);
  const bLeads=await get(f,token,'/v1/human/leads?tenantId='+otherTenant);
  assert.deepEqual((await aLeads.json()).leads.map(x=>x.name),['Fictional buyer']);
  assert.deepEqual((await bLeads.json()).leads.map(x=>x.name),['Secondary-only buyer']);
  const viewerWrite=await post(f,token,'/v1/human/leads',
   {tenantId:tid,name:'Viewer must not write',mobile:'9000000092',sourceType:'other'});
  assert.equal(viewerWrite.status,403);
  const adminWrite=await post(f,token,'/v1/human/leads',
   {tenantId:otherTenant,name:'Authorized insert',mobile:'9000000092',sourceType:'other'});
  assert.equal(adminWrite.status,201,await adminWrite.text());
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM leads WHERE tenant_id=?').get(tid).n,1);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM leads WHERE tenant_id=?').get(otherTenant).n,2);
 }finally{f.close()}
});

test('disabled/suspended company membership loses API data access even with an existing login session',async()=>{
 const f=fixture();
 try{
  seedSecondCompany(f);
  const token=await newSession(f.env.CONTROL_DB,'viewer');
  f.c.db.prepare("UPDATE tenant_memberships SET status='disabled' WHERE tenant_id=? AND user_id='viewer'").run(tid);
  const me=await get(f,token,'/v1/human/me');
  assert.deepEqual((await me.json()).tenants.map(t=>t.id),[otherTenant]);
  assert.equal((await get(f,token,'/v1/human/overview?tenantId='+tid)).status,403);
  assert.equal((await get(f,token,'/v1/human/overview?tenantId='+otherTenant)).status,200);
  f.c.db.prepare("UPDATE tenants SET suspended_from_status=status,status='suspended' WHERE id=?").run(otherTenant);
  assert.deepEqual((await (await get(f,token,'/v1/human/me')).json()).tenants,[]);
  assert.equal((await get(f,token,'/v1/human/overview?tenantId='+otherTenant)).status,403);
 }finally{f.close()}
});
