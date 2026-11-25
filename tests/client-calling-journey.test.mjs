import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {fixture,tid,admin,client,now,until,route,configureScriptedCampaign,at} from './helpers/calling-fixture.mjs';
import {approvedCampaignPhone,handleScriptedPhoneCallback} from '../src/scripted-phone-pilot.mjs';
import {tickScriptedTenant} from '../src/scripted-campaign-dispatch.mjs';
import {handleCrmRequest} from '../src/crm-routes.mjs';
import {handleCampaignRequest} from '../src/campaign-routes.mjs';
import worker from '../src/index.mjs';
import {newSession,COOKIE} from '../src/human-auth.mjs';

// Client Admin journey for two companies at once: CSV/Excel upload, one
// manually added number, Super Admin clearance, Start calling, dispatch,
// seven signed answers, and results that stay inside each company's CRM.
const origin='https://app.example.invalid';
const tid2='44444444-4444-4444-8444-444444444444';
const json=(path,data,method='POST',headers={})=>new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
function signed(url,params,secret){
 const nonce='journey-nonce';
 const query=Object.keys(params).sort().map(k=>k+'='+params[k]).join('&');
 const signature=createHmac('sha256',secret).update(url+'?'+query+'.'+nonce).digest('base64');
 return new Request(url+'?'+new URLSearchParams(params),{headers:{'X-Plivo-Signature-V3':signature,'X-Plivo-Signature-V3-Nonce':nonce}});
}

