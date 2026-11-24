import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,at,now,setup,accepted} from './helpers/calling-fixture.mjs';
import {moneyBudgetConfig,providerBudgetPosition,reserveBudgetedMinutes} from '../src/provider-cost-reservations.mjs';
import {closeMinuteHold,minutePosition} from '../src/minute-holds.mjs';
import {tickScriptedTenant,scriptedCampaignConfiguration} from '../src/scripted-campaign-dispatch.mjs';
import {approvedCampaignPhone} from '../src/scripted-phone-pilot.mjs';
const one='11111111-aaaa-4aaa-8aaa-111111111111',two='11111111-aaaa-4aaa-8aaa-222222222222',other='99999999-9999-4999-8999-999999999999';
const config={plivo:{currency:'USD',capMicros:100,pulseMicros:30},sarvam:{currency:'INR',capMicros:1000,pulseMicros:100}};
function fund(f,id){f.c.db.prepare("INSERT INTO tenant_minute_ledger(id,tenant_id,kind,delta_seconds,previous_seconds,balance_seconds,actor,reason,created_at) VALUES(?,?,'allocation',600,0,600,'admin','Synthetic allocation',?)").run('fund-'+id,id,at);}
test('independent provider budgets reserve atomically across tenants, no duplicate or inferred refund',async()=>{
 const f=fixture();try{
 f.c.db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,'other','Other','starter','shared','active',?,?)").run(other,at,at);
 fund(f,tid);fund(f,other);
 const reserve=(tenantId,job)=>reserveBudgetedMinutes(f.env.CONTROL_DB,{tenantId,job,maxSeconds:60,globalCap:600,config});
 const results=await Promise.all([reserve(tid,one),reserve(other,two)]);
 assert.equal(results.filter(x=>x.ok).length,1);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM provider_cost_reservations').get().n,1);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_minute_holds').get().n,1);
 const a=results[0].ok?{tenantId:tid,job:one}:{tenantId:other,job:two},b=results[0].ok?{tenantId:other,job:two}:{tenantId:tid,job:one};
 assert.equal((await reserve(a.tenantId,a.job)).ok,false);
 let p=await providerBudgetPosition(f.env.CONTROL_DB,config);assert.equal(p.remainingSeconds,30);assert.equal(p.accounts[0].remainingMicros,40);
 assert.equal((await closeMinuteHold(f.env.CONTROL_DB,{...a,billedSeconds:30,kind:'verified_cdr',evidenceRef:'verified-test'})).ok,true);
 assert.equal((await providerBudgetPosition(f.env.CONTROL_DB,config)).accounts[0].remainingMicros,40);
 assert.equal((await minutePosition(f.env.CONTROL_DB,a.tenantId)).usedSeconds,30);
 assert.equal((await reserveBudgetedMinutes(f.env.CONTROL_DB,{...b,maxSeconds:30,globalCap:600,config})).ok,true);
 assert.equal((await closeMinuteHold(f.env.CONTROL_DB,{...b,billedSeconds:0,kind:'verified_no_submission',evidenceRef:'rejected-test'})).ok,true);
 assert.equal((await providerBudgetPosition(f.env.CONTROL_DB,config)).accounts[0].remainingMicros,40);
 assert.throws(()=>f.c.db.exec('DELETE FROM provider_cost_reservations'),/immutable/);
 assert.throws(()=>f.c.db.exec('UPDATE provider_cost_reservations SET plivo_micros=1'),/immutable/);
 }finally{f.close()}
});
test('monetary capacity limits actual Plivo duration and missing configuration fails closed',async()=>{
 const f=fixture();try{await setup(f);
 assert.ok(moneyBudgetConfig(f.env));delete f.env.AR3D_SARVAM_BUDGET_CEILING_MICROS;
 assert.equal((await scriptedCampaignConfiguration(f.env)).ready,false);
 f.env.AR3D_SARVAM_BUDGET_CEILING_MICROS='200000';
 const out=await tickScriptedTenant(f.env,f.r.wrap,tid,await approvedCampaignPhone(f.env),{now,apiFetch:async(_url,opts)=>{
 const body=JSON.parse(opts.body);assert.equal(body.time_limit,60);
 const r=f.c.db.prepare('SELECT * FROM provider_cost_reservations').get();assert.equal(r.sarvam_micros,200000);assert.equal(r.plivo_micros,20000);
 assert.equal(f.c.db.prepare('SELECT reserved_seconds FROM tenant_minute_holds').get().reserved_seconds,60);
 return accepted();}});
 assert.equal(out.state,'submitted');
 }finally{f.close()}
});


test('synthetic burst across 32 tenants cannot exceed shared funding; duplicate settlements stay exact',async()=>{
 const f=fixture();try{
  const ids=Array.from({length:32},(_,i)=>'77777777-7777-4777-8777-'+String(i+1).padStart(12,'0'));
  for(const [i,id] of ids.entries()){
   f.c.db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,?,?,'starter','shared','active',?,?)").run(id,'burst-'+i,'Synthetic '+i,at,at);fund(f,id);
  }
  const cfg={plivo:{currency:'USD',capMicros:960,pulseMicros:30},sarvam:{currency:'INR',capMicros:3200,pulseMicros:100}};
  const jobs=ids.map((tenantId,i)=>({tenantId,job:'88888888-8888-4888-8888-'+String(i+1).padStart(12,'0')}));
  const result=await Promise.all(jobs.map(j=>reserveBudgetedMinutes(f.env.CONTROL_DB,{...j,maxSeconds:60,globalCap:960,config:cfg})));
  const accepted=jobs.filter((_,i)=>result[i].ok);assert.equal(accepted.length,16);
  assert.equal((await providerBudgetPosition(f.env.CONTROL_DB,cfg)).remainingSeconds,0);
  for(const [i,j] of accepted.entries()){
   const evidence={...j,billedSeconds:30,kind:'verified_cdr',evidenceRef:'synthetic-burst-'+i};
   const both=await Promise.all([closeMinuteHold(f.env.CONTROL_DB,evidence),closeMinuteHold(f.env.CONTROL_DB,evidence)]);
   assert.ok(both.every(x=>x.ok));assert.equal(both.filter(x=>!x.replayed).length,1);
   assert.equal((await minutePosition(f.env.CONTROL_DB,j.tenantId)).usedSeconds,30);
  }
  assert.equal(f.c.db.prepare("SELECT SUM(charged_seconds) AS n FROM tenant_minute_holds").get().n,480);
  // No monetary release is inferred from shorter billed time before exact provider reconciliation.
  assert.equal((await providerBudgetPosition(f.env.CONTROL_DB,cfg)).remainingSeconds,0);
 }finally{f.close()}
});
