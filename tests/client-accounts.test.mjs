import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,admin,client,tid} from './helpers/calling-fixture.mjs';
import {handleClientAccountRequest,clientSlug} from '../src/client-account-routes.mjs';

const req=(payload)=>new Request('https://calling.example.test/v1/human/client-accounts',{
  method:'POST',headers:{origin:'https://calling.example.test','content-type':'application/json'},
  body:JSON.stringify(payload)
});
const post=(f,p,user=admin)=>handleClientAccountRequest(req(p),f.env,user);

test('client accounts deny tenant members, leaving isolated D1 unchanged',async()=>{
 const f=fixture();
 try{
  const r=await post(f,{displayName:'Private Builder',email:'private@example.test',mobile:'9000000002'},client);
  assert.equal(r.status,403);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM client_account_contacts').get().n,0);
 }finally{f.close()}
});

test('new client account atomically creates shared tenant, contact and one private invitation without login',async()=>{
 const f=fixture();
 try{
  const email='owner@example.test';
  const r=await post(f,{displayName:'North Builder',email,mobile:'9000000002'});
  if(r.status!==201)assert.fail('onboarding failed: '+await r.text());
  const d=await r.json();
  assert.equal(d.existingTenant,false);
  assert.equal(d.access,'invitation_pending');
  assert.equal(d.aiDraftReady,true);
  assert.equal(d.aiPublished,false);
  assert.match(d.inviteUrl,/^https:\/\/calling\.example\.test\/app#invite=[a-f0-9]{64}$/);
  const company=f.c.db.prepare('SELECT * FROM tenants WHERE id=?').get(d.id);
  assert.equal(company.slug,'north-builder');
  assert.equal(company.storage_mode,'shared');
  const contact=f.c.db.prepare('SELECT * FROM client_account_contacts WHERE tenant_id=?').get(d.id);
  assert.equal(contact.email,email);
  assert.equal(contact.mobile_e164,'+919000000002');
  const invite=f.c.db.prepare('SELECT * FROM human_invitations WHERE tenant_id=?').get(d.id);
  assert.equal(invite.role,'client_admin');
  assert.notEqual(invite.token_hash,d.inviteUrl.split('#invite=')[1]);
  const defaultProfile=f.c.db.prepare('SELECT * FROM company_profile_versions WHERE tenant_id=?').get(d.id);
  const defaultScript=f.c.db.prepare('SELECT * FROM calling_script_versions WHERE tenant_id=?').get(d.id);
  assert.equal(defaultProfile.revision,1);
  assert.equal(JSON.parse(defaultProfile.config_json).companyName,'North Builder');
  assert.equal(JSON.parse(defaultProfile.config_json).pricing,'');
  assert.equal(JSON.parse(defaultProfile.config_json).projects,'');
  assert.equal(JSON.parse(defaultScript.config_json).questions.length,7);
  assert.equal(defaultScript.provider_state,'draft');
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM calling_agent_publications WHERE tenant_id=?').get(d.id).n,0);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_jobs WHERE tenant_id=?').get(d.id).n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM human_users WHERE email=?').get(email).n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_memberships WHERE tenant_id=?').get(d.id).n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_audit_events WHERE tenant_id=?').get(d.id).n,1);
  const duplicate=await post(f,{displayName:'North Builder',email,mobile:'9000000002'});
  assert.equal(duplicate.status,409);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenants WHERE slug=?').get('north-builder').n,1);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM human_invitations WHERE tenant_id=?').get(d.id).n,1);
 }finally{f.close()}
});

test('existing company is reused, never duplicated, when creating first login invitation',async()=>{
 const f=fixture();
 try{
  const before=f.c.db.prepare('SELECT COUNT(*) AS n FROM tenants').get().n;
  const r=await post(f,{displayName:'Demo',email:'firstowner@example.test',mobile:'9888888888',tenantId:tid});
  if(r.status!==201)assert.fail('onboarding failed: '+await r.text());
  const d=await r.json();
  assert.equal(d.id,tid);
  assert.equal(d.existingTenant,true);
  assert.equal(d.aiDraftReady,false);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM company_profile_versions WHERE tenant_id=?').get(tid).n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM calling_script_versions WHERE tenant_id=?').get(tid).n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenants').get().n,before);
  assert.equal(f.c.db.prepare('SELECT email FROM client_account_contacts WHERE tenant_id=?').get(tid).email,'firstowner@example.test');
 }finally{f.close()}
});

