import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,admin,client,setup} from './helpers/calling-fixture.mjs';
import {handleCreditWalletRequest} from '../src/credit-wallet-routes.mjs';
import {handleScriptedCallingRequest} from '../src/scripted-campaign-routes.mjs';
import {handleLaunchReadiness} from '../src/launch-readiness-routes.mjs';
import {MANUAL_CALLING_COSTS as rates} from '../src/manual-calling-costs.mjs';

const origin='https://app.example.invalid';
const request=(path,method='GET',data,from=origin)=>new Request(origin+path,{
 method,headers:{Origin:from,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})
});
const route=(f,path='provider-balance-sync',method='GET',data,user=admin,from=origin)=>
 handleCreditWalletRequest(request('/v1/human/credits/'+path,method,data,from),f.env,user,
  {fetcher:async()=>{throw Error('manual balance sync must not call a provider')}});
const payload=(provider,balanceMicros,expectedRevision=0)=>({id:crypto.randomUUID(),provider,balanceMicros,expectedRevision});
function fresh(f){const now=Date.now();f.c.db.prepare("UPDATE human_sessions SET created_at=?,expires_at=? WHERE user_id='admin'")
 .run(new Date(now).toISOString(),now+3600000);}
async function body(res,status=200){assert.equal(res.status,status,await res.clone().text());return res.json();}

test('manual provider sync is current-MFA and same-origin only, strictly validated, and read-only on GET',async()=>{
 const f=fixture();try{
  const d=payload('plivo',1000000);
  assert.equal((await route(f,undefined,'POST',d)).status,403);
  fresh(f);
  assert.equal((await route(f,undefined,'POST',d,client)).status,403);
  assert.equal((await route(f,undefined,'POST',d,admin,'https://other.invalid')).status,403);
  assert.equal((await route(f,'provider-balance-sync?force=1')).status,400);
  for(const patch of [{provider:'unknown'},{balanceMicros:-1},{balanceMicros:1000000000000},
   {balanceMicros:1.2},{balanceMicros:'1000'},{expectedRevision:-1},{extra:'force'},{id:'bad'}])
   assert.equal((await route(f,undefined,'POST',{...d,...patch})).status,400);
  const state=await body(await route(f));
  assert.equal(state.mode,'manual_balance');assert.equal(state.callingEnabled,false);
  assert.deepEqual(state.providers.map(p=>[p.available,p.syncedBalanceMicros,p.availableBalanceMicros,p.revision]),
   [[false,null,null,0],[false,null,null,0]]);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) n FROM provider_balance_snapshots').get().n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) n FROM provider_manual_funding_control').get().n,0);
 }finally{f.close()}
});

test('full provider totals replace snapshots; zero and exact retries are accepted without a recharge receipt',async()=>{
 const f=fixture();try{
  fresh(f);
  const first=payload('plivo',543210000);
  let state=await body(await route(f,undefined,'POST',first),201);
  assert.equal(state.providers[0].availableBalanceMicros,543210000);
  assert.equal(state.providers[1].available,false);
  assert.equal(state.status,'provider_balance_sync_required');
  assert.equal((await body(await route(f,undefined,'POST',first))).replayed,true);
  const sarvam=payload('sarvam',123450000);
  state=await body(await route(f,undefined,'POST',sarvam),201);
  assert.equal(state.status,'ready');assert.equal(state.callingEnabled,true);
  assert.deepEqual(state.providers.map(p=>p.syncedBalanceMicros),[543210000,123450000]);
  const next=payload('plivo',2000000,state.providers[0].revision);
  state=await body(await route(f,undefined,'POST',next),201);
  assert.equal(state.providers[0].syncedBalanceMicros,2000000,'pasted total replaces, never adds');
  assert.equal((await route(f,undefined,'POST',payload('plivo',999999999,next.expectedRevision))).status,409);
  state=await body(await route(f,undefined,'POST',payload('plivo',0,state.providers[0].revision)),201);
  assert.equal(state.providers[0].available,true);assert.equal(state.providers[0].availableBalanceMicros,0);
  assert.equal(state.status,'money_budget_exhausted');
  assert.equal(f.c.db.prepare('SELECT COUNT(*) n FROM provider_financial_journal').get().n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) n FROM tenant_minute_ledger').get().n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) n FROM scripted_phone_pilots').get().n,0);
 }finally{f.close()}
});

