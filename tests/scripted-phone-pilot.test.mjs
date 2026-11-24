import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {fixture,tid,lead,admin,client,now,until,route,configureScriptedCampaign,setup,accepted} from './helpers/calling-fixture.mjs';
import {approvedCampaignPhone,handleScriptedPhoneAdmin,handleScriptedPhoneCallback,scriptedPromptsReady} from '../src/scripted-phone-pilot.mjs';
import {tickScriptedTenant} from '../src/scripted-campaign-dispatch.mjs';
import worker from '../src/index.mjs';
import {handleCrmRequest} from '../src/crm-routes.mjs';
import {handleFixedVoicePreviewRequest} from '../src/fixed-voice-preview-routes.mjs';

const origin='https://app.example.invalid';
const token='synthetictestonlytoken0123456789';
const internalNumber='+919000000001';
const callId='14111111-2222-3333-4444-555555555555';
const requestId='24111111-2222-3333-4444-555555555555';

function signed(url,params={},secret=token){
 const nonce='test-nonce';
 const query=Object.keys(params).sort().map(key=>key+'='+params[key]).join('&');
 const signature=createHmac('sha256',secret).update(url+(query?'?'+query:'')+'.'+nonce).digest('base64');
 return new Request(url+'?'+new URLSearchParams(params),{headers:{
  'X-Plivo-Signature-V3':signature,'X-Plivo-Signature-V3-Nonce':nonce
 }});
}

test('verified internal pilot only: consent, fixed prompts, AI answers, and one tenant-scoped CRM save',async()=>{
 const f=fixture();
 try{
  const answers=['प्लॉट','रायपुर','अमलीडीह','1200 वर्ग फुट','45 लाख','बाद में'];
  const env={...f.env,PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,
   RECORDINGS:{head:async()=>({size:4}),get:async()=>({size:4,body:new Uint8Array(4)})},
   AI:{async run(model,input){
    assert.equal(model,'@cf/openai/whisper-large-v3-turbo');
    assert.equal(input.language,'hi');
    assert.equal(input.audio,'UklGRg==');
    return {text:answers.shift()};
   }}
  };
  let dialCount=0,mediaReads=0,hook;
  const fetcher=async(url,options)=>{
   if(url.startsWith('https://api.plivo.com/')){
    dialCount++;
    const payload=JSON.parse(options.body);
    assert.equal(payload.to,internalNumber);
    assert.equal(payload.time_limit,180);
    assert.equal(payload.ring_timeout,25);
    assert.equal(Object.hasOwn(payload,'hangup_on_ring'),false,'must not schedule hangup of answered call');
    hook=payload.answer_url.replace(/\/answer$/,'');
    return Response.json({request_uuid:requestId},{status:202});
   }
   assert.match(url,/^https:\/\/media\.plivo\.com\/v1\/Account\/syntheticAuth\/Recording\/[a-z0-9-]+\.mp3$/);
   mediaReads++;
   return new Response('RIFF',{headers:{'Content-Type':'audio/wav'}});
  };
  const start=(configuration=env)=>handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot',{
   method:'POST',headers:{Origin:origin},body:JSON.stringify({language:'hi',confirm:'CALL_ONE_VERIFIED_INTERNAL_NUMBER'})
  }),configuration,admin,{now,fetcher});
  assert.equal((await start({...env,AR3D_SCRIPTED_PILOT_ENABLED:undefined})).status,503);
  assert.equal(dialCount,0);
  const started=await start();
  assert.equal(started.status,202,await started.clone().text());
  assert.equal((await start()).status,409);
  assert.equal(dialCount,1);
  const callback=(step,params={})=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params}),env,{now,fetcher});
  assert.equal((await handleScriptedPhoneCallback(new Request(hook+'/answer'),env,{now,fetcher})).status,403);
  const details={ALegRequestUUID:requestId,From:'918000000000',To:'919000000001',Direction:'outbound'};
  assert.equal((await callback('answer',{...details,To:'919000000009'})).status,403);
  const opening=await (await callback('answer',details)).text();
  assert.match(opening,/GetDigits.*opening\.mp3/);
  assert.match(opening,/retries="2" timeout="25"/);
  assert.match(opening,/<\/GetDigits><Hangup\/>/);
  assert.doesNotMatch(opening,/<Record/);
  assert.equal((await callback('turn/0',{RecordingID:'record-id-00'})).status,200);
  assert.equal(mediaReads,0);
  assert.match(await (await callback('consent',{Digits:'1'})).text(),/propertyType\.mp3.*Record/);
  for(let i=0;i<6;i++){
   const res=await callback('turn/'+i,{RecordingID:'record-id-0'+i});
   assert.equal(res.status,200,await res.clone().text());
   const result=await res.text();
   assert.match(result,i===5?/closing\.mp3/:/<Record/);
  }
  assert.match(await (await callback('turn/5',{RecordingID:'record-id-05'})).text(),/closing\.mp3/);
  const row=f.r.db.prepare('SELECT * FROM leads WHERE tenant_id=? AND id=?').get(tid,lead);
  assert.equal(row.preferred_location,'रायपुर');
  assert.equal(row.budget_max_inr,4500000);
  assert.equal(row.interest_status,'followup');
  assert.equal(row.consent_status,'unknown');
  assert.equal(JSON.parse(row.requirements_json).scriptedCallPilot.answers.area,'अमलीडीह');
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='lead.scripted_phone_pilot_saved'").get().n,1);
  assert.equal(f.c.db.prepare('SELECT phase FROM scripted_phone_pilots').get().phase,'completed');
  assert.equal(mediaReads,6);
  const status=await handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot'),env,admin,{now,fetcher});
  const last=(await status.json()).recent[0];
  assert.equal(last.turn,6);assert.equal(last.provider_call_reference,1);assert.equal(last.signed_hangup,0);
  assert.equal((await callback('hangup',{Duration:'73'})).status,204);
  const ended=await handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot'),env,admin,{now,fetcher});
  const final=(await ended.json()).recent[0];assert.equal(final.signed_hangup,1);assert.equal(final.duration_seconds,73);
 }finally{f.close()}
});

