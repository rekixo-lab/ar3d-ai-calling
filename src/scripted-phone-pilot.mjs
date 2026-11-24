// Shared phone questionnaire with a separately approved internal pilot and customer campaigns.
import {resolveCrmDb,parseJsonBody} from './core.mjs';
import {mutationOriginAllowed} from './human-auth.mjs';
import {beginFixedVoicePreview,advanceFixedVoicePreview,advanceContextualVoice,advanceInternalVoice} from './fixed-voice-turns.mjs';
import {normalizePropertySurvey,surveyToCrm} from './fixed-property-survey.mjs';
import {streamToken,validStreamToken,openNovaSocket,upgradePlivoTurn} from './streaming-speech.mjs';
import {ANSWER_MAX_BYTES,answerContentType,readBoundedBytes,supportsAnswerAudio,transcribeScriptedAnswer,transcribeNovaRecordedAnswer,speechFailureCode} from './scripted-speech.mjs';

const ADMIN='/v1/human/scripted-phone-pilot',HOOK='/v1/provider/plivo/scripted-pilot';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ID=/^[a-zA-Z0-9-]{8,80}$/;
const MOBILE=/^\+91[6-9]\d{9}$/;
const FIELDS=['propertyType','location','area','size','budgetInr','interest','visitDate'];
const PROMPTS=['opening','closing','review','size-plot','size-home',...FIELDS.filter(key=>key!=='size')];
// Optional spoken apology before a retry. Never block ordinary scripts when absent.
const AUDIO_PROMPTS=new Set([...PROMPTS,'repeat']);
const terminal=new Set(['completed','declined','needs_review','ended','rejected']);
const duration=180;
const ttl=10*60000;
const pilotCooldownMs=60000;
const encoder=new TextEncoder();
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(result,status=200)=>Response.json(result,{status,headers});
const error=(reason,status)=>json({error:reason},status);
const xml=body=>new Response('<Response>'+body+'</Response>',{headers:{...headers,'Content-Type':'application/xml;charset=utf-8'}});
const end=()=>xml('<Hangup/>');
const promptKey=(language,prompt,tenant)=> (tenant?'scripted-phone-campaigns/'+tenant:'scripted-phone-pilot')+'/'+language+'/'+prompt+'.mp3';
export const SCRIPTED_CALLING_POLICY='ar3d-fixed-plivo-v1';
export async function scriptedPromptsReady(env,language,tenant){
 const files=await Promise.all(PROMPTS.map(name=>env.RECORDINGS.head(promptKey(language,name,tenant))));
 return files.every(file=>file&&file.size>0&&file.size<=ANSWER_MAX_BYTES);
}

// Metadata-only, bounded audio audit for the current-MFA Super Admin readiness
// page. Never opens audio bytes, changes R2, queries Plivo or authorizes dialing.
export async function inspectScriptedPromptPack(env,language='hi'){
 if(!['hi','en'].includes(language))throw Error('invalid audio pack language');
 const names=[...PROMPTS,'repeat'],bucket=env?.RECORDINGS;
 if(typeof bucket?.head!=='function')
  return Object.freeze({language,scope:'internal_pilot',requiredTotal:PROMPTS.length,
   requiredReady:0,missing:[],invalid:[],unavailable:[...PROMPTS],
   optionalRepeat:'unavailable',ready:false});
 const checked=await Promise.allSettled(names.map(name=>
  bucket.head(promptKey(language,name,null))));
 const state=result=>{
  if(result.status!=='fulfilled')return 'unavailable';
  if(!result.value)return 'missing';
  const size=result.value.size;
  return Number.isSafeInteger(size)&&size>0&&size<=ANSWER_MAX_BYTES?'present':'invalid';
 };
 const required=checked.slice(0,PROMPTS.length),missing=[],invalid=[],unavailable=[];
 required.forEach((result,i)=>{
  const status=state(result);
  if(status==='missing')missing.push(PROMPTS[i]+'.mp3');
  else if(status==='invalid')invalid.push(PROMPTS[i]+'.mp3');
  else if(status==='unavailable')unavailable.push(PROMPTS[i]+'.mp3');
 });
 const requiredReady=PROMPTS.length-missing.length-invalid.length-unavailable.length;
 return Object.freeze({language,scope:'internal_pilot',requiredTotal:PROMPTS.length,
  requiredReady,missing,invalid,unavailable,
  optionalRepeat:state(checked[PROMPTS.length]),ready:requiredReady===PROMPTS.length});
}

const iso=now=>new Date(now).toISOString();
const normalizePhone=value=>String(value||'').replace(/^\+/,'');
const escapeXml=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]);

function phoneConfiguration(env){
 const authId=env.PLIVO_AUTH_ID,token=env.PLIVO_AUTH_TOKEN;
 const caller=env.AR3D_PLIVO_CALLER_NUMBER,origin=env.AR3D_SCRIPTED_PILOT_ORIGIN;
 if(env.AR3D_PLIVO_RECORDING_AUTH!=='confirmed'||
    !/^[A-Za-z0-9]{8,64}$/.test(authId||'')||!/^[A-Za-z0-9]{16,128}$/.test(token||'')||
    !/^\+91[1-9]\d{9}$/.test(caller||'')||
    !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(origin||'')||
    !env.AI?.run||!env.RECORDINGS?.get||!env.RECORDINGS?.head)return null;
 return {authId,token,caller,origin,authorization:'Basic '+btoa(authId+':'+token)};
}

function configuration(env){
 const phone=phoneConfiguration(env),destination=env.AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER;
 const tenant=env.AR3D_SCRIPTED_PILOT_TENANT_ID,lead=env.AR3D_SCRIPTED_PILOT_LEAD_ID;
 if(!phone||env.AR3D_SCRIPTED_PILOT_ENABLED!=='enabled'||!MOBILE.test(destination||'')||
    !UUID.test(tenant||'')||!UUID.test(lead||''))return null;
 return {...phone,destination,tenant,lead};
}

export async function approvedCampaignPhone(env){
 if(env.AR3D_SCRIPTED_CAMPAIGNS_ENABLED!=='enabled')return null;
 const config=configuration(env);
 if(!config)return null;
 const verified=await env.CONTROL_DB.prepare(`SELECT id FROM scripted_phone_pilots
   WHERE job_id IS NULL AND phase='completed' AND hangup_at IS NOT NULL AND provider_account_id=?
   AND caller=? AND destination=? AND tenant_id=? AND lead_id=?
   AND CASE WHEN json_valid(survey_json) THEN COALESCE(json_extract(survey_json,'$.phoneMeta.engine'),'whisper')='whisper' ELSE 0 END LIMIT 1`)
  .bind(config.authId,config.caller,config.destination,config.tenant,config.lead).first();
 return verified?phoneConfiguration(env):null;
}

async function currentMfa(db,user,now){
 return db.prepare(`SELECT m.enabled_at FROM human_mfa_settings m JOIN human_sessions s ON s.user_id=m.user_id
  WHERE m.user_id=? AND s.token_hash=? AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at
  AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1`).bind(user.id,user.token_hash,now).first();
}

async function pilotCrm(env,tenantId){
 const tenant=await env.CONTROL_DB.prepare("SELECT id,storage_mode,dedicated_binding FROM tenants WHERE id=? AND status IN('trial','active')")
  .bind(tenantId).first();
 return tenant?resolveCrmDb(env,tenant):null;
}

// Reuse the dispatch eligibility predicate for the no-dial readiness check.
async function eligiblePilotLead(crm,config){
 return crm.prepare(`SELECT updated_at FROM leads WHERE tenant_id=? AND id=? AND mobile_e164=?
  AND consent_status!='denied' AND dnd_status!='blocked'
  AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=leads.tenant_id AND o.lead_id=leads.id)`)
  .bind(config.tenant,config.lead,config.destination).first();
}

// No identifiers, records, or phone numbers are returned. No switch needed.
export async function inspectInternalPilotLead(env){
 const config={tenant:env.AR3D_SCRIPTED_PILOT_TENANT_ID,
  lead:env.AR3D_SCRIPTED_PILOT_LEAD_ID,destination:env.AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER};
 if(!UUID.test(config.tenant||'')||!UUID.test(config.lead||'')||!MOBILE.test(config.destination||''))
  return {state:'configuration_missing',ready:false};
 try{
  const crm=await pilotCrm(env,config.tenant);
  if(!crm)return {state:'tenant_unavailable',ready:false};
  const lead=await eligiblePilotLead(crm,config);
  return lead?{state:'matched',ready:true}:{state:'lead_unavailable',ready:false};
 }catch{return {state:'check_unavailable',ready:false}}
}

