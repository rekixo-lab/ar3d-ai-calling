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

test('recording and STT failures play repeat cue, bounded at three attempts, without redial or invented answers',async()=>{
 for(const mode of ['http','network','type','empty_body','speech','missing_id','recover']){
  const f=fixture();
  try{
   let hook,submitted=0,reads=0,stt=0;
   const env={...f.env,PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
    AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
    AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
    AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
    AR3D_SCRIPTED_PILOT_LEAD_ID:lead,
    RECORDINGS:{head:async()=>({size:4}),get:async()=>({size:4,body:new Uint8Array(4)})},
    AI:{async run(){stt++;if(mode==='speech')throw Error('synthetic private error');return {text:'प्लॉट चाहिए'}}}
   };
   const fetcher=async(url,options)=>{
    if(url.startsWith('https://api.plivo.com/')){
     submitted++;hook=JSON.parse(options.body).answer_url.replace(/\/answer$/,'');
     return Response.json({request_uuid:requestId},{status:202});
    }
    assert.match(url,/^https:\/\/media\.plivo\.com\//);
    reads++;
    if(mode==='http'||(mode==='recover'&&reads<=2))return new Response('not ready',{status:404});
    if(mode==='network')throw Error('synthetic network error');
    if(mode==='type')return new Response('{}',{headers:{'Content-Type':'application/json'}});
    if(mode==='empty_body')return new Response(null,{headers:{'Content-Type':'audio/mpeg'}});
    return new Response('RIFF',{headers:{'Content-Type':'audio/wav'}});
   };
   const start=await handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot',{
    method:'POST',headers:{Origin:origin},body:JSON.stringify({language:'hi',confirm:'CALL_ONE_VERIFIED_INTERNAL_NUMBER'})
   }),env,admin,{now,fetcher});
   assert.equal(start.status,202);
   const cb=(step,params={})=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params}),env,{now,fetcher});
   await cb('answer',{ALegRequestUUID:requestId,From:'918000000000',To:'919000000001',Direction:'outbound'});
   await cb('consent',{Digits:'1'});
   for(let i=0;i<(mode==='recover'?2:3);i++){
    const params=mode==='missing_id'?{}:{RecordingID:'record-id-0'+i,RecordUrl:'https://evil.invalid/never'};
    const r=await cb('turn/'+i,params);assert.equal(r.status,200,mode);
    const xml=await r.text();
    if(mode==='recover'&&i===1){assert.match(xml,/audio\/location\.mp3/);assert.doesNotMatch(xml,/repeat\.mp3/)}
    else if(i<2){assert.match(xml,/audio\/repeat\.mp3[\s\S]*audio\/propertyType\.mp3/);assert.doesNotMatch(xml,/review\.mp3/)}
    else assert.match(xml,/review\.mp3/);
    const n=reads,ai=stt;
    await cb('turn/'+i,params);assert.equal(reads,n);assert.equal(stt,ai);
   }
   const row=f.c.db.prepare('SELECT phase,turn,survey_json FROM scripted_phone_pilots').get(),state=JSON.parse(row.survey_json);
   assert.equal(row.phase,mode==='recover'?'question':'needs_review');
   assert.equal(state.attempts,mode==='recover'?0:3);
   assert.equal(state.index,mode==='recover'?1:0);
   assert.equal(row.turn,mode==='recover'?2:3);
   assert.equal(submitted,1);
   assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='lead.scripted_phone_pilot_saved'").get().n,0);
  }finally{f.close()}
 }
});