test('Cloudflare microphone transcription requires a writable tenant membership',async()=>{
 const f=fixture();try{
  let aiCalls=0;
  const env={...f.env,AI:{async run(model,options){
   aiCalls++;
   assert.match(model,/whisper/);
   assert.equal(options.audio,'UklGRg==');
   return {text:' बजट   45 लाख '};
  }}};
  const submit=user=>handleFixedVoicePreviewRequest(new Request(origin+'/v1/human/voice-preview/transcribe?language=hi&tenantId='+tid,{
   method:'POST',headers:{'Content-Type':'audio/wav'},body:'RIFF'
  }),env,user);
  assert.equal((await submit({id:'viewer'})).status,403);
  assert.equal(aiCalls,0);
  assert.deepEqual(await (await submit({id:'client'})).json(),{text:'बजट 45 लाख',reviewRequired:true});
  assert.equal(aiCalls,1);
 }finally{f.close()}
});


test('queued customer call uses signed callbacks, scoped audio and durable opt-out',async()=>{
 const f=fixture();
 try{
  await setup(f);
  const env=f.env,config=await approvedCampaignPhone(env),audioKeys=[];
  env.RECORDINGS.get=async key=>{audioKeys.push(key);return {size:4,body:new Uint8Array(4)}};
  env.AI.run=()=>assert.fail('opt-out on the opening prompt must not record/transcribe');
  let hook;
  const started=await tickScriptedTenant(env,f.r.wrap,tid,config,{now,apiFetch:async (_url,opts)=>{
   hook=JSON.parse(opts.body).answer_url.replace(/\/answer$/,'');
   return accepted();
  }});
  assert.equal(started.state,'submitted');
  const request=(step,params)=>signed(hook+'/'+step,{CallUUID:callId,...params},env.PLIVO_AUTH_TOKEN);
  const answer=await handleScriptedPhoneCallback(request('answer',{
   ALegRequestUUID:'synthetic-plivo-request-123',To:internalNumber,From:config.caller,Direction:'outbound'
  }),env,{now});
  assert.match(await answer.text(),/GetDigits/);
  const audio=await handleScriptedPhoneCallback(new Request(hook+'/audio/opening.mp3'),env,{now});
  assert.equal(audio.status,200);
  assert.deepEqual(audioKeys,['scripted-phone-campaigns/'+tid+'/hi/opening.mp3']);
  for(let i=0;i<2;i++){
   const stopped=await handleScriptedPhoneCallback(request('consent',{Digits:'2'}),env,{now});
   assert.match(await stopped.text(),/<Hangup/);
  }
  const suppressed=f.r.db.prepare('SELECT consent_status,dnd_status FROM leads WHERE id=?').get(lead);
  assert.equal(suppressed.consent_status,'denied');
  assert.equal(suppressed.dnd_status,'blocked');
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM lead_opt_out_events').get().n,1);
  assert.equal((await handleScriptedPhoneCallback(request('hangup',{Duration:'22'}),env,{now})).status,204);
  assert.equal((await tickScriptedTenant(env,f.r.wrap,tid,config,{now:now+60000,apiFetch:()=>assert.fail('never redial')})).state,'reconciled');
  assert.equal(f.r.db.prepare('SELECT provider_status FROM calling_jobs').get().provider_status,'declined');
 }finally{f.close()}
});

