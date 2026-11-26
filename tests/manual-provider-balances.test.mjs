import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture,tid,at,now} from './helpers/calling-fixture.mjs';
import {readManualBalances,syncManualBalance,setManualFundingEnabled,validManualBalanceSync} from '../src/manual-provider-balances.mjs';
import {closeMinuteHold} from '../src/minute-holds.mjs';
import {recordProviderFault,providerSafety} from '../src/provider-safety.mjs';

const observation=(provider='plivo',balanceMicros=1000000000,expectedRevision=0)=>({id:crypto.randomUUID(),provider,balanceMicros,expectedRevision});
const sync=(f,d=observation(),time=now)=>syncManualBalance(f.c.wrap,d,'admin',time);
const count=(f,table)=>f.c.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
function allocate(f){
 f.c.db.prepare("INSERT INTO tenant_minute_ledger(id,tenant_id,kind,delta_seconds,previous_seconds,balance_seconds,actor,reason,created_at) VALUES('synthetic-manual-funding',?,'allocation',6000,0,6000,'admin','Synthetic allocation',?)").run(tid,at);
}
function reserve(f,job=crypto.randomUUID()){
 f.c.db.prepare("INSERT INTO provider_cost_reservations(tenant_id,job_id,reserved_seconds,plivo_currency,plivo_micros,sarvam_currency,sarvam_micros,created_at) VALUES(?,?,180,'INR',3000000,'INR',1000000,?)").run(tid,job,at);
 return job;
}
async function settle(f,job,time,kind='verified_cdr'){
 const result=await closeMinuteHold(f.c.wrap,{tenantId:tid,job,billedSeconds:kind==='verified_cdr'?30:0,kind,evidenceRef:'synthetic-cdr-'+job,now:time});
 assert.equal(result.ok,true);
}
const covered=f=>f.c.db.prepare('SELECT provider,job_id AS job,snapshot_sequence AS revision FROM provider_balance_covered_calls ORDER BY provider,job_id').all().map(r=>({...r}));
const audits=f=>f.c.db.prepare("SELECT * FROM tenant_audit_events WHERE action='funding.balance_synced'").all();

test('manual balances seed no money or enablement and replace observations rather than add topups',async()=>{
 const f=fixture();try{
  assert.deepEqual(await readManualBalances(f.c.wrap),{plivo:null,sarvam:null,control:null});
  const first=await sync(f,observation('plivo',1000000000));
  assert.equal(first.ok,true);assert.equal(first.replayed,false);
  const second=await sync(f,observation('plivo',400000000,first.snapshot.sequence),now+1);
  const sarvam=await sync(f,observation('sarvam',1200000000),now+2);
  const balances=await readManualBalances(f.c.wrap);
  assert.equal(balances.plivo.balanceMicros,400000000);
  assert.equal(balances.plivo.sequence,second.snapshot.sequence);
  assert.equal(balances.sarvam.balanceMicros,1200000000);
  assert.equal(balances.sarvam.sequence,sarvam.snapshot.sequence);
  assert.deepEqual(balances.control,{enabled:true,revision:1,updatedBy:'admin',updatedAt:at});
  assert.equal(count(f,'provider_financial_journal'),0,'observations do not manufacture provider receipts');
  assert.equal(count(f,'tenant_minute_ledger'),0,'observations do not allocate client credits');
  assert.equal(audits(f).length,3);
 }finally{f.close()}
});

