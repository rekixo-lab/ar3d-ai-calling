import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {fixture,tid,lead,admin,client,now,until,route,configureScriptedCampaign,setup,accepted} from './helpers/calling-fixture.mjs';
import {approvedCampaignPhone,handleScriptedPhoneAdmin,handleScriptedPhoneCallback as realPhoneCallback,scriptedPromptsReady} from '../src/scripted-phone-pilot.mjs';
import {tickScriptedTenant} from '../src/scripted-campaign-dispatch.mjs';
import worker from '../src/index.mjs';
import {handleCrmRequest} from '../src/crm-routes.mjs';
import {handleFixedVoicePreviewRequest} from '../src/fixed-voice-preview-routes.mjs';

// Test-only transport: exercise the production Sarvam HTTP contract while
// retaining synthetic transcript sequences from the questionnaire regressions.
function handleScriptedPhoneCallback(req,env,options={}){
 const fetcher=options.fetcher||(()=>assert.fail('unexpected provider request'));
 return realPhoneCallback(req,env,{...options,fetcher:async(url,opts)=>{
  if(url==='https://api.sarvam.ai/speech-to-text'&&env.syntheticSpeech){
   assert.equal(opts.body.get('model'),'saaras:v4');
   const result=await env.syntheticSpeech.run(opts.body.get('model'),{language:opts.body.get('language_code'),audio:await opts.body.get('file').text()});
   return Response.json({transcript:result.text});
  }
  if(url==='https://api.sarvam.ai/v1/chat/completions'&&env.syntheticSpeech)return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'unclear',value:'',evidence:''})}}]});
  return fetcher(url,opts);
 }});
}
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

for(const channel of ['phone','whatsapp_voice']) test(channel+' internal pilot: consent, fixed prompts, AI answers and one CRM save',async()=>{
 const whatsapp=channel==='whatsapp_voice';
 const f=fixture();
 try{
  const answers=['प्लॉट','रायपुर','अमलीडीह','बारह सौ वर्ग फीट','45 लाख','बाद में'];
  const env={...f.env,SARVAM_API_KEY:'synthetic-key',PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_PLIVO_WHATSAPP_CALLER_NUMBER:'+919000000008',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,
   RECORDINGS:{head:async()=>({size:4}),get:async()=>({size:4,body:new Uint8Array(4)})},
   syntheticSpeech:{async run(model,input){
    assert.equal(model,'saaras:v4');
    assert.equal(input.language,'hi-IN');
    assert.equal(input.audio,'RIFF');
    return {text:answers.shift()};
   }}
  };
  let dialCount=0,mediaReads=0,hook;
  const fetcher=async(url,options)=>{
   if(url.startsWith('https://api.plivo.com/')){
    dialCount++;
    const payload=JSON.parse(options.body);
    assert.equal(payload.call_type,whatsapp?'whatsapp_voice':undefined);
    assert.equal(payload.from,whatsapp?env.AR3D_PLIVO_WHATSAPP_CALLER_NUMBER:env.AR3D_PLIVO_CALLER_NUMBER);
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
   method:'POST',headers:{Origin:origin},body:JSON.stringify({language:'hi',confirm:whatsapp?'CALL_ONE_INTERNAL_WHATSAPP_WITH_CURRENT_PERMISSION':'CALL_ONE_CONSENTED_INTERNAL_SARVAM_KEYPAD'})
  }),configuration,admin,{now,fetcher});
  assert.equal((await start({...env,AR3D_SCRIPTED_PILOT_ENABLED:undefined})).status,503);
  if(whatsapp)assert.equal((await start({...env,AR3D_PLIVO_WHATSAPP_CALLER_NUMBER:undefined})).status,409);
  assert.equal(dialCount,0);
  const started=await start();
  assert.equal(started.status,202,await started.clone().text());
  assert.equal((await start()).status,409);
  assert.equal(dialCount,1);
  const callback=(step,params={})=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params}),env,{now,fetcher});
  assert.equal((await handleScriptedPhoneCallback(new Request(hook+'/answer'),env,{now,fetcher})).status,403);
  const details={ALegRequestUUID:requestId,From:whatsapp?'919000000008':'918000000000',To:'919000000001',Direction:'outbound'};
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