test('retired provider endpoints stop before DB access or body handling',async()=>{
 for(const path of ['/v1/provider/unknown-transport','/v1/provider/retired-hook','/v1/provider/legacy/session']){
  const response=await worker.fetch(new Request(origin+path,{method:'POST',body:'{}'}),{});
  assert.equal(response.status,404);
  assert.deepEqual(await response.json(),{error:'not found'});
 }
});


test('CSV campaign → approved dial → seven signed answers → client CRM result',async()=>{
 for(const editDuringCall of [false,true]){
  const f=fixture();
  try{
   const csv='Name,Mobile,Preferred Location\nNew CSV customer,9000000005,Old city';
   const batch={tenantId:tid,csv,campaign:{name:'November CSV',language:'en',requestId:crypto.randomUUID()}};
   const commit=user=>handleCrmRequest(new Request(origin+'/v1/human/import/commit',{
    method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(batch)
   }),f.env,user);
   assert.equal((await commit({id:'viewer'})).status,403);
   const imported=await commit(client);
   assert.equal(imported.status,201,await imported.clone().text());
   const draft=await imported.json();
   const replay=await (await commit(client)).json();
   assert.equal(draft.campaignCustomers,1);
   assert.equal(replay.campaignId,draft.campaignId);
   assert.equal(replay.inserted,0);
   const csvLead=f.r.db.prepare('SELECT id FROM leads WHERE mobile_e164=?').get('+919000000005').id;
   assert.notEqual(csvLead,lead);
   assert.deepEqual(f.r.db.prepare('SELECT lead_id FROM call_campaign_candidates WHERE campaign_id=?').all(draft.campaignId).map(v=>v.lead_id),[csvLead]);

   configureScriptedCampaign(f);
   const policy=await route(f,'policy',{tenantId:tid,enabled:true,approvalReference:'provider-approval-ref',expiresAt:until,dailyLimit:10,maxSeconds:180},admin);
   assert.equal(policy.status,200,await policy.text());
   const review=await (await route(f,'clearances',{tenantId:tid,campaignId:draft.campaignId},admin,'GET')).json();
   assert.deepEqual(review.leads.map(x=>x.id),[csvLead]);
   const start=await route(f,'runs',{tenantId:tid,campaignId:draft.campaignId,action:'start'});
   assert.equal(start.status,202,await start.text());
   const env=f.env,config=await approvedCampaignPhone(env);
   const waiting=await tickScriptedTenant(env,f.r.wrap,tid,config,{now,apiFetch:()=>assert.fail('clearance is required')});
   assert.equal(waiting.state,'idle_or_clearance_required');
   const clearance=await route(f,'clearances',{tenantId:tid,leadIds:[csvLead],purpose:'property_information',
    consentReference:'consent-ref',dndReference:'dnd-ref',expiresAt:until},admin);
   assert.equal(clearance.status,200,await clearance.text());
   let hook;
   const responses=['flat','Raipur','Shankar Nagar','3BHK','35 lakh','yes','2027-01-12'];
   env.AI.run=async()=>({text:responses.shift()});
   const tick=await tickScriptedTenant(env,f.r.wrap,tid,config,{now,apiFetch:async (_url,opts)=>{
    const payload=JSON.parse(opts.body);
    assert.equal(payload.to,'+919000000005');
    hook=payload.answer_url.replace(/\/answer$/,'');
    return accepted();
   }});
   assert.equal(tick.state,'submitted');
   const callback=(step,params)=>handleScriptedPhoneCallback(
    signed(hook+'/'+step,{CallUUID:callId,...params},env.PLIVO_AUTH_TOKEN),env,{now,fetcher:async()=>new Response('RIFF',{headers:{'Content-Type':'audio/wav'}})}
   );
   assert.match(await (await callback('answer',{ALegRequestUUID:'synthetic-plivo-request-123',
    To:'+919000000005',From:config.caller,Direction:'outbound'})).text(),/GetDigits/);
   await callback('consent',{Digits:'1'});
   if(editDuringCall)f.r.db.prepare("UPDATE leads SET updated_at=?,preferred_location='Staff city' WHERE id=?")
    .run(new Date(now+500).toISOString(),csvLead);
   for(let i=0;i<7;i++){
    const response=await callback('turn/'+i,{RecordingID:'record-id-0'+i});
    assert.equal(response.status,200,await response.clone().text());
    assert.match(await response.text(),i===6?(editDuringCall?/review\.mp3/:/closing\.mp3/):/<Record/);
   }
   await callback('turn/6',{RecordingID:'record-id-06'});
   assert.equal((await callback('hangup',{Duration:'70'})).status,204);
   assert.equal((await tickScriptedTenant(env,f.r.wrap,tid,config,{now:now+60000,apiFetch:()=>assert.fail('no redial')})).state,'reconciled');
   const data=await (await route(f,'results',{tenantId:tid,campaignId:draft.campaignId},client,'GET')).json();
   assert.equal(data.total,1);
   assert.equal(data.results[0].savedToLead,!editDuringCall);
   assert.equal(data.results[0].answers.budgetInr,3500000);
   assert.equal(data.results[0].answers.visitDate,'2027-01-12');
   assert.equal(data.results[0].durationSeconds,70);
   assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM scripted_call_results').get().n,1);
   assert.equal(f.r.db.prepare('SELECT preferred_location FROM leads WHERE id=?').get(csvLead).preferred_location,editDuringCall?'Staff city':'Raipur');
   assert.equal((await route(f,'results',{tenantId:tid},{id:'foreign'},'GET')).status,403);
   assert.equal((await (await route(f,'results',{tenantId:tid,campaignId:crypto.randomUUID()},client,'GET')).json()).total,0);
  }finally{f.close()}
 }
});