test('sync is exact-id idempotent and stale balance revisions cannot replace newer balances',async()=>{
 const f=fixture();try{
  const d=observation();const first=await sync(f,d);
  assert.equal((await sync(f,d,now+1000)).replayed,true);
  for(const changed of [{...d,balanceMicros:2},{...d,provider:'sarvam'},{...d,expectedRevision:first.snapshot.sequence}]){
   assert.equal((await sync(f,changed)).reason,'conflicting_sync_id');
  }
  assert.equal((await syncManualBalance(f.c.wrap,d,'client',now)).reason,'conflicting_sync_id');
  assert.equal((await sync(f,observation('plivo',3,0))).reason,'balance_changed');
  const second=await sync(f,observation('plivo',500,first.snapshot.sequence),now+1);
  assert.equal(second.ok,true);
  assert.equal((await sync(f,d,now+2000)).replayed,true,'old exact retry does not restore its old amount');
  assert.equal((await readManualBalances(f.c.wrap)).plivo.balanceMicros,500);
  assert.equal(count(f,'provider_balance_snapshots'),2);assert.equal(audits(f).length,2);
 }finally{f.close()}
});

test('serialized concurrent CAS admits one editor and duplicate request side effects run once',async()=>{
 const f=fixture();try{
  let queue=Promise.resolve();
  const concurrent={...f.c.wrap,batch(queries){const next=queue.then(()=>f.c.wrap.batch(queries));queue=next.catch(()=>{});return next;}};
  const d=observation();
  const same=await Promise.all([syncManualBalance(concurrent,d,'admin',now),syncManualBalance(concurrent,d,'admin',now)]);
  assert.equal(same.filter(x=>x.ok&&!x.replayed).length,1);
  assert.equal(same.filter(x=>x.ok&&x.replayed).length,1);
  assert.equal(audits(f).length,1);
  const revision=same[0].snapshot.sequence;
  const different=await Promise.all([syncManualBalance(concurrent,observation('plivo',500,revision),'admin',now+1),syncManualBalance(concurrent,observation('plivo',700,revision),'admin',now+1)]);
  assert.equal(different.filter(x=>x.ok).length,1);
  assert.equal(different.filter(x=>x.reason==='balance_changed').length,1);
  assert.equal(count(f,'provider_balance_snapshots'),2);assert.equal(audits(f).length,2);
 }finally{f.close()}
});

test('snapshot covers posted settled liabilities only and retry cannot absorb a newly closed call',async()=>{
 const f=fixture();try{
  allocate(f);
  const old=reserve(f),edge=reserve(f),recent=reserve(f),held=reserve(f),released=reserve(f);
  await settle(f,old,now-61000);await settle(f,edge,now-60000);await settle(f,recent,now-59999);
  await settle(f,released,now-120000,'verified_no_submission');
  const d=observation();const first=await sync(f,d);
  assert.deepEqual(covered(f).map(x=>x.job).sort(),[old,edge].sort());
  assert.equal(covered(f).every(x=>x.provider==='plivo'&&x.revision===first.snapshot.sequence),true);
  await settle(f,held,now+1);
  await sync(f,d,now+120000);
  assert.equal(covered(f).length,2,'old request replay cannot expand original coverage');
  const newer=await sync(f,observation('plivo',400000000,first.snapshot.sequence),now+120000);
  assert.equal(covered(f).length,4);
  assert.equal(covered(f).find(x=>x.job===old).revision,first.snapshot.sequence,'old coverage remains immutable');
  assert.equal(covered(f).find(x=>x.job===held).revision,newer.snapshot.sequence);
  assert.equal(covered(f).some(x=>x.job===released),false);
  await sync(f,observation('sarvam',300000000),now+120000);
  assert.equal(covered(f).length,8,'each provider has its own balance observation');
  assert.equal(count(f,'tenant_minute_ledger'),1);
  assert.equal(count(f,'provider_cost_reservations'),5);
  assert.equal(f.c.db.prepare("SELECT state FROM tenant_minute_holds WHERE job_id=?").get(released).state,'released');
 }finally{f.close()}
});

test('unknown calls remain held through a lower, zero or higher copied balance',async()=>{
 const f=fixture();try{
  allocate(f);const job=reserve(f);
  let revision=0;
  for(const amount of [1000000000,0,2000000000]){
   const result=await sync(f,observation('plivo',amount,revision));revision=result.snapshot.sequence;
   assert.equal(count(f,'provider_balance_covered_calls'),0);
   const hold=f.c.db.prepare('SELECT state,reserved_seconds,charged_seconds FROM tenant_minute_holds WHERE job_id=?').get(job);
   assert.deepEqual({...hold},{state:'held',reserved_seconds:180,charged_seconds:null});
  }
 }finally{f.close()}
});

