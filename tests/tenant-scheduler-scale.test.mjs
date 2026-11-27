// Synthetic 1,000-company Calling scheduler acceptance. Plivo is a local stub;
// no real provider, customer or phone number is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,at,configureScriptedCampaign} from './helpers/calling-fixture.mjs';
import {runScriptedCampaignCron,dispatchSettings,signalProviderThrottle,DEFAULT_QUERY_BUDGET} from '../src/scripted-campaign-dispatch.mjs';
import {SCRIPTED_CALLING_POLICY} from '../src/scripted-phone-pilot.mjs';

const anchor=Date.parse('2026-11-20T06:30:00Z'),STEP=60000;
const tenantId=i=>'00000000-'+String(i).padStart(4,'0')+'-4000-8000-000000000000';

// n companies, each approved, funded, with `per` cleared customers queued in a running campaign.
function seed(f,n,per){
 configureScriptedCampaign(f);
 Object.assign(f.env,{AR3D_FUNDED_CUMULATIVE_SECONDS:'90000000',AR3D_PLIVO_FUNDED_CUMULATIVE_SECONDS:'90000000',AR3D_SARVAM_FUNDED_CUMULATIVE_SECONDS:'90000000',
  AR3D_PLIVO_BUDGET_CEILING_MICROS:'900000000000',AR3D_SARVAM_BUDGET_CEILING_MICROS:'900000000000'});
 const c=f.c.db,r=f.r.db,until=new Date(anchor+86400000).toISOString();
 const T=c.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,?,'Synthetic Builder','starter','shared','active',?,?)");
 const M=c.prepare("INSERT INTO tenant_minute_ledger(id,tenant_id,kind,delta_seconds,previous_seconds,balance_seconds,actor,reason,created_at) VALUES(?,?,'allocation',600000,0,600000,'admin','Synthetic scale allocation',?)");
 const P=r.prepare("INSERT INTO calling_policies(tenant_id,enabled,flow_id,approval_reference,expires_at,daily_limit,max_seconds,updated_by,updated_at) VALUES(?,1,?,'synthetic-approval',?,100,180,'admin',?)");
 const D=r.prepare("INSERT INTO call_campaign_drafts(tenant_id,id,name,language_mode,purpose,status,created_by,created_at,updated_at) VALUES(?,?,'Scale','hi','property_information','draft','client',?,?)");
 const R=r.prepare("INSERT INTO calling_runs(tenant_id,id,campaign_id,state,created_by,created_at,updated_at) VALUES(?,?,?,'running','client',?,?)");
 const L=r.prepare("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES(?,?,'Synthetic buyer',?,'excel',?,?)");
 const V=r.prepare("INSERT INTO calling_clearances(tenant_id,lead_id,purpose,consent_reference,dnd_reference,expires_at,reviewed_by,reviewed_at) VALUES(?,?,'property_information','consent-ref','dnd-ref',?,'admin',?)");
 const J=r.prepare("INSERT INTO calling_jobs(tenant_id,id,run_id,lead_id,state,flow_id,created_at,updated_at) VALUES(?,?,?,?,'queued',?,?,?)");
 c.exec('BEGIN');r.exec('BEGIN');
 for(let i=0;i<n;i++){
  const t=tenantId(i),camp=crypto.randomUUID(),run=crypto.randomUUID();
  T.run(t,'scale-'+i,at,at);M.run('scale-'+i,t,at);P.run(t,SCRIPTED_CALLING_POLICY,until,at);D.run(t,camp,at,at);R.run(t,run,camp,at,at);
  for(let k=0;k<per;k++){const lead=crypto.randomUUID();L.run(t,lead,'+9190'+String(i*10+k).padStart(8,'0'),at,at);V.run(t,lead,until,at);J.run(t,crypto.randomUUID(),run,lead,SCRIPTED_CALLING_POLICY,at,at)}
 }
 c.exec('COMMIT');r.exec('COMMIT');
}
let seq=0;
const plivo=log=>async(_u,opts)=>{const b=JSON.parse(opts.body);log.push(b.to);return Response.json({request_uuid:'scale-request-'+(++seq)},{status:202})};
const liveByTenant=f=>Object.fromEntries(f.r.db.prepare("SELECT tenant_id AS t,COUNT(*) AS n FROM calling_jobs WHERE state IN('reserved','submitted') GROUP BY tenant_id").all().map(x=>[x.t,x.n]));
const hangUpAll=(f,now,except='')=>f.c.db.prepare("UPDATE scripted_phone_pilots SET phase='completed',hangup_at=? WHERE job_id IS NOT NULL AND hangup_at IS NULL AND tenant_id!=?").run(now,except);

