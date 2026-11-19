import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../src/index.mjs';
import {parseLeadCsv} from '../src/csv-import.mjs';
import {js} from '../src/app-assets.mjs';

const tid='22222222-2222-4222-8222-222222222222',other='44444444-4444-4444-8444-444444444444';
const lead='33333333-3333-4333-8333-333333333333';
const cookie='ar3d_calling_session='+'a'.repeat(64);
const request=(path,method='GET',body)=>new Request('https://example.test'+path,{method,
  headers:{cookie,origin:'https://example.test',...(body?{'content-type':'application/json'}:{})},
  body:body?JSON.stringify(body):undefined});
function fake(role='client_admin'){
  const log=[];
  const CONTROL_DB={prepare(sql){return {bind(...params){log.push({sql,params,db:'control'});return {
    async first(){
      if(sql.includes('FROM human_sessions'))return {id:'user-1',email:'demo@example.test',globalRole:'user'};
      if(sql.includes('FROM tenant_memberships'))return params[0]===tid?{tenant_id:tid,role,storage_mode:'shared',status:'active'}:null;
      return null;
    }
  }}}}};
  const CRM_DB={prepare(sql){return {bind(...params){log.push({sql,params,db:'crm'});return {
    async first(){
      if(sql.includes('FROM leads WHERE tenant_id')&&sql.includes('interest_status AS interestStatus'))
        return {interestStatus:'new',preferredLocation:null,budgetMinInr:null,budgetMaxInr:null,followupAt:null,
          customerSegment:'unclassified',plotSizePreference:null,visitDatePreference:null};
      if(sql.includes('COUNT(*) AS total FROM leads'))return {total:1};
      return null;
    },
    async all(){
      if(sql.includes('SELECT mobile_e164 AS mobile FROM leads'))return {results:[]};
      if(sql.includes('FROM leads'))return {results:[{id:lead,customerSegment:'prior_inquiry',plotSizePreference:'30x40 ft'}]};
      return {results:[]};
    },
    async run(){return {meta:{changes:1}}}
  }}}},async batch(xs){return xs.map(()=>({meta:{changes:1}}))}};
  return {env:{CONTROL_DB,CRM_DB},log};
}
const spreadsheet='Name,Mobile,Customer Type,Plot Size,Visit Date Preference\n'+
  'A,9876543210,previous inquiry,30x40 ft,2026-12-08\n'+
  'B,9123456780,unknown contact,1200 sqft,\n'+
  'C,9234567890,,,';
test('Boss spreadsheet supports both categories, size, visit date and safe unclassified default',()=>{
  const rows=parseLeadCsv(spreadsheet);
  assert.deepEqual(rows.map(r=>r.customerSegment),['prior_inquiry','unknown_contact','unclassified']);
  assert.equal(rows[0].plotSizePreference,'30x40 ft');
  assert.equal(rows[0].visitDatePreference,'2026-12-08');
  assert.equal(rows[1].visitDatePreference,null);
  assert.equal(rows[2].customerSegment,'unclassified');
});
test('CSV segment, plot size and invalid calendar day are rejected strictly',()=>{
  for(const value of ['approved to call','verified','telemarketing'])assert.throws(()=>
    parseLeadCsv('Mobile,Customer Type\n9876543210,'+value),/invalid customer type/);
  assert.throws(()=>parseLeadCsv('Mobile,Visit Date\n9876543210,2026-02-30'),/invalid visit preference date/);
  assert.throws(()=>parseLeadCsv('Mobile,Plot Size\n9876543210,'+'x'.repeat(121)),/invalid plot size/);
});
test('import uses CRM-only tenant scope; never grants consent or creates a call',async()=>{
  const f=fake();
  const response=await worker.fetch(request('/v1/human/import/commit','POST',{tenantId:tid,csv:spreadsheet}),f.env);
  assert.equal(response.status,201);
  const writes=f.log.filter(x=>x.db==='crm'&&x.sql.includes('INSERT INTO leads'));
  assert.equal(writes.length,3);
  assert.ok(writes.every(x=>x.sql.includes('customer_segment,plot_size_preference,visit_date_preference')));
  assert.deepEqual(writes.map(x=>x.params.at(-3)),['prior_inquiry','unknown_contact','unclassified']);
  assert.ok(writes.every(x=>x.sql.includes("'unknown','unknown'")));
  assert.ok(f.log.every(x=>!/INSERT INTO calls|UPDATE leads SET consent_status|UPDATE leads SET dnd_status/.test(x.sql)));
});
test('client admin may filter, update qualification; viewers and foreign tenants may not write',async()=>{
  const f=fake();
  const list=await worker.fetch(request('/v1/human/leads?tenantId='+tid+'&segment=prior_inquiry'),f.env);
  assert.equal(list.status,200);
  assert.ok(f.log.some(x=>x.sql.includes('AND customer_segment=?')));
  const edit=await worker.fetch(request('/v1/human/leads/'+lead,'PATCH',{
    tenantId:tid,customerSegment:'unknown_contact',plotSizePreference:'900 sqft',visitDatePreference:'2026-11-25'
  }),f.env);
  assert.equal(edit.status,200);
  const update=f.log.find(x=>x.sql.includes('UPDATE leads SET interest_status='));
  assert.ok(update.sql.includes('visit_date_preference'));
  assert.ok(update.params.includes('unknown_contact'));
  assert.ok(!update.sql.includes('consent_status='));
  assert.equal((await worker.fetch(request('/v1/human/leads/'+lead,'PATCH',{
    tenantId:tid,customerSegment:'unknown_contact'}),fake('viewer').env)).status,403);
  assert.equal((await worker.fetch(request('/v1/human/leads/'+lead,'PATCH',{
    tenantId:other,customerSegment:'unknown_contact'}),fake().env)).status,403);
  for(const segment of ['allowed','prior_inquiry;DROP','other'])
    assert.equal((await worker.fetch(request('/v1/human/leads/'+lead,'PATCH',{
      tenantId:tid,customerSegment:segment}),fake().env)).status,400);
});
test('qualification does not turn a preferred visit into an actual scheduled visit',async()=>{
  const f=fake();
  const r=await worker.fetch(request('/v1/human/leads/'+lead,'PATCH',{
    tenantId:tid,visitDatePreference:'2026-12-10'}),f.env);
  assert.equal(r.status,200);
  assert.ok(!f.log.some(x=>/INSERT INTO site_visits/.test(x.sql)));
});
test('client dashboard JavaScript parses and shows segment and plot size controls',()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  assert.match(js,/Previous enquiry/);
  assert.match(js,/Unknown\/new contact/);
  assert.match(js,/Preferred visit date \(not booked\)/);
});
