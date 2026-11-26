import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {fixture,configureScriptedCampaign,setup,route,tid,cid,lead,admin,client,now,at,accepted} from './helpers/calling-fixture.mjs';
import {handleScriptedCallingRequest} from '../src/scripted-campaign-routes.mjs';
import {SCRIPTED_CALLING_POLICY,campaignPromptMode,scriptedPromptsReady,approvedCampaignPhone,handleScriptedPhoneCallback} from '../src/scripted-phone-pilot.mjs';
import {fundedDispatchApproved,tickScriptedTenant} from '../src/scripted-campaign-dispatch.mjs';
import {FUNDING_CONTEXT} from '../src/funding-context.mjs';
import {resolveFundingEnv} from '../src/provider-funding.mjs';
import {automaticMinuteSettlementApproved,runAutomaticMinuteSettlement} from '../src/plivo-cost-reconcile-routes.mjs';
import {syncManualBalance,setManualFundingEnabled} from '../src/manual-provider-balances.mjs';
import {handleCallingCron} from '../src/calling-schedule.mjs';

const other='44444444-4444-4444-8444-444444444444';
const reference='owner-authorized-dashboard';
const request=(data={reference},options={})=>new Request('https://app.example.invalid/v1/human/calling/enable-clients',{
 method:'POST',headers:{Origin:'https://app.example.invalid','Content-Type':'application/json'},body:JSON.stringify(data),...options});

test('owner activation enables current trial/active companies without starting calls or inventing customer consent',async()=>{
 const f=fixture();
 try{
  configureScriptedCampaign(f);
  f.c.db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,'other','Other company','starter','shared','trial',?,?)").run(other,at,at);
  f.r.db.prepare("UPDATE leads SET consent_status='denied',dnd_status='blocked' WHERE tenant_id=? AND id=?").run(tid,lead);
  const draft=f.r.db.prepare('SELECT * FROM call_campaign_drafts').all(),leads=f.r.db.prepare('SELECT * FROM leads').all();
  const response=await route(f,'enable-clients',{reference},admin);
  assert.equal(response.status,200,await response.clone().text());
  assert.deepEqual(await response.json(),{enabled:2,companies:[{name:'Demo',status:'enabled'},{name:'Other company',status:'enabled'}]});
  assert.equal(f.c.db.prepare('SELECT status FROM tenants WHERE id=?').get(other).status,'active');
  assert.equal(f.c.db.prepare('SELECT enabled FROM provider_manual_funding_control').get().enabled,1);
  const policies=f.r.db.prepare('SELECT * FROM calling_policies ORDER BY tenant_id').all();
  assert.equal(policies.length,2);
  for(const policy of policies){
   assert.equal(policy.enabled,1);assert.equal(policy.flow_id,SCRIPTED_CALLING_POLICY);
   assert.equal(policy.approval_reference,reference);assert.equal(policy.max_seconds,180);
   assert.equal(policy.expires_at,new Date(now+365*86400000).toISOString());
  }
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM calling_company_settings WHERE consent_mode='client_declared'").get().n,2);
  assert.deepEqual(f.r.db.prepare('SELECT * FROM call_campaign_drafts').all(),draft);
  assert.deepEqual(f.r.db.prepare('SELECT * FROM leads').all(),leads);
  for(const table of ['calling_clearances','calling_runs','calling_jobs'])assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM scripted_phone_pilots WHERE job_id IS NOT NULL').get().n,0);
  const events=f.c.db.prepare("SELECT detail_json FROM tenant_audit_events WHERE action='tenant.calling_activated'").all();
  assert.equal(events.length,2);assert.equal(JSON.parse(events[0].detail_json).authorization,'owner');
 }finally{f.close()}
});

test('repeating activation is idempotent and preserves policy clearance epoch and funding revision',async()=>{
 const f=fixture();
 try{
  configureScriptedCampaign(f);
  assert.equal((await route(f,'enable-clients',{reference},admin)).status,200);
  const before=f.r.db.prepare('SELECT * FROM calling_policies').get();
  const revision=f.c.db.prepare('SELECT revision FROM provider_manual_funding_control').get().revision;
  const result=await handleScriptedCallingRequest(request(),f.env,admin,{now:now+60000});
  assert.equal(result.status,200);assert.equal((await result.json()).companies[0].status,'already_enabled');
  assert.deepEqual(f.r.db.prepare('SELECT * FROM calling_policies').get(),before);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='calling.owner_activated'").get().n,1);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM tenant_audit_events WHERE action='tenant.calling_activated'").get().n,1);
  assert.equal(f.c.db.prepare('SELECT revision FROM provider_manual_funding_control').get().revision,revision);
  f.c.db.prepare('UPDATE provider_manual_funding_control SET enabled=0,revision=revision+1').run();
  assert.equal((await route(f,'enable-clients',{reference},admin)).status,200);
  assert.equal(f.c.db.prepare('SELECT enabled,revision FROM provider_manual_funding_control').get().enabled,1);
  assert.equal(f.c.db.prepare('SELECT revision FROM provider_manual_funding_control').get().revision,revision+2);
 }finally{f.close()}
});

