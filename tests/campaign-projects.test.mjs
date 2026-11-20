import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
const tenant='22222222-2222-4222-8222-222222222222';
const other='44444444-4444-4444-8444-444444444444';
const campaign='33333333-3333-4333-8333-333333333333';
const lead='55555555-5555-4555-8555-555555555555';
const cookie='ar3d_calling_session='+'a'.repeat(64);
const req=(path,method='GET',data,origin=true)=>new Request('https://example.test'+path,{method,
  headers:{cookie,...(origin?{origin:'https://example.test'}:{}),
    ...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
function stub(role='client_admin',hasCampaign=true){
  const log=[];
  const CONTROL_DB={prepare(sql){return {bind(...params){log.push({db:'control',sql,params});return {
    async first(){
      if(sql.includes('FROM human_sessions'))return {id:'u',email:'u@example.test',globalRole:'user'};
      if(sql.includes('FROM tenant_memberships'))return role&&params[0]===tenant?
        {tenant_id:tenant,role,storage_mode:'shared',status:'active'}:null;
      return null;
    },
    async all(){return {results:[{id:'link',source:'ar3d-platform',status:'pending'}]}}
  }}}},async batch(rows){return rows.map(()=>({meta:{changes:1}}))}};
  const CRM_DB={prepare(sql){return {bind(...params){log.push({db:'crm',sql,params});return {
    async first(){
      if(sql.includes('FROM call_campaign_drafts WHERE'))return hasCampaign?
        {id:campaign,name:'Trial',status:'draft',languageMode:'hi-en',purpose:'site_visit'}:null;
      if(sql.includes('FROM call_campaign_candidates cc'))return {total:3,blocked:1,unverified:3,optedOut:1,pendingEvidence:2,unclassified:1};
      return null;
    },
    async all(){return {results:[]}}
  }}}},async batch(rows){return rows.map(()=>({meta:{changes:1}}))}};
  return {env:{CONTROL_DB,CRM_DB},log};
}
test('draft creation enforces tenant edit role and never launches calls',async()=>{
  const f=stub(),data={tenantId:tenant,name:'November visit planning',languageMode:'hi-en',purpose:'site_visit'};
  const res=await worker.fetch(req('/v1/human/campaigns','POST',data),f.env);
  assert.equal(res.status,201);assert.equal((await res.json()).dialingEnabled,false);
  assert.ok(f.log.some(x=>x.sql.includes('INSERT INTO call_campaign_drafts')));
  assert.ok(!f.log.some(x=>/INSERT INTO calls|UPDATE leads|fetch\(/.test(x.sql)));
  assert.equal((await worker.fetch(req('/v1/human/campaigns','POST',data),stub('viewer').env)).status,403);
  assert.equal((await worker.fetch(req('/v1/human/campaigns','POST',{...data,tenantId:other}),stub().env)).status,403);
  assert.equal((await worker.fetch(req('/v1/human/campaigns','POST',data,false),stub().env)).status,403);
});
test('campaign cannot activate or supply phone provider / sensitive settings',async()=>{
  const url='/v1/human/campaigns';
  for(const d of [
    {tenantId:tenant,name:'A',languageMode:'hi-en',purpose:'site_visit',status:'active'},
    {tenantId:tenant,name:'A',languageMode:'bad',purpose:'site_visit'},
    {tenantId:tenant,name:'A',languageMode:'hi',purpose:'marketing'},
  ])assert.equal((await worker.fetch(req(url,'POST',d),stub().env)).status,400);
  assert.equal((await worker.fetch(req(url+'/'+campaign+'?tenantId='+tenant,'PATCH',{tenantId:tenant,status:'active'}),stub().env)).status,405);
  assert.equal((await worker.fetch(req(url+'/'+campaign+'/readiness?tenantId='+tenant),stub().env)).status,200);
});
test('candidate references are tenant-scoped, skipped when opted out, never granted consent',async()=>{
  const f=stub(),url='/v1/human/campaigns/'+campaign+'/candidates';
  const res=await worker.fetch(req(url,'POST',{tenantId:tenant,leadIds:[lead]}),f.env);
  assert.equal(res.status,200);assert.equal((await res.json()).dialingEnabled,false);
  assert.ok(f.log.some(x=>x.sql.includes("consent_status!='denied'")));
  assert.ok(f.log.some(x=>x.sql.includes("dnd_status!='blocked'")));
  assert.ok(!f.log.some(x=>/INSERT INTO calls/.test(x.sql)));
  assert.equal((await worker.fetch(req(url,'POST',{tenantId:tenant,leadIds:[lead]}),stub('viewer').env)).status,403);
  assert.equal((await worker.fetch(req(url,'POST',{tenantId:other,leadIds:[lead]}),stub().env)).status,403);
  assert.equal((await worker.fetch(req(url,'POST',{tenantId:tenant,leadIds:[lead,lead]}),stub().env)).status,400);
});
test('campaign readiness always blocks execution and protects foreign tenant',async()=>{
  const url='/v1/human/campaigns/'+campaign+'/readiness?tenantId='+tenant;
  const res=await worker.fetch(req(url),stub('viewer').env),v=await res.json();
  assert.equal(res.status,200);assert.equal(v.executionAllowed,false);
  assert.equal(v.stats.total,3);assert.equal(v.stats.blocked,1);
  assert.equal(v.stats.optedOut,1);assert.equal(v.stats.unverified,3);
  assert.equal(v.stats.pendingEvidence,2);assert.equal(v.stats.unclassified,1);
  assert.ok(v.reasons.length>=3);
  assert.ok(v.nextActions.some(x=>x.includes('opted-out')));
  assert.equal((await worker.fetch(req('/v1/human/campaigns/'+campaign+'/readiness?tenantId='+other),stub().env)).status,403);
  assert.equal((await worker.fetch(req('/v1/human/campaigns/'+campaign+'/readiness?tenantId='+tenant),stub('client_admin',false).env)).status,404);
});
test('project links stay pending, never contact Platform or Engine',async()=>{
  const f=stub(),url='/v1/human/project-links',data={tenantId:tenant,source:'ar3d-platform',externalProjectId:'shree-palace-123',externalSlug:'shree-palace'};
  const res=await worker.fetch(req(url,'POST',data),f.env),v=await res.json();
  assert.equal(res.status,201);assert.equal(v.status,'pending');assert.equal(v.verified,false);
  assert.ok(f.log.some(x=>x.sql.includes('INSERT INTO project_links')));
  assert.ok(f.log.every(x=>x.db==='control'));
  assert.equal((await worker.fetch(req(url+'?tenantId='+tenant),stub('viewer').env)).status,200);
  assert.equal((await worker.fetch(req(url,'POST',data),stub('viewer').env)).status,403);
  assert.equal((await worker.fetch(req(url,'POST',{...data,tenantId:other}),stub().env)).status,403);
  for(const bad of [{...data,status:'verified'},{...data,source:'fake'}, {...data,externalProjectId:'../db'}]){
    assert.equal((await worker.fetch(req(url,'POST',bad),stub().env)).status,400);
  }
});
test('human session is required for new campaign and project endpoints',async()=>{
  const {env}=stub();
  for(const path of ['/v1/human/campaigns?tenantId='+tenant,'/v1/human/project-links?tenantId='+tenant]){
    const request=new Request('https://example.test'+path);
    assert.equal((await worker.fetch(request,env)).status,401);
  }
});
test('human bootstrap token cannot authorize machine admin; separate secret works',async()=>{
  const boot='B'.repeat(40),machine='M'.repeat(40);
  const url='https://example.test/v1/admin/tenants';
  const env={ADMIN_BOOTSTRAP_TOKEN:boot,CONTROL_DB:{prepare(){throw Error('should not query without machine token')}}};
  assert.equal((await worker.fetch(new Request(url,{method:'POST',headers:{Authorization:'Bearer '+boot}}),env)).status,401);
  const written=[];
  const db={prepare(sql){written.push(sql);return {bind(){return {async run(){return {meta:{changes:1}}}}}}}};
  const authorized=await worker.fetch(new Request(url,{method:'POST',headers:{
    Authorization:'Bearer '+machine, 'Content-Type':'application/json'},
    body:JSON.stringify({slug:'demo-client',displayName:'Demo Client'})}),
    {ADMIN_BOOTSTRAP_TOKEN:boot,ADMIN_API_TOKEN:machine,CONTROL_DB:db});
  assert.equal(authorized.status,201);assert.ok(written.some(x=>x.includes('INSERT INTO tenants')));
});

test('readiness aggregation is tenant-scoped and cannot change or place a call',async()=>{
  const f=stub('viewer'),url='/v1/human/campaigns/'+campaign+'/readiness?tenantId='+tenant;
  const res=await worker.fetch(req(url),f.env);
  assert.equal(res.status,200);
  assert.equal((await res.json()).executionAllowed,false);
  const q=f.log.find(x=>x.sql.includes('FROM call_campaign_candidates cc')&&x.sql.includes('optedOut'));
  assert.ok(q);
  assert.ok(q.sql.includes('lead_opt_out_events'));
  assert.ok(q.sql.includes('lead_consent_evidence'));
  assert.ok(q.sql.includes('cc.tenant_id=? AND cc.campaign_id=?'));
  assert.deepEqual(q.params,[tenant,campaign]);
  assert.ok(!f.log.some(x=>/INSERT INTO calls|UPDATE leads/.test(x.sql)));
});
