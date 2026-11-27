import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,lead,admin,client} from './helpers/calling-fixture.mjs';
import {handleDeletionReadiness} from '../src/privacy-deletion-readiness.mjs';

const base='https://app.example.invalid/v1/human/leads/'+lead+'/deletion-readiness';
const req=(query='tenantId='+tid,method='GET')=>new Request(
 base+'?'+query,{method});
function currentMfa(f){
 const now=Date.now();
 f.c.db.prepare("UPDATE human_sessions SET created_at=?,expires_at=? WHERE user_id='admin'")
 .run(new Date(now).toISOString(),now+3600000);
}

test('Super Admin dry-run enumerates actual dependencies without deleting anything',async()=>{
 const f=fixture();
 try{
  currentMfa(f);
  f.r.db.prepare("INSERT INTO lead_consent_evidence(tenant_id,id,lead_id,source,purpose,reference,captured_at,received_at,submitted_by) VALUES(?,?,?,'website_form','site_visit','synthetic-proof',?,?,?)")
  .run(tid,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',lead,'2026-11-20T00:00:00Z','2026-11-20T00:00:00Z','client');
  const before=f.r.db.prepare('SELECT total_changes() AS n').get().n;
  const resp=await handleDeletionReadiness(req(),f.env,admin);
  assert.equal(resp.status,200,await resp.clone().text());
  const result=await resp.json();
  assert.equal(result.mode,'read_only_deletion_dry_run');
  assert.equal(result.tenantId,tid);
  assert.equal(result.leadId,lead);
  assert.equal(result.piiDeleted,false);
  assert.equal(result.executionAllowed,false);
  assert.equal(result.providerRecordingsDeleted,false);
  assert.equal(result.dependentRecords.consentReferences,1);
  assert.equal(result.dependentRecords.campaignCandidates,1);
  assert.equal(result.dependentRecords.calls,0);
  for(const key of ['leadNotes','staffAssignments','callIntentProposals','scriptedCallResults','verifiedProviderCosts','directLeadAuditEvents','phoneSessions','whatsAppPermissions','whatsAppThreads','whatsAppMessages','whatsAppInboundMessages'])assert.ok(Number.isSafeInteger(result.dependentRecords[key]),key);
  assert.ok(result.checksRequired.includes('verified_production_backup_and_isolated_restore'));
  assert.equal(f.r.db.prepare('SELECT total_changes() AS n').get().n,before);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM leads WHERE tenant_id=? AND id=?').get(tid,lead).n,1);
  assert.ok(!JSON.stringify(result).includes('+919000000001'));
 }finally{f.close()}
});

test('No deletion visibility for ordinary clients, missing MFA or wrong tenant',async()=>{
 const f=fixture();
 try{
  currentMfa(f);
  assert.equal((await handleDeletionReadiness(req(),f.env,client)).status,403);
  assert.equal((await handleDeletionReadiness(req(),f.env,null)).status,403);
  assert.equal((await handleDeletionReadiness(req('tenantId=99999999-9999-4999-8999-999999999999'),f.env,admin)).status,404);
  assert.equal((await handleDeletionReadiness(req('tenantId='+tid),f.env,
   {...admin,token_hash:'c'.repeat(64)})).status,403);
  f.c.db.prepare("UPDATE human_mfa_settings SET enabled_at=NULL WHERE user_id='admin'").run();
  assert.equal((await handleDeletionReadiness(req(),f.env,admin)).status,403);
 }finally{f.close()}
});

test('Deletion preview rejects writes and malformed or duplicate query parameters',async()=>{
 const f=fixture();
 try{
  currentMfa(f);
  const invalid=[
   'tenantId='+tid+'&tenantId='+tid,
   'tenantId='+tid+'&delete=true',
   'tenantId=wrong',
   ''
  ];
  for(const query of invalid){
   const r=await handleDeletionReadiness(req(query),f.env,admin);
   assert.equal(r.status,400,query);
  }
  assert.equal((await handleDeletionReadiness(req('tenantId='+tid,'POST'),f.env,admin)).status,405);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM leads').get().n,1);
 }finally{f.close()}
});

test('Opt-out suppression remains visible and untouched in deletion readiness',async()=>{
 const f=fixture();
 try{
  currentMfa(f);
  f.r.db.prepare("INSERT INTO lead_opt_out_events(tenant_id,id,lead_id,source,actor,created_at) VALUES(?,?,?,'admin_action','admin',?)")
   .run(tid,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',lead,'2026-11-20T00:00:00Z');
  f.r.db.prepare("UPDATE leads SET consent_status='denied',dnd_status='blocked' WHERE tenant_id=? AND id=?")
   .run(tid,lead);
  const res=await handleDeletionReadiness(req(),f.env,admin);
  assert.equal(res.status,200);
  const row=await res.json();
  assert.equal(row.dependentRecords.optOutEvents,1);
  assert.equal(row.contactSuppressionPreserved,true);
  assert.equal(row.executionAllowed,false);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM lead_opt_out_events').get().n,1);
 }finally{f.close()}
});

test('deletion inventory includes new industry candidate and every review revision without exposing destination',async()=>{
 const f=fixture();try{
  currentMfa(f);
  const cid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const at='2026-11-20T06:30:00.000Z',expires='2026-11-21T06:30:00.000Z';
  f.r.db.prepare("INSERT INTO industry_campaigns(tenant_id,id,launch_request_id,snapshot_id,graph_sha256,purpose,name,created_by,created_at) VALUES(?,?,?,?,?,'school_admission','School','client',?)").run(tid,cid,cid,cid,'a'.repeat(64),at);
  f.r.db.prepare("INSERT INTO industry_campaign_candidates(tenant_id,campaign_id,lead_id,added_by,added_at) VALUES(?,?,?,'client',?)").run(tid,cid,lead,at);
  f.r.db.prepare("INSERT INTO industry_recipient_reviews(tenant_id,campaign_id,lead_id,revision,decision,destination,lead_updated_at,consent_ref,dnd_ref,expires_at,reviewed_by,reviewed_at) VALUES(?,?,?,1,'cleared','+919000000001',?,'guardian-ref','dnd-ref',?,'admin',?)").run(tid,cid,lead,at,expires,at);
  f.r.db.prepare("INSERT INTO industry_recipient_reviews(tenant_id,campaign_id,lead_id,revision,decision,reason,reviewed_by,reviewed_at) VALUES(?,?,?,2,'revoked','withdrawn','admin',?)").run(tid,cid,lead,at);
  const res=await handleDeletionReadiness(req(),f.env,admin);assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.dependentRecords.industryCampaignCandidates,1);
  assert.equal(body.dependentRecords.industryRecipientReviews,2);
  assert.equal(body.executionAllowed,false);assert.ok(!JSON.stringify(body).includes('+919000000001'));
 }finally{f.close()}
});
