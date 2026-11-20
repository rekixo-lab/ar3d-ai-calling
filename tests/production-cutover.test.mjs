import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {handleProductionCutover} from '../src/production-cutover-routes.mjs';

const NOW=Date.parse('2026-11-20T14:45:00.000Z');
const user={id:'123e4567-e89b-42d3-a456-426614174000',
  globalRole:'super_admin',token_hash:'a'.repeat(64)};
const request=(path='/v1/human/engineering/production-cutover',method='GET')=>
  new Request('https://aicalling.ar3dstudio.in'+path,{method});

function makeSqlite(which,{mfa=true}={}){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of readdirSync(join('migrations',which))
    .filter(name=>name.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(join('migrations',which,file),'utf8'));
  const history=[];
  const wrapper={
    prepare(sql){
      history.push(sql);
      assert.match(sql,/^\s*SELECT\b/i,'production cutover must be read-only');
      if(sql.includes('human_mfa_settings m JOIN human_sessions s')){
        return {bind(...args){return {async first(){
          return mfa&&args[0]===user.id&&args[1]===user.token_hash?
            {enabled_at:'2026-11-20T14:00:00.000Z'}:null;
        }}}};
      }
      const stmt=sqlite.prepare(sql);
      return {bind(...args){return {
        async first(){return stmt.get(...args)||null},
        async all(){return {results:stmt.all(...args)}}
      }}};
    }
  };
  return {sqlite,wrapper,history};
}
function fixture(opts={}){
  const ctl=makeSqlite('control',opts);
  const crm=makeSqlite('crm',opts);
  return {control:ctl,crm,env:{
    CONTROL_DB:ctl.wrapper,CRM_DB:crm.wrapper,
    EXOTEL_OPERATOR_TEST_ENABLED:'enabled',
    CUSTOMER_CALLING_ENABLED:'enabled', // untrusted rollout flags never approve
    PRODUCTION_APPROVED:'true',
    EXOTEL_REGION:'singapore',
    EXOTEL_API_KEY:'fictional-provider-key',
    EXOTEL_API_TOKEN:'fictional-provider-secret'
  },close(){ctl.sqlite.close();crm.sqlite.close()}};
}
test('actual migrated Control + CRM are guarded; legal/provider launch is still NO_GO',async()=>{
  const f=fixture();
  try{
    const response=await handleProductionCutover(request(),f.env,user,{now:NOW});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    const data=await response.json();
    assert.equal(data.verdict,'NO_GO');
    assert.equal(data.customerCampaignLaunchAuthorized,false);
    assert.equal(data.hundredCustomerCallPilotAuthorized,false);
    assert.equal(data.paidSubscriptionsAuthorized,false);
    assert.equal(data.databaseSafety.control,'guarded');
    assert.equal(data.databaseSafety.crm,'guarded');
    assert.deepEqual(data.databaseSafety.controlMissing,[]);
    assert.deepEqual(data.databaseSafety.crmMissing,[]);
    assert.ok(data.blockers.length>=12);
    assert.ok(data.blockers.every(g=>g.independentlyVerified===false));
    assert.equal(data.providerNetworkRequests,0);
    assert.equal(data.customerCallsPlaced,0);
    assert.equal(data.crmMutations,0);
    assert.ok(f.control.history.every(s=>/^SELECT/.test(s)));
    assert.ok(f.crm.history.every(s=>/^SELECT/.test(s)));
    const serialized=JSON.stringify(data);
    for(const secret of ['fictional-provider-secret','fictional-provider-key',
      user.token_hash,'+919876543210'])
      assert.ok(!serialized.includes(secret),'secret leaked');
    assert.equal(f.crm.sqlite.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
  }finally{f.close()}
});
test('missing protection trigger becomes an explicit incomplete schema, never GO',async()=>{
  const f=fixture();
  try{
    f.crm.sqlite.exec('DROP TRIGGER trg_no_call_launch');
    f.control.sqlite.exec('DROP TRIGGER trg_exotel_voicebot_receipt_immutable');
    const res=await handleProductionCutover(request(),f.env,user,{now:NOW});
    assert.equal(res.status,200);
    const data=await res.json();
    assert.equal(data.verdict,'NO_GO');
    assert.equal(data.databaseSafety.control,'incomplete');
    assert.equal(data.databaseSafety.crm,'incomplete');
    assert.ok(data.databaseSafety.crmMissing.includes('trg_no_call_launch'));
    assert.ok(data.databaseSafety.controlMissing.includes('trg_exotel_voicebot_receipt_immutable'));
    assert.equal(data.customerCampaignLaunchAuthorized,false);
  }finally{f.close()}
});
test('Super Admin with missing/old MFA cannot read cutover diagnostics',async()=>{
  const f=fixture({mfa:false});
  try{
    const denied=await handleProductionCutover(request(),f.env,user,{now:NOW});
    assert.equal(denied.status,403);
    assert.equal((await denied.json()).error,'current_mfa_session_required');
    assert.equal(f.crm.history.length,0);
    for(const wrong of [null,{...user,globalRole:'viewer'},
      {...user,globalRole:'client_admin'}]){
      const r=await handleProductionCutover(request(),f.env,wrong,{now:NOW});
      assert.equal(r.status,403);
    }
  }finally{f.close()}
});
test('no POST/query overrides, no external execution or tenant selection',async()=>{
  const f=fixture();
  try{
    assert.equal((await handleProductionCutover(request(
      '/v1/human/engineering/production-cutover','POST'),f.env,user,{now:NOW})).status,405);
    assert.equal((await handleProductionCutover(request(
      '/v1/human/engineering/production-cutover?approved=1&tenantId=other'),
      f.env,user,{now:NOW})).status,400);
    assert.equal(await handleProductionCutover(request('/unrelated'),f.env,user,{now:NOW}),null);
    assert.equal(f.control.history.length,0);
    assert.equal(f.crm.history.length,0);
  }finally{f.close()}
});
test('missing database and schema errors fail closed with no detailed SQL data',async()=>{
  const f=fixture();
  try{
    assert.equal((await handleProductionCutover(request(),{
      CONTROL_DB:f.control.wrapper
    },user,{now:NOW})).status,503);
    const broken={prepare(sql){if(sql.includes('human_mfa_settings'))
      return f.control.wrapper.prepare(sql);
      throw Error('private database title & credentials');
    }};
    const res=await handleProductionCutover(request(),{
      ...f.env,CONTROL_DB:broken
    },user,{now:NOW});
    assert.equal(res.status,503);
    assert.deepEqual(await res.json(),{error:'production_preflight_unavailable'});
  }finally{f.close()}
});