function callback(config,id,step){return config.origin+HOOK+'/'+id+'/'+step}
const play=url=>'<Play>'+escapeXml(url)+'</Play>';
const directConfirm='CALL_ONE_PRECONSENTED_INTERNAL_NUMBER';
const legacyConfirm='CALL_ONE_VERIFIED_INTERNAL_NUMBER';
const streamingEngine='deepgram_stream';
function isStreaming(row){return internalDirect(row)&&JSON.parse(row.survey_json).phoneMeta?.engine===streamingEngine}
function internalDirect(row){return !row.job_id&&JSON.parse(row.survey_json).phoneMeta?.mode==='direct_preconsented'}
const speak=(language,text)=>'<Speak voice="'+(language==='hi'?'Polly.Aditi':'WOMAN')+'" language="'+(language==='hi'?'hi-IN':'en-US')+'">'+escapeXml(text)+'</Speak>';
function directOpening(row){
 // Only the explicitly pre-informed internal streaming test uses the short greeting.
 if(isStreaming(row))return speak(row.language,row.language==='hi'?'नमस्कार, मैं ए आर थ्री डी की ए आई असिस्टेंट हूँ।':'Hello, I am the AR3D AI assistant.');
 return speak(row.language,row.language==='hi'?'नमस्कार, मैं ए आर थ्री डी की ए आई असिस्टेंट हूँ। यह बातचीत रिकॉर्ड होती है।':'Hello, I am the AR3D AI assistant. This conversation is recorded.');
}

function responseFor(config,row,{repeatCue=false,directOpeningCue=false,liveToken=null}={}){
 const audio=name=>play(callback(config,row.id,'audio/'+name+'.mp3'));
 if(row.phase==='consent'){
  const action=escapeXml(callback(config,row.id,'consent'));
  // Internal acceptance: allow time to hear the complete recorded notice and
  // use the keypad. A missing/invalid digit still never authorizes recording.
  // Keep the existing independently approved customer campaign behavior.
  const wait=row.job_id?'7':'25',retries=row.job_id?'1':'2';
  return xml('<GetDigits action="'+action+'" method="GET" numDigits="1" retries="'+retries+'" timeout="'+wait+'">'+audio('opening')+'</GetDigits><Hangup/>');
 }
 if(row.phase==='question'){
  const state=JSON.parse(row.survey_json),field=FIELDS[state.index];
  const prompt=field==='size'?(state.answers.propertyType==='plot'?'size-plot':'size-home'):field;
  if(!PROMPTS.includes(prompt))return end();
  // A distinct URL per attempt makes a retried callback safe to recognize.
  const retry=state.attempts>0?(repeatCue?audio('repeat'):speak(row.language,row.language==='hi'?'माफ कीजिए, कृपया दोबारा बताइए।':'Sorry, please say that again.')):'';
  const pending=internalDirect(row)&&state.phoneMeta?.pendingQuantity;
  const clarification=pending&&pending.turn===state.turns&&pending.field===field?
   speak(row.language,field==='size'?(row.language==='hi'?'कृपया बताइए, यह वर्ग फुट है या वर्ग गज?':'Is that in square feet or square yards?'):(row.language==='hi'?'कृपया बताइए, हजार, लाख या करोड़?':'Is that thousands, lakhs or crores?')):null;
  const prefix=(directOpeningCue?directOpening(row):'')+(clarification||retry+audio(prompt));
  if(liveToken){
   const ws=callback(config,row.id,'stream/'+row.turn+'/'+liveToken).replace(/^https:/,'wss:');
   return xml(prefix+'<Stream audioTrack="inbound" keepCallAlive="true" bidirectional="false" contentType="audio/x-mulaw;rate=8000" streamTimeout="30">'+escapeXml(ws)+'</Stream><Redirect method="GET">'+escapeXml(callback(config,row.id,'stream-next/'+row.turn))+'</Redirect>');
  }
  return xml(prefix+'<Record action="'+escapeXml(callback(config,row.id,'turn/'+row.turn))+
   '" method="GET" fileFormat="mp3" maxLength="16" timeout="6" finishOnKey="#" playBeep="true"/><Hangup/>');
 }
 if(row.phase==='needs_review'&&isStreaming(row)&&JSON.parse(row.survey_json).phoneMeta?.technicalFailure===true)
  return xml(speak(row.language,row.language==='hi'?'माफ कीजिए, अभी हमारी तकनीकी सेवा में समस्या है। हम बाद में संपर्क करेंगे।':'Sorry, our speech service is currently unavailable. We will follow up later.')+'<Hangup/>');
 if(row.phase==='completed'||row.phase==='needs_review')
  return xml(audio(row.phase==='completed'?'closing':'review')+'<Hangup/>');
 return end();
}

// Look up a reviewed optional cue only on an actual retry. A missing object,
// out-of-range object or R2 metadata failure must not break the phone survey.
async function responseForPhoneQuestion(config,env,row,{directOpeningCue=false}={}){
 let repeatCue=false;
 if(row.phase==='question'){
  const state=JSON.parse(row.survey_json);
  if(state.attempts>0){
   try{
    const key=promptKey(row.language,'repeat',row.job_id?row.tenant_id:null);
    const cue=await env.RECORDINGS.head(key);
    repeatCue=!!cue&&cue.size>0&&cue.size<=ANSWER_MAX_BYTES;
   }catch{repeatCue=false}
  }
 }
 const liveToken=row.phase==='question'&&isStreaming(row)?await streamToken(config.token,row):null;
 return responseFor(config,row,{repeatCue,directOpeningCue,liveToken});
}

// All internal attempts share one gate, including after a configuration change.
 // An expired reservation or an apparently terminal questionnaire does NOT prove
 // that the provider call ended. Only a signed hangup or explicit API rejection does.