test('internal pilot cooldown starts at signed hangup, blocks unsigned terminal attempts and concurrent starts',async()=>{
 const f=fixture();
 try{
  const env={...f.env,PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,RECORDINGS:{head:async()=>({size:4}),get:async()=>({size:4,body:new Uint8Array(4)})},AI:{run:async()=>({text:''})}};
  let dials=0,hook;
  const fetcher=async(url,options)=>{
   dials++;hook=JSON.parse(options.body).answer_url.replace(/\/answer$/,'');
   return Response.json({request_uuid:dials===1?requestId:'24111111-2222-3333-4444-555555555556'},{status:202});
  };
  const start=at=>handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot',{
   method:'POST',headers:{Origin:origin},body:JSON.stringify({language:'hi',confirm:'CALL_ONE_VERIFIED_INTERNAL_NUMBER'})
  }),env,admin,{now:at,fetcher});
  const status=async at=>(await (await handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot'),env,admin,{now:at,fetcher})).json()).availability;
  assert.equal((await status(now)).ready,true);
  assert.equal((await start(now)).status,202);
  assert.equal((await status(now+61000)).reason,'awaiting_signed_hangup');
  const details={ALegRequestUUID:requestId,From:'918000000000',To:'919000000001',Direction:'outbound',CallUUID:callId};
  await handleScriptedPhoneCallback(signed(hook+'/answer',details),env,{now:now+1000,fetcher});
  f.c.db.prepare("UPDATE scripted_phone_pilots SET phase='needs_review'").run();
  assert.equal((await start(now+61000)).status,409);
  assert.equal((await start(now+700000)).status,409,'expiry cannot prove hangup');
  assert.equal(dials,1);
  const endAt=now+100000;
  assert.equal((await handleScriptedPhoneCallback(signed(hook+'/hangup',{CallUUID:callId,Duration:'99'}),env,{now:endAt,fetcher})).status,204);
  assert.deepEqual(await status(endAt),{ready:false,reason:'cooldown',retryAfterSeconds:60});
  assert.equal((await start(endAt+59999)).status,409);
  assert.equal((await status(endAt+59999)).retryAfterSeconds,1);
  assert.equal((await status(endAt+60000)).ready,true);
  const outcomes=await Promise.all([start(endAt+60000),start(endAt+60000)]);
  assert.deepEqual(outcomes.map(x=>x.status).sort(),[202,409]);
  assert.equal(dials,2);
 }finally{f.close()}
});

test('five-device internal registry is capped, audited, consent-attested and tenant bound',async()=>{
 const f=fixture();
 try{
  f.c.db.prepare("UPDATE tenants SET display_name='AR3D Internal' WHERE id=?").run(tid);
  const env={...f.env,PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,RECORDINGS:{head:async()=>({size:4}),get:async()=>({size:4,body:new Uint8Array(4)})},AI:{run:async()=>({text:'प्लॉट'})}};
  let dials=0,hook,destination;
  const fetcher=async(url,options)=>{
   dials++;const b=JSON.parse(options.body);destination=b.to;hook=b.answer_url.replace(/\/answer$/,'');
   return Response.json({request_uuid:requestId},{status:202});
  };
  const request=(path,body,user=admin,configuration=env)=>handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot'+path,{
   method:body?'POST':'GET',headers:{Origin:origin},...(body?{body:JSON.stringify(body)}:{})
  }),configuration,user,{now,fetcher});
  const add=mobile=>request('/devices',{mobile,confirm:'VERIFIED_CONSENTED_INTERNAL_DEVICE_NO_CALL'});
  const first='+919000000002';
  assert.equal((await request('/devices',{mobile:first,confirm:'wrong'})).status,400);
  assert.equal((await request('/devices',{mobile:first,confirm:'VERIFIED_CONSENTED_INTERNAL_DEVICE_NO_CALL'},client)).status,403);
  assert.equal((await add(internalNumber)).status,409);
  let enrolled=[];
  for(let i=2;i<=5;i++){const r=await add('+91900000000'+i);assert.equal(r.status,201,await r.clone().text());enrolled.push((await r.json()).leadId)}
  assert.equal((await add('+919000000006')).status,409);
  assert.equal((await add(first)).status,409);
  assert.equal(dials,0);
  const status=await (await request('',null)).json();
  assert.equal(status.devices.length,5);
  assert.ok(!JSON.stringify(status).includes(first));
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='lead.internal_test_device_enrolled'").get().n,4);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM leads WHERE name='AR3D Internal Device Test' AND consent_status='unknown' AND dnd_status='unknown'").get().n,4);
  const start=leadId=>request('',{leadId,language:'hi',confirm:'CALL_ONE_VERIFIED_INTERNAL_NUMBER'});
  assert.equal((await start('99999999-9999-4999-8999-999999999999')).status,403);
  assert.equal((await start(enrolled[0])).status,202);
  assert.equal(destination,first);
  assert.equal(dials,1);
  assert.equal((await start(enrolled[1])).status,409);
  const cb=(step,params)=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params}),env,{now,fetcher});
  const details={ALegRequestUUID:requestId,From:'918000000000',To:'919000000002',Direction:'outbound'};
  assert.match(await (await cb('answer',details)).text(),/opening\.mp3/);
  assert.match(await (await cb('consent',{Digits:'1'})).text(),/propertyType\.mp3/);
  assert.equal((await cb('hangup',{Duration:'20'})).status,204);
  const row=f.c.db.prepare('SELECT lead_id,destination,hangup_at FROM scripted_phone_pilots').get();
  assert.equal(row.lead_id,enrolled[0]);assert.equal(row.destination,first);assert.equal(row.hangup_at,now);
 }finally{f.close()}
});

