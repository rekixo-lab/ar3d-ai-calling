import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,lead,at,now} from './helpers/calling-fixture.mjs';
import {readManualBalances,syncManualBalance,setManualFundingEnabled} from '../src/manual-provider-balances.mjs';
import {resolveFundingEnv,resolvedFunding} from '../src/provider-funding.mjs';
import {moneyBudgetConfig,providerBudgetPosition,reserveBudgetedMinutes} from '../src/provider-cost-reservations.mjs';
import {fundingCap,affordableCallSeconds,closeMinuteHold,minutePosition} from '../src/minute-holds.mjs';
import {reconcileProviderCost} from '../src/provider-cost-reconciliation.mjs';
import {MANUAL_CALLING_COSTS} from '../src/manual-calling-costs.mjs';

const P=224200,S=306800;
const other='99999999-9999-4999-8999-999999999999';
const amounts=s=>Object.fromEntries(s.money.accounts.map(a=>[a.provider,a]));
function allocate(f,tenantId=tid,seconds=6000){
 f.c.db.prepare("INSERT INTO tenant_minute_ledger(id,tenant_id,kind,delta_seconds,previous_seconds,balance_seconds,actor,reason,created_at) VALUES(?,?,'allocation',?,0,?,'admin','Synthetic client allocation',?)").run(crypto.randomUUID(),tenantId,seconds,seconds,at);
}
async function sync(f,provider,amount,time=now){
 const before=await readManualBalances(f.c.wrap);
 const result=await syncManualBalance(f.c.wrap,{id:crypto.randomUUID(),provider,balanceMicros:amount,expectedRevision:before[provider]?.sequence??0},'admin',time);
 assert.equal(result.ok,true);return result;
}
async function balances(f,p=1000000000,s=1000000000,time=now){
 await sync(f,'plivo',p,time);await sync(f,'sarvam',s,time);
}
async function state(f){
 const env=await resolveFundingEnv(f.env);
 return {env,funding:resolvedFunding(env),money:await providerBudgetPosition(f.c.wrap,moneyBudgetConfig(env))};
}
const reserve=(f,s,job=crypto.randomUUID(),seconds=30,tenantId=tid)=>reserveBudgetedMinutes(f.c.wrap,{tenantId,job,maxSeconds:seconds,now,globalCap:fundingCap(s.env),config:moneyBudgetConfig(s.env)});
async function settle(f,job,seconds=30,time=now+1,kind='verified_cdr'){
 assert.equal((await closeMinuteHold(f.c.wrap,{tenantId:tid,job,billedSeconds:seconds,kind,evidenceRef:'synthetic-cdr-'+job,now:time})).ok,true);
}
const completeMetrics=(overrides={})=>({engine:'sarvam',costMeterVersion:1,sttRoundedSeconds:30,sttFailedRequests:0,sttDurationUnknown:0,llmRequests:1,llmInputTokens:1000,llmOutputTokens:100,llmUsageUnknown:0,...overrides});
function pilot(f,job,metrics,options={}){
 f.c.db.prepare(`INSERT INTO scripted_phone_pilots(id,tenant_id,lead_id,lead_updated_at,actor_id,language,destination,caller,expires_at,phase,survey_json,created_at,provider_account_id,job_id,hangup_at)
  VALUES(?,?,?,?,'admin','hi','+919000000001','+918000000000',?,?,?,?, 'synthetic-account',?,?)`)
  .run(crypto.randomUUID(),tid,lead,at,now+3600000,options.phase??'completed',JSON.stringify({phoneMeta:metrics}),at,job,options.hangupAt===undefined?now:options.hangupAt);
}
function expense(f,provider,amount){
 const id=crypto.randomUUID(),evidenceRef='synthetic-expense-'+id;
 f.c.db.prepare("INSERT INTO provider_financial_journal(id,provider,currency,kind,amount_micros,evidence_ref,reason,actor,created_at) VALUES(?,?,'INR','expense',?,?,'Synthetic provider expense evidence','admin',?)").run(id,provider,amount,evidenceRef,at);
 return evidenceRef;
}

