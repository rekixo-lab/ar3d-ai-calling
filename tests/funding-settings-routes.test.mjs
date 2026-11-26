import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,admin,client,configureScriptedCampaign,setup} from './helpers/calling-fixture.mjs';
import {handleCreditWalletRequest} from '../src/credit-wallet-routes.mjs';
import {handleScriptedCallingRequest} from '../src/scripted-campaign-routes.mjs';
import {handleLaunchReadiness} from '../src/launch-readiness-routes.mjs';
import {recordProviderFault} from '../src/provider-safety.mjs';

const origin='https://app.example.invalid';
const settings={mode:'journal',plivoCurrency:'USD',plivoPulseMicros:10000,sarvamPulseMicros:100000,evidenceRef:'reviewed-paid-funding-001',expectedRevision:0};
const request=(path,method='GET',data,source=origin)=>new Request(origin+path,{
 method,headers:{Origin:source,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})
});
const credit=(f,path,user=admin,method='GET',data,fetcher=async()=>{throw Error('unexpected provider request')})=>
 handleCreditWalletRequest(request('/v1/human/credits/'+path,method,data),f.env,user,{fetcher});
const readJson=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json()};
function freshMfa(f){
 const now=Date.now();f.c.db.prepare("UPDATE human_sessions SET created_at=?,expires_at=? WHERE user_id='admin'")
  .run(new Date(now).toISOString(),now+3600000);
}
function paidAccount(f,patch={}){
 return {auth_id:f.env.PLIVO_AUTH_ID,account_type:'standard',billing_mode:'prepaid',cash_credits:'999.00',...patch};
}
function removeManualLimits(f){
 for(const key of Object.keys(f.env))if(/_FUNDED_CUMULATIVE_SECONDS$|_BUDGET_(?:CURRENCY|CEILING_MICROS|PULSE_MICROS)$/.test(key))delete f.env[key];
}
async function journal(f,provider,kind,amountMicros,ref){
 const data={id:crypto.randomUUID(),provider,currency:provider==='plivo'?'USD':'INR',kind,amountMicros,
  evidenceRef:ref,reason:'Synthetic reviewed provider evidence for test'};
 const response=await credit(f,'provider-journal',admin,'POST',data);
 assert.equal(response.status,201,await response.clone().text());return data;
}
async function funded(f){
 await setup(f);freshMfa(f);removeManualLimits(f);
 // Keep the independently approved policy current for the live-clock wallet
 // endpoint. The fixture's deterministic campaign setup uses a fixed date.
 f.r.db.prepare('UPDATE calling_policies SET expires_at=? WHERE tenant_id=?').run(new Date(Date.now()+86400000).toISOString(),tid);
 await journal(f,'plivo','opening',40000,'synthetic-plivo-opening');
 await journal(f,'sarvam','opening',400000,'synthetic-sarvam-opening');
 return readJson(await credit(f,'funding-settings',admin,'POST',settings,async()=>Response.json(paidAccount(f))));
}
async function clientState(f){
 return readJson(await handleScriptedCallingRequest(request('/v1/human/calling/state?tenantId='+tid),f.env,client));
}

test('funding settings require current MFA, same origin, valid schema and never probe providers on denied requests',async()=>{
 const f=fixture();try{
  configureScriptedCampaign(f);let calls=0;
  const fetcher=async()=>{calls++;return Response.json(paidAccount(f))};
  assert.equal((await credit(f,'funding-settings',client)).status,403);
  assert.equal((await credit(f,'funding-settings',client,'POST',settings,fetcher)).status,403);
  f.c.db.prepare("UPDATE human_sessions SET expires_at=0 WHERE user_id='admin'").run();
  assert.equal((await credit(f,'funding-settings',admin,'POST',settings,fetcher)).status,403);
  freshMfa(f);
  assert.equal((await handleCreditWalletRequest(request('/v1/human/credits/funding-settings','POST',settings,'https://other.invalid'),f.env,admin,{fetcher})).status,403);
  for(const patch of [{plivoPulseMicros:0},{sarvamPulseMicros:0.5},{plivoCurrency:'EUR'},{extra:'force'},{expectedRevision:-1},{evidenceRef:'short'}]){
   assert.equal((await credit(f,'funding-settings',admin,'POST',{...settings,...patch},fetcher)).status,400);
  }
  assert.equal((await credit(f,'funding-settings?force=1')).status,400);
  assert.equal((await credit(f,'funding-settings',admin,'PUT')).status,405);
  assert.equal(calls,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) n FROM calling_funding_settings').get().n,0);
 }finally{f.close()}
});

test('funding enable rejects trial, postpaid, identity mismatch, zero balance and unavailable Plivo without writing settings',async()=>{
 const f=fixture();try{
  configureScriptedCampaign(f);freshMfa(f);
  for(const patch of [{account_type:'developer'},{billing_mode:'postpaid'},{auth_id:undefined},{auth_id:'DIFFERENT123'},{cash_credits:'0.0000009'}]){
   const response=await credit(f,'funding-settings',admin,'POST',settings,async()=>Response.json(paidAccount(f,patch)));
   assert.equal(response.status,409,await response.clone().text());
  }
  assert.equal((await credit(f,'funding-settings',admin,'POST',settings,async()=>{throw Error('synthetic network outage')})).status,409);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) n FROM calling_funding_settings').get().n,0);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) n FROM tenant_audit_events WHERE action='funding.settings_changed'").get().n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) n FROM provider_financial_journal').get().n,0);
 }finally{f.close()}
});

