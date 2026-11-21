import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,admin,client,tid,now} from './helpers/calling-fixture.mjs';
import {handleCompanyChangeRequests} from '../src/company-change-requests.mjs';

const req=(method,body={},path='/v1/human/company-change-requests',origin='https://app.example.invalid')=>
 new Request('https://app.example.invalid'+path+(method==='GET'?'?tenantId='+encodeURIComponent(body.tenantId):''),{
  method,headers:{Origin:origin,'Content-Type':'application/json'},
  ...(method==='POST'?{body:JSON.stringify(body)}:{})
 });
const message='Please correct Demo Heights plot price from 12 lakh to 14 lakh.';
test('client requests are private to the tenant and never rewrite published AI facts',async()=>{
 const f=fixture();
 try{
  const before=f.c.db.prepare('SELECT COUNT(*) AS n FROM company_profile_versions').get().n;
  const response=await handleCompanyChangeRequests(req('POST',{tenantId:tid,message}),f.env,client,{now});
  assert.equal(response.status,201,await response.clone().text());
  const data=await response.json();
  const list=await handleCompanyChangeRequests(req('GET',{tenantId:tid}),f.env,client,{now});
  assert.equal(list.status,200);
  const value=await list.json();
  assert.equal(value.canResolve,false);
  assert.equal(value.requests.length,1);
  assert.equal(value.requests[0].message,message);
  assert.equal(value.requests[0].status,'pending');
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM company_profile_versions').get().n,before);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM calling_script_versions').get().n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM calling_agent_publications').get().n,0);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
  const adminView=await handleCompanyChangeRequests(req('GET',{tenantId:tid}),f.env,admin,{now});
  assert.equal((await adminView.json()).canResolve,true);
  assert.equal((await handleCompanyChangeRequests(req('POST',{tenantId:tid,message}),f.env,admin,{now})).status,403);
  assert.equal((await handleCompanyChangeRequests(req('POST',{tenantId:tid,message},'/v1/human/company-change-requests','https://evil.invalid'),f.env,client,{now})).status,403);
  assert.equal((await handleCompanyChangeRequests(req('POST',{tenantId:'22222222-2222-4222-8222-222222222222',message}),f.env,client,{now})).status,403);
  assert.equal((await handleCompanyChangeRequests(req('GET',{tenantId:tid}),f.env,{id:'attacker',globalRole:'user'},{now})).status,403);
  assert.equal((await handleCompanyChangeRequests(req('GET',{tenantId:tid}),f.env,{...admin,token_hash:'not-recent'},{now})).status,403);
  const action='/v1/human/company-change-requests/'+data.id+'/resolve';
  assert.equal((await handleCompanyChangeRequests(req('POST',{tenantId:tid,status:'handled'},action),f.env,client,{now})).status,403);
  const resolved=await handleCompanyChangeRequests(req('POST',{tenantId:tid,status:'handled'},action),f.env,admin,{now});
  assert.equal(resolved.status,200,await resolved.clone().text());
  assert.equal((await handleCompanyChangeRequests(req('POST',{tenantId:tid,status:'dismissed'},action),f.env,admin,{now})).status,409);
  const rec=f.c.db.prepare('SELECT * FROM company_change_requests WHERE tenant_id=?').get(tid);
  assert.equal(rec.status,'handled');
  assert.throws(()=>f.c.db.prepare('UPDATE company_change_requests SET message=? WHERE tenant_id=?').run('tampered',tid),/immutable/);
  assert.throws(()=>f.c.db.prepare('DELETE FROM company_change_requests WHERE tenant_id=?').run(tid),/immutable/);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM tenant_audit_events WHERE action LIKE 'company.%'").get().n,2);
 }finally{f.close()}
});
test('request rate limit, pending cap and input validation prevent inbox flooding',async()=>{
 const f=fixture();
 try{
  for(const invalid of ['short', 'x'.repeat(1201),'x\u0000'.repeat(12)]){
   assert.equal((await handleCompanyChangeRequests(req('POST',{tenantId:tid,message:invalid}),f.env,client,{now})).status,400);
  }
  assert.equal((await handleCompanyChangeRequests(req('POST',{tenantId:tid,message}),f.env,client,{now})).status,201);
  assert.equal((await handleCompanyChangeRequests(req('POST',{tenantId:tid,message}),f.env,client,{now})).status,429);
  assert.equal((await handleCompanyChangeRequests(req('POST',{tenantId:tid,message:'Location has changed: please use Raipur, Chhattisgarh.'}),f.env,client,{now:now+61_000})).status,201);
  assert.equal((await handleCompanyChangeRequests(req('POST',{tenantId:tid,message:'New project: use Demo Towers Phase 2.'}),f.env,client,{now:now+122_000})).status,201);
  assert.equal((await handleCompanyChangeRequests(req('POST',{tenantId:tid,message:'A fourth request should be blocked.'}),f.env,client,{now:now+183_000})).status,429);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM company_change_requests WHERE status='pending'").get().n,3);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM tenant_audit_events WHERE action='company.change_requested'").get().n,3);
 }finally{f.close()}
});