test('Sarvam microphone transcription requires writable membership, origin and explicit consent',async()=>{
 const f=fixture();try{
 let aiCalls=0;const env={...f.env,SARVAM_API_KEY:'synthetic-key'};
 const fetcher=async(url,opts)=>{aiCalls++;assert.equal(url,'https://api.sarvam.ai/speech-to-text');assert.equal(opts.body.get('model'),'saaras:v4');assert.equal(await opts.body.get('file').text(),'RIFF');return Response.json({transcript:' बजट   45 लाख '})};
 const submit=(user,consent='sarvam',requestOrigin=origin)=>handleFixedVoicePreviewRequest(new Request(origin+'/v1/human/voice-preview/transcribe?language=hi&tenantId='+tid,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'audio/wav','X-AR3D-Speech-Consent':consent},body:'RIFF'}),env,user,{fetcher});
 assert.equal((await submit({id:'viewer'})).status,403);assert.equal((await submit({id:'client'},'')).status,403);assert.equal((await submit({id:'client'},'sarvam','https://foreign.invalid')).status,403);assert.equal(aiCalls,0);
 assert.deepEqual(await (await submit({id:'client'})).json(),{text:'बजट 45 लाख',reviewRequired:true});assert.equal(aiCalls,1);
 }finally{f.close()}
});

