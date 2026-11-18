import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';

const tenant='22222222-2222-4222-8222-222222222222';
const other='44444444-4444-4444-8444-444444444444';
const campaign='33333333-3333-4333-8333-333333333333';
const lead='55555555-5555-4555-8555-555555555555';
const cookie='ar3d_calling_session='+'a'.repeat(64);
const req=(path,method='GET',body=null)=>new Request('https://example.test'+path,{method,
  headers:{cookie,origin:'https://example.test',...(body?{'content-type':'application/json'}:{})},
  body:body?JSON.stringify(body):undefined});
function fixture(role='client_admin'){
  const log=[];
  const CONTROL_DB={prepare(sql){return {bind(...params){log.push({db:'control',sql,params});return {
    async first(){
      if(sql.includes('FROM human_sessions'))return {id:'user-123',email:'owner@example.test',globalRole:'user'};
      if(sql.includes('FROM tenant_memberships'))return params[0]===tenant&&role?
        {tenant_id:tenant,role,storage_mode:'shared',status:'active',plan_code:'starter'}:null;
      return null;
    },
    async all(){return {results:[]}},async run(){return {meta:{changes:1}}}
  }}}}};
  const CRM_DB={prepare(sql){return {bind(...params){log.push({db:'crm',sql,params});return {
    async first(){
      if(sql.includes('AS leadCount'))return {leadCount:3,agentCount:2,draftCampaignCount:1,visitCount:1,syntheticDemoCount:4};
      if(sql.includes('FROM call_campaign_drafts WHERE'))return {id:campaign,status:'draft',name:'Demo'};
      if(sql.includes('COUNT(*) AS total FROM call_campaign_candidates'))return {total:125};
      if(sql.includes('COUNT(*) AS total FROM leads'))return {total:3};
      return null;
    },
    async all(){
      if(sql.includes('SELECT mobile_e164 AS mobile FROM leads'))return {results:[{mobile:'+919876543210'}]};
      if(sql.includes('FROM call_campaign_candidates cc'))return {results:[{leadId:lead,name:'Lead A',consentStatus:'unknown',dndStatus:'unknown'}]};
      if(sql.includes('FROM leads WHERE tenant_id=? ORDER BY'))return {results:[{id:lead,name:'Lead A',mobile:'+919876543210'}]};
      return {results:[]};
    },
    async run(){return {meta:{changes:1}}}
  }}}}};
  return {env:{CONTROL_DB,CRM_DB},log};
}
test('CSV import preview counts existing mobiles without modifying lead flags or writes',async()=>{
  const {env,log}=fixture();
  const csv='Name,Mobile\nDemo,9876543210\nNew,9123456780';
  const r=await worker.fetch(req('/v1/human/import/preview','POST',{tenantId:tenant,csv}),env);
  assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(body.rows,2);assert.equal(body.existingCount,1);assert.equal(body.wouldInsert,1);
  assert.equal(body.preview[0].alreadyInCrm,true);
  assert.equal(body.preview[1].alreadyInCrm,false);
  const lookups=log.filter(x=>x.sql.includes('SELECT mobile_e164 AS mobile FROM leads'));
  assert.equal(lookups.length,1);assert.equal(lookups[0].params[0],tenant);
  assert.ok(!log.some(x=>/INSERT INTO leads|UPDATE leads|consent_status='granted'/.test(x.sql)));
});
test('preview is client admin-only, not usable across tenants',async()=>{
  const csv='Name,Mobile\nDemo,9876543210';
  assert.equal((await worker.fetch(req('/v1/human/import/preview','POST',{tenantId:tenant,csv}),fixture('viewer').env)).status,403);
  assert.equal((await worker.fetch(req('/v1/human/import/preview','POST',{tenantId:other,csv}),fixture().env)).status,403);
});
test('campaign pagination preserves tenant scope and 100-row upper bound',async()=>{
  const {env,log}=fixture();
  const url='/v1/human/campaigns/'+campaign+'/candidates?tenantId='+tenant+'&limit=1&offset=25';
  const r=await worker.fetch(req(url),env),data=await r.json();
  assert.equal(r.status,200);assert.equal(data.total,125);
  assert.equal(data.limit,1);assert.equal(data.offset,25);assert.equal(data.candidates.length,1);
  const select=log.find(x=>x.sql.includes('ORDER BY cc.created_at DESC'));
  assert.deepEqual(select.params,[tenant,campaign,1,25]);
  for(const q of ['&limit=0','&limit=101','&limit=abc','&offset=-2','&offset=100001'])
    assert.equal((await worker.fetch(req('/v1/human/campaigns/'+campaign+'/candidates?tenantId='+tenant+q),fixture().env)).status,400);
  assert.equal((await worker.fetch(req('/v1/human/campaigns/'+campaign+'/candidates?tenantId='+other),fixture().env)).status,403);
});
test('lead JSON export is admin-only, paginated, audited and cache-disabled',async()=>{
  const {env,log}=fixture();
  const url='/v1/human/exports/leads?tenantId='+tenant+'&limit=2&offset=0';
  const response=await worker.fetch(req(url),env),body=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(body.total,3);assert.equal(body.leads.length,1);assert.equal(body.format,'ar3d-crm-leads-v1');
  const lookup=log.find(x=>x.sql.includes('FROM leads WHERE tenant_id=? ORDER BY'));
  assert.deepEqual(lookup.params,[tenant,2,0]);
  assert.ok(log.some(x=>x.sql.includes('leads.exported')));
  assert.equal((await worker.fetch(req(url),fixture('viewer').env)).status,403);
  assert.equal((await worker.fetch(req('/v1/human/exports/leads?tenantId='+other),fixture().env)).status,403);
  assert.equal((await worker.fetch(req('/v1/human/exports/leads?tenantId='+tenant+'&limit=201'),fixture().env)).status,400);
  assert.equal((await worker.fetch(req('/v1/human/exports/leads?tenantId='+tenant+'&offset=-1'),fixture().env)).status,400);
});
test('usage report never asserts billable minutes or money and permits readonly viewer',async()=>{
  const {env,log}=fixture('viewer');
  const r=await worker.fetch(req('/v1/human/usage?tenantId='+tenant),env),body=await r.json();
  assert.equal(r.status,200);
  assert.equal(body.planCode,'starter');assert.equal(body.crmStats.leads,3);
  assert.equal(body.crmStats.syntheticDemos,4);assert.equal(body.billingEnabled,false);
  assert.equal(body.paidMinutes,null);assert.equal(body.amountDueInr,null);
  assert.ok(!log.some(x=>/\bINSERT\b|\bUPDATE\b/.test(x.sql)));
  assert.equal((await worker.fetch(req('/v1/human/usage?tenantId='+other),fixture().env)).status,403);
});
test('export and usage endpoints require human session',async()=>{
  const {env}=fixture();
  for(const path of ['/v1/human/usage?tenantId='+tenant,'/v1/human/exports/leads?tenantId='+tenant]){
    const r=await worker.fetch(new Request('https://example.test'+path),env);
    assert.equal(r.status,401);
  }
});
