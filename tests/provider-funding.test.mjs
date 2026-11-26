import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,at,now} from './helpers/calling-fixture.mjs';
import {resolveFundingEnv,resolvedFunding,saveFundingSettings,validFundingSettings} from '../src/provider-funding.mjs';
import {fundingCap,providerFundingCaps,fundingPosition,closeMinuteHold} from '../src/minute-holds.mjs';
import {moneyBudgetConfig,providerBudgetPosition,reserveBudgetedMinutes} from '../src/provider-cost-reservations.mjs';
import {reconcileProviderCost} from '../src/provider-cost-reconciliation.mjs';
import {recordProviderFault,providerSafety} from '../src/provider-safety.mjs';

const one='11111111-aaaa-4aaa-8aaa-111111111111',two='11111111-aaaa-4aaa-8aaa-222222222222';
const three='11111111-aaaa-4aaa-8aaa-333333333333',other='99999999-9999-4999-8999-999999999999';
const policy=(overrides={})=>({mode:'journal',plivoCurrency:'USD',plivoPulseMicros:30,sarvamPulseMicros:100,
 evidenceRef:'synthetic-reviewed-rates',expectedRevision:0,...overrides});
async function enable(f,overrides={}){
 assert.equal(await saveFundingSettings(f.env.CONTROL_DB,policy(overrides),'admin',now),true);
}
function record(f,provider,kind,amount,options={}){
 const id=options.id??crypto.randomUUID(),evidenceRef=options.evidenceRef??'synthetic-'+id;
 const currency=options.currency??(provider==='plivo'?'USD':'INR');
 f.c.db.prepare('INSERT INTO provider_financial_journal(id,provider,currency,kind,amount_micros,evidence_ref,reason,actor,created_at) VALUES(?,?,?,?,?,?,?,\'admin\',?)')
  .run(id,provider,currency,kind,amount,evidenceRef,'Synthetic provider evidence',at);
 return {id,evidenceRef};
}
function opening(f,plivo=90,sarvam=300){record(f,'plivo','opening',plivo);record(f,'sarvam','opening',sarvam);}
function allocate(f,tenant=tid,seconds=600){
 f.c.db.prepare("INSERT INTO tenant_minute_ledger(id,tenant_id,kind,delta_seconds,previous_seconds,balance_seconds,actor,reason,created_at) VALUES(?,?,'allocation',?,0,?,'admin','Synthetic client allocation',?)")
  .run('synthetic-credit-'+tenant,tenant,seconds,seconds,at);
}
async function snapshot(f){
 const env=await resolveFundingEnv(f.env);
 return {env,state:resolvedFunding(env),money:await providerBudgetPosition(f.env.CONTROL_DB,moneyBudgetConfig(env))};
}
const reserve=(f,env,job,seconds=30,tenantId=tid)=>reserveBudgetedMinutes(f.env.CONTROL_DB,
 {tenantId,job,maxSeconds:seconds,now,globalCap:fundingCap(env),config:moneyBudgetConfig(env)});
function legacy(f){
 Object.assign(f.env,{AR3D_FUNDED_CUMULATIVE_SECONDS:'900',AR3D_PLIVO_FUNDED_CUMULATIVE_SECONDS:'600',AR3D_SARVAM_FUNDED_CUMULATIVE_SECONDS:'300',
  AR3D_PLIVO_BUDGET_CURRENCY:'USD',AR3D_PLIVO_BUDGET_CEILING_MICROS:'900',AR3D_PLIVO_BUDGET_PULSE_MICROS:'30',
  AR3D_SARVAM_BUDGET_CURRENCY:'INR',AR3D_SARVAM_BUDGET_CEILING_MICROS:'3000',AR3D_SARVAM_BUDGET_PULSE_MICROS:'100'});
}

