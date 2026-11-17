import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {cookieFor,validEmail,validPassword,makePassword,checkPassword,mutationOriginAllowed,requireMembership,randomSecret} from '../src/human-auth.mjs';
import {js,html} from '../src/app-assets.mjs';
import vm from 'node:vm';

test('human passwords use salted slow PBKDF2 and verify without plaintext storage',async()=>{
  const p=await makePassword('correct horse battery staple');
  assert.equal(p.iterations>=200000,true);
  assert.equal(p.hash.length,64);
  assert.equal(p.salt.length,32);
  assert.equal(await checkPassword('correct horse battery staple',{password_salt:p.salt,password_hash:p.hash,password_iterations:p.iterations}),true);
  assert.equal(await checkPassword('wrong 123456789',{password_salt:p.salt,password_hash:p.hash,password_iterations:p.iterations}),false);
  assert.notEqual((await makePassword('correct horse battery staple')).salt,p.salt);
  assert.throws(()=>validPassword('short'),/12/);
  assert.equal(validEmail('  OWNER@EXAMPLE.COM '),'owner@example.com');
  assert.throws(()=>validEmail('not-an-email'));
});
test('session cookie cannot be accessed by JS and browser mutations need same origin',()=>{
  assert.match(cookieFor(randomSecret()),/HttpOnly; Secure; SameSite=Strict/);
  assert.match(cookieFor('',0),/Max-Age=0/);
  assert.equal(mutationOriginAllowed(new Request('https://example.test/app',{method:'POST',headers:{origin:'https://evil.test'}})),false);
  assert.equal(mutationOriginAllowed(new Request('https://example.test/app',{method:'POST'})),false);
  assert.equal(mutationOriginAllowed(new Request('https://example.test/app',{method:'POST',headers:{origin:'https://example.test'}})),true);
});
test('tenant membership lookup is bound to authenticated user (not super-admin bypass)',async()=>{
  const queries=[];
  const db={prepare(sql){return {bind(...args){queries.push({sql,args});return {async first(){return null}}}}}};
  const user={id:'user-A',globalRole:'super_admin'};
  const forbidden=await requireMembership(db,user,'11111111-1111-4111-8111-111111111111');
  assert.equal(forbidden,null);
  assert.equal(queries[0].args[0],'11111111-1111-4111-8111-111111111111');
  assert.equal(queries[0].args[1],'user-A');
});
test('UI is self-contained and scripts parse',async()=>{
  assert.match(html,/AR3D AI Calling/);
  assert.doesNotMatch(html,/https:\/\//);
  assert.doesNotThrow(()=>new vm.Script(js));
  const r=await worker.fetch(new Request('https://example.test/app'),{});
  assert.equal(r.status,200);
  assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);
});
test('human API needs real cookie, denied no-origin writes, unauthenticated reads',async()=>{
  const env={CONTROL_DB:{prepare(){throw new Error('no DB query should happen')}}};
  const r=await worker.fetch(new Request('https://example.test/v1/human/me'),env);
  assert.equal(r.status,401);
  const create=await worker.fetch(new Request('https://example.test/v1/human/tenants',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),env);
  assert.equal(create.status,403);
});
test('client cannot fetch another tenant overview with forged query selector',async()=>{
  const calls=[];
  const token='a'.repeat(64);
  const env={
    CONTROL_DB:{prepare(sql){return {bind(...params){calls.push({sql,params});return {async first(){if(sql.includes('FROM human_sessions'))return {id:'user-A',email:'one@example.com',globalRole:'user',token_hash:'x'};return null},async all(){return {results:[]}}}}}}},
    CRM_DB:{prepare(){throw new Error('CRM DB should not be accessed by an unauthorized tenant')}}
  };
  const r=await worker.fetch(new Request('https://example.test/v1/human/overview?tenantId=22222222-2222-4222-8222-222222222222',{headers:{cookie:'ar3d_calling_session='+token}}),env);
  assert.equal(r.status,403);
  assert.equal(calls.some(x=>x.sql.includes('tenant_memberships')),true);
  assert.equal(calls.find(x=>x.sql.includes('tenant_memberships')).params[1],'user-A');
});