test('queued customer call uses signed callbacks, scoped audio and durable opt-out',async()=>{
 const f=fixture();
 try{
  await setup(f);
  const env=f.env,config=await approvedCampaignPhone(env),audioKeys=[];
  env.RECORDINGS.get=async key=>{audioKeys.push(key);return {size:4,body:new Uint8Array(4)}};
  env.syntheticSpeech.run=()=>assert.fail('opt-out on the opening prompt must not record/transcribe');
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
   env.syntheticSpeech.run=async()=>({text:responses.shift()});
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
  const env={...f.env,SARVAM_API_KEY:'synthetic-key',PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,
   RECORDINGS:{head:async()=>({size:4}),get:async()=>({size:4,body:new Uint8Array(4)})},
   syntheticSpeech:{async run(){return {text:spoken.shift()}}}
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
   body:JSON.stringify({language:'hi',confirm:'CALL_ONE_CONSENTED_INTERNAL_SARVAM_KEYPAD'})
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
  const env={...f.env,SARVAM_API_KEY:'synthetic-key',PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,
   RECORDINGS:{head:async()=>({size:4}),get:async()=>({size:4,body:new Uint8Array(4)})},
   syntheticSpeech:{async run(){return {text:sttRuns++===0?'प्लॉट':'   '}}}
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
   body:JSON.stringify({language:'hi',confirm:'CALL_ONE_CONSENTED_INTERNAL_SARVAM_KEYPAD'})
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
 for(const mode of ['http','network','type','empty_body','missing_id','recover']){
  const f=fixture();
  try{
   let hook,submitted=0,reads=0,stt=0;
   const env={...f.env,SARVAM_API_KEY:'synthetic-key',PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
    AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
    AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
    AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
    AR3D_SCRIPTED_PILOT_LEAD_ID:lead,
    RECORDINGS:{head:async()=>({size:4}),get:async()=>({size:4,body:new Uint8Array(4)})},
    syntheticSpeech:{async run(){stt++;return {text:'प्लॉट चाहिए'}}}
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
    method:'POST',headers:{Origin:origin},body:JSON.stringify({language:'hi',confirm:'CALL_ONE_CONSENTED_INTERNAL_SARVAM_KEYPAD'})
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
  const env={...f.env,SARVAM_API_KEY:'synthetic-key',PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,RECORDINGS:{head:async()=>({size:4}),get:async()=>({size:4,body:new Uint8Array(4)})},syntheticSpeech:{run:async()=>({text:''})}};
  let dials=0,hook;
  const fetcher=async(url,options)=>{
   dials++;hook=JSON.parse(options.body).answer_url.replace(/\/answer$/,'');
   return Response.json({request_uuid:dials===1?requestId:'24111111-2222-3333-4444-555555555556'},{status:202});
  };
  const start=at=>handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot',{
   method:'POST',headers:{Origin:origin},body:JSON.stringify({language:'hi',confirm:'CALL_ONE_CONSENTED_INTERNAL_SARVAM_KEYPAD'})
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
  const env={...f.env,SARVAM_API_KEY:'synthetic-key',PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,RECORDINGS:{head:async()=>({size:4}),get:async()=>({size:4,body:new Uint8Array(4)})},syntheticSpeech:{run:async()=>({text:'प्लॉट'})}};
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
  const start=leadId=>request('',{leadId,language:'hi',confirm:'CALL_ONE_CONSENTED_INTERNAL_SARVAM_KEYPAD'});
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
   env.syntheticSpeech.run=async()=>({text:spoken.shift()});
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
  const env={...f.env,SARVAM_API_KEY:'synthetic-key',PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,
   RECORDINGS:{head:async()=>({size:4}),get:async()=>({size:4,body:new Uint8Array(4)})},
   syntheticSpeech:{async run(_model,options){assert.equal(options.language,'hi-IN');return {text:'प्लॉट चाहिए'}}}
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
   method:'POST',headers:{Origin:origin},body:JSON.stringify({language:'hi',confirm:'CALL_ONE_PRECONSENTED_INTERNAL_SARVAM_NUMBER'})
  }),env,admin,{now,fetcher});assert.equal(start.status,202);
  const cb=(step,params)=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params}),env,{now,fetcher});
  const details={ALegRequestUUID:requestId,From:'918000000000',To:'919000000001',Direction:'outbound'};
  const opening=await (await cb('answer',details)).text();
  assert.match(opening,/यह बातचीत रिकॉर्ड होती है/);assert.doesNotMatch(opening,/आपके जवाब रिकॉर्ड किए जाएंगे|अगर आप बात नहीं करना चाहते/);assert.doesNotMatch(opening,/GetDigits|opening\.mp3/);
  assert.match(opening,/propertyType\.mp3.*Record.*maxLength="12".*timeout="3"/);
  assert.match(await (await cb('turn/0',{RecordingID:'record-id-00'})).text(),/location\.mp3/);
  assert.equal(reads,2);
  const state=JSON.parse(f.c.db.prepare('SELECT survey_json FROM scripted_phone_pilots').get().survey_json);
  assert.equal(state.answers.propertyType,'plot');assert.equal(state.phoneMeta.lastAudioOutcome,'recognized');
  const status=await (await handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot'),env,admin,{now,fetcher})).json();
  assert.equal(status.recent[0].question_index,1);assert.equal(status.recent[0].last_audio_outcome,'recognized');
  assert.equal((await cb('hangup',{Duration:'30'})).status,204);
 }finally{f.close()}
});

test('recording 403 may recover only through matching authenticated regional metadata',async()=>{
 for(const mode of ['regional','wrong_call','wrong_host']){
  const f=fixture();try{
   const env={...f.env,SARVAM_API_KEY:'synthetic-key',PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
    AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
    AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
    AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
    AR3D_SCRIPTED_PILOT_LEAD_ID:lead,RECORDINGS:{head:async()=>({size:4}),get:async()=>null},
    syntheticSpeech:{async run(){assert.equal(mode,'regional');return {text:'प्लॉट'}}}};
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
    method:'POST',headers:{Origin:origin},body:JSON.stringify({language:'hi',confirm:'CALL_ONE_PRECONSENTED_INTERNAL_SARVAM_NUMBER'})
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

test('Sarvam recording replay is MFA-only, explicit consent, no dial, no CRM mutation',async()=>{
 const f=fixture();try{
 const env={...f.env,SARVAM_API_KEY:'synthetic-key',PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
 AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
 AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,AR3D_SCRIPTED_PILOT_LEAD_ID:lead,RECORDINGS:{head:async()=>({size:4}),get:async()=>null}};
 const state={version:1,status:'needs_review',language:'hi',index:4,answers:{propertyType:'plot',location:'रायपुर',area:'अमलीडीह',size:'1000 sqft'},attempts:3,turns:9,startedAt:now,phoneMeta:{engine:'sarvam'}};
 f.c.db.prepare("INSERT INTO scripted_phone_pilots(id,tenant_id,lead_id,lead_updated_at,actor_id,language,destination,caller,rate_slot,expires_at,phase,turn,provider_call_id,survey_json,created_at,provider_account_id,hangup_at) VALUES(?,?,?,?,?,?,?,?,?,?,'ended',1,?,?,?,?,?)")
 .run(crypto.randomUUID(),tid,lead,new Date(now).toISOString(),admin.id,'hi',internalNumber,env.AR3D_PLIVO_CALLER_NUMBER,1,now+600000,callId,JSON.stringify(state),new Date(now).toISOString(),env.PLIVO_AUTH_ID,now);
 let calls=0,stt=0,ordered=false;
 const fetcher=async(url,opts)=>{
  calls++;assert.equal(opts.redirect,'manual');
  if(url==='https://api.sarvam.ai/speech-to-text'){stt++;assert.equal(opts.body.get('model'),'saaras:v4');assert.equal(await opts.body.get('file').text(),'RIFF');return Response.json({transcript:'बीस लाख'});}
  assert.equal(opts.method,'GET');
  if(url.includes('/Recording/?'))return Response.json({objects:[{call_uuid:callId,recording_id:'record-id-00',recording_format:'mp3',recording_duration_ms:6000,recording_url:'https://aps1.media.plivo.com/v1/Account/syntheticAuth/Recording/record-id-00.mp3',...(ordered?{recording_start_ms:1407235163907}:{})}]});
  assert.match(url,/aps1\.media\.plivo\.com/);return new Response('RIFF',{headers:{'Content-Type':'audio/wav'}});
 };
 const req=(confirm='REPLAY_ONE_CONSENTED_INTERNAL_LAST_SARVAM')=>new Request(origin+'/v1/human/scripted-phone-pilot/recording-probe',{method:'POST',headers:{Origin:origin},body:JSON.stringify({confirm})});
 assert.equal((await handleScriptedPhoneAdmin(req(),env,client,{now,fetcher})).status,403);
 assert.equal((await handleScriptedPhoneAdmin(req('retired-mode'),env,admin,{now,fetcher})).status,400);
 assert.equal(calls,0);
 const before=f.r.db.prepare('SELECT * FROM leads WHERE id=?').get(lead),controlBefore=f.c.db.prepare('SELECT * FROM scripted_phone_pilots').get();
 const blocked=await (await handleScriptedPhoneAdmin(req(),env,admin,{now,fetcher})).json();assert.equal(blocked.state,'last_answer_order_unverified');assert.equal(stt,0);
 ordered=true;
 const result=await (await handleScriptedPhoneAdmin(req(),env,admin,{now,fetcher})).json();assert.equal(result.normalizedAnswer,2000000);assert.equal(result.transcript,'बीस लाख');assert.equal(result.interpretation.llmRequests,0);assert.equal(stt,1);assert.equal(result.crmChanged,false);
 const playback=await handleScriptedPhoneAdmin(req('PLAY_ONE_CONSENTED_INTERNAL_LAST_ANSWER'),env,admin,{now,fetcher});assert.equal(await playback.text(),'RIFF');assert.equal(stt,1);
 assert.deepEqual(f.c.db.prepare('SELECT * FROM scripted_phone_pilots').get(),controlBefore);assert.deepEqual(f.r.db.prepare('SELECT * FROM leads WHERE id=?').get(lead),before);
 }finally{f.close()}
});

test('signed regional RecordUrl fast path downloads one answer and exposes safe live audio metrics',async()=>{
 const f=fixture();try{
  const env={...f.env,SARVAM_API_KEY:'synthetic-key',PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,RECORDINGS:{head:async()=>({size:4}),get:async()=>null},
   syntheticSpeech:{async run(){return {text:'प्लॉट'}}}};
  let hook,media=0;const recording='record-id-00',mediaUrl='https://aps1.media.plivo.com/v1/Account/syntheticAuth/Recording/'+recording+'.mp3';
  const fetcher=async(url,opts)=>{
   assert.equal(opts.redirect,'manual');
   if(url.endsWith('/Call/')){hook=JSON.parse(opts.body).answer_url.replace(/\/answer$/,'');return Response.json({request_uuid:requestId},{status:202})}
   assert.equal(url,mediaUrl);assert.match(opts.headers.Authorization,/^Basic /);media++;
   return new Response('RIFF',{headers:{'Content-Type':'audio/wav'}});
  };
  const start=await handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot',{
   method:'POST',headers:{Origin:origin},body:JSON.stringify({language:'hi',confirm:'CALL_ONE_PRECONSENTED_INTERNAL_SARVAM_NUMBER'})
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


test('Internal live callback asks for missing unit and remembers only normalized quantity',async()=>{
 const f=fixture();try{
  const spoken=['प्लॉट','कोरबा','अमलीडीह','एक हजार','वर्ग फीट','पच्चीस','लाख','बाद में'];
  const env={...f.env,SARVAM_API_KEY:'synthetic-key',PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
   AR3D_SCRIPTED_PILOT_LEAD_ID:lead,RECORDINGS:{head:async()=>({size:4}),get:async()=>null},
   syntheticSpeech:{async run(model){assert.equal(model,'saaras:v4');return {text:spoken.shift()}}}};
  let hook;
  const fetcher=async(url,opts)=>{
   if(url.endsWith('/Call/')){hook=JSON.parse(opts.body).answer_url.replace(/\/answer$/,'');return Response.json({request_uuid:requestId},{status:202})}
   return new Response('RIFF',{headers:{'Content-Type':'audio/wav'}});
  };
  const start=await handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot',{
   method:'POST',headers:{Origin:origin},body:JSON.stringify({language:'hi',confirm:'CALL_ONE_PRECONSENTED_INTERNAL_SARVAM_NUMBER'})
  }),env,admin,{now,fetcher});assert.equal(start.status,202);
  const cb=(step,params)=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params}),env,{now,fetcher});
  await cb('answer',{ALegRequestUUID:requestId,From:'918000000000',To:'919000000001',Direction:'outbound'});
  for(let i=0;i<8;i++){
   const xml=await (await cb('turn/'+i,{RecordingID:'record-id-0'+i})).text();
   if(i===3){
    assert.match(xml,/वर्ग फुट है या वर्ग गज/);assert.doesNotMatch(xml,/size-plot\.mp3/);
    const saved=JSON.parse(f.c.db.prepare('SELECT survey_json FROM scripted_phone_pilots').get().survey_json);
    assert.deepEqual(saved.phoneMeta.pendingQuantity,{field:'size',amount:1000,turn:4});
    assert.equal(saved.answers.size,undefined);
   }
   if(i===4)assert.match(xml,/budgetInr\.mp3/);
   if(i===5)assert.match(xml,/हजार, लाख या करोड़/);
   if(i===6)assert.match(xml,/interest\.mp3/);
   if(i===7)assert.match(xml,/closing\.mp3/);
  }
  const state=JSON.parse(f.c.db.prepare('SELECT survey_json FROM scripted_phone_pilots').get().survey_json);
  assert.equal(state.answers.size,'1000 वर्ग फुट');assert.equal(state.answers.budgetInr,2500000);
  assert.equal(state.phoneMeta.pendingQuantity,null);assert.equal(spoken.length,0);
 }finally{f.close()}
});

test('consented Sarvam internal call uses one STT per turn, direct parser and no campaign authorization',async()=>{
 const f=fixture();try{
  const env={...f.env,SARVAM_API_KEY:'synthetic-key',PLIVO_AUTH_ID:'syntheticAuth',PLIVO_AUTH_TOKEN:token,
   AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
   AR3D_SCRIPTED_PILOT_ORIGIN:origin,AR3D_PLIVO_CALLER_NUMBER:'+918000000000',
   AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:internalNumber,AR3D_SCRIPTED_PILOT_TENANT_ID:tid,AR3D_SCRIPTED_PILOT_LEAD_ID:lead,
   RECORDINGS:{head:async()=>({size:4}),get:async()=>({size:4,body:new Uint8Array(4)})},
   };delete env.SARVAM_API_KEY;
  let hook,dials=0,stt=0;
  const phrases=['प्लॉट','रायपुर','अमलीडीह','1000 वर्ग फुट','20 लाख।','बाद में'];
  const fetcher=async(url,opts)=>{
   if(url.startsWith('https://api.plivo.com/')){dials++;hook=JSON.parse(opts.body).answer_url.replace(/\/answer$/,'');return Response.json({request_uuid:requestId},{status:202})}
   if(url==='https://api.sarvam.ai/speech-to-text'){
    assert.equal(opts.headers['api-subscription-key'],'synthetic-key');assert.equal(opts.body.get('language_code'),'hi-IN');assert.equal(opts.body.get('model'),'saaras:v4');
    assert.equal(await opts.body.get('file').text(),'RIFF');return Response.json({transcript:phrases[stt++]});
   }
   assert.match(url,/^https:\/\/media\.plivo\.com\//);return new Response('RIFF',{headers:{'Content-Type':'audio/wav'}});
  };
  const start=(confirm,fastTiming)=>handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot',{method:'POST',headers:{Origin:origin},body:JSON.stringify({language:'hi',engine:'sarvam',confirm,...(fastTiming===undefined?{}:{fastTiming})})}),env,admin,{now,fetcher});
  assert.equal((await start('CALL_ONE_PRECONSENTED_INTERNAL_SARVAM_NUMBER')).status,409);assert.equal(dials,0);
  env.SARVAM_API_KEY='synthetic-key';
  assert.equal((await start('retired-mode')).status,400);assert.equal(dials,0);
  assert.equal((await start('CALL_ONE_INTERNAL_SARVAM_WITH_PRIOR_RECORDING_NOTICE','yes')).status,400);assert.equal(dials,0);
  assert.equal((await start('CALL_ONE_CONSENTED_INTERNAL_SARVAM_KEYPAD',true)).status,400);assert.equal(dials,0);
  assert.equal((await start('CALL_ONE_INTERNAL_SARVAM_WITH_PRIOR_RECORDING_NOTICE',true)).status,202);assert.equal(dials,1);
  const cb=(step,params)=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params}),env,{now,fetcher});
  const opening=await (await cb('answer',{ALegRequestUUID:requestId,From:'918000000000',To:'919000000001',Direction:'outbound'})).text();
  assert.match(opening,/नमस्ते.*आपकी पसंद की प्रॉपर्टी/);assert.doesNotMatch(opening,/यह बातचीत रिकॉर्ड होती है/);assert.match(opening,/maxLength="12".*timeout="2"/);
  for(let i=0;i<5;i++){const res=await cb('turn/'+i,{RecordingID:'record-id-0'+i,RecordingDurationMs:'2500'});assert.equal(res.status,200);const xml=await res.text();assert.match(xml,i===4?/timeout="2"/:/timeout="3"/);}
  const row=f.c.db.prepare('SELECT survey_json FROM scripted_phone_pilots').get(),s=JSON.parse(row.survey_json);
  assert.equal(s.answers.budgetInr,2000000);assert.equal(s.phoneMeta.engine,'sarvam');assert.equal(s.phoneMeta.llmRequests,0);assert.equal(s.phoneMeta.sttAudioMs,12500);assert.equal(stt,5);
  await cb('turn/4',{RecordingID:'record-id-04',RecordingDurationMs:'2500'});assert.equal(stt,5);assert.equal(dials,1);
  await cb('turn/5',{RecordingID:'record-id-05',RecordingDurationMs:'2500'});
  const verify=user=>handleScriptedPhoneAdmin(new Request(origin+'/v1/human/scripted-phone-pilot/verify-result'),env,user,{now,fetcher:async()=>{throw Error('no external request')}});
  assert.equal((await verify(client)).status,403);
  assert.equal((await (await verify(admin)).json()).state,'no_signed_ended_sarvam_call');
  await cb('hangup',{Duration:'73'});
  const before=f.r.db.prepare('SELECT * FROM leads WHERE id=?').get(lead);
  const report=await (await verify(admin)).json();
  assert.equal(report.crmVerified,true);assert.equal(report.answers.budgetInr,2000000);assert.equal(report.storedAnswers.budgetInr,2000000);
  assert.equal(report.connectedSeconds,73);assert.equal(report.usage.llmRequests,0);assert.equal(report.usage.sttAudioMs,15000);
  assert.equal(report.fastTiming,true);assert.equal(report.voiceTiming.samples,6);assert.ok(Number.isSafeInteger(report.voiceTiming.totalP95Ms));assert.equal(report.voiceTiming.basis,'successful_recorded_answer_processing_only');
  assert.equal(report.phoneCallsStarted,0);assert.equal(report.crmChanged,false);assert.equal(stt,6);
  assert.deepEqual(f.r.db.prepare('SELECT * FROM leads WHERE id=?').get(lead),before);
 }finally{f.close()}
});

