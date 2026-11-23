import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,lead,client} from './helpers/calling-fixture.mjs';
import {handleLeadStaffRequest} from '../src/lead-staff-routes.mjs';

const base='https://app.example.invalid/v1/human/lead-staff';
const get=(tidParam=tid,id=lead)=>new Request(base+'?'+new URLSearchParams({tenantId:tidParam,leadId:id}));
const post=(body)=>new Request(base,{
 method:'POST',headers:{Origin:'https://app.example.invalid','content-type':'application/json'},
 body:JSON.stringify(body)
});

test('client admin can assign existing company sales member with audit and no call',async()=>{
 const f=fixture();
 try{
  const first=await handleLeadStaffRequest(get(),f.env,client);
  assert.equal(first.status,200,await first.clone().text());
  const data=await first.json();
  assert.equal(data.assignedUserId,null);
  assert.ok(data.members.some(m=>m.id==='client'));
  assert.ok(data.members.some(m=>m.id==='viewer'));
  assert.ok(!JSON.stringify(data).includes('+919000000001'));
  const prior=f.r.db.prepare('SELECT total_changes() AS n').get().n;
  const changed=await handleLeadStaffRequest(post({
   tenantId:tid,leadId:lead,userId:'viewer',expectedUserId:null
  }),f.env,client);
  assert.equal(changed.status,200,await changed.clone().text());
  assert.equal((await changed.json()).assignedUserId,'viewer');
  assert.ok(f.r.db.prepare('SELECT total_changes() AS n').get().n>prior);
  assert.equal(f.r.db.prepare('SELECT user_id AS u FROM lead_staff_assignments WHERE tenant_id=? AND lead_id=?').get(tid,lead).u,'viewer');
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE tenant_id=? AND action='lead.staff_assigned'").get(tid).n,1);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_jobs').get().n,0);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
  const stale=await handleLeadStaffRequest(post({
   tenantId:tid,leadId:lead,userId:'client',expectedUserId:null
  }),f.env,client);
  assert.equal(stale.status,409);
  const unassign=await handleLeadStaffRequest(post({
   tenantId:tid,leadId:lead,userId:null,expectedUserId:'viewer'
  }),f.env,client);
  assert.equal(unassign.status,200);
  assert.equal(f.r.db.prepare('SELECT user_id AS u FROM lead_staff_assignments WHERE tenant_id=? AND lead_id=?').get(tid,lead).u,null);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='lead.staff_assigned'").get().n,2);
 }finally{f.close()}
});

test('staff assignments deny viewers, outsiders, bad lead IDs and forged staff',async()=>{
 const f=fixture();
 try{
  const viewer={id:'viewer',globalRole:'user'};
  assert.equal((await handleLeadStaffRequest(get(),f.env,viewer)).status,403);
  assert.equal((await handleLeadStaffRequest(post({
   tenantId:tid,leadId:lead,userId:'viewer',expectedUserId:null
  }),f.env,viewer)).status,403);
  const foreign='99999999-9999-4999-8999-999999999999';
  assert.equal((await handleLeadStaffRequest(get(foreign),f.env,client)).status,403);
  assert.equal((await handleLeadStaffRequest(post({
   tenantId:tid,leadId:lead,userId:'attacker',expectedUserId:null
  }),f.env,client)).status,400);
  assert.equal((await handleLeadStaffRequest(post({
   tenantId:tid,leadId:foreign,userId:'viewer',expectedUserId:null
  }),f.env,client)).status,404);
  assert.equal((await handleLeadStaffRequest(
   new Request(base+'?tenantId='+tid+'&leadId='+lead+'&leadId='+lead),f.env,client)).status,400);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM lead_staff_assignments').get().n,0);
 }finally{f.close()}
});