test('1,000 companies share the platform limit fairly: one call each before anyone gets a second',async()=>{
 const f=fixture();
 try{
  seed(f,1000,3);
  const settings={maxConcurrent:600,maxPerCompany:3,queryBudget:950};
  const log=[];let now=anchor,minutes=0;
  const seen=new Set();
  // Calls last under two minutes. Every company is reached before any company gets a second call.
  while(seen.size<1000&&minutes<60){
   f.c.db.prepare("UPDATE scripted_phone_pilots SET phase='completed',hangup_at=? WHERE job_id IS NOT NULL AND hangup_at IS NULL AND created_at<=?").run(now,new Date(now-90000).toISOString());
   const r=await runScriptedCampaignCron(f.env,{now,apiFetch:plivo(log),settings});
   assert.ok(r.queriesUsed<=settings.queryBudget,'query budget respected: '+r.queriesUsed);
   assert.ok(r.liveCalls<=settings.maxConcurrent);
   const live=liveByTenant(f);
   assert.ok(Object.values(live).every(n=>n<=settings.maxPerCompany));
   for(const t of Object.keys(live))seen.add(t);
   const dialedPerCompany=f.r.db.prepare("SELECT tenant_id,COUNT(*) AS n FROM calling_jobs WHERE state!='queued' GROUP BY tenant_id").all();
   if(seen.size<1000)assert.ok(dialedPerCompany.every(x=>x.n===1),'no second call while some company still waits');
   now+=STEP;minutes++;
  }
  assert.equal(seen.size,1000,'every company dialed');
  assert.equal(new Set(log).size,log.length,'no customer dialed twice');
  // Throughput: dials per minute are limited by the query budget, not by "2 companies".
  assert.ok(log.length/minutes>=30,'at least 30 new calls per minute at paid-plan budget, got '+(log.length/minutes));
  // Calls finish: their lines are reused and every queued customer is reached.
  for(let k=0;k<120&&f.r.db.prepare("SELECT COUNT(*) AS n FROM calling_jobs WHERE state='queued'").get().n;k++){
   hangUpAll(f,now);
   await runScriptedCampaignCron(f.env,{now,apiFetch:plivo(log),settings});now+=STEP;
  }
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM calling_jobs WHERE state='queued'").get().n,0);
  assert.equal(log.length,3000);assert.equal(new Set(log).size,3000);
  hangUpAll(f,now);await runScriptedCampaignCron(f.env,{now,apiFetch:plivo(log),settings});
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM calling_jobs WHERE state='completed'").get().n,3000);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM tenant_minute_holds").get().n,3000);
 }finally{f.close()}
});

test('platform and per-company limits hold; a company can run several calls at once',async()=>{
 const f=fixture();
 try{
  seed(f,4,10);
  const log=[];
  const r=await runScriptedCampaignCron(f.env,{now:anchor,apiFetch:plivo(log),settings:{maxConcurrent:10,maxPerCompany:3,queryBudget:950}});
  assert.equal(r.dialed,10);assert.equal(r.liveCalls,10);
  const live=Object.values(liveByTenant(f)).sort();
  assert.deepEqual(live,[2,2,3,3]);
  // Full platform: nothing new until a call ends.
  const again=await runScriptedCampaignCron(f.env,{now:anchor+STEP,apiFetch:()=>assert.fail('platform is full'),settings:{maxConcurrent:10,maxPerCompany:3,queryBudget:950}});
  assert.equal(again.dialed,0);
  hangUpAll(f,anchor+STEP);
  const after=await runScriptedCampaignCron(f.env,{now:anchor+2*STEP,apiFetch:plivo(log),settings:{maxConcurrent:10,maxPerCompany:3,queryBudget:950}});
  assert.equal(after.reconciled,10);assert.equal(after.dialed,10);
 }finally{f.close()}
});

test('free-plan query budget is never exceeded and an uncertain call still locks only its company',async()=>{
 const f=fixture();
 try{
  seed(f,20,2);
  const log=[];
  const r=await runScriptedCampaignCron(f.env,{now:anchor,apiFetch:plivo(log),settings:{maxConcurrent:50,maxPerCompany:1,queryBudget:DEFAULT_QUERY_BUDGET}});
  assert.ok(r.queriesUsed<=DEFAULT_QUERY_BUDGET,'used '+r.queriesUsed);
  assert.ok(r.dialed>=1);
  // Mark one company's call uncertain: that company pauses, others continue.
  const locked=f.r.db.prepare("SELECT tenant_id FROM calling_jobs WHERE state='submitted' LIMIT 1").get().tenant_id;
  f.r.db.prepare("UPDATE calling_jobs SET state='unknown' WHERE tenant_id=? AND state='submitted'").run(locked);
  for(let k=1;k<15;k++){hangUpAll(f,anchor+k*STEP,locked);await runScriptedCampaignCron(f.env,{now:anchor+k*STEP,apiFetch:plivo(log),settings:{maxConcurrent:50,maxPerCompany:2,queryBudget:950}})}
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM calling_jobs WHERE tenant_id=? AND state='queued'").get(locked).n,1);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM calling_jobs WHERE tenant_id!=? AND state='queued'").get(locked).n,0);
 }finally{f.close()}
});