const pilotUnconfirmed="hangup_at IS NULL AND phase!='rejected'";
const pilotLastEnd="COALESCE(hangup_at,expires_at-"+ttl+")";
async function pilotAvailability(control,now){
 const row=await control.prepare(`SELECT
  COALESCE(MAX(CASE WHEN ${pilotUnconfirmed} THEN 1 ELSE 0 END),0) AS unconfirmed,
  MAX(${pilotLastEnd}) AS last_end
  FROM scripted_phone_pilots WHERE job_id IS NULL`).first();
 if(row?.unconfirmed===1)return {ready:false,reason:'awaiting_signed_hangup',retryAfterSeconds:null};
 const wait=Math.max(0,Math.ceil(((row?.last_end??(now-pilotCooldownMs))+pilotCooldownMs-now)/1000));
 return {ready:wait===0,reason:wait?'cooldown':'ready',retryAfterSeconds:wait};
}
// Enrollment is an append-only CRM audit event bound to BOTH lead and mobile.
// No general customer editing or import can create the enrollment marker.
const deviceAction='lead.internal_test_device_enrolled',deviceName='AR3D Internal Device Test';
async function deviceBinding(lead,mobile){
 const bytes=await crypto.subtle.digest('SHA-256',encoder.encode('ar3d-internal-device-v1:'+lead+':'+mobile));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
async function deviceCrm(env,config){
 const tenant=await env.CONTROL_DB.prepare(`SELECT id,storage_mode,dedicated_binding FROM tenants
  WHERE id=? AND display_name='AR3D Internal' AND status IN('trial','active')`).bind(config.tenant).first();
 return tenant?resolveCrmDb(env,tenant):null;
}
async function enrolledDevices(env,config){
 const db=await deviceCrm(env,config);
 if(!db)return [];
 const rows=await db.prepare(`SELECT l.id,l.mobile_e164,a.id AS binding FROM leads l
  JOIN crm_audit_events a ON a.tenant_id=l.tenant_id AND a.target_id=l.id AND a.action=?
  WHERE l.tenant_id=? AND l.name=? AND l.source_type='other'
  ORDER BY a.created_at,a.id LIMIT 4`).bind(deviceAction,config.tenant,deviceName).all();
 const out=[];
 for(const row of rows.results){
  if(!UUID.test(row.id)||!MOBILE.test(row.mobile_e164)||row.id===config.lead||row.mobile_e164===config.destination||
   row.binding!==await deviceBinding(row.id,row.mobile_e164))continue;
  const target={...config,lead:row.id,destination:row.mobile_e164};
  if(await eligiblePilotLead(db,target))out.push(target);
 }
 return out;
}
async function selectDevice(env,config,leadId){
 if(!leadId||leadId===config.lead)return config;
 return (await enrolledDevices(env,config)).find(x=>x.lead===leadId)||null;
}
async function enrollDevice(req,env,user,config,now){
 if(req.method!=='POST')return error('method_not_allowed',405);
 const url=new URL(req.url);
 if(!config||url.search||!mutationOriginAllowed(req)||url.origin!==config.origin)return error('pilot_origin_or_configuration_invalid',403);
 if(env.AR3D_SCRIPTED_CAMPAIGNS_ENABLED==='enabled')return error('disable_campaigns_before_enrolling_test_devices',409);
 let data;
 try{data=parseJsonBody(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBytes(req,1024)),1024)}
 catch{return error('invalid_device_request',400)}
 if(Object.keys(data).sort().join(',')!=='confirm,mobile'||data.confirm!=='VERIFIED_CONSENTED_INTERNAL_DEVICE_NO_CALL'||
  typeof data.mobile!=='string'||!MOBILE.test(data.mobile))return error('valid_indian_mobile_and_explicit_internal_consent_required',400);
 if(data.mobile===config.destination)return error('number_already_registered',409);
 const db=await deviceCrm(env,config);
 if(!db)return error('internal_tenant_unavailable',409);
 const id=crypto.randomUUID(),at=iso(now),binding=await deviceBinding(id,data.mobile);
 // D1 batch serializes cap check, insert and binding. Count all enrolled
 // devices, even if a lead was subsequently deleted or made ineligible.
 const steps=await db.batch([
  db.prepare(`INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,consent_status,dnd_status,created_at,updated_at)
   SELECT ?,?,?,?,'other','unknown','unknown',?,?
   WHERE (SELECT COUNT(*) FROM crm_audit_events WHERE tenant_id=? AND action=?)<4
   ON CONFLICT(tenant_id,mobile_e164) DO NOTHING`).bind(config.tenant,id,deviceName,data.mobile,at,at,config.tenant,deviceAction),
  db.prepare(`INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)
   SELECT tenant_id,?,'human:'||?, ?,id,? FROM leads WHERE tenant_id=? AND id=? AND changes()=1`)
   .bind(binding,user.id,deviceAction,at,config.tenant,id)
 ]);
 if(steps[0].meta.changes!==1)return error('number_exists_or_five_device_limit_reached',409);
 if(steps[1].meta.changes!==1)throw Error('device_enrollment_audit_unconfirmed');
 return json({leadId:id,destinationLast4:data.mobile.slice(-4),created:true,callPlaced:false},201);
}
async function startPilot(req,env,user,config,now,fetcher){
 if(!config)return error('scripted_phone_pilot_not_configured',503);
 if(!mutationOriginAllowed(req)||new URL(req.url).origin!==config.origin)return error('pilot_origin_mismatch',403);
 let data;
 try{data=parseJsonBody(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBytes(req,1024)),1024)}
 catch{return error('invalid_pilot_request',400)}
 if(!['confirm,language','confirm,language,leadId','confirm,engine,language','confirm,engine,language,leadId'].includes(Object.keys(data).sort().join(','))||
    ![legacyConfirm,directConfirm].includes(data.confirm)||!['hi','en'].includes(data.language)||
    (Object.hasOwn(data,'engine')&&(!['whisper',streamingEngine].includes(data.engine)||data.confirm!==directConfirm))||
    (Object.hasOwn(data,'leadId')&&(typeof data.leadId!=='string'||!UUID.test(data.leadId))))return error('explicit_pilot_confirmation_required',400);
 config=await selectDevice(env,config,data.leadId);
 if(!config)return error('internal_test_device_not_enrolled_or_blocked',403);
 const control=env.CONTROL_DB,crm=await pilotCrm(env,config.tenant);
 if(!crm)return error('pilot_client_unavailable',409);
 const lead=await eligiblePilotLead(crm,config);
 if(!lead)return error('verified_internal_lead_unavailable',409);
 if(!await scriptedPromptsReady(env,data.language))
  return error('pilot_prompt_recordings_incomplete',409);
 const id=crypto.randomUUID(),slot=Math.floor(now/pilotCooldownMs),survey=beginFixedVoicePreview({language:data.language,now}).state;
 // Separate explicit attestation; old callers continue to require keypad consent.
 // This is limited to enrolled internal devices and never used for a campaign.
 if(data.confirm===directConfirm)survey.phoneMeta={mode:'direct_preconsented',engine:data.engine||'whisper'};
 const reservation=await control.prepare(`INSERT INTO scripted_phone_pilots
  (id,tenant_id,lead_id,lead_updated_at,actor_id,language,destination,caller,rate_slot,expires_at,phase,survey_json,created_at,provider_account_id)
  SELECT ?,?,?,?,?,?,?,?,?,?,'requested',?,?,? WHERE NOT EXISTS(
   SELECT 1 FROM scripted_phone_pilots WHERE job_id IS NULL
    AND ((${pilotUnconfirmed}) OR ${pilotLastEnd}>?))
  ON CONFLICT(rate_slot) DO NOTHING`).bind(id,config.tenant,config.lead,lead.updated_at,user.id,
  data.language,config.destination,config.caller,slot,now+ttl,JSON.stringify(survey),iso(now),config.authId,now-pilotCooldownMs).run();
 if(reservation.meta.changes!==1){
  const availability=await pilotAvailability(control,now);
  return json({error:availability.reason==='awaiting_signed_hangup'?
   'Previous internal call has not received a signed hangup. Check Plivo before retrying.':
   'Internal test cooldown is active. Refresh status before retrying.',availability},409);
 }
 const outcome=await submitScriptedPhone(control,config,id,config.destination,duration,fetcher);
 if(outcome==='rejected')return error('plivo_rejected_pilot',502);
 if(outcome==='unknown')return error('pilot_outcome_unconfirmed_check_status',502);
 return json({id,state:'submitted'},202);
}

export async function reserveCampaignQuestionnaire(control,config,job,now){
 const id=crypto.randomUUID(),survey=beginFixedVoicePreview({language:job.language,now}).state;
 const inserted=await control.prepare(`INSERT INTO scripted_phone_pilots
   (id,tenant_id,lead_id,lead_updated_at,actor_id,language,destination,caller,expires_at,phase,survey_json,
    created_at,provider_account_id,job_id)
   VALUES (?,?,?,?,?,?,?,?,?,'requested',?,?,?,?) ON CONFLICT(tenant_id,job_id) DO NOTHING`)
  .bind(id,job.tenant_id,job.lead_id,job.lead_updated_at,job.created_by,job.language,job.destination,config.caller,
   now+ttl,JSON.stringify(survey),iso(now),config.authId,job.id).run();
 if(inserted.meta.changes!==1)throw Error('scripted_session_already_exists');
 return id;
}

export async function submitScriptedPhone(control,config,id,destination,maxSeconds,fetcher){
 // ring_timeout stops unanswered ringing; hangup_on_ring schedules a hangup
 // from the start of ringing even if the recipient has answered (6000).
 try{
  const response=await fetcher('https://api.plivo.com/v1/Account/'+config.authId+'/Call/',{
   method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),
   headers:{Authorization:config.authorization,'Content-Type':'application/json'},body:JSON.stringify({
    from:config.caller,to:destination,answer_url:callback(config,id,'answer'),answer_method:'GET',
    hangup_url:callback(config,id,'hangup'),hangup_method:'GET',time_limit:maxSeconds,ring_timeout:25
   })
  });
  if([400,401,403,404,422,429].includes(response.status)){
   await control.prepare("UPDATE scripted_phone_pilots SET phase='rejected' WHERE id=? AND phase='requested'").bind(id).run();
   return 'rejected';
  }
  if(!response.ok)throw Error('provider_outcome_unknown');
  const saved=JSON.parse(new TextDecoder().decode(await readBoundedBytes(response,8192)));
  if(!ID.test(saved?.request_uuid||''))throw Error('provider_outcome_unknown');
  const updated=await control.prepare(`UPDATE scripted_phone_pilots SET provider_request_id=?
   WHERE id=? AND (provider_request_id IS NULL OR provider_request_id=?)`).bind(saved.request_uuid,id,saved.request_uuid).run();
  if(updated.meta.changes!==1)throw Error('provider_outcome_unknown');
  return 'submitted';
 }catch{
  // No automatic redial, including when Plivo accepted the request but the HTTP response was lost.
  await control.prepare("UPDATE scripted_phone_pilots SET phase='unknown' WHERE id=? AND phase='requested'").bind(id).run();
  return 'unknown';
 }
}