test('funding resolver preserves configured legacy ceilings only while no managed row exists',async()=>{
 const f=fixture();try{
  const empty=await resolveFundingEnv(f.env);
  assert.equal(resolvedFunding(empty).status,'setup_required');
  assert.equal(fundingCap(empty),null);
  legacy(f);
  const expected=moneyBudgetConfig(f.env),env=await resolveFundingEnv(f.env);
  assert.equal(resolvedFunding(env).source,'legacy_environment');
  assert.equal(resolvedFunding(env).status,'configured');
  assert.equal(fundingCap(env),300);
  assert.deepEqual(providerFundingCaps(env),{combined:900,plivo:600,sarvam:300});
  assert.deepEqual(moneyBudgetConfig(env),expected);
  assert.equal(await resolveFundingEnv(env),env,'already resolved request snapshot is reused');
  await enable(f);
  const managed=await resolveFundingEnv(f.env);
  assert.equal(resolvedFunding(managed).status,'provider_funding_records_required');
  assert.equal(fundingCap(managed),null,'missing managed funds never fall back to environment funding');
  assert.equal(moneyBudgetConfig(managed),null);
 }finally{f.close()}
});

test('recorded funding derives time and provider envelopes; new receipts replenish without variable edits',async()=>{
 const f=fixture();try{
  await enable(f);opening(f);allocate(f);
  assert.equal(Object.keys(f.env).some(k=>k.includes('BUDGET')||k.includes('FUNDED')),false);
  let s=await snapshot(f);
  assert.equal(s.state.source,'recorded_provider_ledger');
  assert.equal(s.state.automaticProviderSync,false);
  assert.equal(s.state.status,'ready');
  assert.equal(fundingCap(s.env),90);
  assert.equal(s.money.remainingSeconds,90);
  assert.equal((await reserve(f,s.env,one)).ok,true);
  s=await snapshot(f);
  assert.equal(fundingCap(s.env),90,'existing holds remain included in derived cumulative time');
  assert.equal(s.money.remainingSeconds,60);
  record(f,'plivo','topup',60);record(f,'sarvam','topup',200);
  s=await snapshot(f);
  assert.equal(fundingCap(s.env),150);
  assert.equal(s.money.remainingSeconds,120);
  assert.equal((await reserve(f,s.env,two,120)).ok,true);
  s=await snapshot(f);
  assert.equal(s.state.status,'money_budget_exhausted');
  assert.equal(s.money.remainingSeconds,0);
  assert.equal((await reserve(f,s.env,three)).ok,false);
  record(f,'plivo','topup',30);record(f,'sarvam','topup',100);
  s=await snapshot(f);
  assert.equal(s.money.remainingSeconds,30);
  assert.equal((await reserve(f,s.env,three)).ok,true);
  assert.equal(f.c.db.prepare("SELECT SUM(reserved_seconds) AS n FROM tenant_minute_holds WHERE state='held'").get().n,180);
  assert.equal(Object.keys(f.env).some(k=>k.includes('BUDGET')||k.includes('FUNDED')),false);
 }finally{f.close()}
});