test('activation requires same origin, current Super Admin MFA, exact body and existing carrier setup',async()=>{
 const f=fixture();
 try{
  assert.equal((await route(f,'enable-clients',{reference},client)).status,403);
  assert.equal((await route(f,'enable-clients',{reference},admin,'GET')).status,405);
  assert.equal((await handleScriptedCallingRequest(request({reference},{headers:{Origin:'https://other.invalid','Content-Type':'application/json'}}),f.env,admin,{now})).status,403);
  for(const data of [{reference:'x'},{reference,confirm:true},{reference:'bad\nreference'},{}])
   assert.equal((await route(f,'enable-clients',data,admin)).status,400);
  assert.equal((await route(f,'enable-clients',{reference},admin)).status,409);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_policies').get().n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM provider_manual_funding_control').get().n,0);
  configureScriptedCampaign(f);
  f.c.db.prepare('UPDATE human_sessions SET revoked_at=?').run(now);
  assert.equal((await route(f,'enable-clients',{reference},admin)).status,403);
 }finally{f.close()}
});

test('activation reports unprovisioned companies and never reactivates suspended companies',async()=>{
 const f=fixture();
 try{
  configureScriptedCampaign(f);
  f.c.db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,dedicated_binding,status,created_at,updated_at) VALUES(?,'other','Other company','starter','dedicated','CRM_UNAVAILABLE','trial',?,?)").run(other,at,at);
  const response=await route(f,'enable-clients',{reference},admin);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.enabled,1);
  assert.deepEqual(result.companies[1],{name:'Other company',status:'blocked',reason:'company_database_unavailable'});
  assert.equal(f.c.db.prepare('SELECT status FROM tenants WHERE id=?').get(other).status,'trial');
  f.c.db.prepare("UPDATE tenants SET status='suspended',suspended_from_status=status WHERE id=?").run(other);
  const next=await (await route(f,'enable-clients',{reference},admin)).json();
  assert.equal(next.companies.length,1);
  assert.equal(f.c.db.prepare('SELECT status FROM tenants WHERE id=?').get(other).status,'suspended');
 }finally{f.close()}
});

test('built-in prompt fallback is only for funded manual-mode customer campaigns; existing recordings win',async()=>{
 const f=fixture();
 try{
  configureScriptedCampaign(f);
  const resolved=await resolveFundingEnv(f.env);
  const manual={...resolved,[FUNDING_CONTEXT]:{...resolved[FUNDING_CONTEXT],source:'manual_balance',status:'ready'}};
  assert.equal(await campaignPromptMode(manual,'hi',tid),'recorded');
  manual.RECORDINGS={...manual.RECORDINGS,async head(){return null}};
  assert.equal(await campaignPromptMode(manual,'hi',tid),'builtin');
  assert.equal(await campaignPromptMode(manual,'en',tid),'builtin');
  assert.equal(await scriptedPromptsReady(manual,'hi'),false);
  assert.equal(await scriptedPromptsReady(manual,'es',tid),false);
  assert.equal(await scriptedPromptsReady({...manual,[FUNDING_CONTEXT]:resolved[FUNDING_CONTEXT]},'hi',tid),false);
  assert.equal(fundedDispatchApproved({...manual,AR3D_FUNDED_CAMPAIGN_DISPATCH:undefined}),true);
  assert.equal(fundedDispatchApproved({...resolved,AR3D_FUNDED_CAMPAIGN_DISPATCH:undefined}),false);
  assert.equal(fundedDispatchApproved({...manual,AR3D_FUNDED_CAMPAIGN_DISPATCH:undefined,
   [FUNDING_CONTEXT]:{...manual[FUNDING_CONTEXT],status:'setup_required',config:null}}),false);
 }finally{f.close()}
});

function signed(url,params,token){
 const nonce='synthetic-activation-test';
 const query=Object.keys(params).sort().map(key=>key+'='+params[key]).join('&');
 const signature=createHmac('sha256',token).update(url+'?'+query+'.'+nonce).digest('base64');
 return new Request(url+'?'+new URLSearchParams(params),{headers:{'X-Plivo-Signature-V3':signature,'X-Plivo-Signature-V3-Nonce':nonce}});
}