test('signed incomplete campaign call preserves accepted answers for review without changing lead or redialing',async()=>{
 for(const mode of ['ended','needs_review','suppressed']){
  const f=fixture();try{
   await setup(f);const env=f.env,config=await approvedCampaignPhone(env);
   const spoken=['प्लॉट','रायपुर','repeat','repeat','repeat'];
   env.AI.run=async()=>({text:spoken.shift()});
   let hook;
   const submitted=await tickScriptedTenant(env,f.r.wrap,tid,config,{now,apiFetch:async (_url,opts)=>{
    hook=JSON.parse(opts.body).answer_url.replace(/\/answer$/,'');return accepted();
   }});
   assert.equal(submitted.state,'submitted');
   const cb=(step,params)=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params},env.PLIVO_AUTH_TOKEN),env,{now,fetcher:async()=>new Response('RIFF',{headers:{'Content-Type':'audio/wav'}})});
   await cb('answer',{ALegRequestUUID:'synthetic-plivo-request-123',To:internalNumber,From:config.caller,Direction:'outbound'});
   await cb('consent',{Digits:'1'});
   const original=f.r.db.prepare('SELECT * FROM leads WHERE id=?').get(lead);
   for(let i=0;i<(mode==='needs_review'?5:2);i++){
    const response=await cb('turn/'+i,{RecordingID:'record-id-0'+i});
    assert.equal(response.status,200,await response.clone().text());
   }
   assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM scripted_call_results').get().n,0);
   if(mode==='suppressed')f.r.db.prepare("UPDATE leads SET consent_status='denied',dnd_status='blocked' WHERE id=?").run(lead);
   const before=f.r.db.prepare('SELECT * FROM leads WHERE id=?').get(lead);
   assert.equal((await cb('hangup',{Duration:'45'})).status,204);
   const tick=()=>tickScriptedTenant(env,f.r.wrap,tid,config,{now:now+60000,apiFetch:()=>assert.fail('no redial')});
   assert.equal((await tick()).state,'reconciled');
   await tick();
   const result=await (await route(f,'results',{tenantId:tid},client,'GET')).json();
   const row=result.results[0];assert.equal(row.state,'failed');assert.equal(row.savedToLead,false);
   if(mode==='suppressed'){
    assert.equal(row.answers,null);assert.equal(row.partial,false);
   }else{
    assert.equal(row.partial,true);
    assert.deepEqual(row.answers,{propertyType:'plot',location:'रायपुर'});
    assert.deepEqual(original,before);
   }
   assert.deepEqual(f.r.db.prepare('SELECT * FROM leads WHERE id=?').get(lead),before);
   assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='calling.partial_result_saved'").get().n,mode==='suppressed'?0:1);
   assert.equal((await route(f,'results',{tenantId:tid},{id:'foreign'},'GET')).status,403);
  }finally{f.close()}
 }
});

