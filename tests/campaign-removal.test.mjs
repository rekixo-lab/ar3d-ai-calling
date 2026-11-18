import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';

const tid='22222222-2222-4222-8222-222222222222';
const campaign='33333333-3333-4333-8333-333333333333';
const lead='55555555-5555-4555-8555-555555555555';
const other='44444444-4444-4444-8444-444444444444';
const cookie='ar3d_calling_session='+'a'.repeat(64);
function fixture(role='client_admin',exists=true){
  const log=[];
  const control={prepare(sql){return {bind(...params){log.push({sql,params,db:'control'});return {async first(){
    if(sql.includes('FROM human_sessions'))return {id:'userA',email:'a@example.com',globalRole:'user'};
    if(sql.includes('FROM tenant_memberships'))return params[0]===tid?
      {tenant_id:tid,role,storage_mode:'shared',status:'active'}:null;
    return null;
  }}}}}};
  const crm={prepare(sql){return {bind(...params){log.push({sql,params,db:'crm'});return {async first(){
    if(sql.includes('FROM call_campaign_drafts WHERE'))return {id:campaign,name:'Draft',status:'draft',languageMode:'hi-en',purpose:'site_visit'};
    return null;
  }}}}},async batch(statements){return statements.map((x,i)=>({meta:{changes:exists?1:0}}))}};
  return {env:{CONTROL_DB:control,CRM_DB:crm},log};
}
function request(tenantId=tid,origin=true){
  return new Request('https://example.test/v1/human/campaigns/'+campaign+'/candidates/'+lead+
    '?tenantId='+tenantId,{method:'DELETE',headers:{cookie,...(origin?{origin:'https://example.test'}:{})}});
}
test('client admin can remove a lead from an owned draft with a scoped audit',async()=>{
  const f=fixture(),res=await worker.fetch(request(),f.env);
  assert.equal(res.status,200);assert.equal((await res.json()).removed,true);
  assert.ok(f.log.some(x=>x.sql.includes('campaign.candidate_removed')));
  assert.ok(f.log.some(x=>x.sql.includes('DELETE FROM call_campaign_candidates')));
  assert.ok(f.log.filter(x=>x.db==='crm').every(x=>x.params.includes(tid)));
  assert.ok(!f.log.some(x=>/UPDATE leads|INSERT INTO calls|UPDATE call_campaign_drafts/.test(x.sql)));
});
test('removing an absent candidate is idempotent, does not authorize a call',async()=>{
  const r=await worker.fetch(request(),fixture('client_admin',false).env);
  assert.equal(r.status,200);assert.equal((await r.json()).removed,false);
});
test('viewer, foreign tenant and cross-origin removals are refused',async()=>{
  assert.equal((await worker.fetch(request(),fixture('viewer').env)).status,403);
  assert.equal((await worker.fetch(request(other),fixture().env)).status,403);
  assert.equal((await worker.fetch(request(tid,false),fixture().env)).status,403);
});
