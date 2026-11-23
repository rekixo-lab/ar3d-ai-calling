import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,lead,client} from './helpers/calling-fixture.mjs';
import {handleVisitStatusRequest} from '../src/visit-status-routes.mjs';

const id='aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const url='https://app.example.invalid/v1/human/visits/'+id;
const request=d=>new Request(url,{
 method:'PATCH',headers:{origin:'https://app.example.invalid','content-type':'application/json'},body:JSON.stringify(d)
});
const params=(oldTime,nextTime,extra={})=>({
 tenantId:tid,action:'reschedule',expectedScheduledAt:oldTime,scheduledAt:nextTime,...extra
});
function create(f,when,status='requested'){
 f.r.db.prepare('INSERT INTO site_visits(tenant_id,id,lead_id,scheduled_at,status,created_at) VALUES(?,?,?,?,?,?)')
  .run(tid,id,lead,when,status,new Date().toISOString());
}

test('client reschedules an upcoming visit in own CRM with audit, no telecom activity',async()=>{
 const f=fixture();
 try{
  const old=new Date(Date.now()+2*86400000).toISOString();
  const fresh=new Date(Date.now()+3*86400000).toISOString();
  create(f,old);
  const out=await handleVisitStatusRequest(request(params(old,fresh)),f.env,client);
  assert.equal(out.status,200,await out.clone().text());
  const d=await out.json();
  assert.equal(d.scheduledAt,fresh);
  assert.equal(d.status,'requested');
  assert.equal(d.reminderSent,false);
  assert.equal(f.r.db.prepare('SELECT scheduled_at AS at,status FROM site_visits WHERE tenant_id=? AND id=?')
   .get(tid,id).at,fresh);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE tenant_id=? AND action='visit.rescheduled'").get(tid).n,1);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
  const stale=await handleVisitStatusRequest(request(params(old,fresh)),f.env,client);
  assert.equal(stale.status,409);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE tenant_id=? AND action='visit.rescheduled'").get(tid).n,1);
 }finally{f.close()}
});

test('reschedule refuses unauthorized, cross-tenant, terminal visits and unsafe dates',async()=>{
 const f=fixture();
 try{
  const old=new Date(Date.now()+2*86400000).toISOString();
  const future=new Date(Date.now()+3*86400000).toISOString();
  create(f,old,'confirmed');
  const viewer={id:'viewer',globalRole:'user'};
  assert.equal((await handleVisitStatusRequest(request(params(old,future)),f.env,viewer)).status,403);
  assert.equal((await handleVisitStatusRequest(request(params(old,future,{tenantId:'99999999-9999-4999-8999-999999999999'})),f.env,client)).status,403);
  assert.equal((await handleVisitStatusRequest(request(params(old,new Date(Date.now()-3600000).toISOString())),f.env,client)).status,400);
  assert.equal((await handleVisitStatusRequest(request(params(old,future,{callerId:'+911111111111'})),f.env,client)).status,400);
  assert.equal((await handleVisitStatusRequest(request(params(old,future,{expectedScheduledAt:'2020-01-01T00:00:00.000Z'})),f.env,client)).status,409);
  f.r.db.prepare("UPDATE site_visits SET status='cancelled' WHERE tenant_id=? AND id=?").run(tid,id);
  assert.equal((await handleVisitStatusRequest(request(params(old,future)),f.env,client)).status,409);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='visit.rescheduled'").get().n,0);
 }finally{f.close()}
});