test('preconsented internal test skips keypad, announces recording and retries temporary media availability',async()=>{
 const f=fixture();try{
  const env={...f.env,PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,
   RECORDINGS:{head:async()=>({size:4}),get:async()=>({size:4,body:new Uint8Array(4)})},
   AI:{async run(_model,options){assert.equal(options.vad_filter,false);return {text:'प्लॉट चाहिए'}}}
  };
  let hook,reads=0;
  const fetcher=async(url,opts)=>{
   if(url.startsWith('https://api.plivo.com/')){
    hook=JSON.parse(opts.body).answer_url.replace(/\/answer$/,'');
    return Response.json({request_uuid:requestId},{status:202});
   }
   assert.equal(opts.redirect,'manual');assert.match(url,/^https:\/\/media\.plivo\.com\//);
   reads++;return reads===1?new Response('not ready',{status:404}):new Response('RIFF',{headers:{'Content-Type':'audio/wav'}});
  };
  const start=await handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot',{
   method:'POST',headers:{Origin:origin},body:JSON.stringify({language:'hi',confirm:'CALL_ONE_PRECONSENTED_INTERNAL_NUMBER'})
  }),env,admin,{now,fetcher});assert.equal(start.status,202);
  const cb=(step,params)=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params}),env,{now,fetcher});
  const details={ALegRequestUUID:requestId,From:'918000000000',To:'919000000001',Direction:'outbound'};
  const opening=await (await cb('answer',details)).text();
  assert.match(opening,/यह बातचीत रिकॉर्ड होती है/);assert.doesNotMatch(opening,/आपके जवाब रिकॉर्ड किए जाएंगे|अगर आप बात नहीं करना चाहते/);assert.doesNotMatch(opening,/GetDigits|opening\.mp3/);
  assert.match(opening,/propertyType\.mp3.*Record.*maxLength="16".*timeout="6"/);
  assert.match(await (await cb('turn/0',{RecordingID:'record-id-00'})).text(),/location\.mp3/);
  assert.equal(reads,2);
  const state=JSON.parse(f.c.db.prepare('SELECT survey_json FROM scripted_phone_pilots').get().survey_json);
  assert.equal(state.answers.propertyType,'plot');assert.equal(state.phoneMeta.lastAudioOutcome,'recognized');
  const status=await (await handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot'),env,admin,{now,fetcher})).json();
  assert.equal(status.recent[0].question_index,1);assert.equal(status.recent[0].last_audio_outcome,'recognized');
  assert.equal((await cb('hangup',{Duration:'30'})).status,204);
 }finally{f.close()}
});

