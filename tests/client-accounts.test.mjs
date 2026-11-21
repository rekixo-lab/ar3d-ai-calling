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

test('non-Latin company name receives a deterministic valid slug',async()=>{
 const result=await clientSlug('श्री रियल एस्टेट');
 assert.match(result,/^client-[a-f0-9]{16}$/);
 assert.equal(result,await clientSlug('श्री रियल एस्टेट'));
});
