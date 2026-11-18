import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
const tenant='22222222-2222-4222-8222-222222222222';
const other='44444444-4444-4444-8444-444444444444';
const visit='33333333-3333-4333-8333-333333333333';
const cookie='ar3d_calling_session='+'a'.repeat(64);
function req(path,data={tenantId:tenant,status:'confirmed'},origin=true){
  return new Request('https://demo.test'+path,{method:'PATCH',
    headers:{cookie,...(origin?{origin:'https://demo.test'}:{}),'content-type':'application/json'},
    body:JSON.stringify(data)});
}
function fixture(role='client_admin',current='requested'){
  const log=[];
  const CONTROL_DB={prepare(sql){return {bind(...params){log.push({sql,params});return {
    async first(){
      if(sql.includes('FROM human_sessions'))return {id:'u',email:'u@example.test',globalRole:'user'};
      if(sql.includes('FROM tenant_memberships'))return params[0]===tenant?
        {tenant_id:tenant,role,status:'active',storage_mode:'shared'}:null;
      return null;
    }
  }}}}};
  const CRM_DB={prepare(sql){return {bind(...params){log.push({sql,params});return {
    async first(){if(sql.includes('FROM site_visits'))return current?{id:visit,status:current}:null;return null}
  }}}},async batch(rows){return rows.map(()=>({meta:{changes:1}}))}};
  return {env:{CONTROL_DB,CRM_DB},log};
}
test('client admin confirms requested visit and audits without calling',async()=>{
  const f=fixture(),r=await worker.fetch(req('/v1/human/visits/'+visit),f.env);
  assert.equal(r.status,200);assert.equal((await r.json()).status,'confirmed');
  assert.ok(f.log.some(x=>x.sql.includes('UPDATE site_visits SET status')));
  assert.ok(f.log.some(x=>x.sql.includes('visit.status_changed')));
  assert.ok(!f.log.some(x=>x.sql.includes('INSERT INTO calls')));
});
test('viewer, foreign tenant and cross-origin updates denied',async()=>{
  const url='/v1/human/visits/'+visit;
  assert.equal((await worker.fetch(req(url),fixture('viewer').env)).status,403);
  assert.equal((await worker.fetch(req(url,{tenantId:other,status:'confirmed'}),fixture().env)).status,403);
  assert.equal((await worker.fetch(req(url,{tenantId:tenant,status:'confirmed'},false),fixture().env)).status,403);
});
test('visit state machine rejects terminal, invalid statuses and unknown fields',async()=>{
  const url='/v1/human/visits/'+visit;
  assert.equal((await worker.fetch(req(url,{tenantId:tenant,status:'completed'}),fixture().env)).status,409);
  assert.equal((await worker.fetch(req(url,{tenantId:tenant,status:'confirmed'}),fixture('client_admin','cancelled').env)).status,409);
  assert.equal((await worker.fetch(req(url,{tenantId:tenant,status:'active'}),fixture().env)).status,400);
  assert.equal((await worker.fetch(req(url,{tenantId:tenant,status:'confirmed',phoneNumber:'123'}),fixture().env)).status,400);
  assert.equal((await worker.fetch(req(url),fixture('client_admin',null).env)).status,404);
  assert.equal((await worker.fetch(req(url,{tenantId:tenant,status:'completed'}),fixture('client_admin','confirmed').env)).status,200);
});