// Explicit operator action only, never called by deploy, scheduler or GET.
async function prepareInternalTestLead(req,env,user,now){
 if(req.method!=='POST')return error('method_not_allowed',405);
 const url=new URL(req.url);
 if(url.search||!mutationOriginAllowed(req)||url.origin!==env.AR3D_SCRIPTED_PILOT_ORIGIN)
  return error('pilot_origin_mismatch',403);
 if(env.AR3D_SCRIPTED_PILOT_ENABLED==='enabled'||env.AR3D_SCRIPTED_CAMPAIGNS_ENABLED==='enabled')
  return error('disable_calling_before_preparing_internal_lead',409);
 let data;
 try{data=parseJsonBody(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBytes(req,1024)),1024)}
 catch{return error('invalid_pilot_request',400)}
 if(Object.keys(data).join(',')!=='confirm'||data.confirm!=='PREPARE_INTERNAL_TEST_LEAD_NO_CALL')
  return error('explicit_internal_lead_confirmation_required',400);
 const tenantId=env.AR3D_SCRIPTED_PILOT_TENANT_ID,mobile=env.AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER;
 if(!UUID.test(tenantId||'')||!MOBILE.test(mobile||''))
  return error('internal_tenant_or_mobile_not_configured',409);
 // Restrict this privileged setup to the designated internal company.
 const tenant=await env.CONTROL_DB.prepare(`SELECT id,storage_mode,dedicated_binding FROM tenants
  WHERE id=? AND display_name='AR3D Internal' AND status IN('trial','active')`).bind(tenantId).first();
 if(!tenant)return error('internal_tenant_unavailable',409);
 const db=resolveCrmDb(env,tenant),id=crypto.randomUUID(),date=iso(now),name='AR3D Internal Test';
 // Atomic insert + audit, idempotent on tenant/mobile, no consent or DND changes.
 const result=await db.batch([
  db.prepare(`INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,consent_status,dnd_status,created_at,updated_at)
   VALUES(?,?,?,?,'other','unknown','unknown',?,?)
   ON CONFLICT(tenant_id,mobile_e164) DO NOTHING`).bind(tenantId,id,name,mobile,date,date),
  db.prepare(`INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)
   SELECT tenant_id,?,'human:'||?,'lead.created',id,? FROM leads
   WHERE tenant_id=? AND id=? AND changes()=1`).bind(crypto.randomUUID(),user.id,date,tenantId,id)
 ]);
 const created=result[0]?.meta?.changes===1;
 if(created&&result[1]?.meta?.changes!==1)throw Error('internal_lead_audit_unconfirmed');
 const row=await db.prepare('SELECT id,name,source_type FROM leads WHERE tenant_id=? AND mobile_e164=?')
  .bind(tenantId,mobile).first();
 if(!row||row.name!==name||row.source_type!=='other')
  return error('existing_non_test_customer_not_modified',409);
 if(!await eligiblePilotLead(db,{tenant:tenantId,lead:row.id,destination:mobile}))
  return error('internal_lead_locally_blocked',409);
 return json({leadId:row.id,created,destinationLast4:mobile.slice(-4)},created?201:200);
}

export async function handleScriptedPhoneAdmin(req,env,user,{now=Date.now(),fetcher=fetch}={}){
 const path=new URL(req.url).pathname;
 if(path!==ADMIN&&path!==ADMIN+'/prepare-lead'&&path!==ADMIN+'/devices'&&path!==ADMIN+'/media-diagnostics'&&path!==ADMIN+'/recording-probe')return null;
 if(user?.globalRole!=='super_admin'||!await currentMfa(env.CONTROL_DB,user,now))return error('current_super_admin_mfa_required',403);
 if(path===ADMIN+'/prepare-lead'){
  try{return await prepareInternalTestLead(req,env,user,now)}
  catch{return error('internal_lead_setup_unavailable',503)}
 }
 if(!['GET','POST'].includes(req.method))return error('method_not_allowed',405);
 const config=configuration(env);
 if(path===ADMIN+'/recording-probe'){
  if(req.method!=='POST'||!config||!mutationOriginAllowed(req)||new URL(req.url).origin!==config.origin||new URL(req.url).search)return error('invalid_recording_probe_request',400);
  try{
   const data=parseJsonBody(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBytes(req,512)),512);
   if(Object.keys(data).join(',')!=='confirm'||!['REPROCESS_ONE_CONSENTED_INTERNAL_RECORDING','SHOW_ONE_CONSENTED_INTERNAL_FIRST_ANSWER','SHOW_ONE_CONSENTED_INTERNAL_LAST_ANSWER','PLAY_ONE_CONSENTED_INTERNAL_LAST_ANSWER'].includes(data.confirm))return error('explicit_recording_probe_confirmation_required',400);
   const playback=data.confirm==='PLAY_ONE_CONSENTED_INTERNAL_LAST_ANSWER';
   const report=await probeInternalRecording(env,config,fetcher,{showFirstAnswer:data.confirm==='SHOW_ONE_CONSENTED_INTERNAL_FIRST_ANSWER',showLastAnswer:playback||data.confirm==='SHOW_ONE_CONSENTED_INTERNAL_LAST_ANSWER',playback,now});
   return report instanceof Response?report:json(report);
  }catch{return error('recording_probe_unavailable',503)}
 }
 if(path===ADMIN+'/media-diagnostics'){
  if(req.method!=='GET'||new URL(req.url).search)return error('invalid_diagnostic_request',400);
  if(!config)return error('pilot_configuration_missing',503);
  try{return json(await inspectLastMedia(env,config,fetcher))}catch{return error('media_diagnostic_unavailable',503)}
 }
 if(path===ADMIN+'/devices'){
  try{return await enrollDevice(req,env,user,config,now)}catch{return error('device_enrollment_unavailable',503)}
 }
 try{
  if(req.method==='POST')return await startPilot(req,env,user,config,now,fetcher);
  if(!config)return json({configured:false});
  const recent=await env.CONTROL_DB.prepare(`SELECT id,
    CASE WHEN phase='requested' AND provider_request_id IS NOT NULL THEN 'submitted' ELSE phase END AS phase,
    language,created_at,turn,duration_seconds,substr(destination,-4) AS destinationLast4,
    CASE WHEN json_valid(survey_json) THEN json_extract(survey_json,'$.index') END AS question_index,
    CASE WHEN json_valid(survey_json) THEN COALESCE(json_extract(survey_json,'$.phoneMeta.engine'),'whisper') END AS engine,
    CASE WHEN json_valid(survey_json) THEN json_extract(survey_json,'$.phoneMeta.lastAudioOutcome') END AS last_audio_outcome,
    CASE WHEN json_valid(survey_json) THEN json_extract(survey_json,'$.phoneMeta.audioMs') END AS audio_ms,
    CASE WHEN json_valid(survey_json) THEN json_extract(survey_json,'$.phoneMeta.sttConnected') END AS stt_connected,
    CASE WHEN json_valid(survey_json) THEN json_extract(survey_json,'$.phoneMeta.audioBytes') END AS audio_bytes,
    CASE WHEN json_valid(survey_json) THEN json_extract(survey_json,'$.phoneMeta.mediaHost') END AS media_host,
    CASE WHEN json_valid(survey_json) THEN json_extract(survey_json,'$.phoneMeta.interpreter') END AS interpreter,
    hangup_at IS NOT NULL AS signed_hangup,
    provider_call_id IS NOT NULL AS provider_call_reference FROM scripted_phone_pilots
    WHERE tenant_id=? AND job_id IS NULL ORDER BY created_at DESC LIMIT 5`).bind(config.tenant).all();
  const devices=[config,...await enrolledDevices(env,config)];
  return json({configured:true,destinationLast4:config.destination.slice(-4),recent:recent.results,
   devices:devices.map((x,i)=>({leadId:x.lead,destinationLast4:x.destination.slice(-4),primary:i===0})),
   enrollmentEnabled:env.AR3D_SCRIPTED_CAMPAIGNS_ENABLED!=='enabled'&&!!await deviceCrm(env,config),
   engines:['whisper',streamingEngine],availability:await pilotAvailability(env.CONTROL_DB,now)});
 }catch{return error('scripted_phone_pilot_unavailable',503)}
}