test('onboarding refuses mismatched tenant, unsupported phone, unexpected fields and pre-existing access',async()=>{
 const f=fixture();
 try{
  const common={displayName:'Demo',email:'abc@example.test',mobile:'9000000001'};
  assert.equal((await post(f,{...common,tenantId:'22222222-2222-4222-8222-222222222222'})).status,404);
  assert.equal((await post(f,{...common,displayName:'Different',tenantId:tid})).status,409);
  assert.equal((await post(f,{...common,mobile:'1234567890'})).status,400);
  assert.equal((await post(f,{...common,secret:'should-not-be-accepted'})).status,400);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM client_account_contacts').get().n,0);
 }finally{f.close()}
});


test('initial provisional INR client credit is chosen at account creation with current MFA',async()=>{
 const f=fixture();
 try{
  const now=Date.now();
  f.c.db.prepare("UPDATE human_sessions SET created_at=?,expires_at=? WHERE user_id='admin'")
   .run(new Date(now).toISOString(),now+3600000);
  const r=await post(f,{displayName:'Credit Builder',email:'credit@example.test',
   mobile:'9000000022',initialCreditInr:500});
  assert.equal(r.status,201,await r.clone().text());
  const d=await r.json();
  assert.equal(d.plannedCreditInr,500);
  assert.equal(d.creditStatus,'provisional_only');
  assert.equal(f.c.db.prepare('SELECT planned_paise AS n FROM tenant_credit_budgets WHERE tenant_id=?').get(d.id).n,50000);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_credit_audit WHERE tenant_id=?').get(d.id).n,1);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM human_invitations WHERE tenant_id=?').get(d.id).n,1);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_runs WHERE tenant_id=?').get(d.id).n,0);
 }finally{f.close()}
});

test('stale MFA cannot grant new client credits or create partial invitations',async()=>{
 const f=fixture();
 try{
  const r=await post(f,{displayName:'Unapproved Builder',email:'other@example.test',
   mobile:'9000000024',initialCreditInr:500});
  assert.equal(r.status,403);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM tenants WHERE slug='unapproved-builder'").get().n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_credit_budgets').get().n,0);
  const bad=await post(f,{displayName:'No Budget Builder',email:'other2@example.test',
   mobile:'9000000025',initialCreditInr:-100});
  assert.equal(bad.status,400);
  assert.equal((await post(f,{displayName:'Unlisted Pack',email:'unlisted@example.test',mobile:'9000000028',initialCreditInr:150})).status,400);
  assert.equal((await post(f,{displayName:'Oversize Pack',email:'oversize@example.test',mobile:'9000000029',initialCreditInr:1000})).status,400);
 }finally{f.close()}
});

test('non-Latin company name receives a deterministic valid slug',async()=>{
 const result=await clientSlug('श्री रियल एस्टेट');
 assert.match(result,/^client-[a-f0-9]{16}$/);
 assert.equal(result,await clientSlug('श्री रियल एस्टेट'));
});

test('initial manual minutes are atomically allocated with new client invitation; no legacy INR conversion',async()=>{const f=fixture();try{
 const payload={displayName:'Minute Builder',email:'minute@example.test',mobile:'9000000022',initialMinutes:1000};
 assert.equal((await post(f,payload)).status,403);
 const now=Date.now();f.c.db.prepare("UPDATE human_sessions SET created_at=?,expires_at=? WHERE user_id='admin'").run(new Date(now).toISOString(),now+3600000);
 assert.equal((await post(f,{...payload,initialCreditInr:500})).status,400);
 assert.equal((await post(f,{...payload,initialMinutes:-1})).status,400);
 assert.equal((await post(f,{...payload,displayName:'Demo',tenantId:tid})).status,409);
 const res=await post(f,payload);assert.equal(res.status,201,await res.clone().text());const data=await res.json();
 assert.equal(data.initialAllocatedSeconds,60000);assert.equal(f.c.db.prepare('SELECT balance_seconds AS n FROM tenant_minute_ledger WHERE tenant_id=?').get(data.id).n,60000);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_credit_budgets WHERE tenant_id=?').get(data.id).n,0);
 assert.equal((await post(f,payload)).status,409);assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_minute_ledger WHERE tenant_id=?').get(data.id).n,1);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM human_invitations WHERE tenant_id=?').get(data.id).n,1);
}finally{f.close()}});