test('expense attribution charges the journal and reservation exactly once while unattributed spend stays conservative',async()=>{
 const f=fixture();try{
  await enable(f);opening(f,150,1000);allocate(f);
  assert.equal((await reserve(f,(await snapshot(f)).env,one,60)).ok,true);
  assert.equal((await closeMinuteHold(f.env.CONTROL_DB,{tenantId:tid,job:one,billedSeconds:30,kind:'verified_cdr',evidenceRef:'synthetic-cdr-1',now})).ok,true);
  const p=record(f,'plivo','expense',20),s=record(f,'sarvam','expense',80);
  let current=await snapshot(f);
  assert.equal(current.money.accounts[0].remainingMicros,70,'unattributed expense and unconfirmed reserve both remain committed');
  assert.equal(current.money.accounts[1].remainingMicros,720);
  for(const [provider,evidence] of [['plivo',p],['sarvam',s]]){
   const result=await reconcileProviderCost(f.env.CONTROL_DB,{tenantId:tid,jobId:one,provider,evidenceRef:evidence.evidenceRef,zeroCost:false},'admin',now);
   assert.equal(result.ok,true);
   assert.equal(result.replayed,false);
   assert.equal((await reconcileProviderCost(f.env.CONTROL_DB,{tenantId:tid,jobId:one,provider,evidenceRef:evidence.evidenceRef,zeroCost:false},'admin',now)).replayed,true);
  }
  current=await snapshot(f);
  assert.equal(current.money.accounts[0].remainingMicros,130,'150 funding minus 20 actual expense');
  assert.equal(current.money.accounts[1].remainingMicros,920,'1000 funding minus 80 actual expense');
  assert.equal((await fundingPosition(f.env.CONTROL_DB,fundingCap(current.env))).usedSeconds,30);
  record(f,'plivo','expense',10);record(f,'sarvam','expense',20);
  current=await snapshot(f);
  assert.equal(current.money.accounts[0].remainingMicros,120,'unrelated provider spending reduces allowance too');
  assert.equal(current.money.accounts[1].remainingMicros,900);
 }finally{f.close()}
});

test('duplicate provider receipts cannot add capacity twice and amounts with conflicting currency fail closed',async()=>{
 const f=fixture();try{
  await enable(f);opening(f);
  const first=record(f,'plivo','topup',30,{evidenceRef:'synthetic-topup-receipt-001'});
  assert.throws(()=>record(f,'plivo','topup',30,{id:first.id,evidenceRef:first.evidenceRef}),/UNIQUE constraint failed/);
  assert.throws(()=>record(f,'plivo','topup',300,{evidenceRef:first.evidenceRef}),/UNIQUE constraint failed/);
  let s=await snapshot(f);
  assert.equal(s.money.accounts[0].capMicros,120);
  record(f,'plivo','topup',100,{currency:'INR'});
  s=await snapshot(f);
  assert.equal(s.state.status,'currency_or_amount_review_required');
  assert.equal(s.money.ready,false);
  assert.equal(fundingCap(s.env),null);
 }finally{f.close()}
});

test('settings are audited with compare-and-set; disablement cannot restore legacy allowance',async()=>{
 const f=fixture();try{
  legacy(f);opening(f);allocate(f);
  await enable(f);
  const before=(await snapshot(f)).env;
  assert.equal(await saveFundingSettings(f.env.CONTROL_DB,policy({mode:'disabled',expectedRevision:1}),'admin',now+1),true);
  assert.equal(await saveFundingSettings(f.env.CONTROL_DB,policy({expectedRevision:1}),'admin',now+2),false,'stale editor cannot reenable settings');
  const s=await snapshot(f);
  assert.equal(s.state.source,'disabled');
  assert.equal(s.state.status,'disabled');
  assert.equal(fundingCap(s.env),null);
  assert.equal(moneyBudgetConfig(s.env),null);
  assert.equal((await reserve(f,before,one)).ok,false,'previous ready snapshot cannot reserve after disablement');
  const events=f.c.db.prepare("SELECT detail_json FROM tenant_audit_events WHERE action='funding.settings_changed' ORDER BY created_at").all();
  assert.equal(events.length,2);
  assert.deepEqual(events.map(x=>JSON.parse(x.detail_json).revision),[1,2]);
  assert.equal(validFundingSettings(policy({plivoPulseMicros:0})),false);
  assert.equal(validFundingSettings({...policy(),unapprovedExtra:true}),false);
 }finally{f.close()}
});