test('Sarvam campaign requires explicit engine disclosure, consent and verified matching pilot',async()=>{
 const f=fixture();try{
  await setup(f);const env=f.env;
  delete env.syntheticSpeech;delete env.AR3D_CAMPAIGN_SARVAM_DISCLOSURE;env.SARVAM_API_KEY='synthetic-key';
  assert.equal(await approvedCampaignPhone(env),null);
  env.AR3D_CAMPAIGN_SARVAM_DISCLOSURE='approved';
  f.c.db.prepare("UPDATE scripted_phone_pilots SET survey_json='{}' WHERE job_id IS NULL").run();
  assert.equal(await approvedCampaignPhone(env),null);
  f.c.db.prepare("UPDATE scripted_phone_pilots SET survey_json=? WHERE job_id IS NULL").run(JSON.stringify({phoneMeta:{engine:'sarvam'}}));
  const config=await approvedCampaignPhone(env);assert.equal(config.engine,'sarvam');
  let hook,requests=0;
  const start=await tickScriptedTenant(env,f.r.wrap,tid,config,{now,apiFetch:async(_url,opts)=>{hook=JSON.parse(opts.body).answer_url.replace(/\/answer$/,'');return accepted()}});
  assert.equal(start.state,'submitted');
  const callback=(step,params)=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params},env.PLIVO_AUTH_TOKEN),env,{now,fetcher:async(url,opts)=>{
   if(url==='https://api.sarvam.ai/speech-to-text'){requests++;assert.equal(opts.body.get('model'),'saaras:v4');return Response.json({transcript:'घर'});}
   assert.match(url,/plivo\.com/);return new Response('RIFF',{headers:{'Content-Type':'audio/wav'}});
  }});
  assert.match(await (await callback('answer',{ALegRequestUUID:'synthetic-plivo-request-123',To:internalNumber,From:config.caller,Direction:'outbound'})).text(),/GetDigits/);
  await callback('turn/0',{RecordingID:'record-id-00'});assert.equal(requests,0);
  assert.match(await (await callback('consent',{Digits:'1'})).text(),/Record/);
  await callback('turn/0',{RecordingID:'record-id-00',RecordingDurationMs:'2000'});assert.equal(requests,1);
  const row=f.c.db.prepare('SELECT survey_json FROM scripted_phone_pilots WHERE job_id IS NOT NULL').get();
  const survey=JSON.parse(row.survey_json);assert.equal(survey.answers.propertyType,'house');assert.equal(survey.phoneMeta.engine,'sarvam');assert.equal(survey.phoneMeta.llmRequests,0);
 }finally{f.close()}
});