test('streaming pilot XML and one-time authenticated turn claim preserve existing questionnaire',async()=>{
 const f=fixture();try{
  const env={...f.env,PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,
   RECORDINGS:{head:async()=>({size:4}),get:async()=>({size:4,body:new Uint8Array(4)})},
   AI:{async run(){assert.fail('no model or recording request until stream starts')}}
  };
  let hook,bridge;
  const fetcher=async(url,opts)=>{
   assert.match(url,/api\.plivo\.com/);hook=JSON.parse(opts.body).answer_url.replace(/\/answer$/,'');
   return Response.json({request_uuid:requestId},{status:202});
  };
  const start=await handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot',{
   method:'POST',headers:{Origin:origin},body:JSON.stringify({language:'hi',engine:'deepgram_stream',confirm:'CALL_ONE_PRECONSENTED_INTERNAL_NUMBER'})
  }),env,admin,{now,fetcher});assert.equal(start.status,202);
  const cb=(step,params)=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params}),env,{now,fetcher});
  const opening=await (await cb('answer',{ALegRequestUUID:requestId,From:'918000000000',To:'919000000001',Direction:'outbound'})).text();
  assert.match(opening,/ए आई असिस्टेंट हूँ/);assert.doesNotMatch(opening,/टेक्स्ट में दर्ज|रिकॉर्ड किए जाएंगे/);
  assert.match(opening,/propertyType\.mp3.*<Stream/);assert.doesNotMatch(opening,/<Record |<GetDigits/);
  assert.match(opening,/audio\/x-mulaw;rate=8000/);assert.match(opening,/stream-next\/0/);
  const url=opening.match(/>(wss:[^<]+)<\/Stream>/)[1].replace(/^wss:/,'https:');
  const claim=(uri)=>handleScriptedPhoneCallback(new Request(uri,{headers:{Upgrade:'websocket'}}),env,{now,fetcher,streamUpgrade:args=>{bridge=args;return new Response('synthetic upgrade')}});
  assert.equal((await claim(url.replace(/[a-f0-9]{64}$/,'0'.repeat(64)))).status,403);
  assert.equal((await claim(url)).status,200);
  assert.equal((await claim(url)).status,403);
  assert.equal(bridge.callId,callId);
  assert.equal((await cb('turn/0',{RecordingID:'record-id-00'})).status,200);
  // Use current simulated time for the injected callback's server clock.
  const previous=Date.now;Date.now=()=>now;
  try{await bridge.onAnswer({text:'प्लॉट',reason:'recognized',confidence:.95})}finally{Date.now=previous}
  const next=await (await cb('stream-next/0',{})).text();assert.match(next,/location\.mp3.*<Stream/);
  assert.match(next,/stream-next\/1/);
  assert.equal((await claim(url)).status,403);
  assert.match(await (await cb('stream-next/1',{})).text(),/तकनीकी सेवा/);
  const row=JSON.parse(f.c.db.prepare('SELECT survey_json FROM scripted_phone_pilots').get().survey_json);
  assert.equal(row.answers.propertyType,'plot');assert.equal(row.attempts,0);
  assert.equal(row.phoneMeta.lastAudioOutcome,'stream_start_missing');assert.equal(row.phoneMeta.technicalFailure,true);
  assert.equal((await cb('hangup',{Duration:'30'})).status,204);
 }finally{f.close()}
});

test('read-only internal media diagnostics scopes requests to signed ended calls and returns no IDs or URLs',async()=>{
 const f=fixture();try{
  const env={...f.env,PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,RECORDINGS:{head:async()=>({size:4}),get:async()=>null},
   AI:{async run(){assert.fail('no STT')}}};
  const ids=[callId,'34111111-2222-3333-4444-555555555555'];
  for(let i=0;i<2;i++)f.c.db.prepare("INSERT INTO scripted_phone_pilots(id,tenant_id,lead_id,lead_updated_at,actor_id,language,destination,caller,rate_slot,expires_at,phase,provider_call_id,survey_json,created_at,provider_account_id,hangup_at) VALUES(?,?,?,?,?,?,?,?,?,?,'ended',?,?,?,?,?)")
   .run(crypto.randomUUID(),tid,lead,new Date(now).toISOString(),admin.id,'hi',internalNumber,env.AR3D_PLIVO_CALLER_NUMBER,i,now+600000,ids[i],JSON.stringify({phoneMeta:{engine:i?'whisper':'deepgram_stream'}}),new Date(now+i).toISOString(),env.PLIVO_AUTH_ID,now);
  const req=new Request(origin+'/v1/human/scripted-phone-pilot/media-diagnostics');let reads=0;
  const fetcher=async(url,opts)=>{
   reads++;assert.equal(opts.method,'GET');assert.equal(opts.redirect,'manual');
   if(url.includes('/Stream/')){assert.ok(url.includes(ids[0]));return Response.json({objects:[{call_uuid:ids[0],end_time:'2026-11-20',service_url:'wss://private.invalid/token'}]})}
   assert.ok(url.includes('call_uuid='+ids[1]));return Response.json({objects:[{call_uuid:ids[1],recording_duration_ms:'6000',recording_url:'https://private.invalid/audio'},{call_uuid:'other',recording_duration_ms:'9999'}]});
  };
  assert.equal((await handleScriptedPhoneAdmin(req,env,client,{now,fetcher})).status,403);
  assert.equal(reads,0);
  const r=await handleScriptedPhoneAdmin(req,env,admin,{now,fetcher});assert.equal(r.status,200);
  const data=await r.json();assert.equal(data.streams.count,1);assert.equal(data.recordings.durationMs,6000);
  assert.equal(data.recordings.count,1);assert.equal(data.phoneCallsStarted,0);assert.equal(reads,2);
  assert.doesNotMatch(JSON.stringify(data),/private|34111111|14111111/);
 }finally{f.close()}
});

