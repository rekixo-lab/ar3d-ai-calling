// Synthetic >1000-company Calling scheduler acceptance. No provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,at,configureScriptedCampaign} from './helpers/calling-fixture.mjs';
import {
 CAMPAIGN_SCAN_LIMIT,CAMPAIGN_WORK_LIMIT,campaignScanOffset,runScriptedCampaignCron
} from '../src/scripted-campaign-dispatch.mjs';

const STEP=60000;
const anchor=Date.parse('2026-11-20T06:30:00Z');
function populate(f,count){
 const add=f.c.db.prepare(`INSERT INTO tenants
  (id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at)
  VALUES(?,?,'Synthetic Builder','starter','shared','active',?,?)`);
 for(let i=0;i<count;i++){
  add.run('00000000-'+String(i).padStart(4,'0')+'-4000-8000-000000000000',
   'scale-synthetic-'+i,at,at);
 }
}
function ready(f,hasWork,checked){
 configureScriptedCampaign(f); // synthetic completed internal pilot, NEVER a real phone
 const source=f.r.wrap;
 f.env.CRM_DB={
  prepare(sql){
   if(sql.includes("SELECT id FROM calling_runs WHERE tenant_id=? AND state='running'")){
    return {bind(tid1,tid2){
     assert.equal(tid1,tid2);
     checked.add(tid1);
     return {async first(){return hasWork(tid1)?{id:'synthetic-scheduler-work'}:null}};
    }};
   }
   return source.prepare(sql);
  }
 };
}
const forbiddenNetwork=()=>assert.fail('synthetic scheduler test MUST NEVER fetch a provider');

test('bounded two-stage rotation covers every one of 1,025 active companies without 100-tenant truncation',async()=>{
 const f=fixture();
 try{
  populate(f,1024);
  const checked=new Set(),ticked=new Set();
  ready(f,()=>true,checked);
  const total=1025;
  const rounds=Math.ceil(total/2)+2*Math.ceil(total/CAMPAIGN_SCAN_LIMIT);
  for(let t=0;t<rounds;t++){
   const actual=await runScriptedCampaignCron(f.env,{
    now:anchor+t*STEP,apiFetch:forbiddenNetwork,
    tickTenant:async (_env,_db,id)=>{
     // A live campaign may remain busy for many minutes; repeats are safe
     // because the tenant's reservation is atomically guarded downstream.
     ticked.add(id);return {state:'synthetic_ok'};
    }
   });
   assert.equal(actual.activeTenants,total);
   assert.equal(actual.processed,CAMPAIGN_WORK_LIMIT);
   assert.ok(actual.scanned<=CAMPAIGN_SCAN_LIMIT);
   assert.equal(actual.scanned,CAMPAIGN_WORK_LIMIT);
   if(ticked.size===total)break;
  }
  assert.equal(ticked.size,total);
  assert.ok(ticked.has(tid),'the last real fixture tenant must not be starved');
  assert.equal(checked.size,total);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_jobs').get().n,0);
 }finally{f.close()}
});

test('sparse approved work beyond first 1,000 tenants is discovered in one bounded directory sweep',async()=>{
 const f=fixture();
 try{
  populate(f,1024);
  const checked=new Set(),work=[];
  ready(f,id=>id===tid,checked);
  const pages=Math.ceil(1025/CAMPAIGN_SCAN_LIMIT);
  for(let t=0;t<pages+1;t++){
   const result=await runScriptedCampaignCron(f.env,{
    now:anchor+t*STEP,apiFetch:forbiddenNetwork,
    tickTenant:async (_env,_db,id)=>{work.push(id);return {state:'synthetic_ok'};}
   });
   assert.ok(result.scanned<=CAMPAIGN_SCAN_LIMIT);
   assert.ok(result.processed<=CAMPAIGN_WORK_LIMIT);
   if(work.length)break;
  }
  assert.deepEqual(work,[tid]);
  assert.ok(checked.has(tid));
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
 }finally{f.close()}
});

test('directory rotation is stable, bounded and advances under different clock offsets',()=>{
 for(const total of [0,1,5,16,17,100,1000,1001,1024,1025,3000]){
  const seen=new Set(),firstSeen=new Set();
  const rounds=total?Math.ceil(total/2)+2*Math.ceil(total/CAMPAIGN_SCAN_LIMIT):1;
  for(let t=0;t<rounds;t++){
   const index=campaignScanOffset(anchor+t*STEP,total);
   assert.ok(index>=0&&(!total||index<total));
   for(let i=0;i<Math.min(total,CAMPAIGN_SCAN_LIMIT);i++)
    seen.add((index+i)%total);
   for(let i=0;i<Math.min(total,CAMPAIGN_WORK_LIMIT);i++)
    firstSeen.add((index+i)%total);
  }
  assert.equal(seen.size,total);
  assert.equal(firstSeen.size,total);
 }
 for(const input of [-1,NaN,Infinity,1.5])assert.throws(()=>campaignScanOffset(input,100),/invalid/);
 for(const input of [-1,NaN,1.2])assert.throws(()=>campaignScanOffset(anchor,input),/invalid/);
});

test('two-attempt cap survives a tenant failure; no extra provider activity follows',async()=>{
 const f=fixture();
 try{
  populate(f,150);
  ready(f,()=>true,new Set());
  let attempts=0;
  const result=await runScriptedCampaignCron(f.env,{
   now:anchor,apiFetch:forbiddenNetwork,
   tickTenant:async()=>{attempts++;throw Error('synthetic tenant error');}
  });
  assert.equal(attempts,CAMPAIGN_WORK_LIMIT);
  assert.equal(result.processed,CAMPAIGN_WORK_LIMIT);
  assert.ok(result.scanned<=CAMPAIGN_SCAN_LIMIT);
 }finally{f.close()}
});

test('unapproved kill switch touches no tenant directory even at 1,000+ companies',async()=>{
 const f=fixture();
 try{
  populate(f,1024);
  let reads=0;
  const env={...f.env,AR3D_SCRIPTED_CAMPAIGNS_ENABLED:'disabled',
   CONTROL_DB:{prepare(){reads++;throw Error('unexpected control read')}}};
  assert.deepEqual(await runScriptedCampaignCron(env,{
   now:anchor,apiFetch:forbiddenNetwork
  }),{processed:0});
  assert.equal(reads,0);
 }finally{f.close()}
});