test('manual snapshots power all client readiness paths without recurring funding variables or approval flags',async()=>{
 const f=fixture();try{
  await setup(f);fresh(f);
  for(const key of Object.keys(f.env))if(/_FUNDED_CUMULATIVE_SECONDS$|_BUDGET_(?:CURRENCY|CEILING_MICROS|PULSE_MICROS)$|^AR3D_FUNDED_CAMPAIGN_DISPATCH$/.test(key))delete f.env[key];
  f.r.db.prepare('UPDATE calling_policies SET expires_at=? WHERE tenant_id=?').run(new Date(Date.now()+86400000).toISOString(),tid);
  await body(await route(f,undefined,'POST',payload('plivo',rates.plivoPulseMicros)),201);
  await body(await route(f,undefined,'POST',payload('sarvam',rates.sarvamPulseMicros)),201);
  const state=await body(await handleScriptedCallingRequest(request('/v1/human/calling/state?tenantId='+tid),f.env,client));
  assert.equal(state.configuration.ready,true);assert.equal(state.configuration.funding.source,'manual_balance');
  assert.equal(state.credits.ready,true);assert.equal(state.credits.maxCallSeconds,30);
  const wallet=await body(await route(f,'minute-ledger?tenantId='+tid,'GET',undefined,client));
  assert.equal(wallet.dispatchEnabled,true);assert.equal(wallet.spendableSeconds,30);
  const dashboard=await body(await route(f,'admin-dashboard'));
  assert.equal(dashboard.providerBudget.remainingSeconds,30);assert.equal(dashboard.settlementQueue.automaticApproved,true);
  const readiness=await body(await handleLaunchReadiness(request('/v1/human/launch-readiness'),f.env,admin));
  assert.equal(readiness.environment.find(r=>r.id==='fundingReview').configured,true);
  assert.doesNotMatch(JSON.stringify(state),/pulseMicros|capMicros|balanceMicros/);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) n FROM provider_cost_reservations').get().n,0);
 }finally{f.close()}
});

test('manual disablement is explicit and revision guarded; later balance sync never reenables calling',async()=>{
 const f=fixture();try{
  fresh(f);
  let state=await body(await route(f,undefined,'POST',payload('plivo',1000000)),201);
  await body(await route(f,undefined,'POST',payload('sarvam',1000000)),201);
  let result=await body(await route(f,'manual-funding-control','POST',{enabled:false,expectedRevision:state.controlRevision}));
  assert.equal(result.control.enabled,false);
  assert.equal((await route(f,'manual-funding-control','POST',{enabled:true,expectedRevision:1})).status,409);
  state=await body(await route(f,undefined,'POST',payload('plivo',2000000,state.providers[0].revision)),201);
  assert.equal(state.callingEnabled,false);assert.equal(state.status,'disabled');
  const settings=await body(await route(f,'funding-settings'));
  assert.equal(settings.settings.mode,'manual_balance');
  assert.equal((await route(f,'sarvam-balance','POST',{id:crypto.randomUUID(),creditsLeftMicros:3000000})).status,409);
  assert.equal((await route(f,'funding-settings','POST',{mode:'journal',plivoCurrency:'INR',plivoPulseMicros:1,
   sarvamPulseMicros:1,expectedRevision:0,evidenceRef:'synthetic-legacy-attempt'})).status,409);
  result=await body(await route(f,'manual-funding-control','POST',{enabled:true,expectedRevision:result.control.revision}));
  assert.equal(result.control.enabled,true);
 }finally{f.close()}
});