test('recording 403 may recover only through matching authenticated regional metadata',async()=>{
 for(const mode of ['regional','wrong_call','wrong_host']){
  const f=fixture();try{
   const env={...f.env,PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
    AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
    AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
    AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
    AR3D_SCRIPTED_PILOT_LEAD_ID:lead,RECORDINGS:{head:async()=>({size:4}),get:async()=>null},
    AI:{async run(){assert.equal(mode,'regional');return {text:'प्लॉट'}}}};
   let hook,regional=0;const recording='record-id-00';
   const fetcher=async(url,opts)=>{
    assert.equal(opts.redirect,'manual');
    if(url.endsWith('/Call/')){hook=JSON.parse(opts.body).answer_url.replace(/\/answer$/,'');return Response.json({request_uuid:requestId},{status:202})}
    if(url.startsWith('https://media.plivo.com/'))return new Response('forbidden',{status:403});
    if(url.includes('/Recording/?call_uuid='))return Response.json({objects:[{
     recording_id:recording,call_uuid:mode==='wrong_call'?'another-call':callId,recording_format:'mp3',
     recording_url:'https://'+(mode==='wrong_host'?'untrusted.invalid':'aps1.media.plivo.com')+'/v1/Account/syntheticAuth/Recording/'+recording+'.mp3'}]});
    if(url.endsWith('/Recording/'+recording+'/'))return new Response(null,{status:404});
    assert.match(url,/^https:\/\/aps1\.media\.plivo\.com\//);regional++;
    return new Response('RIFF',{headers:{'Content-Type':'audio/wav'}});
   };
   const start=await handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot',{
    method:'POST',headers:{Origin:origin},body:JSON.stringify({language:'hi',confirm:'CALL_ONE_PRECONSENTED_INTERNAL_NUMBER'})
   }),env,admin,{now,fetcher});assert.equal(start.status,202);
   const cb=(step,params)=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params}),env,{now,fetcher});
   await cb('answer',{ALegRequestUUID:requestId,From:'918000000000',To:'919000000001',Direction:'outbound'});
   const result=await (await cb('turn/0',{RecordingID:recording,RecordUrl:'https://untrusted.invalid/ignore'})).text();
   assert.equal(regional,mode==='regional'?1:0);
   const state=JSON.parse(f.c.db.prepare('SELECT survey_json FROM scripted_phone_pilots').get().survey_json);
   assert.equal(state.index,mode==='regional'?1:0);
   assert.match(result,mode==='regional'?/location\.mp3/:/propertyType\.mp3/);
  }finally{f.close()}
 }
});