test('manual funding reaches the final affordable 30-second pulse with native INR planning rates',async()=>{
 const f=fixture();try{
  assert.equal(MANUAL_CALLING_COSTS.plivoPulseMicros,P);assert.equal(MANUAL_CALLING_COSTS.sarvamPulseMicros,S);
  allocate(f);await balances(f,P,S);
  const s=await state(f);
  assert.equal(s.funding.source,'manual_balance');assert.equal(s.funding.automaticProviderSync,false);
  assert.equal(s.money.remainingSeconds,30);
  assert.equal(affordableCallSeconds(180,6000,s.money.remainingSeconds),30);
  const job=crypto.randomUUID();assert.equal((await reserve(f,s,job)).ok,true);
  const after=await state(f);
  assert.equal(after.money.remainingSeconds,0);
  assert.equal(after.funding.status,'money_budget_exhausted');
  assert.equal((await reserve(f,after)).ok,false);
  const row=f.c.db.prepare('SELECT reserved_seconds,plivo_currency,plivo_micros,sarvam_currency,sarvam_micros FROM provider_cost_reservations WHERE job_id=?').get(job);
  assert.deepEqual({...row},{reserved_seconds:30,plivo_currency:'INR',plivo_micros:P,sarvam_currency:'INR',sarvam_micros:S});
  assert.equal(Object.keys(f.env).some(k=>k.includes('BUDGET')||k.includes('FUNDED')),false);
 }finally{f.close()}
});

test('sub-pulse or zero provider balances never launch a call, with no artificial larger minimum',async()=>{
 for(const [p,s,expected] of [[P-1,S,0],[P,S-1,0],[0,S,0],[P,0,0],[2*P-1,2*S-1,30],[2*P,2*S,60]]){
  const f=fixture();try{
   allocate(f);await balances(f,p,s);
   const snapshot=await state(f);
   assert.equal(snapshot.money.remainingSeconds,expected);
   assert.equal((await reserve(f,snapshot)).ok,expected>=30);
  }finally{f.close()}
 }
});

test('concurrent tenants and sequential overlapping requests share one pair of provider balances',async()=>{
 const f=fixture();try{
  f.c.db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,'second','Second','starter','shared','active',?,?)").run(other,at,at);
  allocate(f);allocate(f,other);await balances(f,P,S);
  const s=await state(f);
  const jobs=[crypto.randomUUID(),crypto.randomUUID()];
  const attempts=await Promise.all([reserve(f,s,jobs[0],30,tid),reserve(f,s,jobs[1],30,other)]);
  assert.equal(attempts.filter(x=>x.ok).length,1);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM provider_cost_reservations').get().n,1);
  assert.equal(f.c.db.prepare("SELECT SUM(reserved_seconds) AS n FROM tenant_minute_holds WHERE state='held'").get().n,30);
  assert.equal((await reserve(f,s,crypto.randomUUID(),30,other)).ok,false,'reusing the stale request envelope cannot spend a second pulse');
  const winner=attempts[0].ok?0:1;
  assert.equal((await reserve(f,s,jobs[winner],30,winner===0?tid:other)).ok,false,'same job cannot submit twice');
 }finally{f.close()}
});