test('explicit disablement survives new balance observations and control updates require its current revision',async()=>{
 const f=fixture();try{
  const disabled=await setManualFundingEnabled(f.c.wrap,{enabled:false,expectedRevision:0},'admin',now);
  assert.equal(disabled.ok,true);assert.equal(disabled.control.revision,1);
  const d=observation();await sync(f,d,now+1);
  assert.equal((await readManualBalances(f.c.wrap)).control.enabled,false);
  assert.equal((await setManualFundingEnabled(f.c.wrap,{enabled:true,expectedRevision:0},'admin',now+2)).reason,'control_changed');
  const enabled=await setManualFundingEnabled(f.c.wrap,{enabled:true,expectedRevision:1},'admin',now+3);
  assert.equal(enabled.ok,true);assert.equal(enabled.control.revision,2);
  assert.equal((await setManualFundingEnabled(f.c.wrap,{enabled:false,expectedRevision:1},'admin',now+4)).ok,false);
  assert.equal((await readManualBalances(f.c.wrap)).control.enabled,true);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM tenant_audit_events WHERE action='funding.manual_control_changed'").get().n,2);
  assert.throws(()=>f.c.db.exec('DELETE FROM provider_manual_funding_control'),/cannot be deleted/);
  assert.throws(()=>f.c.db.exec('UPDATE provider_manual_funding_control SET enabled=0'),/revision must advance once/);
  assert.throws(()=>f.c.db.exec('UPDATE provider_manual_funding_control SET revision=revision+2'),/revision must advance once/);
  f.c.db.exec(readFileSync('migrations/control/0031_manual_provider_balances.sql','utf8'));
  assert.equal((await readManualBalances(f.c.wrap)).control.revision,2,'migration retry does not reset operator choice');
 }finally{f.close()}
});

test('a positive new observation reviews only that provider billing 402 and a retry cannot review a later failure',async()=>{
 const f=fixture();try{
  await recordProviderFault(f.c.wrap,'plivo',402,'synthetic-402-first',now-1);
  await recordProviderFault(f.c.wrap,'sarvam',402,'synthetic-sarvam-402',now-1);
  const zero=await sync(f,observation('plivo',0));
  assert.equal((await providerSafety(f.c.wrap)).find(x=>x.provider==='plivo').blocked,true);
  const d=observation('plivo',1000000000,zero.snapshot.sequence);await sync(f,d,now+1);
  let state=await providerSafety(f.c.wrap);
  assert.equal(state.find(x=>x.provider==='plivo').blocked,false);
  assert.equal(state.find(x=>x.provider==='plivo').code,'manual_balance_sync');
  assert.equal(state.find(x=>x.provider==='sarvam').blocked,true);
  await recordProviderFault(f.c.wrap,'plivo',402,'synthetic-402-later',now+2);
  await sync(f,d,now+3);
  state=await providerSafety(f.c.wrap);
  assert.equal(state.find(x=>x.provider==='plivo').blocked,true,'retry is not new billing evidence');
  assert.equal(count(f,'provider_financial_journal'),0);
 }finally{f.close()}
});

test('manual balances cannot clear authentication, route or overspend faults hidden by a later 402',async()=>{
 for(const code of ['http_401','http_403','cost_over_reserve']){
  const f=fixture();try{
   f.c.db.prepare("INSERT INTO provider_safety_events(provider,kind,code,evidence_ref,actor,created_at) VALUES('plivo','blocked',?,'synthetic-nonbilling','system',?)").run(code,at);
   await sync(f,observation('sarvam',1000000000),now+1);
   await recordProviderFault(f.c.wrap,'plivo',402,'synthetic-latest-402',now+2);
   await sync(f,observation('plivo',1000000000),now+3);
   assert.equal((await providerSafety(f.c.wrap)).find(x=>x.provider==='plivo').blocked,true,code);
   assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM provider_safety_events WHERE kind='reviewed'").get().n,0);
  }finally{f.close()}
 }
});

