import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,lead,client,at} from './helpers/calling-fixture.mjs';
import {handleNextActionsRequest} from '../src/next-actions-routes.mjs';

const now=Date.parse('2026-11-23T11:30:00.000Z');
const req=(tenant=tid,query='',method='GET')=>new Request(
 'https://app.example.invalid/v1/human/next-actions?tenantId='+tenant+query,{method});
const fetchActions=(f,user=client,query='',method='GET')=>
 handleNextActionsRequest(req(tid,query,method),f.env,user,{now});

test('client sees due follow-ups and upcoming visits only for own company without calls',async()=>{
 const f=fixture();
 try{
  const due=new Date(now+86400000).toISOString();
  const visit=new Date(now+2*86400000).toISOString();
  f.r.db.prepare("UPDATE leads SET followup_at=?,interest_status='followup' WHERE tenant_id=? AND id=?")
   .run(due,tid,lead);
  const vid='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  f.r.db.prepare("INSERT INTO site_visits(tenant_id,id,lead_id,scheduled_at,status,created_at) VALUES(?,?,?,?, 'confirmed',?)")
   .run(tid,vid,lead,visit,at);
  const prior=f.r.db.prepare('SELECT total_changes() AS n').get().n;
  const r=await fetchActions(f);
  assert.equal(r.status,200,await r.clone().text());
  const d=await r.json();
  assert.equal(d.followups.length,1);
  assert.equal(d.visits.length,1);
  assert.equal(d.followups[0].customer,'Fictional buyer');
  assert.equal(d.followups[0].dueAt,due);
  assert.equal(d.followups[0].canAutoDial,false);
  assert.equal(d.visits[0].status,'confirmed');
  assert.equal(d.visits[0].reminderSent,false);
  assert.equal(d.automaticCallsScheduled,0);
  assert.equal(d.notificationsSent,0);
  assert.equal(f.r.db.prepare('SELECT total_changes() AS n').get().n,prior);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_jobs').get().n,0);
 }finally{f.close()}
});

test('blocked or opted-out lead stays visible only as do_not_call task',async()=>{
 const f=fixture();
 try{
  f.r.db.prepare("UPDATE leads SET consent_status='denied',dnd_status='blocked',followup_at=? WHERE tenant_id=? AND id=?")
   .run(new Date(now+600000).toISOString(),tid,lead);
  const r=await fetchActions(f);
  assert.equal(r.status,200);
  const d=await r.json();
  assert.equal(d.followups[0].status,'do_not_call');
  assert.equal(d.followups[0].canAutoDial,false);
 }finally{f.close()}
});

test('next actions rejects foreign companies, unexpected params, writes and overbroad window',async()=>{
 const f=fixture();
 try{
  assert.equal((await handleNextActionsRequest(req('99999999-9999-4999-8999-999999999999'),f.env,client,{now})).status,403);
  assert.equal((await handleNextActionsRequest(req(tid,'&delete=true'),f.env,client,{now})).status,400);
  assert.equal((await handleNextActionsRequest(req(tid,'&days=10000'),f.env,client,{now})).status,400);
  assert.equal((await handleNextActionsRequest(req(tid,'&tenantId='+tid),f.env,client,{now})).status,400);
  assert.equal((await fetchActions(f,client,'','POST')).status,405);
 }finally{f.close()}
});