// Plivo's GET V3 SDK canonicalizes decoded query parameters in case-sensitive order.
async function verifiedPlivoGet(req,config,url){
 const nonce=req.headers.get('X-Plivo-Signature-V3-Nonce')||'';
 const signature=req.headers.get('X-Plivo-Signature-V3')||'';
 const pairs=[...url.searchParams];
 if(!/^[\x21-\x7e]{1,128}$/.test(nonce)||signature.length>512||pairs.length>45||
    new Set(pairs.map(([name])=>name)).size!==pairs.length)return false;
 pairs.sort(([a],[b])=>a<b?-1:a>b?1:0);
 const query=pairs.map(([name,value])=>name+'='+value).join('&');
 const payload=url.origin+url.pathname+(query?'?'+query:'')+'.'+nonce;
 const key=await crypto.subtle.importKey('raw',encoder.encode(config.token),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 for(const value of signature.split(',').map(s=>s.trim())){
  if(!/^[A-Za-z0-9+/]{43}=$/.test(value))continue;
  if(await crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(value),c=>c.charCodeAt(0)),encoder.encode(payload)))return true;
 }
 return false;
}

async function saveVerifiedPilot(env,row,now){
 const db=await pilotCrm(env,row.tenant_id);
 if(!db)return false;
 if(row.job_id){
  const result=await db.prepare('SELECT session_id,saved_to_lead FROM scripted_call_results WHERE tenant_id=? AND job_id=?')
   .bind(row.tenant_id,row.job_id).first();
  if(result)return result.session_id===row.id&&result.saved_to_lead===1;
 }
 const existing=await db.prepare('SELECT updated_at,requirements_json FROM leads WHERE tenant_id=? AND id=? AND mobile_e164=?')
  .bind(row.tenant_id,row.lead_id,row.destination).first();
 if(!existing)return false;
 let prior;
 try{prior=JSON.parse(existing.requirements_json||'{}')}catch{}
 if(prior?.scriptedCallPilot?.id===row.id&&!row.job_id)return true;
 const survey=normalizePropertySurvey(JSON.parse(row.survey_json).answers,{now}),crm=surveyToCrm(survey);
 const at=iso(Math.max(now,(Date.parse(existing.updated_at)||0)+1));
 const stored=prior&&typeof prior==='object'&&!Array.isArray(prior)?
  JSON.stringify({...prior,scriptedCallPilot:{id:row.id,recordedAt:at,answers:survey}}):null;
 const statements=[];
 if(existing.updated_at===row.lead_updated_at&&stored&&stored.length<=8000){
  statements.push(
   db.prepare(`UPDATE leads SET preferred_location=COALESCE(?,preferred_location),plot_size_preference=?,
    budget_min_inr=CASE WHEN ? IS NULL THEN budget_min_inr ELSE NULL END,budget_max_inr=COALESCE(?,budget_max_inr),
    interest_status=CASE WHEN interest_status='converted' THEN interest_status ELSE ? END,
    visit_date_preference=?,requirements_json=?,updated_at=?
    WHERE tenant_id=? AND id=? AND mobile_e164=? AND updated_at=? AND consent_status!='denied' AND dnd_status!='blocked'
    AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=leads.tenant_id AND o.lead_id=leads.id)`)
    .bind(crm.preferredLocation,crm.plotSizePreference,crm.budgetMaxInr,crm.budgetMaxInr,crm.interestStatus,
     crm.visitDatePreference,stored,at,row.tenant_id,row.lead_id,row.destination,existing.updated_at),
   db.prepare(`INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)
    SELECT tenant_id,?,'scripted_phone_pilot','lead.scripted_phone_pilot_saved',id,?
    FROM leads WHERE tenant_id=? AND id=? AND changes()=1`)
    .bind(crypto.randomUUID(),at,row.tenant_id,row.lead_id)
  );
 }
 if(!row.job_id)return statements.length>0&&(await db.batch(statements))[0].meta.changes===1;
 // Keep the captured answers per attempt even if staff edited the lead during the call.
 // The immutable result and optional lead update commit in one CRM transaction.
 statements.push(db.prepare(`INSERT INTO scripted_call_results(tenant_id,job_id,session_id,answers_json,saved_to_lead,captured_at)
   SELECT j.tenant_id,j.id,?,?,CASE WHEN l.updated_at=? AND json_valid(l.requirements_json)
    THEN COALESCE(json_extract(l.requirements_json,'$.scriptedCallPilot.id')=?,0) ELSE 0 END,?
   FROM calling_jobs j JOIN leads l ON l.tenant_id=j.tenant_id AND l.id=j.lead_id
   WHERE j.tenant_id=? AND j.id=? AND l.id=? AND l.mobile_e164=?
   ON CONFLICT(tenant_id,job_id) DO NOTHING`)
  .bind(row.id,JSON.stringify(survey),at,row.id,iso(now),row.tenant_id,row.job_id,row.lead_id,row.destination));
 await db.batch(statements);
 const result=await db.prepare('SELECT session_id,saved_to_lead FROM scripted_call_results WHERE tenant_id=? AND job_id=?')
  .bind(row.tenant_id,row.job_id).first();
 return result?.session_id===row.id&&result.saved_to_lead===1;
}