test('signed Sarvam campaign STT 402 blocks subsequent commercial calls and preserves current hold',async()=>{
 const f=fixture();try{
 await setup(f);const env=f.env;
 delete env.syntheticSpeech;env.SARVAM_API_KEY='synthetic-key';env.AR3D_CAMPAIGN_SARVAM_DISCLOSURE='approved';
 f.c.db.prepare("UPDATE scripted_phone_pilots SET survey_json=? WHERE job_id IS NULL").run(JSON.stringify({phoneMeta:{engine:'sarvam'}}));
 const config=await approvedCampaignPhone(env);assert.equal(config.engine,'sarvam');
 let hook,requests=0;
 const start=await tickScriptedTenant(env,f.r.wrap,tid,config,{now,apiFetch:async(_url,opts)=>{hook=JSON.parse(opts.body).answer_url.replace(/\/answer$/,'');return accepted()}});
 assert.equal(start.state,'submitted');
 const callback=(step,params)=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params},env.PLIVO_AUTH_TOKEN),env,{now,fetcher:async(url)=>{
  if(url==='https://api.sarvam.ai/speech-to-text'){requests++;return Response.json({error:{code:'insufficient_quota_error'}},{status:402});}
  assert.match(url,/plivo\.com/);return new Response('RIFF',{headers:{'Content-Type':'audio/wav'}});
 }});
 await callback('answer',{ALegRequestUUID:'synthetic-plivo-request-123',To:internalNumber,From:config.caller,Direction:'outbound'});
 await callback('consent',{Digits:'1'});
 await callback('turn/0',{RecordingID:'record-id-00',RecordingDurationMs:'2000'});
 assert.equal(requests,1);
 assert.equal(f.c.db.prepare('SELECT phase FROM scripted_phone_pilots WHERE job_id IS NOT NULL').get().phase,'needs_review');
 assert.equal(f.c.db.prepare("SELECT code FROM provider_safety_events WHERE provider='sarvam'").get().code,'http_402');
 assert.equal(f.c.db.prepare('SELECT state FROM tenant_minute_holds').get().state,'held');
 }finally{f.close()}
});