test('Scripted phone repeats the location prompt after hearing trouble instead of saving it',async()=>{
 const f=fixture();
 try{
  const spoken=['प्लॉट','आपकी आवाज नहीं आ रही','रायपुर','अमलीडीह','1200 वर्ग फुट','45 लाख','बाद में'];
  const env={...f.env,PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,
   RECORDINGS:{head:async()=>({size:4}),get:async()=>({size:4,body:new Uint8Array(4)})},
   AI:{async run(){return {text:spoken.shift()}}}
  };
  let providerCalls=0,hook;
  const fetcher=async(url,options)=>{
   if(url.startsWith('https://api.plivo.com/')){
    providerCalls++;
    hook=JSON.parse(options.body).answer_url.replace(/\/answer$/,'');
    return Response.json({request_uuid:requestId},{status:202});
   }
   return new Response('RIFF',{headers:{'Content-Type':'audio/wav'}});
  };
  const started=await handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot',{
   method:'POST',headers:{Origin:origin},
   body:JSON.stringify({language:'hi',confirm:'CALL_ONE_VERIFIED_INTERNAL_NUMBER'})
  }),env,admin,{now,fetcher});
  assert.equal(started.status,202);
  assert.equal(providerCalls,1);
  const callback=(step,params={})=>handleScriptedPhoneCallback(
   signed(hook+'/'+step,{CallUUID:callId,...params}),env,{now,fetcher});
  await callback('answer',{ALegRequestUUID:requestId,From:'918000000000',
   To:'919000000001',Direction:'outbound'});
  await callback('consent',{Digits:'1'});
  assert.match(await (await callback('turn/0',{RecordingID:'record-id-00'})).text(),/location\.mp3/);
  const bad=await callback('turn/1',{RecordingID:'record-id-01'});
  assert.equal(bad.status,200);
  const retryXml=await bad.text();
  // The optional audio goes BEFORE the original question, not in place of it.
  assert.match(retryXml,/audio\/repeat\.mp3[\s\S]*audio\/location\.mp3/);
  const clip=await handleScriptedPhoneCallback(new Request(hook+'/audio/repeat.mp3'),env,{now,fetcher});
  assert.equal(clip.status,200);
  assert.equal(clip.headers.get('Content-Type'),'audio/mpeg');
  const spokenCount=spoken.length;
  // Duplicate signed Plivo turn callback never transcribes again or double-saves.
  assert.match(await (await callback('turn/1',{RecordingID:'record-id-01'})).text(),
   /audio\/repeat\.mp3[\s\S]*audio\/location\.mp3/);
  assert.equal(spoken.length,spokenCount);
  const originalHead=env.RECORDINGS.head;
  for(const fallback of [null,{size:524289},'error']){
   env.RECORDINGS.head=async key=>{
    if(!key.endsWith('/repeat.mp3'))return originalHead(key);
    if(fallback==='error')throw Error('synthetic R2 metadata outage');
    return fallback;
   };
   const retry=await callback('turn/1',{RecordingID:'record-id-01'});
   assert.equal(retry.status,200);
   const xml=await retry.text();
   assert.doesNotMatch(xml,/audio\/repeat\.mp3/);
   assert.match(xml,/audio\/location\.mp3/);
   assert.equal(spoken.length,spokenCount);
  }
  env.RECORDINGS.head=originalHead;
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='lead.scripted_phone_pilot_saved'").get().n,0);
  for(let i=2;i<=6;i++){
   const res=await callback('turn/'+i,{RecordingID:'record-id-0'+i});
   assert.equal(res.status,200);
   assert.match(await res.text(),i===6?/closing\.mp3/:/<Record/);
  }
  assert.equal(spoken.length,0);
  const row=f.r.db.prepare('SELECT preferred_location,budget_max_inr FROM leads WHERE tenant_id=? AND id=?').get(tid,lead);
  assert.equal(row.preferred_location,'रायपुर');
  assert.equal(row.budget_max_inr,4500000);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='lead.scripted_phone_pilot_saved'").get().n,1);
  assert.equal(providerCalls,1);
 }finally{f.close()}
});


