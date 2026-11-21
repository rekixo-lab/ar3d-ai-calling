import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,cid,lead,at,client,admin,route} from './helpers/calling-fixture.mjs';
import {handleCampaignRequest} from '../src/campaign-routes.mjs';

function fromCrm(f,body={tenantId:tid},user=client){
 return handleCampaignRequest(new Request('https://app.example.invalid/v1/human/campaigns/'+cid+'/candidates/from-crm',{
   method:'POST',headers:{Origin:'https://app.example.invalid','Content-Type':'application/json'},body:JSON.stringify(body)
 }),f.env,user);
}
function seed(f,count){
 const insert=f.r.db.prepare("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES(?,?,? ,?,'excel',?,?)");
 for(let i=2;i<=count;i++){
  const n=String(i).padStart(12,'0'),mobile='+91'+String(9000000000+i);
  insert.run(tid,'55555555-5555-4555-8555-'+n,'Synthetic '+i,mobile,at,at);
 }
}
test('Selecting 240 CRM leads includes entire eligible list, not first 200; replay safe',async()=>{
 const f=fixture();
 try{
  seed(f,240);
  const r=await fromCrm(f);
  if(r.status!==200)assert.fail('CRM selection failed: '+await r.text());
  const result=await r.json();
  assert.equal(result.inserted,239);
  assert.equal(result.alreadyInCampaign,1);
  assert.equal(result.totalEligible,240);
  assert.equal(result.campaignTotal,240);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM call_campaign_candidates WHERE tenant_id=? AND campaign_id=?').get(tid,cid).n,240);
  const retry=await fromCrm(f);
  assert.equal((await retry.json()).inserted,0);
  const policy=await route(f,'policy',{tenantId:tid,enabled:true,flowId:'123456',approvalReference:'approved',expiresAt:new Date(Date.now()+86400000).toISOString(),dailyLimit:1,maxSeconds:120},admin);
  assert.equal(policy.status,200);
  const start=await route(f,'runs',{tenantId:tid,campaignId:cid,action:'start'});
  assert.equal(start.status,202,await start.text());
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_jobs WHERE tenant_id=?').get(tid).n,240);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_jobs WHERE provider_call_sid IS NOT NULL').get().n,0);
 }finally{f.close()}
});
test('Full CRM selection excludes opted-out/denied/blocked and filters by segment',async()=>{
 const f=fixture();
 try{
  seed(f,5);
  const id=(i)=>'55555555-5555-4555-8555-'+String(i).padStart(12,'0');
  f.r.db.prepare("UPDATE leads SET consent_status='denied' WHERE tenant_id=? AND id=?").run(tid,id(2));
  f.r.db.prepare("UPDATE leads SET dnd_status='blocked' WHERE tenant_id=? AND id=?").run(tid,id(3));
  f.r.db.prepare("INSERT INTO lead_opt_out_events(tenant_id,id,lead_id,source,reason,actor,created_at) VALUES(?,?,?,'admin_action','synthetic test','admin',?)")
    .run(tid,'66666666-6666-4666-8666-666666666666',id(4),at);
  f.r.db.prepare("UPDATE leads SET customer_segment='prior_inquiry' WHERE tenant_id=? AND id=?").run(tid,id(5));
  const r=await fromCrm(f,{tenantId:tid,customerSegment:'prior_inquiry'});
  if(r.status!==200)assert.fail('CRM selection failed: '+await r.text());
  const v=await r.json();
  assert.equal(v.inserted,1);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM call_campaign_candidates').get().n,2);
 }finally{f.close()}
});
test('Rejects foreign tenant access, invalid filters and oversized selection without partial writes',async()=>{
 const f=fixture();
 try{
  seed(f,2002);
  const before=f.r.db.prepare('SELECT COUNT(*) AS n FROM call_campaign_candidates').get().n;
  const big=await fromCrm(f);
  assert.equal(big.status,409,await big.text());
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM call_campaign_candidates').get().n,before);
  assert.equal((await fromCrm(f,{tenantId:tid,customerSegment:'arbitrary'})).status,400);
  assert.equal((await fromCrm(f,{tenantId:'99999999-9999-4999-8999-999999999999'})).status,403);
  assert.equal((await fromCrm(f,{tenantId:tid},{id:'viewer',globalRole:'user'})).status,403);
 }finally{f.close()}
});
