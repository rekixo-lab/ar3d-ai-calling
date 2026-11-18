import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../src/index.mjs';
import {js} from '../src/app-assets.mjs';

const tenant='22222222-2222-4222-8222-222222222222';
const another='44444444-4444-4444-8444-444444444444';
const id='33333333-3333-4333-8333-333333333333';
const cookie='ar3d_calling_session='+'a'.repeat(64);
function req(path,method='GET',body=null,origin=true){
  return new Request('https://demo.test'+path,{method,headers:{cookie,...(origin?{origin:'https://demo.test'}:{}),
    ...(body?{'content-type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined});
}
function fixture(role='client_admin',agentStatus='draft'){
  const log=[];
  const CONTROL_DB={prepare(sql){return {bind(...params){log.push({type:'control',sql,params});return {
    async first(){
      if(sql.includes('FROM human_sessions'))return {id:'u1',email:'dev@example.test',globalRole:'user'};
      if(sql.includes('FROM tenant_memberships'))return params[0]===tenant?
        {tenant_id:tenant,role,storage_mode:'shared',status:'active'}:null;
      return null;
    }
  }}}}};
  const agent={id,displayName:'Demo agent',languageMode:'hi-en',questionsJson:'["Where would you like to buy?"]',status:agentStatus};
  const CRM_DB={prepare(sql){return {bind(...params){log.push({type:'crm',sql,params});return {
    async first(){
      if(sql.includes('FROM agents WHERE tenant_id=? AND id=?'))return agent;
      if(sql.includes('COUNT(*) AS total FROM crm_audit_events'))return {total:1};
      return null;
    },
    async all(){
      if(sql.includes('FROM agents WHERE'))return {results:[agent]};
      if(sql.includes('FROM crm_audit_events'))return {results:[{id:'event',actor:'human:u1',action:'lead.updated',createdAt:'2026-11-18T00:00:00Z'}]};
      return {results:[]};
    }
  }}}},async batch(statements){return statements.map(()=>({meta:{changes:1}}))}};
  return {env:{CONTROL_DB,CRM_DB},log};
}
test('tenant viewer can read agents but cannot edit; foreign tenant forbidden',async()=>{
  const r=await worker.fetch(req('/v1/human/agents?tenantId='+tenant),fixture('viewer').env);
  assert.equal(r.status,200);assert.equal((await r.json()).agents.length,1);
  const d={tenantId:tenant,displayName:'Updated'};
  assert.equal((await worker.fetch(req('/v1/human/agents/'+id,'PATCH',d),fixture('viewer').env)).status,403);
  assert.equal((await worker.fetch(req('/v1/human/agents?tenantId='+another),fixture().env)).status,403);
  assert.equal((await worker.fetch(req('/v1/human/agents/'+id,'PATCH',d,false),fixture().env)).status,403);
});
test('agent editor saves own draft with audit; no live calling',async()=>{
  const f=fixture();
  const r=await worker.fetch(req('/v1/human/agents/'+id,'PATCH',{tenantId:tenant,
    displayName:'Indore assistant',languageMode:'hi',questions:['कहाँ प्लॉट चाहिए?'],status:'paused'}),f.env);
  assert.equal(r.status,200);assert.equal((await r.json()).status,'paused');
  assert.ok(f.log.some(x=>x.sql.includes('UPDATE agents SET')));
  assert.ok(f.log.some(x=>x.sql.includes('agent.updated')));
  assert.ok(f.log.filter(x=>x.type==='crm').every(x=>x.params.includes(tenant)));
  assert.ok(!f.log.some(x=>/INSERT INTO calls/.test(x.sql)));
});
test('agent rejects activation and arbitrary fields',async()=>{
  const base={tenantId:tenant,displayName:'Demo'};
  for(const bad of [{...base,status:'active'},{...base,phoneNumber:'1234'},
    {...base,questions:[]},{...base,languageMode:'ru'},
    {...base,questions:Array(26).fill('Question')}])
    assert.equal((await worker.fetch(req('/v1/human/agents/'+id,'PATCH',bad),fixture().env)).status,400);
  assert.equal((await worker.fetch(req('/v1/human/agents/'+id,'PATCH',base),fixture('client_admin','active').env)).status,409);
});
test('audit history is tenant-scoped, viewer denied, pagination bounded',async()=>{
  const r=await worker.fetch(req('/v1/human/audit?tenantId='+tenant),fixture().env);
  const d=await r.json();
  assert.equal(r.status,200);assert.equal(d.events[0].action,'lead.updated');assert.equal(d.total,1);
  assert.equal((await worker.fetch(req('/v1/human/audit?tenantId='+tenant),fixture('viewer').env)).status,403);
  assert.equal((await worker.fetch(req('/v1/human/audit?tenantId='+another),fixture().env)).status,403);
  assert.equal((await worker.fetch(req('/v1/human/audit?tenantId='+tenant+'&limit=999'),fixture().env)).status,400);
});
test('oversized machine API JSON rejected before reaching database',async()=>{
  let queries=0;const secret='A'.repeat(40);
  const env={ADMIN_API_TOKEN:secret,CONTROL_DB:{prepare(){queries++;throw Error('DB must not be queried')}}};
  const request=new Request('https://demo.test/v1/admin/tenants',{method:'POST',headers:{
    authorization:'Bearer '+secret,'content-type':'application/json'
  },body:'{"name":"'+('a'.repeat(18000))+'"}'});
  const r=await worker.fetch(request,env);
  assert.equal(r.status,400);assert.equal(queries,0);
});
test('dashboard source parses and contains agent editing/audit/lead paging',()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  assert.match(js,/Edit or pause an AI Agent/);
  assert.match(js,/CRM Audit History/);
  assert.match(js,/offset:String\(offset\)/);
  assert.match(js,/Next →/);
});
