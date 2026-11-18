import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {inspectLeadDialEligibility} from '../src/core.mjs';

const tenantId='22222222-2222-4222-8222-222222222222';
const leadId='33333333-3333-4333-8333-333333333333';
const otherTenant='44444444-4444-4444-8444-444444444444';
const otherLead='55555555-5555-4555-8555-555555555555';
const cookie='ar3d_calling_session='+'a'.repeat(64);
function request(path,method='GET',data=null,origin=true){
  return new Request('https://example.test'+path,{method,headers:{cookie,...(origin?{origin:'https://example.test'}:{}),
    ...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
}
function fake(role='client_admin',leadExists=true,blocked=false){
  const log=[];
  const CONTROL_DB={prepare(sql){return {bind(...params){log.push({db:'control',sql,params});return {
    async first(){
      if(sql.includes('FROM human_sessions'))return {id:'11111111-1111-4111-8111-111111111111',email:'demo@example.com',globalRole:'user'};
      if(sql.includes('FROM tenant_memberships'))return role&&params[0]===tenantId?{tenant_id:tenantId,role,storage_mode:'shared',status:'active'}:null;
      return null;
    }
  }}}}};
  const CRM_DB={prepare(sql){return {bind(...params){log.push({db:'crm',sql,params});return {
    async first(){return sql.startsWith('SELECT id,consent_status,dnd_status FROM leads')&&leadExists?
      {id:leadId,consent_status:blocked?'denied':'unknown',dnd_status:blocked?'blocked':'unknown'}:null},
    async all(){return {results:[{id:'event1',source:'admin_action',reason:null,createdAt:'2026-11-18T00:00:00Z'}]}}
  }}}},async batch(statements){return statements.map(()=>({meta:{changes:1}}))}};
  return {env:{CONTROL_DB,CRM_DB},log};
}
const path='/v1/human/leads/'+leadId+'/opt-out';
test('client admin may block an owned lead, atomically logging event and audit',async()=>{
  const {env,log}=fake();
  const response=await worker.fetch(request(path,'POST',{tenantId,source:'customer_request',reason:'Requested no further calls'}),env);
  assert.equal(response.status,200);assert.equal((await response.json()).consentStatus,'denied');
  const sql=log.filter(x=>x.db==='crm');
  assert.ok(sql.some(x=>x.sql.includes('INSERT INTO lead_opt_out_events')));
  assert.ok(sql.some(x=>x.sql.includes("lead.opted_out")));
  assert.ok(sql.some(x=>x.sql.includes("consent_status='denied',dnd_status='blocked'")));
  assert.ok(sql.every(x=>x.params.includes(tenantId)));
});
test('viewer cannot block; another tenant cannot block; absent origin denied',async()=>{
  assert.equal((await worker.fetch(request(path,'POST',{tenantId}),fake('viewer').env)).status,403);
  assert.equal((await worker.fetch(request(path,'POST',{tenantId:otherTenant}),fake().env)).status,403);
  assert.equal((await worker.fetch(request(path,'POST',{tenantId},false),fake().env)).status,403);
  assert.equal((await worker.fetch(request(path,'POST',{tenantId}),fake('client_admin',false).env)).status,404);
});
test('opt-out rejects unknown fields, bogus sources, invalid reason',async()=>{
  const bad=[
    {tenantId,source:'granted'},
    {tenantId,consentStatus:'granted'},
    {tenantId,reason:'x'.repeat(501)},
    {tenantId,reason:42},
  ];
  for(const body of bad)assert.equal((await worker.fetch(request(path,'POST',body),fake().env)).status,400);
});
test('blocked lead is idempotent and never creates duplicate event',async()=>{
  const {env,log}=fake('client_admin',true,true);
  const res=await worker.fetch(request(path,'POST',{tenantId}),env);
  assert.equal(res.status,200);assert.equal((await res.json()).alreadyBlocked,true);
  assert.ok(!log.some(x=>x.db==='crm'&&x.sql.includes('INSERT INTO')));
});
test('tenant viewer can read own opt-out events, not other tenant history',async()=>{
  const {env,log}=fake('viewer');
  const res=await worker.fetch(request(path+'?tenantId='+tenantId),env);
  assert.equal(res.status,200);assert.equal((await res.json()).events.length,1);
  assert.ok(log.filter(x=>x.db==='crm').every(x=>x.params.includes(tenantId)));
  assert.equal((await worker.fetch(request(path+'?tenantId='+otherTenant),fake('viewer').env)).status,403);
});
test('invalid path is not privileged; opted-out lead cannot pass dialing precheck',async()=>{
  assert.equal((await worker.fetch(request('/v1/human/leads/'+otherLead+'/opt-out','POST',{tenantId:otherTenant}),fake().env)).status,403);
  assert.equal(inspectLeadDialEligibility(
    {consent_status:'denied',consent_proof:'old',consent_at:'old',dnd_status:'blocked'},
    {status:'active',compliance_state:'approved'}
  ).passedPrecheck,false);
});