for(const language of ['hi','en'])test(language+' fallback identifies the client, discloses recording and keeps keypad consent before recording',async()=>{
 const f=fixture();
 try{
  await setup(f);
  f.c.db.prepare('UPDATE tenants SET display_name=? WHERE id=?').run('Demo <Client & Partner>',tid);
  f.r.db.prepare('UPDATE call_campaign_drafts SET language_mode=? WHERE tenant_id=? AND id=?').run(language,tid,cid);
  const resolved=await resolveFundingEnv(f.env);
  const env={...resolved,AR3D_FUNDED_CAMPAIGN_DISPATCH:undefined,
   [FUNDING_CONTEXT]:{...resolved[FUNDING_CONTEXT],source:'manual_balance',status:'ready'},
   RECORDINGS:{async head(){return null},async get(){return null}}};
  const config=await approvedCampaignPhone(env);
  let requests=0;
  const result=await tickScriptedTenant(env,env.CRM_DB,tid,config,{now,apiFetch:async()=>{requests++;return accepted()}});
  assert.equal(result.state,'submitted');assert.equal(requests,1);
  const row=f.c.db.prepare('SELECT * FROM scripted_phone_pilots WHERE job_id IS NOT NULL').get();
  const meta=JSON.parse(row.survey_json).phoneMeta;
  assert.equal(meta.mode,'campaign_consent');assert.equal(meta.promptMode,'builtin');
  assert.equal(meta.companyName,'Demo <Client & Partner>');
  for(const key of ['sttAudioMs','sttDurationUnknown','sttRoundedSeconds','sttFailedRequests','llmRequests','llmInputTokens','llmOutputTokens','llmUsageUnknown'])assert.equal(meta[key],0);
  const hook='https://app.example.invalid/v1/provider/plivo/scripted-pilot/'+row.id;
  const call='55555555-5555-4555-8555-555555555555';
  const callback=(step,params={})=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:call,...params},env.PLIVO_AUTH_TOKEN),env,{now,fetcher:()=>assert.fail('no speech request before consent')});
  const opening=await (await callback('answer',{ALegRequestUUID:'synthetic-plivo-request-123',To:row.destination,From:row.caller,Direction:'outbound'})).text();
  assert.match(opening,/<GetDigits /);assert.match(opening,/<Speak voice="Polly.Aditi" language="(?:hi|en)-IN">/);
  assert.match(opening,/Demo &lt;Client &amp; Partner&gt;/);
  assert.match(opening,language==='hi'?/सर्वम ए आई/:/Sarvam AI/);
  assert.doesNotMatch(opening,/<Record |opening\.mp3/);
  const digit=language==='hi'?'2':'1';
  const after=await (await callback('consent',{Digits:digit})).text();
  if(digit==='2'){
   assert.doesNotMatch(after,/<Record /);
   assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM lead_opt_out_events WHERE tenant_id=? AND lead_id=?').get(tid,lead).n,1);
  }else{
   assert.match(after,/<Speak voice="Polly.Aditi" language="en-IN">/);
   assert.match(after,/<Record /);assert.doesNotMatch(after,/audio\/propertyType/);
  }
 }finally{f.close()}
});

test('manual balance mode includes automatic CDR minute settlement without another environment approval',async()=>{
 const f=fixture();
 try{
  configureScriptedCampaign(f);
  const resolved=await resolveFundingEnv(f.env),manual={...resolved,[FUNDING_CONTEXT]:{...resolved[FUNDING_CONTEXT],source:'manual_balance'}};
  assert.equal(automaticMinuteSettlementApproved(manual),true);
  assert.equal(automaticMinuteSettlementApproved(resolved),false);
  assert.deepEqual(await runAutomaticMinuteSettlement(manual,{now,fetcher:()=>assert.fail('empty settlement queue')}),{attempted:0});
  await assert.rejects(runAutomaticMinuteSettlement(manual,{now,maxCalls:0}),/invalid settlement limit/);
 }finally{f.close()}
});

test('client state distinguishes unsynced, exhausted and disabled manual funding from real carrier/company approval',async()=>{
 const f=fixture();
 try{
  configureScriptedCampaign(f);
  assert.equal((await route(f,'enable-clients',{reference},admin)).status,200);
  const state=async()=>{
   const response=await route(f,'state',{tenantId:tid},client,'GET');
   assert.equal(response.status,200);return response.json();
  };
  assert.equal((await state()).credits.reason,'provider_balance_required');
  delete f.env.AR3D_SCRIPTED_CAMPAIGNS_ENABLED;
  assert.equal((await state()).credits.reason,'approval_required');
  f.env.AR3D_SCRIPTED_CAMPAIGNS_ENABLED='enabled';
  f.r.db.prepare('UPDATE calling_policies SET enabled=0').run();
  assert.equal((await state()).credits.reason,'approval_required');
  f.r.db.prepare('UPDATE calling_policies SET enabled=1').run();
  for(const provider of ['plivo','sarvam'])assert.equal((await syncManualBalance(f.env.CONTROL_DB,
   {id:crypto.randomUUID(),provider,balanceMicros:0,expectedRevision:0},admin.id,now)).ok,true);
  assert.equal((await state()).credits.reason,'provider_balance_exhausted');
  assert.equal((await setManualFundingEnabled(f.env.CONTROL_DB,{enabled:false,expectedRevision:1},admin.id,now)).ok,true);
  assert.equal((await state()).credits.reason,'funding_disabled');
 }finally{f.close()}
});

