import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,at,admin,client} from './helpers/calling-fixture.mjs';
import {clientFinancialReport} from '../src/client-financial-report.mjs';
import {handleCreditWalletRequest} from '../src/credit-wallet-routes.mjs';
import {reserveBudgetedMinutes} from '../src/provider-cost-reservations.mjs';
import {closeMinuteHold} from '../src/minute-holds.mjs';
import {reconcileProviderCost} from '../src/provider-cost-reconciliation.mjs';
const job='11111111-aaaa-4aaa-8aaa-111111111111',other='99999999-9999-4999-8999-999999999999';
test('FIFO prepaid value, outstanding holds, currency-separated costs and conservative contribution',async()=>{
 const f=fixture();try{
 const now=Date.now();
 f.c.db.prepare("UPDATE human_sessions SET created_at=?,expires_at=? WHERE user_id='admin'").run(new Date(now).toISOString(),now+3600000);
 const buy=(id,paid,seconds,before)=>f.c.db.prepare("INSERT INTO tenant_credit_purchases(id,tenant_id,receipt_ref,paid_paise,purchased_seconds,previous_seconds,actor,created_at) VALUES(?,?,?,?,?,?,'admin',?)").run(id,tid,'ref-'+id,paid,seconds,before,at);
 buy('purchase-one',101,60,0);buy('purchase-two',400,120,60);
 const config={plivo:{currency:'INR',capMicros:10000000,pulseMicros:10000},sarvam:{currency:'INR',capMicros:10000000,pulseMicros:10000}};
 assert.equal((await reserveBudgetedMinutes(f.env.CONTROL_DB,{tenantId:tid,job,maxSeconds:90,globalCap:180,config})).ok,true);
 let r=(await clientFinancialReport(f.env.CONTROL_DB)).rows[0];
 assert.equal(r.outstandingSeconds,180);assert.equal(r.heldSeconds,90);assert.equal(r.uncommittedSeconds,90);assert.equal(r.remainingPrepaidValuePaise,501);
 assert.equal((await closeMinuteHold(f.env.CONTROL_DB,{tenantId:tid,job,billedSeconds:90,kind:'verified_cdr',evidenceRef:'synthetic-cdr'})).ok,true);
 r=(await clientFinancialReport(f.env.CONTROL_DB)).rows[0];
 assert.equal(r.paidValueUsedPaise,201);assert.equal(r.remainingPrepaidValuePaise,300);assert.equal(r.outstandingSeconds,90);assert.equal(r.contributionMicros,null);assert.equal(r.incompleteCostCalls,1);
 const journal=(provider,amount)=>f.c.db.prepare("INSERT INTO provider_financial_journal(id,provider,currency,kind,amount_micros,evidence_ref,reason,actor,created_at) VALUES(?,?,'INR','expense',?,?,'Synthetic expense evidence','admin',?)").run(provider,provider,amount,'evidence-'+provider,at);
 journal('plivo',20000);journal('sarvam',10000);
 for(const provider of ['plivo','sarvam'])assert.equal((await reconcileProviderCost(f.env.CONTROL_DB,{tenantId:tid,jobId:job,provider,evidenceRef:'evidence-'+provider,zeroCost:false},'admin')).ok,true);
 r=(await clientFinancialReport(f.env.CONTROL_DB)).rows[0];assert.equal(r.providerCostsComplete,true);assert.equal(r.contributionMicros,1980000);
 f.c.db.prepare("INSERT INTO tenant_minute_ledger(id,tenant_id,kind,delta_seconds,previous_seconds,balance_seconds,actor,reason,created_at) VALUES(?,?,'allocation',90,180,270,'admin','Synthetic reversal',?)").run('call-reversal:'+tid+':'+job,tid,at);
 r=(await clientFinancialReport(f.env.CONTROL_DB)).rows[0];assert.equal(r.netUsedSeconds,0);assert.equal(r.outstandingSeconds,180);assert.equal(r.remainingPrepaidValuePaise,null);assert.equal(r.contributionMicros,null);
 f.c.db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,'other','Other','starter','shared','active',?,?)").run(other,at,at);
 f.c.db.prepare("UPDATE tenants SET status='suspended' WHERE id=?").run(tid);
 const all=await clientFinancialReport(f.env.CONTROL_DB);assert.equal(all.rows.length,2);assert.equal(all.rows.find(x=>x.tenantId===tid).outstandingSeconds,180);
 assert.equal((await clientFinancialReport(f.env.CONTROL_DB,{tenantId:other})).rows[0].paidPaise,0);
 const req=user=>handleCreditWalletRequest(new Request('https://app.example.invalid/v1/human/credits/client-financial-report'),f.env,user);
 assert.equal((await req(client)).status,403);
 const report=await (await req(admin)).json();assert.equal(report.profitVerified,false);assert.equal(report.recognizedRevenuePaise,null);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_credit_purchases').get().n,2);
 }finally{f.close()}
});
