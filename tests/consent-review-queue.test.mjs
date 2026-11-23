import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,lead,client,admin} from './helpers/calling-fixture.mjs';
import {handleConsentRequest} from '../src/consent-routes.mjs';

const base='https://app.example.invalid/v1/human/consent-review-queue';
function get(params='',method='GET'){
 return new Request(base+(params?'?'+params:''),{
  method,...(method==='POST'?{headers:{Origin:'https://app.example.invalid'},body:'{}'}:{})
 });
}
function seed(f,id,purpose,at){
 f.r.db.prepare("INSERT INTO lead_consent_evidence "+
  "(tenant_id,id,lead_id,source,purpose,reference,captured_at,received_at,submitted_by) "+
  "VALUES(?,?,?,'website_form',?,?,?,?,'client')")
 .run(tid,id,lead,purpose,'internal-reference-'+id.slice(-3),at,at);
}

test('Simple client evidence queue is read-only, paged and purpose-scoped',async()=>{
 const f=fixture();
 try{
  seed(f,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','site_visit','2026-11-20T00:00:00Z');
  seed(f,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','property_information','2026-11-21T00:00:00Z');
  const before=f.r.db.prepare('SELECT total_changes() AS n').get().n;
  const res=await handleConsentRequest(get('tenantId='+tid),f.env,client);
  assert.equal(res.status,200,await res.clone().text());
  const data=await res.json();
  assert.equal(data.total,2);
  assert.deepEqual(data.items.map(x=>x.purpose),['property_information','site_visit']);
  assert.equal(data.items[0].leadId,lead);
  assert.equal(data.items[0].leadName,'Fictional buyer');
  assert.equal(data.items[0].verificationStatus,'not_verified');
  assert.equal(data.items[0].executionAllowed,false);
  assert.equal(data.items[0].optedOut,false);
  assert.equal(data.executionAllowed,false);
  assert.equal(data.verificationPerformed,false);
  assert.ok(!('mobile' in data.items[0]));
  assert.equal(f.r.db.prepare('SELECT total_changes() AS n').get().n,before);
  const filtered=await handleConsentRequest(
   get('tenantId='+tid+'&purpose=site_visit&limit=1&offset=0'),f.env,client);
  const visit=await filtered.json();
  assert.equal(visit.total,1);
  assert.equal(visit.items[0].purpose,'site_visit');
  const secondPage=await handleConsentRequest(
   get('tenantId='+tid+'&limit=1&offset=1'),f.env,client);
  const page=await secondPage.json();
  assert.equal(page.total,2);
  assert.equal(page.items.length,1);
  assert.equal(page.items[0].purpose,'site_visit');
 }finally{f.close()}
});

test('Queue denies viewers, foreign tenants and users without membership',async()=>{
 const f=fixture();
 try{
  seed(f,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','site_visit','2026-11-20T00:00:00Z');
  const viewer={id:'viewer',globalRole:'user'},foreign='99999999-9999-4999-8999-999999999999';
  for(const [request,user] of [
   [get('tenantId='+tid),viewer],
   [get('tenantId='+foreign),client],
   [get('tenantId='+tid),null]
  ]){
   const res=await handleConsentRequest(request,f.env,user);
   assert.equal(res.status,403);
  }
  const allowed=await handleConsentRequest(get('tenantId='+tid),f.env,client);
  assert.equal((await allowed.json()).total,1);
 }finally{f.close()}
});

test('Queue rejects unexpected parameters, unsupported purpose and write methods',async()=>{
 const f=fixture();
 try{
  for(const query of [
   'tenantId='+tid+'&purpose=all&purpose=site_visit',
   'tenantId='+tid+'&limit=0',
   'tenantId='+tid+'&limit=101',
   'tenantId='+tid+'&offset=10001',
   'tenantId='+tid+'&offset=-1',
   'tenantId='+tid+'&purpose=marketing',
   'tenantId='+tid+'&enableCalling=true',
   'tenantId='+tid+'&tenantId='+tid
  ]){
   const res=await handleConsentRequest(get(query),f.env,client);
   assert.equal(res.status,400,query);
  }
  assert.equal((await handleConsentRequest(get('tenantId='+tid,'POST'),f.env,client)).status,405);
  const plain=await handleConsentRequest(get('tenantId='+tid),f.env,client);
  assert.equal((await plain.json()).total,0);
 }finally{f.close()}
});

test('Blocked lead appears with DND status, never becomes callable',async()=>{
 const f=fixture();
 try{
  seed(f,'dddddddd-dddd-4ddd-8ddd-dddddddddddd','property_information','2026-11-20T00:00:00Z');
  f.r.db.prepare("UPDATE leads SET consent_status='denied',dnd_status='blocked' WHERE tenant_id=? AND id=?")
   .run(tid,lead);
  const res=await handleConsentRequest(get('tenantId='+tid),f.env,client);
  assert.equal(res.status,200);
  const entry=(await res.json()).items[0];
  assert.equal(entry.consentStatus,'denied');
  assert.equal(entry.dndStatus,'blocked');
  assert.equal(entry.executionAllowed,false);
  assert.equal(f.r.db.prepare('SELECT consent_status,dnd_status FROM leads WHERE tenant_id=? AND id=?')
   .get(tid,lead).consent_status,'denied');
 }finally{f.close()}
});

test('Central operator can view the pending queue only with a current MFA Super Admin session',async()=>{
 const f=fixture();
 try{
  seed(f,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','site_visit','2026-11-20T00:00:00Z');
  const now=Date.now(),date=new Date(now).toISOString();
  f.c.db.prepare("UPDATE human_sessions SET created_at=?,expires_at=? WHERE user_id='admin'")
   .run(date,now+3600000);
  const readable=await handleConsentRequest(get('tenantId='+tid),f.env,admin);
  assert.equal(readable.status,200,await readable.clone().text());
  assert.equal((await readable.json()).total,1);
  const badSession={...admin,token_hash:'c'.repeat(64)};
  assert.equal((await handleConsentRequest(get('tenantId='+tid),f.env,badSession)).status,403);
  f.c.db.prepare("UPDATE human_mfa_settings SET enabled_at=NULL WHERE user_id='admin'").run();
  assert.equal((await handleConsentRequest(get('tenantId='+tid),f.env,admin)).status,403);
 }finally{f.close()}
});
