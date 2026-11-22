import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {fixture,tid,lead,admin,now,setup,accepted} from './helpers/calling-fixture.mjs';
import {approvedCampaignPhone,handleScriptedPhoneAdmin,handleScriptedPhoneCallback} from '../src/scripted-phone-pilot.mjs';
import {tickScriptedTenant} from '../src/scripted-campaign-dispatch.mjs';
import worker from '../src/index.mjs';
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
  assert.match(await (await callback('answer',details)).text(),/GetDigits.*opening\.mp3/);
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
 for(const path of ['/v1/provider/exotel','/v1/provider/exotel/voicebot','/v1/provider/exotel/session']){
  const response=await worker.fetch(new Request(origin+path,{method:'POST',body:'{}'}),{});
  assert.equal(response.status,410);
  assert.deepEqual(await response.json(),{error:'provider_route_retired'});
 }
});