test('saved recording probe is no-dial, current-MFA and explicit-consent only; returns no speech or IDs',async()=>{
 const f=fixture();try{
  const env={...f.env,PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,RECORDINGS:{head:async()=>({size:4}),get:async()=>null},
   AI:{async run(){return {text:'private transcript'}}}};
  f.c.db.prepare("INSERT INTO scripted_phone_pilots(id,tenant_id,lead_id,lead_updated_at,actor_id,language,destination,caller,rate_slot,expires_at,phase,turn,provider_call_id,survey_json,created_at,provider_account_id,hangup_at) VALUES(?,?,?,?,?,?,?,?,?,?,'ended',1,?,?,?,?,?)")
   .run(crypto.randomUUID(),tid,lead,new Date(now).toISOString(),admin.id,'hi',internalNumber,env.AR3D_PLIVO_CALLER_NUMBER,1,now+600000,callId,JSON.stringify({phoneMeta:{engine:'whisper'}}),new Date(now).toISOString(),env.PLIVO_AUTH_ID,now);
  let calls=0,media=0;
  const req=(confirm='REPROCESS_ONE_CONSENTED_INTERNAL_RECORDING')=>new Request(origin+'/v1/human/scripted-phone-pilot/recording-probe',{method:'POST',headers:{Origin:origin},body:JSON.stringify({confirm})});
  const fetcher=async(url,opts)=>{
   calls++;assert.equal(opts.method,'GET');assert.equal(opts.redirect,'manual');
   if(url.includes('/Recording/?'))return Response.json({objects:[{call_uuid:callId,recording_id:'record-id-00',recording_format:'mp3',recording_duration_ms:6000,recording_url:'https://aps1.media.plivo.com/v1/Account/syntheticAuth/Recording/record-id-00.mp3'}]});
   assert.match(url,/^https:\/\/aps1\.media\.plivo\.com\//);media++;
   return new Response('RIFF',{headers:{'Content-Type':'audio/wav'}});
  };
  assert.equal((await handleScriptedPhoneAdmin(req(),env,client,{now,fetcher})).status,403);
  assert.equal((await handleScriptedPhoneAdmin(req('wrong'),env,admin,{now,fetcher})).status,400);
  assert.equal(calls,0);
  const before=f.r.db.prepare('SELECT * FROM leads WHERE id=?').get(lead);
  const r=await handleScriptedPhoneAdmin(req(),env,admin,{now,fetcher});assert.equal(r.status,200,await r.clone().text());
  const d=await r.json();assert.equal(d.mediaHttp,200);assert.equal(d.stt,'text_received');assert.equal(d.bytes,4);assert.equal(media,1);assert.equal(calls,2);
  assert.doesNotMatch(JSON.stringify(d),/private transcript|record-id|syntheticAuth/);
  assert.deepEqual(f.r.db.prepare('SELECT * FROM leads WHERE id=?').get(lead),before);
 }finally{f.close()}
});

test('signed regional RecordUrl fast path downloads one answer and exposes safe live audio metrics',async()=>{
 const f=fixture();try{
  const env={...f.env,PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,RECORDINGS:{head:async()=>({size:4}),get:async()=>null},
   AI:{async run(){return {text:'प्लॉट'}}}};
  let hook,media=0;const recording='record-id-00',mediaUrl='https://aps1.media.plivo.com/v1/Account/syntheticAuth/Recording/'+recording+'.mp3';
  const fetcher=async(url,opts)=>{
   assert.equal(opts.redirect,'manual');
   if(url.endsWith('/Call/')){hook=JSON.parse(opts.body).answer_url.replace(/\/answer$/,'');return Response.json({request_uuid:requestId},{status:202})}
   assert.equal(url,mediaUrl);assert.match(opts.headers.Authorization,/^Basic /);media++;
   return new Response('RIFF',{headers:{'Content-Type':'audio/wav'}});
  };
  const start=await handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot',{
   method:'POST',headers:{Origin:origin},body:JSON.stringify({language:'hi',confirm:'CALL_ONE_PRECONSENTED_INTERNAL_NUMBER'})
  }),env,admin,{now,fetcher});assert.equal(start.status,202);
  const cb=(step,params)=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params}),env,{now,fetcher});
  await cb('answer',{ALegRequestUUID:requestId,From:'918000000000',To:'919000000001',Direction:'outbound'});
  assert.match(await (await cb('turn/0',{RecordingID:recording,RecordUrl:mediaUrl,RecordingDurationMs:'2500'})).text(),/location\.mp3/);
  assert.equal(media,1);
  const status=await (await handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot'),env,admin,{now,fetcher})).json();
  assert.equal(status.recent[0].question_index,1);assert.equal(status.recent[0].audio_ms,2500);
  assert.equal(status.recent[0].audio_bytes,4);assert.equal(status.recent[0].stt_connected,1);
  assert.equal(status.recent[0].media_host,'aps1.media.plivo.com');
 }finally{f.close()}
});