test('two companies: CSV and manual numbers are called and answers land only in their own CRM',async()=>{
 const f=fixture();
 try{
  configureScriptedCampaign(f);
  f.env.LOGIN_RATE_LIMIT_SECRET='synthetic-journey-rate-limit-secret';
  // Second company with its own Client Admin and calling minutes.
  f.c.db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,'second','Second Builder','starter','shared','active',?,?)").run(tid2,at,at);
  f.c.db.prepare("INSERT INTO human_users(id,email,password_salt,password_hash,password_iterations,global_role,created_at,updated_at) VALUES('client2','client2@example.invalid','salt','hash',200000,'user',?,?)").run(at,at);
  f.c.db.prepare("INSERT INTO tenant_memberships(tenant_id,user_id,role,created_at) VALUES(?,'client2','client_admin',?)").run(tid2,at);
  f.c.db.prepare("INSERT INTO tenant_minute_ledger(id,tenant_id,kind,delta_seconds,previous_seconds,balance_seconds,actor,reason,created_at) VALUES('synthetic-funding-2',?,'allocation',6000,0,6000,'admin','Synthetic test allocation',?)").run(tid2,at);
  const client2={id:'client2',globalRole:'user'};
  const companies=[
   {tenant:tid,user:client,answers:['flat','Raipur','Shankar Nagar','3BHK','35 lakh','yes','2027-01-12'],budget:3500000,location:'Raipur'},
   {tenant:tid2,user:client2,answers:['प्लॉट','भिलाई','नेहरू नगर','1200 sq ft','20 लाख','हाँ','2027-02-03'],budget:2000000,location:'भिलाई'}
  ];
  const shared='9000000030'; // same buyer number in both companies
  for(const [i,c] of companies.entries()){
   // 1. CSV upload that prepares a campaign.
   const csv=`Name,Mobile\nShared buyer ${i},${shared}\nCSV buyer ${i},90000000${40+i}`;
   const imported=await handleCrmRequest(json('/v1/human/import/commit',{tenantId:c.tenant,csv,campaign:{name:'Campaign '+i,language:i?'hi':'en',requestId:crypto.randomUUID()}}),f.env,c.user);
   assert.equal(imported.status,201,await imported.clone().text());
   c.campaign=(await imported.json()).campaignId;
   // 2. One number typed in by hand, then added to the same campaign.
   const cookie=COOKIE+'='+await newSession(f.env.CONTROL_DB,c.user.id);
   const added=await worker.fetch(json('/v1/human/leads',{tenantId:c.tenant,name:'Manual buyer '+i,mobile:'90000000'+(50+i)},'POST',{Cookie:cookie,'CF-Connecting-IP':'192.0.2.10'}),f.env);
   assert.equal(added.status,201,await added.clone().text());
   const manual=f.r.db.prepare('SELECT id FROM leads WHERE tenant_id=? AND mobile_e164=?').get(c.tenant,'+9190000000'+(50+i)).id;
   const join=await handleCampaignRequest(json(`/v1/human/campaigns/${c.campaign}/candidates`,{tenantId:c.tenant,leadIds:[manual]}),f.env,c.user);
   assert.equal(join.status,200,await join.clone().text());
   assert.equal((await join.json()).inserted,1);
   c.leads=f.r.db.prepare('SELECT lead_id AS id FROM call_campaign_candidates WHERE tenant_id=? AND campaign_id=?').all(c.tenant,c.campaign).map(x=>x.id);
   assert.equal(c.leads.length,3);
   // Test clock is fixed; real production leads are created before the call.
   f.r.db.prepare('UPDATE leads SET created_at=?,updated_at=? WHERE tenant_id=?').run(at,at,c.tenant);
   // A client cannot touch another company's campaign.
   const foreign=await handleCampaignRequest(json(`/v1/human/campaigns/${c.campaign}/candidates`,{tenantId:c.tenant,leadIds:[manual]}),f.env,i?client:client2);
   assert.equal(foreign.status,403);
   // 3. Super Admin approval and per-customer clearance.
   let r=await route(f,'policy',{tenantId:c.tenant,enabled:true,approvalReference:'provider-approval-ref',expiresAt:until,dailyLimit:10,maxSeconds:180},admin);
   assert.equal(r.status,200,await r.text());
   r=await route(f,'clearances',{tenantId:c.tenant,leadIds:c.leads,purpose:'property_information',consentReference:'consent-ref',dndReference:'dnd-ref',expiresAt:until},admin);
   assert.equal(r.status,200,await r.text());
   // 4. Client Admin presses Start calling.
   r=await route(f,'runs',{tenantId:c.tenant,campaignId:c.campaign,action:'start'},c.user);
   assert.equal(r.status,202,await r.text());
  }
  // 5. Dispatcher: one call at a time per company, each answered fully.
  const config=await approvedCampaignPhone(f.env);
  const dialed={[tid]:[],[tid2]:[]};let clock=now,seq=0;
  for(let round=0;round<3;round++){
   for(const c of companies){
    let hook,to;
    const tick=await tickScriptedTenant(f.env,f.r.wrap,c.tenant,config,{now:clock,apiFetch:async(_u,opts)=>{
     const payload=JSON.parse(opts.body);to=payload.to;hook=payload.answer_url.replace(/\/answer$/,'');
     return Response.json({request_uuid:'journey-request-'+(++seq)},{status:202});
    }});
    assert.equal(tick.state,'submitted',JSON.stringify(tick));
    dialed[c.tenant].push(to);
    const callUuid=crypto.randomUUID(),answers=[...c.answers];
    f.env.syntheticSpeech.run=async()=>({text:answers.shift()});
    const cb=(step,params)=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callUuid,...params},f.env.PLIVO_AUTH_TOKEN),f.env,{now:clock,fetcher:async(url,opts)=>{
     if(url==='https://api.sarvam.ai/speech-to-text'){const res=await f.env.syntheticSpeech.run();return Response.json({transcript:res.text})}
     if(url==='https://api.sarvam.ai/v1/chat/completions')return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'unclear',value:'',evidence:''})}}]});
     return new Response('RIFF',{headers:{'Content-Type':'audio/wav'}});
    }});
    assert.match(await (await cb('answer',{ALegRequestUUID:'journey-request-'+seq,To:to,From:config.caller,Direction:'outbound'})).text(),/GetDigits/);
    await cb('consent',{Digits:'1'});
    for(let q=0;q<7;q++){const res=await cb('turn/'+q,{RecordingID:'recording-'+seq+'-'+q});assert.equal(res.status,200,await res.clone().text())}
    assert.equal((await cb('hangup',{Duration:'75'})).status,204);
    clock+=60000;
    const after=await tickScriptedTenant(f.env,f.r.wrap,c.tenant,config,{now:clock,apiFetch:()=>assert.fail('no redial before reconciliation')});
    assert.equal(after.state,'reconciled',JSON.stringify(after));
   }
  }
  // Every customer called exactly once, only within its own company.
  for(const c of companies){
   assert.deepEqual([...dialed[c.tenant]].sort(),['+919000000030','+9190000000'+(40+companies.indexOf(c)),'+9190000000'+(50+companies.indexOf(c))].sort());
   const config2=await tickScriptedTenant(f.env,f.r.wrap,c.tenant,config,{now:clock+60000,apiFetch:()=>assert.fail('campaign finished; nobody is redialed')});
   assert.notEqual(config2.state,'submitted');
   // 6. Results / CRM shows three saved calls with this company's answers.
   const data=await (await route(f,'results',{tenantId:c.tenant,campaignId:c.campaign},c.user,'GET')).json();
   assert.equal(data.total,3);
   for(const row of data.results){assert.equal(row.savedToLead,true,JSON.stringify(row));assert.equal(row.answers.budgetInr,c.budget)}
   for(const id of c.leads){
    const lead=f.r.db.prepare('SELECT tenant_id,preferred_location,budget_max_inr FROM leads WHERE id=?').get(id);
    assert.equal(lead.tenant_id,c.tenant);assert.equal(lead.preferred_location,c.location);assert.equal(lead.budget_max_inr,c.budget);
   }
  }
  // The shared number exists twice, once per company, each with its own answers.
  const shared2=f.r.db.prepare('SELECT tenant_id,budget_max_inr FROM leads WHERE mobile_e164=? ORDER BY tenant_id').all('+919000000030');
  assert.deepEqual(shared2.map(x=>[x.tenant_id,x.budget_max_inr]),[[tid,3500000],[tid2,2000000]]);
  // Neither client can read the other company's results.
  assert.equal((await route(f,'results',{tenantId:tid2},client,'GET')).status,403);
  assert.equal((await route(f,'results',{tenantId:tid},client2,'GET')).status,403);
  // Minutes were reserved and settled per company, never across companies.
  for(const c of companies){
   const holds=f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_minute_holds WHERE tenant_id=?').get(c.tenant).n;
   assert.equal(holds,3);
  }
 }finally{f.close()}
});