test('atomic reservation rejects changed control and either changed provider observation',async()=>{
 const f=fixture();try{
  allocate(f);await balances(f);
  const initial=await state(f);
  await sync(f,'plivo',1000000000,now+1);
  assert.equal((await reserve(f,initial)).ok,false,'same amount with a newer Plivo observation still invalidates old envelope');
  const afterPlivo=await state(f);
  await sync(f,'sarvam',1000000000,now+2);
  assert.equal((await reserve(f,afterPlivo)).ok,false,'Sarvam revision is also guarded');
  const enabled=await state(f);
  assert.equal((await setManualFundingEnabled(f.c.wrap,{enabled:false,expectedRevision:1},'admin',now+3)).ok,true);
  assert.equal((await reserve(f,enabled)).ok,false);
  assert.equal((await state(f)).funding.status,'disabled');
  await balances(f,1000000000,1000000000,now+4);
  assert.equal((await state(f)).funding.status,'disabled','sync never re-enables owner disablement');
  assert.equal((await setManualFundingEnabled(f.c.wrap,{enabled:true,expectedRevision:2},'admin',now+5)).ok,true);
  assert.equal((await reserve(f,enabled)).ok,false,'reenabling creates a new control revision');
  assert.equal((await reserve(f,await state(f))).ok,true);
 }finally{f.close()}
});

test('resync replaces current balances and excludes settled history without forgiving a live call',async()=>{
 const f=fixture();try{
  allocate(f);await balances(f);
  const old=crypto.randomUUID(),held=crypto.randomUUID();
  assert.equal((await reserve(f,await state(f),old,180)).ok,true);
  assert.equal((await reserve(f,await state(f),held,30)).ok,true);
  await settle(f,old,30,now+1);
  let s=await state(f);
  assert.equal(amounts(s).plivo.committedMicros,2*P);
  assert.equal(amounts(s).sarvam.committedMicros,7*S,'unmetered settled AI retains full 180-second reservation');
  await sync(f,'plivo',5*P,now+60002);
  s=await state(f);
  assert.equal(amounts(s).plivo.committedMicros,P);
  assert.equal(amounts(s).plivo.remainingMicros,4*P);
  assert.equal(amounts(s).sarvam.committedMicros,7*S,'Plivo sync does not cover Sarvam liabilities');
  await sync(f,'sarvam',5*S,now+60002);
  s=await state(f);
  assert.equal(amounts(s).sarvam.committedMicros,S);
  assert.equal(s.money.remainingSeconds,120);
  assert.equal((await reserve(f,s,crypto.randomUUID(),120)).ok,true);
  s=await state(f);assert.equal(s.money.remainingSeconds,0);
  assert.equal(f.c.db.prepare('SELECT state FROM tenant_minute_holds WHERE job_id=?').get(held).state,'held');
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_minute_ledger').get().n,1,'balance sync does not rewrite client wallet');
 }finally{f.close()}
});

test('late reconciliation of a covered old call cannot mint additional spending capacity',async()=>{
 const f=fixture();try{
  allocate(f);await balances(f);
  const job=crypto.randomUUID();assert.equal((await reserve(f,await state(f),job,180)).ok,true);
  await settle(f,job,30,now+1);
  await balances(f,3*P,3*S,now+60002);
  const before=await state(f);assert.equal(before.money.remainingSeconds,90);
  for(const [provider,actual] of [['plivo',100000],['sarvam',10000]]){
   const evidenceRef=expense(f,provider,actual);
   const result=await reconcileProviderCost(f.c.wrap,{tenantId:tid,jobId:job,provider,evidenceRef,zeroCost:false},'admin',now+60003);
   assert.equal(result.ok,true);
  }
  const after=await state(f);
  assert.deepEqual(after.money.accounts,before.money.accounts);
  assert.equal(after.money.remainingSeconds,90,'lower actual costs of already covered calls do not increase snapshot funds');
  assert.equal((await reserve(f,after,crypto.randomUUID(),90)).ok,true);
  assert.equal((await state(f)).money.remainingSeconds,0);
 }finally{f.close()}
});