test('legacy signed callbacks reject ambiguous parameters and mismatched unbound hangup',async()=>{
 const f=fixture();try{
  await setup(f);const config=await approvedCampaignPhone(f.env);let hook;
  await tickScriptedTenant(f.env,f.r.wrap,tid,config,{now,apiFetch:async(_url,opts)=>{hook=JSON.parse(opts.body).answer_url.replace(/\/answer$/,'');return accepted()}});
  const cb=(step,params={},time=now)=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params},f.env.PLIVO_AUTH_TOKEN),f.env,{now:time});
  const details={ALegRequestUUID:'synthetic-plivo-request-123',To:internalNumber,From:config.caller,Direction:'outbound'};
  assert.equal((await cb('answer',{...details,extra:'a&b=c'})).status,403);
  assert.equal((await cb('answer',{...details,RequestUUID:'different-request'})).status,403);
  await cb('hangup',{...details,ALegRequestUUID:'different-request',Duration:'5'});
  assert.equal(f.c.db.prepare('SELECT hangup_at FROM scripted_phone_pilots WHERE job_id IS NOT NULL').get().hangup_at,null);
  assert.match(await (await cb('answer',{...details,'SIP-H-To':'sip:fictional@example.invalid;tag=opaque','X-PH-Test':'Sample'})).text(),/GetDigits/);
  const expiry=f.c.db.prepare('SELECT expires_at FROM scripted_phone_pilots WHERE job_id IS NOT NULL').get().expires_at;
  assert.equal((await cb('hangup',{Duration:'20'},expiry+1)).status,204);
  assert.ok(f.c.db.prepare('SELECT hangup_at FROM scripted_phone_pilots WHERE job_id IS NOT NULL').get().hangup_at);
 }finally{f.close()}
});
test('legacy recording claims prevent cross-turn replay and stop processing after disablement',async()=>{
 const f=fixture();try{
  await setup(f);let hook,media=0,stt=0;
  const config=await approvedCampaignPhone(f.env);
  await tickScriptedTenant(f.env,f.r.wrap,tid,config,{now,apiFetch:async(_url,opts)=>{hook=JSON.parse(opts.body).answer_url.replace(/\/answer$/,'');return accepted()}});
  f.env.syntheticSpeech={async run(){stt++;return {text:'प्लॉट'}}};
  const cb=(step,params={})=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params},f.env.PLIVO_AUTH_TOKEN),f.env,{now,fetcher:async()=>{media++;return new Response('RIFF',{headers:{'Content-Type':'audio/wav'}})}});
  await cb('answer',{ALegRequestUUID:'synthetic-plivo-request-123',To:internalNumber,From:config.caller,Direction:'outbound'});
  await cb('consent',{Digits:'1'});
  assert.match(await (await cb('turn/0',{RecordingID:'replayed-record-1'})).text(),/Record/);
  assert.equal(stt,1);assert.equal(media,1);
  assert.doesNotMatch(await (await cb('turn/1',{RecordingID:'replayed-record-1'})).text(),/<Record/);
  assert.equal(stt,1);assert.equal(media,1);
  const saved=f.c.db.prepare('SELECT survey_json,turn FROM scripted_phone_pilots WHERE job_id IS NOT NULL').get();
  assert.equal(saved.turn,1);assert.equal(JSON.parse(saved.survey_json).phoneMeta.claimedRecordingDigests.length,1);
  assert.ok(!saved.survey_json.includes('replayed-record-1'));
  f.env.AR3D_SCRIPTED_CAMPAIGNS_ENABLED='disabled';
  assert.doesNotMatch(await (await cb('turn/1',{RecordingID:'different-record-2'})).text(),/<Record/);
  assert.equal(stt,1);assert.equal(media,1);
  assert.equal((await cb('hangup',{Duration:'20'})).status,204);
 }finally{f.close()}
});
test('legacy keypad opt-out survives hangup, suspension and campaign disablement',async()=>{
 const f=fixture();try{
  await setup(f);let hook;const config=await approvedCampaignPhone(f.env);
  await tickScriptedTenant(f.env,f.r.wrap,tid,config,{now,apiFetch:async(_url,opts)=>{hook=JSON.parse(opts.body).answer_url.replace(/\/answer$/,'');return accepted()}});
  const cb=(step,params={})=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params},f.env.PLIVO_AUTH_TOKEN),f.env,{now});
  await cb('answer',{ALegRequestUUID:'synthetic-plivo-request-123',To:internalNumber,From:config.caller,Direction:'outbound'});
  await cb('hangup',{Duration:'10'});
  f.c.db.prepare("UPDATE tenants SET status='suspended',suspended_from_status='active' WHERE id=?").run(tid);
  f.env.AR3D_SCRIPTED_CAMPAIGNS_ENABLED='disabled';
  await cb('consent',{Digits:'2'});await cb('consent',{Digits:'2'});
  assert.equal(f.c.db.prepare('SELECT phase FROM scripted_phone_pilots WHERE job_id IS NOT NULL').get().phase,'declined');
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM lead_opt_out_events').get().n,1);
  assert.deepEqual(Object.values(f.r.db.prepare('SELECT consent_status,dnd_status FROM leads WHERE id=?').get(lead)),['denied','blocked']);
 }finally{f.close()}
});