test('observations older than a recorded billing fault do not review that fault',async()=>{
 const f=fixture();try{
  await recordProviderFault(f.c.wrap,'plivo',402,'synthetic-later-fault',now+1000);
  await sync(f,observation(),now);
  assert.equal((await providerSafety(f.c.wrap)).find(x=>x.provider==='plivo').blocked,true);
 }finally{f.close()}
});

test('schema forbids edits and invalid coverage, and validates native INR amounts and actor identity',async()=>{
 const f=fixture();try{
  allocate(f);const held=reserve(f),recent=reserve(f),old=reserve(f);
  await settle(f,recent,now-1);await settle(f,old,now-60001);
  const result=await sync(f,observation());
  const sequence=result.snapshot.sequence;
  assert.throws(()=>f.c.db.exec('UPDATE provider_balance_snapshots SET balance_micros=0'),/immutable/);
  assert.throws(()=>f.c.db.exec('DELETE FROM provider_balance_snapshots'),/immutable/);
  assert.throws(()=>f.c.db.exec('UPDATE provider_balance_covered_calls SET snapshot_sequence=1'),/immutable/);
  assert.throws(()=>f.c.db.exec('DELETE FROM provider_balance_covered_calls'),/immutable/);
  const insert=f.c.db.prepare('INSERT INTO provider_balance_covered_calls(provider,tenant_id,job_id,snapshot_sequence) VALUES(?,?,?,?)');
  for(const args of [['plivo',tid,held,sequence],['plivo',tid,recent,sequence],['sarvam',tid,old,sequence],['plivo',tid,old,sequence+100]]){
   assert.throws(()=>insert.run(...args),/only posted settled calls/);
  }
  const raw=f.c.db.prepare('INSERT INTO provider_balance_snapshots(id,provider,currency,balance_micros,actor,created_at) VALUES(?,?,?,?,?,?)');
  for(const [provider,currency,amount,actor,date] of [['other','INR',1,'admin',at],['plivo','USD',1,'admin',at],['plivo','INR',-1,'admin',at],['plivo','INR',1000000000000,'admin',at],['plivo','INR',1.5,'admin',at],['plivo','INR',1,'admin','bad']]){
   assert.throws(()=>raw.run(crypto.randomUUID(),provider,currency,amount,actor,date),/CHECK constraint/);
  }
  assert.throws(()=>raw.run(crypto.randomUUID(),'plivo','INR',1,'missing',at),/FOREIGN KEY/);
  for(const invalid of [{...observation(),currency:'USD'},{...observation(),balanceMicros:1.5},{...observation(),expectedRevision:-1},{...observation(),balanceMicros:NaN},{...observation(),id:'bad'}]){
   assert.equal(validManualBalanceSync(invalid),false);
   await assert.rejects(sync(f,invalid),/invalid manual balance sync/);
  }
 }finally{f.close()}
});

test('audit failure rolls back balance, covered liabilities, control and billing review together',async()=>{
 const f=fixture();try{
  allocate(f);const job=reserve(f);await settle(f,job,now-60001);
  await recordProviderFault(f.c.wrap,'plivo',402,'synthetic-billing-fault',now-1);
  f.c.db.exec("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON tenant_audit_events BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
  await assert.rejects(sync(f,observation()),/synthetic audit failure/);
  assert.deepEqual(await readManualBalances(f.c.wrap),{plivo:null,sarvam:null,control:null});
  assert.equal(count(f,'provider_balance_covered_calls'),0);
  assert.equal((await providerSafety(f.c.wrap)).find(x=>x.provider==='plivo').blocked,true);
 }finally{f.close()}
});