async function saveCampaignOptOut(env,row,now){
 const db=await pilotCrm(env,row.tenant_id),at=iso(now);
 if(!db)throw Error('scripted_crm_unavailable');
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO lead_opt_out_events(tenant_id,id,lead_id,source,actor,created_at)
   SELECT tenant_id,?,id,'customer_request','scripted_phone',? FROM leads
   WHERE tenant_id=? AND id=? AND mobile_e164=?`).bind(row.id,at,row.tenant_id,row.lead_id,row.destination),
  db.prepare(`UPDATE leads SET consent_status='denied',dnd_status='blocked',updated_at=?
   WHERE tenant_id=? AND id=? AND mobile_e164=? AND EXISTS(
    SELECT 1 FROM lead_opt_out_events WHERE tenant_id=? AND id=? AND lead_id=?)`)
   .bind(at,row.tenant_id,row.lead_id,row.destination,row.tenant_id,row.id,row.lead_id)
 ]);
}

async function finishCampaignOptOut(env,row,now){
 await saveCampaignOptOut(env,row,now);
 await env.CONTROL_DB.prepare("UPDATE scripted_phone_pilots SET phase='declined' WHERE id=? AND phase='suppressing'").bind(row.id).run();
 return end();
}

async function completePilot(env,row,now){
 const saved=await saveVerifiedPilot(env,row,now);
 const phase=saved?'completed':'needs_review';
 await env.CONTROL_DB.prepare("UPDATE scripted_phone_pilots SET phase=? WHERE id=? AND phase='finishing'").bind(phase,row.id).run();
 return {...row,phase};
}

// Use provider metadata for existing signed internal calls only. No call,
// recording download, transcription, provider mutation or PII in responses.
async function providerMetadata(config,path,fetcher){
 try{
  const response=await fetcher('https://api.plivo.com/v1/Account/'+config.authId+'/'+path,{
   method:'GET',headers:{Authorization:config.authorization},redirect:'manual',signal:AbortSignal.timeout(5000)
  });
  if(!response.ok)return {httpStatus:response.status,body:null};
  const body=JSON.parse(new TextDecoder().decode(await readBoundedBytes(response,65536)));
  return {httpStatus:response.status,body};
 }catch{return {httpStatus:null,body:null}}
}
async function inspectLastMedia(env,config,fetcher){
 const read=engine=>env.CONTROL_DB.prepare(
  "SELECT provider_call_id FROM scripted_phone_pilots WHERE tenant_id=? AND job_id IS NULL AND provider_account_id=? AND caller=? AND hangup_at IS NOT NULL AND provider_call_id IS NOT NULL AND CASE WHEN json_valid(survey_json) THEN COALESCE(json_extract(survey_json,'$.phoneMeta.engine'),'whisper')=? ELSE 0 END ORDER BY created_at DESC LIMIT 1")
  .bind(config.tenant,config.authId,config.caller,engine).first();
 const [stream,recording]=await Promise.all([read('deepgram_stream'),read('whisper')]);
 async function inspect(row,type){
  const id=row?.provider_call_id;
  if(!ID.test(id||''))return {state:'no_matching_call',httpStatus:null,count:null};
  const path=type==='stream'?'Call/'+id+'/Stream/':'Recording/?call_uuid='+encodeURIComponent(id)+'&limit=20';
  const {httpStatus,body}=await providerMetadata(config,path,fetcher);
  if(!Array.isArray(body?.objects))return {state:'provider_unavailable',httpStatus,count:null};
  const records=body.objects.filter(x=>x?.call_uuid===id);
  return {state:records.length?'records_found':'no_matching_records',httpStatus,count:records.length,
   ...(type==='stream'?{endedCount:records.filter(x=>typeof x.end_time==='string'&&x.end_time.length>0).length}:
    {durationMs:records.reduce((sum,x)=>{const n=Number(x.recording_duration_ms);return sum+(Number.isFinite(n)&&n>=0&&n<=180000?n:0)},0)})};
 }
 const [streams,recordings]=await Promise.all([inspect(stream,'stream'),inspect(recording,'recording')]);
 return {streams,recordings,phoneCallsStarted:0,mediaDownloaded:false};
}
// Only an authenticated provider metadata response for this exact call and
// recording may supply an alternate URL. Never send credentials off Plivo.
function verifiedRecordingUrl(config,row,recording,body){
 if(body?.recording_id!==recording||body.call_uuid!==row.provider_call_id||!['mp3','wav'].includes(body.recording_format)||typeof body.recording_url!=='string'||body.recording_url.length>4096)return null;
 try{
  const url=new URL(body.recording_url);
  const expected='/v1/Account/'+config.authId+'/Recording/'+recording+'.'+body.recording_format;
  if(!['https://media.plivo.com','https://aps1.media.plivo.com'].includes(url.origin)||url.username||url.password||url.hash||url.pathname!==expected)return null;
  return url.href;
 }catch{return null}
}

// Deliberately reuse one already recorded answer. Only current-MFA operator,
// explicit renewed consent, eligible enrolled internal lead, signed ended call.
// No recording or transcript is retained, logged or written to CRM.
// A separate explicit consent confirmation permits displaying one first-answer
// transcript to the current-MFA operator only; default probe returns no text.
async function probeInternalRecording(env,config,fetcher,{showFirstAnswer=false,showLastAnswer=false,playback=false,now=Date.now()}={}){
 const result={phoneCallsStarted:0,crmChanged:false,metadataHttp:null,mediaHost:null,mediaHttp:null,bytes:0,stt:'not_started'};
 const row=await env.CONTROL_DB.prepare(
  "SELECT provider_call_id,lead_id,destination,language,survey_json,CASE WHEN json_valid(survey_json) THEN json_extract(survey_json,'$.index') END AS question_index FROM scripted_phone_pilots WHERE tenant_id=? AND job_id IS NULL AND provider_account_id=? AND caller=? AND hangup_at IS NOT NULL AND provider_call_id IS NOT NULL AND turn>0 AND CASE WHEN json_valid(survey_json) THEN COALESCE(json_extract(survey_json,'$.phoneMeta.engine'),'whisper')='whisper' ELSE 0 END ORDER BY created_at DESC LIMIT 1")
  .bind(config.tenant,config.authId,config.caller).first();
 if(!row||!ID.test(row.provider_call_id)||!['hi','en'].includes(row.language))return {...result,state:'no_matching_recorded_call'};
 if(showFirstAnswer&&row.question_index!==0)return {...result,state:'first_question_not_confirmed'};
 const target=await selectDevice(env,config,row.lead_id),crm=await pilotCrm(env,config.tenant);
 if(!target||target.destination!==row.destination||!crm||!await eligiblePilotLead(crm,target))return {...result,state:'internal_device_unavailable'};
 const metadata=await providerMetadata(config,'Recording/?call_uuid='+encodeURIComponent(row.provider_call_id)+'&limit=20',fetcher);
 result.metadataHttp=metadata.httpStatus;
 if(!Array.isArray(metadata.body?.objects))return {...result,state:'recording_metadata_unavailable'};
 const candidates=metadata.body.objects.filter(x=>x?.call_uuid===row.provider_call_id&&ID.test(x.recording_id||'')&&Number(x.recording_duration_ms)>0&&Number(x.recording_duration_ms)<=20000)
  .sort((a,b)=>Number(a.recording_start_ms||0)-Number(b.recording_start_ms||0));
 if(!candidates.length)return {...result,state:'no_matching_short_recording'};
 if(showLastAnswer&&(![0,1,2,3,4,5,6].includes(row.question_index)||!candidates.every(x=>Number(x.recording_start_ms)>0)||new Set(candidates.map(x=>Number(x.recording_start_ms))).size!==candidates.length))return {...result,state:'last_answer_order_unverified'};
 const recording=showLastAnswer?candidates.at(-1):candidates[0],url=verifiedRecordingUrl(config,row,recording.recording_id,recording);
 if(!url)return {...result,state:'recording_url_not_allowlisted'};
 result.mediaHost=new URL(url).hostname;
 let bytes,contentType;
 try{
  const response=await fetcher(url,{method:'GET',headers:{Authorization:config.authorization},redirect:'manual',signal:AbortSignal.timeout(5000)});
  result.mediaHttp=response.status;
  if(!response.ok){try{await response.body?.cancel()}catch{}return {...result,state:'media_http_'+response.status}}
  contentType=answerContentType(response.headers);
  if(!supportsAnswerAudio(contentType)){try{await response.body?.cancel()}catch{}return {...result,state:'media_type_invalid'}}
  bytes=await readBoundedBytes(response,ANSWER_MAX_BYTES);result.bytes=bytes.length;
 }catch{return {...result,state:'media_read_failed'}}
 // Separately consented, current-MFA internal listening only. No model call,
 // provider URL, download link, storage or CRM mutation.
 if(playback){
  if(!['audio/mpeg','audio/wav','audio/x-wav'].includes(contentType))return {...result,state:'playback_type_unsupported'};
  return new Response(bytes,{headers:{...headers,'Content-Type':contentType,'Content-Length':String(bytes.length)}});
 }
 try{
  if(showLastAnswer){
   const {phoneMeta,...previous}=JSON.parse(row.survey_json);
   const field=FIELDS[row.question_index];
   const replayState={...previous,status:'active',attempts:0,turns:0,startedAt:now};
   // Same bytes, language and VAD settings; only the topic hint differs.
   // These are fresh recognition runs, not the original callback transcript.
   // Deterministic parser only: historical contextual/memory state is not recoverable.
   const recognize=async(run)=>{
    let transcript,confidence=null;
    try{({text:transcript,confidence=null}=await run())}
    catch(e){return {stt:'service_failed',failureCode:speechFailureCode(e),transcript:null,parserAction:null,normalizedAnswer:null,confidence:null}}
    if(!transcript)return {stt:'empty_text',transcript:null,parserAction:null,normalizedAnswer:null,confidence};
    try{
     const replay=advanceFixedVoicePreview(replayState,{transcript,now,confidence:confidence??1});
     return {stt:'text_received',transcript,parserAction:replay.action,normalizedAnswer:['next_question','completed'].includes(replay.action)?replay.state.answers[field]??null:null,confidence};
    }catch{return {stt:'text_received',transcript,parserAction:'replay_state_invalid',normalizedAnswer:null,confidence}}
   };
   const whisper=async(initialPrompt)=>({text:await transcribeScriptedAnswer(env.AI,bytes,row.language,{vadFilter:false,initialPrompt})});
   const [baseline,hinted,nova]=await Promise.all([
    recognize(()=>whisper(null)),recognize(()=>whisper(answerSpeechContext(row))),
    recognize(()=>transcribeNovaRecordedAnswer(env.AI,bytes,row.language,contentType))
   ]);
   return {...result,state:'media_downloaded',question:field,...baseline,hinted,nova,contentType,recordingDurationMs:Number(recording.recording_duration_ms)};
  }
  const text=await transcribeScriptedAnswer(env.AI,bytes,row.language,{vadFilter:false});
  const output={...result,state:'media_downloaded',stt:text?'text_received':'empty_text'};
  if(showFirstAnswer&&text){
   const replay=advanceFixedVoicePreview(beginFixedVoicePreview({language:row.language,now}).state,{transcript:text,now});
   return {...output,transcript:text,parserAction:replay.action,propertyType:replay.state.answers.propertyType??null};
  }
  return output;
 }catch{return {...result,state:'media_downloaded',stt:'service_failed'}}
}

// Same authenticated, call-scoped listing that passed the saved-recording
// production diagnostic. Never use the URL of a different answer or call.
async function resolveRecordedAnswerUrl(config,row,recording,fetcher){
 const listed=await providerMetadata(config,'Recording/?call_uuid='+encodeURIComponent(row.provider_call_id)+'&limit=20',fetcher);
 const matches=Array.isArray(listed.body?.objects)?listed.body.objects.filter(x=>x?.call_uuid===row.provider_call_id&&x.recording_id===recording):[];
 if(matches.length>1)return null;
 if(matches.length===1)return verifiedRecordingUrl(config,row,recording,matches[0]);
 // The list can lag immediately after the recording callback.
 const one=await providerMetadata(config,'Recording/'+recording+'/',fetcher);
 return verifiedRecordingUrl(config,row,recording,one.body);
}
function answerSpeechContext(row){
 // Topic-only hint, no example amounts, to reduce language/number errors
 // without priming the recognizer to invent a specific answer.
 const field=FIELDS[JSON.parse(row.survey_json).index];
 const topics={size:'property area, measurement units and bedrooms',budgetInr:'Indian rupee budget, lakh and crore',propertyType:'real estate property type',location:'Indian city names',area:'Indian neighborhood names',interest:'property viewing interest',visitDate:'site visit date'};
 const hindi={size:'प्रॉपर्टी का क्षेत्रफल, माप की इकाई, बीएचके।',budgetInr:'भारतीय रुपये में बजट, लाख और करोड़।',propertyType:'प्रॉपर्टी का प्रकार।',location:'भारत के शहरों के नाम।',area:'शहर का इलाका।',interest:'प्रॉपर्टी देखने में रुचि।',visitDate:'साइट विजिट की तारीख।'};
 return row.language==='hi'?hindi[field]:topics[field];
}
function recordingDurationMs(params){
 const raw=params.get('RecordingDurationMs');
 if(raw&&/^\d{1,6}$/.test(raw)&&Number(raw)<=180000)return Number(raw);
 return null;
}
async function recordingAnswer(config,env,row,params,fetcher){
 if(!ID.test(params.get('RecordingID')||''))return {text:null,reason:'recording_id_missing'};
 const recording=params.get('RecordingID');
 // The signed callback has already been verified and bound to this call.
 // Accept only an exact account/recording path on our two approved Plivo
 // media hosts; never follow a redirect or send auth to arbitrary URLs.
 const callbackUrl=verifiedRecordingUrl(config,row,recording,{recording_id:recording,call_uuid:row.provider_call_id,recording_format:'mp3',recording_url:params.get('RecordUrl')});
 const legacyUrl='https://media.plivo.com/v1/Account/'+config.authId+'/Recording/'+recording+'.mp3';
 let mediaUrl=callbackUrl||legacyUrl,response,bytes,reason='recording_fetch_failed';
 // The action callback can precede media availability. Retry the identical
 // authenticated GET once on a transient status, within a bounded fetch budget.
 // Never follow redirects or forward credentials to callback-provided URLs.
 for(let attempt=0;attempt<2;attempt++){
  try{
   response=await fetcher(mediaUrl,{
    headers:{Authorization:config.authorization},redirect:'manual',signal:AbortSignal.timeout(2500)
   });
   if(response.ok)break;
   reason='recording_http_'+(Number.isInteger(response.status)?response.status:'unknown');
   const transient=[404,409,425,429,500,502,503,504].includes(response.status);
   if(response.status===403&&attempt===0){
    const verified=await resolveRecordedAnswerUrl(config,row,recording,fetcher);
    if(!verified||verified===mediaUrl)return {text:null,reason:'recording_http_403'};
    try{await response.body?.cancel()}catch{}
    mediaUrl=verified;
    response=await fetcher(mediaUrl,{headers:{Authorization:config.authorization},redirect:'manual',signal:AbortSignal.timeout(2500)});
    if(response.ok)break;
    return {text:null,reason:'recording_http_'+response.status};
   }
   if(!transient||attempt===1)return {text:null,reason};
   try{await response.body?.cancel()}catch{}
  }catch{response=null;reason='recording_fetch_failed';if(attempt===1)return {text:null,reason}}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 if(!response?.ok)return {text:null,reason};
 if(!supportsAnswerAudio(answerContentType(response.headers)))return {text:null,reason:'recording_type_invalid'};
 try{bytes=await readBoundedBytes(response,ANSWER_MAX_BYTES)}
 catch{return {text:null,reason:'recording_body_invalid'}}
 try{
  const text=await transcribeScriptedAnswer(env.AI,bytes,row.language,{vadFilter:false,initialPrompt:internalDirect(row)?answerSpeechContext(row):null});
  return {text,reason:text?'recognized':'speech_empty',audioMs:recordingDurationMs(params),audioBytes:bytes.length,sttConnected:true,mediaHost:new URL(mediaUrl).hostname};
 }catch{return {text:null,reason:'speech_service_failed',audioMs:recordingDurationMs(params),audioBytes:bytes.length,sttConnected:false,mediaHost:new URL(mediaUrl).hostname}}
}

async function applyPhoneAnswer(config,env,row,answer,now){
 const control=env.CONTROL_DB,id=row.id,turn=row.turn;
  const {phoneMeta={},...prior}=JSON.parse(row.survey_json);
  // A broken media/ASR path is not an unintelligible customer response.
  // Never loop the apology when no actual listening opportunity was provided.
  const streamMetrics=isStreaming(row)?{audioMs:Number.isSafeInteger(answer.audioMs)?Math.min(18000,Math.max(0,answer.audioMs)):0,streamStarted:answer.streamStarted===true,sttConnected:answer.sttConnected===true}:{audioMs:answer.audioMs??null,audioBytes:answer.audioBytes??null,sttConnected:answer.sttConnected??null,mediaHost:answer.mediaHost??null};
  if(isStreaming(row)&&answer.reason.startsWith('stream_')){
   const survey_json=JSON.stringify({...prior,phoneMeta:{...phoneMeta,...streamMetrics,lastAudioOutcome:answer.reason,technicalFailure:true}});
   const changed=await control.prepare("UPDATE scripted_phone_pilots SET phase='needs_review',survey_json=? WHERE id=? AND phase='transcribing' AND turn=?").bind(survey_json,id,turn).run();
   return changed.meta.changes===1?responseFor(config,{...row,phase:'needs_review',survey_json}):end();
  }
  // Transport, empty audio and STT errors use the SAME bounded retry budget
  // as unclear speech. Never invent an answer or repeat a paid outbound call.
  const args={transcript:answer.text||'repeat',confidence:answer.confidence??1,now};
  const {result,interpreter,pendingQuantity=null}=internalDirect(row)&&answer.reason==='recognized'&&answer.text?
   await advanceInternalVoice(env.AI,prior,args,phoneMeta.pendingQuantity):{result:advanceFixedVoicePreview(prior,args),interpreter:'direct'};
  // No transcript, recording URL, identifiers, phone numbers or provider secrets.
  console.info('AR3D scripted answer outcome',JSON.stringify({
   reason:answer.reason,action:result.action,interpreter,questionIndex:prior.index,
   attempt:prior.attempts+1,scope:row.job_id?'campaign':'internal'
  }));
  if(row.job_id&&result.state.status==='opted_out'){
   await control.prepare("UPDATE scripted_phone_pilots SET phase='suppressing' WHERE id=? AND phase='transcribing'").bind(id).run();
   return await finishCampaignOptOut(env,row,now);
  }
  const phase={active:'question',completed:'finishing',opted_out:'declined',needs_review:'needs_review'}[result.state.status];
  const survey_json=JSON.stringify({...result.state,phoneMeta:{...phoneMeta,...streamMetrics,interpreter,pendingQuantity,lastAudioOutcome:answer.reason==='recognized'&&result.action==='repeat'?'speech_unrecognized':answer.reason==='recognized'&&result.action==='human_review'?'speech_unrecognized':answer.reason}});
  const changed=await control.prepare(`UPDATE scripted_phone_pilots SET phase=CASE WHEN ?='question' AND hangup_at IS NOT NULL THEN 'ended' ELSE ? END,
   survey_json=?,turn=turn+1 WHERE id=? AND phase='transcribing' AND turn=?`)
   .bind(phase,phase,survey_json,id,turn).run();
  if(changed.meta.changes!==1)return end();
  const next={...row,phase,survey_json,turn:turn+1};
  return phase==='question'?responseForPhoneQuestion(config,env,next):
   responseFor(config,phase==='finishing'?await completePilot(env,next,now):next);
}

export async function handleScriptedPhoneCallback(req,env,{now=Date.now(),fetcher=fetch,streamUpgrade=upgradePlivoTurn}={}){
 const url=new URL(req.url);
 if(!url.pathname.startsWith(HOOK+'/'))return null;
 const config=phoneConfiguration(env);
 if(req.method!=='GET'||!config||url.origin.replace(/^wss:/,'https:')!==config.origin||url.href.length>8192)
  return error('pilot_callback_unavailable',404);
 const [id,step,arg,...rest]=url.pathname.slice(HOOK.length+1).split('/');
 if(!UUID.test(id)||(step==='stream'?rest.length>1:rest.length))return error('not_found',404);
 const control=env.CONTROL_DB;
 try{
  if(step==='audio'){
   if(!arg?.endsWith('.mp3')||!AUDIO_PROMPTS.has(arg.slice(0,-4))||url.search)return error('not_found',404);
   // Scoped to the random pilot ID; serves prerecorded questions only.
   const row=await control.prepare('SELECT language,tenant_id,job_id FROM scripted_phone_pilots WHERE id=? AND expires_at>? AND provider_account_id=?')
    .bind(id,now,config.authId).first();
   const audio=row?await env.RECORDINGS.get(promptKey(row.language,arg.slice(0,-4),row.job_id?row.tenant_id:null)):null;
   if(!audio||audio.size<1||audio.size>ANSWER_MAX_BYTES)return error('not_found',404);
   return new Response(audio.body,{headers:{...headers,'Content-Type':'audio/mpeg','Content-Length':String(audio.size)}});
  }
  if(step==='stream'){
   const token=rest.length===1&&!url.search?rest[0]:rest.length===0&&[...url.searchParams.keys()].join(',')==='token'?url.searchParams.get('token'):null;
   if(req.headers.get('Upgrade')?.toLowerCase()!=='websocket'||!/^\d{1,2}$/.test(arg||'')||!token)return error('stream_upgrade_required',426);
   const row=await control.prepare('SELECT * FROM scripted_phone_pilots WHERE id=? AND expires_at>?').bind(id,now).first();
   if(!row||row.provider_account_id!==config.authId||row.caller!==config.caller||!row.provider_call_id||row.hangup_at!==null||row.phase!=='question'||row.turn!==Number(arg)||!isStreaming(row)||!await validStreamToken(config.token,row,token))return error('stream_not_authorized',403);
   const operator=configuration(env),target=operator&&row.tenant_id===operator.tenant?await selectDevice(env,operator,row.lead_id):null;
   if(!target||target.destination!==row.destination)return error('stream_not_authorized',403);
   const crm=await pilotCrm(env,row.tenant_id);
   if(!crm||!await eligiblePilotLead(crm,target))return error('stream_not_authorized',403);
   const lock=await control.prepare("UPDATE scripted_phone_pilots SET phase='transcribing' WHERE id=? AND phase='question' AND turn=? AND hangup_at IS NULL").bind(id,row.turn).run();
   if(lock.meta.changes!==1)return error('stream_already_claimed',409);
   return streamUpgrade({accountId:config.authId,callId:row.provider_call_id,language:row.language,connect:lang=>openNovaSocket(env.AI,lang),onAnswer:answer=>applyPhoneAnswer(config,env,row,answer,Date.now())});
  }
  if(!await verifiedPlivoGet(req,config,url))return error('invalid_provider_signature',403);
  const params=url.searchParams,call=params.get('CallUUID'),requestId=params.get('ALegRequestUUID')||params.get('RequestUUID');
  if(!ID.test(call||''))return error('invalid_call_reference',400);
  const row=await control.prepare('SELECT * FROM scripted_phone_pilots WHERE id=? AND expires_at>?').bind(id,now).first();
  if(!row||row.provider_account_id!==config.authId||row.caller!==config.caller)return end();
  // A previously reserved call must still be able to report its signed hangup
  // after enrollment/lead eligibility changes. The immutable call identity is
  // checked below. Other internal steps recheck the enrolled destination.
  if(!row.job_id&&step!=='hangup'){
   const operator=configuration(env);
   if(!operator||row.tenant_id!==operator.tenant)return end();
   const target=await selectDevice(env,operator,row.lead_id);
   if(!target||row.destination!==target.destination)return end();
  }
  if(row.job_id&&step==='answer'&&env.AR3D_SCRIPTED_CAMPAIGNS_ENABLED!=='enabled')return end();
  if(step==='answer'&&!arg){
   if(!ID.test(requestId||'')||params.get('Direction')!=='outbound'||
      normalizePhone(params.get('To'))!==normalizePhone(row.destination)||
      normalizePhone(params.get('From'))!==normalizePhone(row.caller)||
      (row.provider_request_id&&row.provider_request_id!==requestId))return error('call_identity_mismatch',403);
   const direct=internalDirect(row),phase=direct?'question':'consent';
   if(row.provider_call_id)return row.provider_call_id===call&&row.phase===phase&&row.turn===0?
    responseForPhoneQuestion(config,env,row,{directOpeningCue:direct}):end();
   const claim=await control.prepare(`UPDATE scripted_phone_pilots SET provider_call_id=?,provider_request_id=?,phase=?
    WHERE id=? AND phase IN('requested','unknown') AND provider_call_id IS NULL
    AND (provider_request_id IS NULL OR provider_request_id=?)`).bind(call,requestId,phase,id,requestId).run();
   return claim.meta.changes===1?responseForPhoneQuestion(config,env,{...row,provider_call_id:call,phase},{directOpeningCue:direct}):end();
  }
  if(step==='hangup'&&!arg){
   const matchedRequest=row.provider_request_id&&row.provider_request_id===requestId;
   const matchesDestination=params.get('Direction')==='outbound'&&
    normalizePhone(params.get('To'))===normalizePhone(row.destination)&&
    normalizePhone(params.get('From'))===normalizePhone(row.caller);
   if(row.provider_call_id?row.provider_call_id!==call:!matchedRequest&&!matchesDestination)return end();
   const seconds=params.get('Duration');
   const durationSeconds=/^\d{1,3}$/.test(seconds||'')?Number(seconds):null;
   await control.prepare(`UPDATE scripted_phone_pilots SET hangup_at=COALESCE(hangup_at,?),
    duration_seconds=COALESCE(duration_seconds,?),provider_call_id=COALESCE(provider_call_id,?),
    phase=CASE WHEN phase IN('requested','unknown','consent','question') THEN 'ended' ELSE phase END
    WHERE id=?`).bind(now,durationSeconds,call,id).run();
   return new Response(null,{status:204,headers});
  }
  if(row.provider_call_id!==call)return end();
  if(row.phase==='suppressing'&&row.job_id)return await finishCampaignOptOut(env,row,now);
  if(terminal.has(row.phase))return responseFor(config,row);
  if(step==='consent'&&!arg){
   if(row.phase!=='consent')return row.phase==='question'&&row.turn===0?responseFor(config,row):end();
   const digits=params.get('Digits');
   const phase=digits==='1'?'question':digits==='2'&&row.job_id?'suppressing':'declined';
   const changed=await control.prepare("UPDATE scripted_phone_pilots SET phase=? WHERE id=? AND phase='consent'").bind(phase,id).run();
   if(changed.meta.changes!==1)return end();
   return phase==='suppressing'?await finishCampaignOptOut(env,row,now):responseFor(config,{...row,phase});
  }
  if(step==='stream-next'&&/^\d{1,2}$/.test(arg||'')&&isStreaming(row)){
   if(row.hangup_at!==null)return end();
   const requestedTurn=Number(arg);
   if(row.phase==='finishing')return responseFor(config,await completePilot(env,row,now));
   if(requestedTurn===row.turn-1&&row.phase==='question')return responseForPhoneQuestion(config,env,row);
   if(requestedTurn!==row.turn)return end();
   if(row.phase==='question'){
    const lock=await control.prepare("UPDATE scripted_phone_pilots SET phase='transcribing' WHERE id=? AND phase='question' AND turn=? AND hangup_at IS NULL").bind(id,row.turn).run();
    if(lock.meta.changes!==1)return end();
   }else if(row.phase!=='transcribing')return end();
   return applyPhoneAnswer(config,env,row,{text:null,reason:row.phase==='question'?'stream_start_missing':'stream_disconnected'},now);
  }
  if(isStreaming(row)||step!=='turn'||!/^\d{1,2}$/.test(arg||''))return end();
  const turn=Number(arg);
  if(row.phase==='finishing')return responseFor(config,await completePilot(env,row,now));
  if(turn===row.turn-1&&row.phase==='question')return responseForPhoneQuestion(config,env,row);
  if(turn!==row.turn)return end();
  if(row.phase==='transcribing')return error('answer_processing',503);
  if(row.phase!=='question')return end();
  const lock=await control.prepare("UPDATE scripted_phone_pilots SET phase='transcribing' WHERE id=? AND phase='question' AND turn=?")
   .bind(id,turn).run();
  if(lock.meta.changes!==1)return error('answer_processing',503);
  return applyPhoneAnswer(config,env,row,await recordingAnswer(config,env,row,params,fetcher),now);
 }catch{return error('scripted_phone_callback_unavailable',503)}
}
