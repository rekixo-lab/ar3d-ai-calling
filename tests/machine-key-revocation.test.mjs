import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {sha256hex} from '../src/core.mjs';

const admin='S'.repeat(48),bootstrap='B'.repeat(48);
const tenant='22222222-2222-4222-8222-222222222222';
const other='44444444-4444-4444-8444-444444444444';
const keyId='55555555-5555-4555-8555-555555555555';
function request(path,method='GET',token=admin){
  return new Request('https://example.test'+path,{method,headers:{authorization:'Bearer '+token}});
}
function fixture(active=true){
  const statements=[];
  const db={
    prepare(sql){return {bind(...params){statements.push({sql,params});return {
      async first(){return sql.includes('FROM tenants WHERE id')?{id:tenant}:null},
      async all(){return {results:[{id:keyId,name:'Backend integration',role:'integrator',active:1,createdAt:'2026-11-18T00:00:00Z',revokedAt:null}]}},
      async run(){return {meta:{changes:1}}}
    }}}},
    async batch(queries){return queries.map((_,i)=>({meta:{changes:active?1:0}}))}
  };
  return {env:{CONTROL_DB:db,ADMIN_API_TOKEN:admin,ADMIN_BOOTSTRAP_TOKEN:bootstrap},statements};
}
test('only independent machine admin token authorizes inventory',async()=>{
  const url='/v1/admin/tenants/'+tenant+'/keys';
  const f=fixture(),response=await worker.fetch(request(url),f.env);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.keys[0].id,keyId);
  assert.equal(body.keys[0].token_hash,undefined);
  assert.equal(body.keys[0].apiKey,undefined);
  assert.ok(f.statements.every(x=>!x.sql.includes('token_hash')));
  assert.equal((await worker.fetch(request(url,'GET',bootstrap),f.env)).status,401);
  const noSecret=fixture();delete noSecret.env.ADMIN_API_TOKEN;
  assert.equal((await worker.fetch(request(url),noSecret.env)).status,401);
});
test('authorized revoke targets only tenant key and records audit',async()=>{
  const f=fixture(),url='/v1/admin/tenants/'+tenant+'/keys/'+keyId;
  const result=await worker.fetch(request(url,'DELETE'),f.env);
  assert.equal(result.status,200);
  assert.equal((await result.json()).revoked,true);
  assert.ok(f.statements.some(x=>x.sql.includes('tenant_key.revoked')));
  assert.ok(f.statements.some(x=>x.sql.includes('UPDATE tenant_keys SET active=0')));
  assert.ok(f.statements.every(x=>x.params.includes(tenant)));
});
test('revocation is idempotent, wrong token denied, other tenant not changed',async()=>{
  const absent=fixture(false),url='/v1/admin/tenants/'+tenant+'/keys/'+keyId;
  const res=await worker.fetch(request(url,'DELETE'),absent.env);
  assert.equal(res.status,200);assert.equal((await res.json()).revoked,false);
  assert.equal((await worker.fetch(request(url,'DELETE',bootstrap),fixture().env)).status,401);
  const f=fixture();
  const query=await worker.fetch(request('/v1/admin/tenants/'+other+'/keys/'+keyId,'DELETE'),f.env);
  assert.equal(query.status,200);
  assert.ok(f.statements.every(x=>x.params.includes(other)));
});
test('revoked integration key is rejected by existing tenant auth',async()=>{
  const key='ar3dca_'+('a'.repeat(64)),hash=await sha256hex(key);
  const env={CONTROL_DB:{prepare(sql){return {bind(...params){return {
    async first(){return null}
  }}}}}};
  const result=await worker.fetch(new Request('https://example.test/v1/me',{headers:{authorization:'Bearer '+key}}),env);
  assert.equal(result.status,401);
});