test('default 45-query manual-mode cron dispatches one call and settles one ended call within 50 D1 statements',async()=>{
 const f=fixture();
 try{
  await setup(f);
  for(const provider of ['plivo','sarvam'])assert.equal((await syncManualBalance(f.env.CONTROL_DB,
   {id:crypto.randomUUID(),provider,balanceMicros:1000000000,expectedRevision:0},admin.id,now-300000)).ok,true);
  assert.equal((await route(f,'enable-clients',{reference},admin)).status,200);
  delete f.env.AR3D_FUNDED_CAMPAIGN_DISPATCH;
  delete f.env.AR3D_AUTO_CDR_SETTLEMENT;
  const config=await approvedCampaignPhone(f.env);
  assert.equal((await tickScriptedTenant(f.env,f.env.CRM_DB,tid,config,{now,apiFetch:async()=>accepted()})).state,'submitted');
  const ended=f.r.db.prepare('SELECT id FROM calling_jobs').get().id;
  const callUuid='55555555-5555-4555-8555-555555555555';
  f.r.db.prepare("UPDATE calling_jobs SET state='completed',provider_call_sid=?,duration_seconds=34 WHERE id=?").run(callUuid,ended);
  f.c.db.prepare("UPDATE scripted_phone_pilots SET phase='completed',provider_call_id=?,hangup_at=?,duration_seconds=34 WHERE job_id=?").run(callUuid,now+1000,ended);
  const nextLead='66666666-6666-4666-8666-666666666666',nextCampaign='77777777-7777-4777-8777-777777777777';
  f.r.db.prepare("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES(?,?,'Next fictional customer','+919000000007','excel',?,?)").run(tid,nextLead,at,at);
  f.r.db.prepare("INSERT INTO call_campaign_drafts(tenant_id,id,name,language_mode,purpose,status,created_by,created_at,updated_at) VALUES(?,?,'Next campaign','hi','property_information','draft','client',?,?)").run(tid,nextCampaign,at,at);
  f.r.db.prepare('INSERT INTO call_campaign_candidates VALUES(?,?,?,?)').run(tid,nextCampaign,nextLead,at);
  const start=await route(f,'runs',{tenantId:tid,campaignId:nextCampaign,action:'start',consent:{confirmed:true,source:'website_enquiry'}});
  assert.equal(start.status,202,await start.clone().text());
  f.env.RECORDINGS={async head(){return null},async get(){return null}};
  // Count the actual statements across both databases, including each batch
  // statement and all resolution work outside the scheduler's own meter.
  let queries=0,posts=0,gets=0;
  const counted=db=>({
   prepare(sql){
    const wrap=st=>({bind(...args){return wrap(st.bind(...args))},
     first(...args){queries++;return st.first(...args)},all(...args){queries++;return st.all(...args)},run(...args){queries++;return st.run(...args)},raw:st});
    return wrap(db.prepare(sql));
   },
   batch(statements){queries+=statements.length;return db.batch(statements.map(st=>st.raw||st))}
  });
  const env={...f.env,CONTROL_DB:counted(f.env.CONTROL_DB),CRM_DB:counted(f.env.CRM_DB)};
  const result=await handleCallingCron({cron:'* * * * *',scheduledTime:now+121000},env,{
   apiFetch:async(url,options)=>{assert.equal(options.method,'POST');posts++;return Response.json({request_uuid:'synthetic-second-plivo-request'},{status:202})},
   cdrFetch:async(url,options)=>{assert.equal(options.method,'GET');gets++;return Response.json({call_uuid:callUuid,call_direction:'outbound',from_number:f.env.AR3D_PLIVO_CALLER_NUMBER,
    to_number:'+919000000001',billed_duration:60,call_duration:34,total_amount:'0.38'})}
  });
  assert.equal(result.dialed,1,JSON.stringify({result,queries}));
  assert.deepEqual(result.settlement,{attempted:1,settled:1});
  assert.equal(posts,1);assert.equal(gets,1);
  assert.ok(queries<=50,'scheduled invocation used '+queries+' D1 statements');
  assert.equal(f.c.db.prepare('SELECT state FROM tenant_minute_holds WHERE job_id=?').get(ended).state,'settled');
  const next=f.c.db.prepare('SELECT survey_json FROM scripted_phone_pilots WHERE job_id<>? AND job_id IS NOT NULL').get(ended);
  assert.equal(JSON.parse(next.survey_json).phoneMeta.promptMode,'builtin');
 }finally{f.close()}
});