test('unknown held calls survive positive and zero resync; explicit no-submission evidence releases capacity',async()=>{
 const f=fixture();try{
  allocate(f);await balances(f,2*P,2*S);
  const job=crypto.randomUUID();assert.equal((await reserve(f,await state(f),job,60)).ok,true);
  await balances(f,0,0,now+120000);
  let s=await state(f);assert.equal(s.money.remainingSeconds,0);assert.equal((await reserve(f,s)).ok,false);
  await balances(f,3*P,3*S,now+120001);
  s=await state(f);assert.equal(s.money.remainingSeconds,30);
  assert.equal(amounts(s).plivo.heldMicros,2*P);assert.equal(amounts(s).sarvam.heldMicros,2*S);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM provider_balance_covered_calls').get().n,0);
  await settle(f,job,0,now+120002,'verified_no_submission');
  s=await state(f);assert.equal(s.money.remainingSeconds,90);
  assert.equal((await minutePosition(f.c.wrap,tid)).usedSeconds,0);
 }finally{f.close()}
});

test('verified shorter CDR reduces only Plivo estimate; complete terminal Sarvam usage replaces its full reserve',async()=>{
 const f=fixture();try{
  allocate(f);await balances(f,6*P,6*S);
  const job=crypto.randomUUID();assert.equal((await reserve(f,await state(f),job,180)).ok,true);
  pilot(f,job,completeMetrics());
  let s=await state(f);
  assert.equal(amounts(s).plivo.committedMicros,6*P);assert.equal(amounts(s).sarvam.committedMicros,6*S,'in-flight call keeps full reserve even if current metrics look complete');
  await settle(f,job,30);
  s=await state(f);
  assert.equal(amounts(s).plivo.committedMicros,P);
  const ai=Math.ceil((Math.ceil(30*490000/60)+1000*10+100*25)*118/100);
  assert.equal(ai,303850);assert.equal(amounts(s).sarvam.committedMicros,ai);
  assert.equal(amounts(s).plivo.usedMicros,P);assert.equal(amounts(s).sarvam.heldMicros,0);
  assert.equal(s.money.remainingSeconds,150);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM provider_cost_reconciliations').get().n,0,'estimates never create verified invoice evidence');
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM provider_financial_journal').get().n,0);
 }finally{f.close()}
});

test('unknown, failed, malformed, in-flight or unsigned Sarvam usage retains the entire reserve',async()=>{
 const cases=[
  {metrics:{engine:'sarvam'}},
  {metrics:completeMetrics({sttDurationUnknown:1})},
  {metrics:completeMetrics({sttFailedRequests:1})},
  {metrics:completeMetrics({llmUsageUnknown:1})},
  {metrics:completeMetrics({technicalFailure:true})},
  {metrics:completeMetrics({llmInputTokens:'1000'})},
  {metrics:completeMetrics(),options:{phase:'transcribing'}},
  {metrics:completeMetrics(),options:{hangupAt:null}}
 ];
 for(const {metrics,options} of cases){
  const f=fixture();try{
   allocate(f);await balances(f,6*P,6*S);
   const job=crypto.randomUUID();assert.equal((await reserve(f,await state(f),job,180)).ok,true);
   pilot(f,job,metrics,options);await settle(f,job,30);
   const s=await state(f);
   assert.equal(amounts(s).plivo.committedMicros,P);
   assert.equal(amounts(s).sarvam.committedMicros,6*S,JSON.stringify({metrics,options}));
   assert.equal(s.money.remainingSeconds,0);
  }finally{f.close()}
 }
});

test('a terminal consent-declined call with complete zero AI usage spends no estimated Sarvam funds',async()=>{
 const f=fixture();try{
  allocate(f);await balances(f,2*P,2*S);
  const job=crypto.randomUUID();assert.equal((await reserve(f,await state(f),job,60)).ok,true);
  pilot(f,job,completeMetrics({sttRoundedSeconds:0,llmRequests:0,llmInputTokens:0,llmOutputTokens:0}),{phase:'declined'});
  await settle(f,job,30);
  const s=await state(f);
  assert.equal(amounts(s).plivo.committedMicros,P);assert.equal(amounts(s).sarvam.committedMicros,0);
  assert.equal(s.money.remainingSeconds,30);
 }finally{f.close()}
});