test('Optional retry audio is not required for a complete campaign prompt set',async()=>{
 const requested=[];
 const ready=await scriptedPromptsReady({
  RECORDINGS:{head:async key=>{
   requested.push(key);
   if(key.endsWith('/repeat.mp3'))throw Error('optional clip missing');
   return {size:4};
  }}
 },'hi','88888888-8888-4888-8888-888888888888');
 assert.equal(ready,true);
 assert.ok(requested.length>0);
 assert.ok(requested.every(key=>!key.endsWith('/repeat.mp3')));
 assert.ok(requested.every(key=>key.startsWith(
  'scripted-phone-campaigns/88888888-8888-4888-8888-888888888888/hi/')));
});

test('Silence from speech recognition ends in review, never saves invented CRM values or redials',async()=>{
 const f=fixture();
 try{
  let sttRuns=0,submitted=0,hook;
  const env={...f.env,PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,
   RECORDINGS:{head:async()=>({size:4}),get:async()=>({size:4,body:new Uint8Array(4)})},
   AI:{async run(){return {text:sttRuns++===0?'प्लॉट':'   '}}}
  };
  const fetcher=async(url,options)=>{
   if(url.startsWith('https://api.plivo.com/')){
    submitted++;
    hook=JSON.parse(options.body).answer_url.replace(/\/answer$/,'');
    return Response.json({request_uuid:requestId},{status:202});
   }
   return new Response('RIFF',{headers:{'Content-Type':'audio/wav'}});
  };
  const started=await handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot',{
   method:'POST',headers:{Origin:origin},
   body:JSON.stringify({language:'hi',confirm:'CALL_ONE_VERIFIED_INTERNAL_NUMBER'})
  }),env,admin,{now,fetcher});
  assert.equal(started.status,202);
  const callback=(step,params={})=>handleScriptedPhoneCallback(
   signed(hook+'/'+step,{CallUUID:callId,...params}),env,{now,fetcher});
  await callback('answer',{ALegRequestUUID:requestId,
   From:'918000000000',To:'919000000001',Direction:'outbound'});
  await callback('consent',{Digits:'1'});
  assert.match(await (await callback('turn/0',{RecordingID:'record-id-00'})).text(),/location\.mp3/);
  for(let i=1;i<=3;i++){
   const response=await callback('turn/'+i,{RecordingID:'record-id-0'+i});
   assert.equal(response.status,200);
   const xml=await response.text();
   if(i<3)assert.match(xml,/repeat\.mp3[\s\S]*location\.mp3/);
   else assert.match(xml,/review\.mp3/);
  }
  assert.equal(sttRuns,4);
  assert.equal(submitted,1);
  assert.equal(f.c.db.prepare('SELECT phase FROM scripted_phone_pilots').get().phase,'needs_review');
  const leadRow=f.r.db.prepare('SELECT preferred_location,budget_max_inr,consent_status FROM leads WHERE tenant_id=? AND id=?').get(tid,lead);
  assert.equal(leadRow.preferred_location,null);
  assert.equal(leadRow.budget_max_inr,null);
  assert.equal(leadRow.consent_status,'unknown');
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='lead.scripted_phone_pilot_saved'").get().n,0);
  assert.match(await (await callback('turn/3',{RecordingID:'record-id-03'})).text(),/review\.mp3/);
  assert.equal(sttRuns,4);
  assert.equal(submitted,1);
 }finally{f.close()}
});