test('a Sarvam rate-limit signal pauses new calls briefly; saved settings override defaults',async()=>{
 const f=fixture();
 try{
  seed(f,3,2);
  await signalProviderThrottle(f.env,'sarvam',anchor,120000);
  const paused=await runScriptedCampaignCron(f.env,{now:anchor,apiFetch:()=>assert.fail('throttled'),settings:{maxConcurrent:10,maxPerCompany:2,queryBudget:950}});
  assert.equal(paused.throttled,true);assert.equal(paused.dialed,0);
  const resumed=await runScriptedCampaignCron(f.env,{now:anchor+180000,apiFetch:plivo([]),settings:{maxConcurrent:10,maxPerCompany:2,queryBudget:950}});
  assert.equal(resumed.throttled,false);assert.ok(resumed.dialed>0);
  assert.equal((await dispatchSettings(f.env)).maxConcurrent,8);
  f.c.db.prepare("INSERT INTO calling_dispatch_settings(id,max_concurrent_calls,max_calls_per_company,updated_by,updated_at) VALUES(1,300,20,'admin',?)").run(at);
  assert.deepEqual([(await dispatchSettings(f.env)).maxConcurrent,(await dispatchSettings(f.env)).maxPerCompany],[300,20]);
 }finally{f.close()}
});

test('outside 09:00-20:00 IST and with the kill switch, the scheduler dials nobody',async()=>{
 const f=fixture();
 try{
  seed(f,3,1);
  const night=Date.parse('2026-11-20T16:00:00Z'); // 21:30 IST
  assert.equal((await runScriptedCampaignCron(f.env,{now:night,apiFetch:()=>assert.fail('outside hours'),settings:{maxConcurrent:10,maxPerCompany:2,queryBudget:950}})).dialed,0);
  f.env.AR3D_SCRIPTED_CAMPAIGNS_ENABLED='disabled';
  assert.deepEqual(await runScriptedCampaignCron(f.env,{now:anchor,apiFetch:()=>assert.fail('disabled')}),{processed:0});
 }finally{f.close()}
});

test('Sarvam 429 during a live answer is retried once and pauses new dispatch',async()=>{
 const {readFileSync}=await import('node:fs');
 const src=readFileSync('src/scripted-phone-pilot.mjs','utf8');
 assert.match(src,/e\?\.message!=='sarvam_http_429'[\s\S]*signalProviderThrottle\(env,'sarvam'\)[\s\S]*transcribeSarvamRecordedAnswer/);
});

// Two independently triggered cron invocations must respect one global provider ceiling.
test('overlapping schedulers cannot exceed the shared live call ceiling',async()=>{
 const f=fixture();
 try{
  seed(f,3,1);
  const log=[],settings={maxConcurrent:1,maxPerCompany:1,queryBudget:950};
  const results=await Promise.all([
   runScriptedCampaignCron(f.env,{now:anchor,apiFetch:plivo(log),settings}),
   runScriptedCampaignCron(f.env,{now:anchor,apiFetch:plivo(log),settings})
  ]);
  assert.ok(results.every(x=>x.queriesUsed<=settings.queryBudget));
  assert.equal(log.length,1,'only one Plivo request allowed across both cron invocations');
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM calling_jobs WHERE state IN('reserved','submitted')").get().n,1);
 }finally{f.close()}
});

test('unknown call consumes global capacity across companies until signed end evidence',async()=>{
 const f=fixture();
 try{
  seed(f,3,1);
  const settings={maxConcurrent:1,maxPerCompany:1,queryBudget:950};
  let submissions=0;
  const send=async()=>{submissions++;throw Error('synthetic timeout')};
  const first=await runScriptedCampaignCron(f.env,{now:anchor,apiFetch:send,settings});
  assert.equal(first.occupiedSlots,1);
  const row=f.r.db.prepare("SELECT tenant_id FROM calling_jobs WHERE state='unknown'").get();
  assert.ok(row);
  for(let i=1;i<=2;i++){
   const r=await runScriptedCampaignCron(f.env,{now:anchor+i*STEP,apiFetch:send,settings});
   assert.equal(r.dialed,0);assert.equal(r.occupiedSlots,1);
  }
  assert.equal(submissions,1);
  f.c.db.prepare("UPDATE scripted_phone_pilots SET phase='ended',hangup_at=? WHERE job_id IS NOT NULL").run(anchor+2*STEP);
  const end=await runScriptedCampaignCron(f.env,{now:anchor+3*STEP,apiFetch:plivo([]),settings});
  assert.equal(end.reconciled,1);assert.equal(end.dialed,1);
 }finally{f.close()}
});
test('suspending all companies blocks new dispatch but reconciles an existing call',async()=>{
 const f=fixture();
 try{
  seed(f,1,2);
  const settings={maxConcurrent:1,maxPerCompany:1,queryBudget:950};
  assert.equal((await runScriptedCampaignCron(f.env,{now:anchor,apiFetch:plivo([]),settings})).dialed,1);
  f.c.db.prepare("UPDATE tenants SET status='suspended',suspended_from_status='active' WHERE status='active'").run();
  hangUpAll(f,anchor+STEP);
  const r=await runScriptedCampaignCron(f.env,{now:anchor+STEP,apiFetch:()=>assert.fail('suspended tenant must not dial'),settings});
  assert.equal(r.activeTenants,0);assert.equal(r.reconciled,1);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM calling_jobs WHERE state='completed'").get().n,1);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM calling_jobs WHERE state='queued'").get().n,1);
 }finally{f.close()}
});
