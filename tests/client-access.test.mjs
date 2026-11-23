import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,admin,client,at} from './helpers/calling-fixture.mjs';
import {handleClientAccessRequest} from '../src/client-access-routes.mjs';
import {requireMembership} from '../src/human-auth.mjs';

const base='https://calling.example.test/v1/human/tenants/'+tid;
const request=(path,reason='Access review: company owner confirmed the offboarding')=>
  new Request('https://calling.example.test'+path,{
    method:'POST',headers:{origin:'https://calling.example.test','content-type':'application/json'},
    body:JSON.stringify({reason})
  });
const route=(f,path,user=admin,req=new Request('https://calling.example.test'+path))=>
  handleClientAccessRequest(req,f.env,user);
function freshAdminSession(f){
  const now=Date.now();
  f.c.db.prepare("UPDATE human_sessions SET created_at=?,expires_at=? WHERE token_hash=?")
    .run(new Date(now).toISOString(),now+3600000,admin.token_hash);
}
function invitation(f,email,token='f'.repeat(64)){
  const expiry=Date.now()+86400000;
  f.c.db.prepare(`INSERT INTO human_invitations
    (token_hash,tenant_id,email,role,expires_at,created_by,created_at)
    VALUES(?,?,?,'client_admin',?,'admin',?)`)
    .run(token,tid,email,expiry,at);
  return f.c.db.prepare('SELECT rowid AS id FROM human_invitations WHERE token_hash=?').get(token).id;
}

test('Super Admin lists tenant members and pending links without credentials or invitation hashes',async()=>{
  const f=fixture();
  try{
    invitation(f,'pending@example.invalid');
    const response=await route(f,base+'/access');
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.members.length,2);
    assert.deepEqual(result.members.map(v=>v.email).sort(),['client@example.invalid','viewer@example.invalid']);
    assert.equal(result.pendingInvitations.length,1);
    assert.equal(result.pendingInvitations[0].email,'pending@example.invalid');
    assert.equal(JSON.stringify(result).includes('f'.repeat(64)),false);
    assert.equal(JSON.stringify(result).includes('password_hash'),false);
    assert.equal((await route(f,base+'/access',client)).status,403);
    assert.equal((await route(f,base+'/access',null)).status,403);
  }finally{f.close()}
});

test('disable is tenant-scoped, audit logged, and invalidates pending reinvitation',async()=>{
  const f=fixture();
  try{
    freshAdminSession(f);
    const other='77777777-7777-4777-8777-777777777777';
    f.c.db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,'other','Other','starter','shared','active',?,?)").run(other,at,at);
    f.c.db.prepare("INSERT INTO tenant_memberships(tenant_id,user_id,role,created_at) VALUES(?,?,'viewer',?)").run(other,'client',at);
    const pendingId=invitation(f,'client@example.invalid');
    assert.ok(pendingId>0);
    const r=await route(f,base+'/members/client/disable',admin,request(base+'/members/client/disable'));
    assert.equal(r.status,200,await r.text());
    assert.equal(f.c.db.prepare("SELECT status FROM tenant_memberships WHERE tenant_id=? AND user_id='client'").get(tid).status,'disabled');
    assert.equal(f.c.db.prepare("SELECT status FROM tenant_memberships WHERE tenant_id=? AND user_id='client'").get(other).status,'active');
    assert.equal(f.c.db.prepare("SELECT expires_at FROM human_invitations WHERE tenant_id=? AND email='client@example.invalid'").get(tid).expires_at,0);
    assert.equal(await requireMembership(f.env.CONTROL_DB,client,tid),null);
    assert.ok(await requireMembership(f.env.CONTROL_DB,client,other));
    assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM tenant_audit_events WHERE action='client.member_disabled' AND tenant_id=?").get(tid).n,1);
    assert.equal((await route(f,base+'/members/client/disable',admin,request(base+'/members/client/disable'))).status,409);
    assert.equal(f.c.db.prepare("SELECT status FROM tenant_memberships WHERE tenant_id=? AND user_id='viewer'").get(tid).status,'active');
  }finally{f.close()}
});

test('revoke disables only one unused invitation and cannot be repeated',async()=>{
  const f=fixture();
  try{
    freshAdminSession(f);
    const id=invitation(f,'new@example.invalid');
    const otherId=invitation(f,'other@example.invalid','e'.repeat(64));
    const path=base+'/invitations/'+id+'/revoke';
    assert.equal((await route(f,path,admin,request(path))).status,200);
    assert.equal(f.c.db.prepare("SELECT expires_at FROM human_invitations WHERE rowid=?").get(id).expires_at,0);
    assert.ok(f.c.db.prepare("SELECT expires_at FROM human_invitations WHERE rowid=?").get(otherId).expires_at>Date.now());
    assert.equal((await route(f,path,admin,request(path))).status,409);
    assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM tenant_audit_events WHERE action='client.invitation_revoked' AND tenant_id=?").get(tid).n,1);
  }finally{f.close()}
});

test('revocation requires current MFA session, Super Admin role, valid reason and same origin',async()=>{
  const f=fixture();
  try{
    const path=base+'/members/client/disable';
    const old=await route(f,path,admin,request(path));
    assert.equal(old.status,403); // fixture's original admin session is expired
    assert.equal((await route(f,path,client,request(path))).status,403);
    freshAdminSession(f);
    assert.equal((await route(f,path,admin,request(path,'short'))).status,400);
    const noOrigin=new Request('https://calling.example.test'+path,{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({reason:'Verified customer offboarding request'})});
    assert.equal((await route(f,path,admin,noOrigin)).status,403);
    const foreign='88888888-8888-4888-8888-888888888888';
    assert.equal((await route(f,'/v1/human/tenants/'+foreign+'/members/client/disable',admin,
      request('/v1/human/tenants/'+foreign+'/members/client/disable'))).status,404);
    assert.equal(f.c.db.prepare("SELECT status FROM tenant_memberships WHERE tenant_id=? AND user_id='client'").get(tid).status,'active');
    assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM tenant_audit_events WHERE action LIKE 'client.%'").get().n,0);
  }finally{f.close()}
});