test('MFA-only internal customer preparation is scoped, idempotent and never dials',async()=>{
 const f=fixture();
 try{
  f.c.db.prepare("UPDATE tenants SET display_name='AR3D Internal' WHERE id=?").run(tid);
  const destination='+919000000007';
  const env={...f.env,AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:destination};
  const run=(e=env,u=admin,body={confirm:'PREPARE_INTERNAL_TEST_LEAD_NO_CALL'},o=origin,method='POST')=>
   handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot/prepare-lead',
    {method,headers:{Origin:o},...(method==='POST'?{body:JSON.stringify(body)}:{})}),
    e,u,{now,fetcher:()=>assert.fail('must not contact Plivo')});
  assert.equal((await run(env,client)).status,403);
  assert.equal((await run(env,admin,{},origin)).status,400);
  assert.equal((await run(env,admin,undefined,'https://wrong.example')).status,403);
  assert.equal((await run(env,admin,undefined,origin,'GET')).status,405);
  assert.equal((await run({...env,AR3D_SCRIPTED_PILOT_ENABLED:'enabled'})).status,409);
  assert.equal((await run({...env,AR3D_SCRIPTED_CAMPAIGNS_ENABLED:'enabled'})).status,409);
  assert.equal((await run({...env,AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber})).status,409);
  const first=await run();assert.equal(first.status,201,await first.clone().text());
  const d=await first.json();assert.equal(d.created,true);assert.equal(d.destinationLast4,'0007');
  assert.ok(!JSON.stringify(d).includes(destination));
  const again=await run();assert.equal(again.status,200);assert.equal((await again.json()).leadId,d.leadId);
  const row=f.r.db.prepare('SELECT * FROM leads WHERE tenant_id=? AND id=?').get(tid,d.leadId);
  assert.equal(row.name,'AR3D Internal Test');assert.equal(row.mobile_e164,destination);
  assert.equal(row.consent_status,'unknown');assert.equal(row.dnd_status,'unknown');
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='lead.created' AND target_id=?").get(d.leadId).n,1);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM scripted_phone_pilots').get().n,0);
  f.r.db.prepare("UPDATE leads SET consent_status='denied' WHERE tenant_id=? AND id=?").run(tid,d.leadId);
  assert.equal((await run()).status,409);
  f.c.db.prepare("UPDATE tenants SET display_name='External Builder' WHERE id=?").run(tid);
  assert.equal((await run()).status,409);
 }finally{f.close()}
});