test('funding guards reject stale journal, settings and legacy snapshots at the atomic reservation',async()=>{
 const f=fixture();try{
  legacy(f);allocate(f);opening(f);
  const oldLegacy=await resolveFundingEnv(f.env);
  await enable(f);
  assert.equal((await reserve(f,oldLegacy,one)).ok,false,'managed settings supersede even a previously resolved legacy allowance');
  const initial=(await snapshot(f)).env;
  record(f,'plivo','expense',30);
  assert.equal((await reserve(f,initial,one)).ok,false,'new spending invalidates the stale envelope');
  const beforeTariff=(await snapshot(f)).env;
  assert.equal(await saveFundingSettings(f.env.CONTROL_DB,policy({expectedRevision:1,plivoPulseMicros:60}),'admin',now+1),true);
  assert.equal((await reserve(f,beforeTariff,one)).ok,false,'a changed rate invalidates the old request');
  const refreshed=(await snapshot(f)).env;
  assert.equal((await reserve(f,refreshed,one)).ok,true);
  const row=f.c.db.prepare('SELECT plivo_micros,sarvam_micros FROM provider_cost_reservations WHERE job_id=?').get(one);
  assert.equal(row.plivo_micros,60);
  assert.equal(row.sarvam_micros,100);
 }finally{f.close()}
});

test('concurrent tenants share one recorded balance and uncertain holds survive new funding snapshots',async()=>{
 const f=fixture();try{
  f.c.db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,'another','Another','starter','shared','active',?,?)").run(other,at,at);
  await enable(f);opening(f,60,200);allocate(f);allocate(f,other);
  const env=(await snapshot(f)).env;
  const attempts=await Promise.all([reserve(f,env,one,60,tid),reserve(f,env,two,60,other)]);
  assert.equal(attempts.filter(x=>x.ok).length,1);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM provider_cost_reservations').get().n,1);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_minute_holds').get().n,1);
  const successful=attempts[0].ok?{tenant:tid,job:one}:{tenant:other,job:two};
  record(f,'plivo','topup',60);record(f,'sarvam','topup',200);
  const fresh=await snapshot(f);
  assert.equal(fresh.money.remainingSeconds,60);
  assert.equal(f.c.db.prepare('SELECT state FROM tenant_minute_holds WHERE job_id=?').get(successful.job).state,'held');
  assert.equal((await reserve(f,fresh.env,successful.job,60,successful.tenant)).ok,false,'snapshot refresh never retries an existing call');
 }finally{f.close()}
});

test('recorded topups and funding changes never clear provider authentication or billing faults',async()=>{
 const f=fixture();try{
  await enable(f);opening(f);allocate(f);
  await recordProviderFault(f.env.CONTROL_DB,'plivo',401,'synthetic-auth-fault',now);
  await recordProviderFault(f.env.CONTROL_DB,'sarvam',402,'synthetic-billing-fault',now);
  const previous=await providerSafety(f.env.CONTROL_DB);
  record(f,'plivo','topup',300);record(f,'sarvam','topup',1000);
  const s=await snapshot(f);
  assert.equal(s.money.ready,true,'recorded funds are independent of authentication review');
  assert.equal((await reserve(f,s.env,one)).ok,false);
  assert.deepEqual(await providerSafety(f.env.CONTROL_DB),previous);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_minute_holds').get().n,0);
 }finally{f.close()}
});

test('unavailable funding storage fails closed and a managed snapshot is resolved only once per invocation',async()=>{
 const f=fixture();try{
  legacy(f);
  const unavailable=await resolveFundingEnv({...f.env,CONTROL_DB:{prepare(){throw Error('unavailable')}}});
  assert.equal(resolvedFunding(unavailable).status,'funding_settings_unavailable');
  assert.equal(fundingCap(unavailable),null);
  await enable(f);opening(f);
  let queries=0;
  const measured={...f.env,CONTROL_DB:{...f.env.CONTROL_DB,prepare(sql){queries++;return f.env.CONTROL_DB.prepare(sql)}}};
  const ready=await resolveFundingEnv(measured);
  assert.equal(resolvedFunding(ready).status,'ready');
  assert.equal(queries,4,'one settings read, one ledger aggregate and two budget checks');
  assert.equal(await resolveFundingEnv(ready),ready);
  assert.equal(queries,4,'request-local snapshot prevents repeating global funding queries per tenant');
 }finally{f.close()}
});