test('legacy pending suppression preserves signed hangup before completing STOP',async()=>{
 const f=fixture();try{
  await setup(f);let hook;const config=await approvedCampaignPhone(f.env);
  await tickScriptedTenant(f.env,f.r.wrap,tid,config,{now,apiFetch:async(_url,opts)=>{hook=JSON.parse(opts.body).answer_url.replace(/\/answer$/,'');return accepted()}});
  const cb=(step,params={})=>handleScriptedPhoneCallback(signed(hook+'/'+step,{CallUUID:callId,...params},f.env.PLIVO_AUTH_TOKEN),f.env,{now});
  await cb('answer',{ALegRequestUUID:'synthetic-plivo-request-123',To:internalNumber,From:config.caller,Direction:'outbound'});
  f.c.db.prepare("UPDATE scripted_phone_pilots SET phase='suppressing' WHERE job_id IS NOT NULL").run();
  assert.equal((await cb('hangup',{Duration:'10'})).status,204);
  const row=f.c.db.prepare('SELECT phase,hangup_at,duration_seconds FROM scripted_phone_pilots WHERE job_id IS NOT NULL').get();
  assert.equal(row.phase,'declined');assert.equal(row.hangup_at,now);assert.equal(row.duration_seconds,10);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM lead_opt_out_events').get().n,1);
 }finally{f.close()}
});
