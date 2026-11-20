import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';

const tenant='22222222-2222-4222-8222-222222222222',lead='33333333-3333-4333-8333-333333333333';
const other='44444444-4444-4444-8444-444444444444';
const cookie='ar3d_calling_session='+'a'.repeat(64);
const path='/v1/human/leads/'+lead+'/consent-evidence';
const ready='/v1/human/leads/'+lead+'/call-readiness';
function req(path,method='GET',data,origin=true){
  return new Request('https://example.test'+path,{method,
    headers:{cookie,...(origin?{origin:'https://example.test'}:{}),
      ...(data?{'content-type':'application/json'}:{})},
    body:data?JSON.stringify(data):undefined});
}
function stub(role='client_admin',leadFound=true,{optedOut=false,pendingEvidence=1,consent='unknown',dnd='unknown'}={}){
  const log=[];
  const CONTROL_DB={prepare(sql){return {bind(...params){log.push({sql,params,db:'control'});return {
    async first(){
      if(sql.includes('FROM human_sessions'))return {id:'user123',email:'demo@example.com',globalRole:'user'};
      if(sql.includes('FROM tenant_memberships'))return role&&params[0]===tenant?
        {tenant_id:tenant,role,storage_mode:'shared',status:'active'}:null;
      return null;
    }
  }}}}};
  const CRM_DB={prepare(sql){return {bind(...params){log.push({sql,params,db:'crm'});return {
    async first(){
      if(sql.includes('FROM leads WHERE'))return leadFound?
        {id:lead,consent_status:consent,dnd_status:dnd,customer_segment:'unknown_contact'}:null;
      if(sql.includes('FROM lead_opt_out_events'))return {total:optedOut?1:0};
      if(sql.includes('FROM lead_consent_evidence'))return {total:pendingEvidence};
      return null
    },
    async all(){return {results:[{id:'evidence1',reviewStatus:'pending',reference:'form-1234'}]}}
  }}}},async batch(statements){return statements.map(()=>({meta:{changes:1}}))}};
  return {env:{CONTROL_DB,CRM_DB},log};
}
const body={tenantId:tenant,source:'website_form',purpose:'site_visit',
  reference:'web-form-2026-001',capturedAt:'2026-11-17T10:00:00+05:30'};
test('client admin can submit pending evidence with tenant scope and audit, without lead consent update',async()=>{
  const {env,log}=stub();
  const r=await worker.fetch(req(path,'POST',body),env);
  assert.equal(r.status,201);
  assert.equal((await r.json()).reviewStatus,'pending');
  assert.ok(log.some(x=>x.sql.includes('INSERT INTO lead_consent_evidence')));
  assert.ok(log.some(x=>x.sql.includes('consent_evidence.submitted')));
  assert.ok(!log.some(x=>/UPDATE leads|INSERT INTO calls/.test(x.sql)));
  assert.ok(log.filter(x=>x.db==='crm').every(x=>x.params.includes(tenant)));
});
test('viewer and wrong tenant cannot submit, even if body claims owner',async()=>{
  assert.equal((await worker.fetch(req(path,'POST',body),stub('viewer').env)).status,403);
  assert.equal((await worker.fetch(req(path,'POST',{...body,tenantId:other}),stub().env)).status,403);
  assert.equal((await worker.fetch(req(path,'POST',body,false),stub().env)).status,403);
});
test('evidence submission forbids grant/dnd flags, invalid source, future time and missing lead',async()=>{
  const wrong=[
    {...body,consentStatus:'granted'},
    {...body,dndStatus:'allowed'},
    {...body,source:'approved'},
    {...body,purpose:'marketing'},
    {...body,reference:'x'},
    {...body,capturedAt:'2035-01-01T00:00:00Z'},
    {...body,capturedAt:'2026-01-01'},
  ];
  for(const b of wrong)assert.equal((await worker.fetch(req(path,'POST',b),stub().env)).status,400);
  assert.equal((await worker.fetch(req(path,'POST',body),stub('client_admin',false).env)).status,404);
});
test('signed-in tenant viewer can read evidence; foreign tenant gets 403',async()=>{
  const {env,log}=stub('viewer');
  const res=await worker.fetch(req(path+'?tenantId='+tenant),env);
  assert.equal(res.status,200);assert.equal((await res.json()).items[0].reviewStatus,'pending');
  assert.ok(log.filter(x=>x.db==='crm').every(x=>x.params.includes(tenant)));
  assert.equal((await worker.fetch(req(path+'?tenantId='+other),env)).status,403);
});
test('call readiness always blocked while provider verification unavailable, including for matching lead',async()=>{
  const {env}=stub('viewer');
  const res=await worker.fetch(req(ready+'?tenantId='+tenant),env);
  assert.equal(res.status,200);
  const d=await res.json();
  assert.equal(d.eligible,false);
  assert.equal(d.executionAllowed,false);
  assert.ok(d.reasons.length>=4);
  assert.equal(d.pendingEvidenceCount,1);
  assert.equal(d.customerSegment,'unknown_contact');
  assert.equal((await worker.fetch(req(ready,'POST',{tenantId:tenant}),stub().env)).status,405);
  assert.equal((await worker.fetch(req(ready+'?tenantId='+other),stub().env)).status,403);
});
test('no consent route allows a missing session to submit data',async()=>{
  const {env}=stub();
  const unauthorized=new Request('https://example.test'+path,{method:'POST',headers:{origin:'https://example.test',
    'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await worker.fetch(unauthorized,env)).status,401);
});

test('blocked/opted-out leads and pending evidence are explicit read-only blockers',async()=>{
  const f=stub('viewer',true,{optedOut:true,pendingEvidence:2,consent:'denied',dnd:'blocked'});
  const res=await worker.fetch(req(ready+'?tenantId='+tenant),f.env);
  assert.equal(res.status,200);
  const result=await res.json();
  assert.equal(result.eligible,false);
  assert.equal(result.executionAllowed,false);
  assert.equal(result.optOutRecorded,true);
  assert.equal(result.pendingEvidenceCount,2);
  assert.ok(result.reasons.some(x=>x.includes('opt-out')));
  assert.ok(result.reasons.some(x=>x.includes('DND')));
  assert.ok(!f.log.some(x=>/UPDATE leads|INSERT INTO calls|UPDATE call_campaign/.test(x.sql)));
  assert.ok(f.log.filter(x=>x.db==='crm').every(x=>x.params.includes(tenant)));
});
test('even no pending evidence and no opt-out cannot grant live call permission',async()=>{
  const f=stub('viewer',true,{optedOut:false,pendingEvidence:0,consent:'unknown',dnd:'unknown'});
  const res=await worker.fetch(req(ready+'?tenantId='+tenant),f.env);
  const result=await res.json();
  assert.equal(result.eligible,false);
  assert.equal(result.executionAllowed,false);
  assert.equal(result.optOutRecorded,false);
  assert.equal(result.pendingEvidenceCount,0);
  assert.ok(result.reasons.some(x=>x.includes('No pending')));
  assert.ok(result.reasons.some(x=>x.includes('consent')));
});