test('funding save is audited and revision guarded, and disabling needs no provider access or legacy fallback',async()=>{
 const f=fixture();try{
  configureScriptedCampaign(f);freshMfa(f);let calls=0;
  const fetcher=async(url,options)=>{
   calls++;assert.equal(url,'https://api.plivo.com/v1/Account/'+f.env.PLIVO_AUTH_ID+'/');
   assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');
   return Response.json(paidAccount(f));
  };
  const saved=await readJson(await credit(f,'funding-settings',admin,'POST',settings,fetcher));
  assert.equal(saved.settings.revision,1);assert.equal(saved.settings.mode,'journal');
  assert.equal(saved.funding.status,'provider_funding_records_required');
  assert.equal(saved.automaticProviderSync,false);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) n FROM provider_financial_journal').get().n,0,'provider balance must not create funds');
  assert.equal((await credit(f,'funding-settings',admin,'POST',settings,fetcher)).status,409);
  const rows=f.c.db.prepare("SELECT actor,detail_json FROM tenant_audit_events WHERE action='funding.settings_changed'").all();
  assert.equal(rows.length,1);assert.equal(rows[0].actor,admin.id);
  assert.equal(JSON.parse(rows[0].detail_json).revision,1);
  const before=calls;
  const disabled=await readJson(await credit(f,'funding-settings',admin,'POST',{...settings,mode:'disabled',expectedRevision:1},fetcher));
  assert.equal(calls,before,'disabling must not require provider connectivity');
  assert.equal(disabled.settings.revision,2);assert.equal(disabled.funding.source,'disabled');
  assert.equal(disabled.funding.config,null);assert.equal(disabled.funding.globalCap,null);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) n FROM tenant_audit_events WHERE action='funding.settings_changed'").get().n,2);
  const observed=await readJson(await credit(f,'funding-settings'));
  assert.equal(observed.funding.source,'disabled');
  assert.ok(!JSON.stringify(observed).includes(f.env.PLIVO_AUTH_TOKEN));
  assert.ok(!JSON.stringify(observed).includes(f.env.PLIVO_AUTH_ID));
 }finally{f.close()}
});

test('recorded funds replace all nine limit variables consistently across admin, client, wallet and readiness',async()=>{
 const f=fixture();try{
  const saved=await funded(f);
  assert.equal(saved.funding.source,'recorded_provider_ledger');assert.equal(saved.funding.status,'ready');
  assert.equal(saved.funding.globalCap,120);
  assert.equal(saved.funding.config.plivo.capMicros,40000,'observed provider USD balance does not inflate the ledger');
  const [state,wallet,overview,readiness]=await Promise.all([
   clientState(f),credit(f,'minute-ledger?tenantId='+tid,client).then(readJson),
   credit(f,'admin-dashboard').then(readJson),
   handleLaunchReadiness(request('/v1/human/launch-readiness'),f.env,admin).then(readJson)
  ]);
  assert.equal(state.configuration.ready,true);assert.equal(state.credits.ready,true);assert.equal(state.credits.maxCallSeconds,120);
  assert.equal(wallet.dispatchEnabled,true);assert.equal(wallet.spendableSeconds,120);
  assert.equal(overview.providerBudget.remainingSeconds,120);assert.equal(overview.funding.remainingFundedSeconds,120);
  assert.equal(readiness.environment.find(row=>row.id==='fundingReview').configured,true);
  assert.equal(readiness.liveCallAttempted,false);assert.equal(readiness.customerCallsAuthorizedByThisReport,false);
  assert.doesNotMatch(JSON.stringify(state),/pulseMicros|capMicros|reviewed-paid-funding-001/);
  assert.doesNotMatch(JSON.stringify(wallet),/pulseMicros|capMicros|reviewed-paid-funding-001/);
  assert.equal(Object.keys(f.env).filter(key=>/_FUNDED_CUMULATIVE_SECONDS$|_BUDGET_(?:CURRENCY|CEILING_MICROS|PULSE_MICROS)$/.test(key)).length,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) n FROM provider_cost_reservations').get().n,0,'readiness cannot submit or reserve a call');
 }finally{f.close()}
});

test('recorded depletion pauses and a deduplicated recharge restores eligibility without settings or variable changes',async()=>{
 const f=fixture();try{
  await funded(f);
  await journal(f,'plivo','expense',40000,'synthetic-account-expense');
  let state=await clientState(f);assert.equal(state.credits.ready,false);
  let wallet=await readJson(await credit(f,'minute-ledger?tenantId='+tid,client));assert.equal(wallet.dispatchEnabled,false);assert.equal(wallet.spendableSeconds,0);
  const topup=await journal(f,'plivo','topup',40000,'synthetic-paid-topup');
  assert.equal((await credit(f,'provider-journal',admin,'POST',topup)).status,200);
  state=await clientState(f);assert.equal(state.credits.ready,true);assert.equal(state.credits.maxCallSeconds,120);
  wallet=await readJson(await credit(f,'minute-ledger?tenantId='+tid,client));assert.equal(wallet.spendableSeconds,120);
  const observed=await readJson(await credit(f,'funding-settings'));
  assert.equal(observed.settings.revision,1);assert.equal(observed.funding.config.plivo.capMicros,40000);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) n FROM provider_financial_journal WHERE evidence_ref='synthetic-paid-topup'").get().n,1);
  await recordProviderFault(f.env.CONTROL_DB,'sarvam',403,'synthetic-auth-fault');
  await journal(f,'sarvam','topup',400000,'synthetic-extra-recharge');
  assert.equal((await clientState(f)).configuration.ready,false,'funding never clears an authentication fault');
 }finally{f.close()}
});
