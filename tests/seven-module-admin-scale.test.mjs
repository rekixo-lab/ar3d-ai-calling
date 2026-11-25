// Cross-module release audit: Super Admin >1,000 client directory and bounded
// usage statistics. All data is synthetic; no provider or production D1 calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {fixture,tid,at} from './helpers/calling-fixture.mjs';
import {enrichAdminTenantsWithUsage} from '../src/admin-usage.mjs';
import {newSession,COOKIE} from '../src/human-auth.mjs';
import {js} from '../src/app-assets.mjs';

const origin='https://calling.example.test';
async function get(f,token,params=''){
 return worker.fetch(new Request(origin+'/v1/human/tenants'+params,{
  headers:{cookie:COOKIE+'='+token}
 }),f.env);
}
function seedMany(f,n=1105){
 const add=f.c.db.prepare(`INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at)
  VALUES(?,?,?,'starter','shared','active',?,?)`);
 for(let k=0;k<n;k++)
  add.run('00000000-0000-4000-8000-'+String(k).padStart(12,'0'),
   'client-'+k,'Synthetic Builder '+k,at,at);
}

test('Super Admin directory pages beyond position 1000 and reports actual global totals',async()=>{
 const f=fixture();
 try{
  seedMany(f);
  const token=await newSession(f.env.CONTROL_DB,'admin');
  const first=await get(f,token);
  assert.equal(first.status,200,await first.clone().text());
  const a=await first.json();
  assert.equal(a.tenants.length,100);
  assert.equal(a.total,1106);
  assert.equal(a.active,1106);
  assert.equal(a.members,2);
  assert.equal(a.matched,1106);
  assert.equal(a.limit,100);
  const last=await get(f,token,'?limit=100&offset=1000');
  assert.equal(last.status,200,await last.clone().text());
  const b=await last.json();
  assert.equal(b.offset,1000);
  assert.equal(b.tenants.length,100);
  assert.equal(b.total,1106);
  assert.ok(b.tenants.some(t=>t.slug.startsWith('client-')));
  const beyond=await get(f,token,'?limit=100&offset=1100');
  assert.equal(beyond.status,200);
  assert.equal((await beyond.json()).tenants.length,6);
  const search=await get(f,token,'?q=CLIENT-1099');
  assert.equal(search.status,200);
  const match=await search.json();
  assert.equal(match.matched,1);
  assert.deepEqual(match.tenants.map(t=>t.slug),['client-1099']);
  assert.equal(match.total,1106);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
 }finally{f.close()}
});

test('directory refuses unsafe pagination and viewer access before client aggregation',async()=>{
 const f=fixture();
 try{
  const token=await newSession(f.env.CONTROL_DB,'admin');
  const viewer=await newSession(f.env.CONTROL_DB,'viewer');
  assert.equal((await get(f,viewer)).status,403);
  for(const invalid of ['?offset=-1','?limit=0','?limit=101','?offset=1000001',
   '?q='+encodeURIComponent('A'.repeat(81)),'?q=a&q=b','?other=x','?limit=01a'])
    assert.equal((await get(f,token,invalid)).status,400,invalid);
 }finally{f.close()}
});

test('admin usage reporting aggregates only requested tenant IDs, not the entire shared database',async()=>{
 const f=fixture();
 try{
  const queries=[];
  const backing=f.env.CRM_DB;
  const env={...f.env,CRM_DB:{prepare(sql){
   queries.push(sql);
   return backing.prepare(sql);
  }}};
  const report=await enrichAdminTenantsWithUsage(env,[{id:tid,storage_mode:'shared'}]);
  assert.equal(report.length,1);
  assert.equal(report[0].usage.customers,1);
  assert.equal(queries.length,3);
  for(const sql of queries){
   assert.match(sql,/tenant_id IN \(SELECT value FROM json_each\(\?\)\)/);
   assert.match(sql,/GROUP BY tenant_id/);
  }
  assert.deepEqual(await enrichAdminTenantsWithUsage(env,[]),[]);
  assert.equal(queries.length,3);
 }finally{f.close()}
});

test('all Super Admin management panels can search clients instead of stopping at first page',()=>{
 assert.match(js,/Search all clients/);
 assert.match(js,/Search all companies/);
 assert.match(js,/Search all clients/);
 assert.match(js,/function inviteSection\(main\)/);
 assert.match(js,/function companyAdminPanel\(main,client=null\)/);
 assert.match(js,/function callingAdminPanel\(main,client=null\)/);
 assert.match(js,/adminCompanyChangesPanel\(requests,company.value\)/);
 assert.match(js,/Next companies/);
 assert.match(js,/Math\.floor\(pageOffset\/100\)/);
});
