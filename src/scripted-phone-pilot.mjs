// Shared phone questionnaire with a separately approved internal pilot and customer campaigns.
import {resolveCrmDb,parseJsonBody} from './core.mjs';
import {mutationOriginAllowed} from './human-auth.mjs';
import {beginFixedVoicePreview,advanceFixedVoicePreview} from './fixed-voice-turns.mjs';
import {normalizePropertySurvey,surveyToCrm} from './fixed-property-survey.mjs';
import {ANSWER_MAX_BYTES,answerContentType,readBoundedBytes,supportsAnswerAudio,transcribeScriptedAnswer} from './scripted-speech.mjs';

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
   AND caller=? AND destination=? AND tenant_id=? AND lead_id=? LIMIT 1`)
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

function responseFor(config,row,{repeatCue=false}={}){
 const audio=name=>play(callback(config,row.id,'audio/'+name+'.mp3'));
 if(row.phase==='consent'){
  const action=escapeXml(callback(config,row.id,'consent'));
  return xml('<GetDigits action="'+action+'" method="GET" numDigits="1" retries="1" timeout="7">'+audio('opening')+'</GetDigits><Hangup/>');
 }
 if(row.phase==='question'){
  const state=JSON.parse(row.survey_json),field=FIELDS[state.index];
  const prompt=field==='size'?(state.answers.propertyType==='plot'?'size-plot':'size-home'):field;
  if(!PROMPTS.includes(prompt))return end();
  // A distinct URL per attempt makes a retried callback safe to recognize.
  return xml((repeatCue&&state.attempts>0?audio('repeat'):'')+audio(prompt)+'<Record action="'+escapeXml(callback(config,row.id,'turn/'+row.turn))+
   '" method="GET" fileFormat="mp3" maxLength="12" timeout="4" finishOnKey="#" playBeep="true"/><Hangup/>');
 }
 if(row.phase==='completed'||row.phase==='needs_review')
  return xml(audio(row.phase==='completed'?'closing':'review')+'<Hangup/>');
 return end();
}

// Look up a reviewed optional cue only on an actual retry. A missing object,
// out-of-range object or R2 metadata failure must not break the phone survey.
async function responseForPhoneQuestion(config,env,row){
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
 return responseFor(config,row,{repeatCue});
}

async function startPilot(req,env,user,config,now,fetcher){
 if(!config)return error('scripted_phone_pilot_not_configured',503);
 if(!mutationOriginAllowed(req)||new URL(req.url).origin!==config.origin)return error('pilot_origin_mismatch',403);
 let data;
 try{data=parseJsonBody(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBytes(req,1024)),1024)}
 catch{return error('invalid_pilot_request',400)}
 if(Object.keys(data).sort().join(',')!=='confirm,language'||data.confirm!=='CALL_ONE_VERIFIED_INTERNAL_NUMBER'||
    !['hi','en'].includes(data.language))return error('explicit_pilot_confirmation_required',400);
 const control=env.CONTROL_DB,crm=await pilotCrm(env,config.tenant);
 if(!crm)return error('pilot_client_unavailable',409);
 const lead=await eligiblePilotLead(crm,config);
 if(!lead)return error('verified_internal_lead_unavailable',409);
 if(!await scriptedPromptsReady(env,data.language))
  return error('pilot_prompt_recordings_incomplete',409);
 const id=crypto.randomUUID(),slot=Math.floor(now/900000),survey=beginFixedVoicePreview({language:data.language,now}).state;
 const reservation=await control.prepare(`INSERT INTO scripted_phone_pilots
  (id,tenant_id,lead_id,lead_updated_at,actor_id,language,destination,caller,rate_slot,expires_at,phase,survey_json,created_at,provider_account_id)
  SELECT ?,?,?,?,?,?,?,?,?,?,'requested',?,?,? WHERE NOT EXISTS(
   SELECT 1 FROM scripted_phone_pilots WHERE job_id IS NULL AND expires_at>? AND phase IN('requested','consent','question','transcribing','finishing','unknown'))
  ON CONFLICT(rate_slot) DO NOTHING`).bind(id,config.tenant,config.lead,lead.updated_at,user.id,
  data.language,config.destination,config.caller,slot,now+ttl,JSON.stringify(survey),iso(now),config.authId,now).run();
 if(reservation.meta.changes!==1)return error('pilot_already_requested_or_rate_limited',409);
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
 try{
  const response=await fetcher('https://api.plivo.com/v1/Account/'+config.authId+'/Call/',{
   method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),
   headers:{Authorization:config.authorization,'Content-Type':'application/json'},body:JSON.stringify({
    from:config.caller,to:destination,answer_url:callback(config,id,'answer'),answer_method:'GET',
    hangup_url:callback(config,id,'hangup'),hangup_method:'GET',time_limit:maxSeconds,hangup_on_ring:25
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

export async function handleScriptedPhoneAdmin(req,env,user,{now=Date.now(),fetcher=fetch}={}){
 if(new URL(req.url).pathname!==ADMIN)return null;
 if(user?.globalRole!=='super_admin'||!await currentMfa(env.CONTROL_DB,user,now))return error('current_super_admin_mfa_required',403);
 if(!['GET','POST'].includes(req.method))return error('method_not_allowed',405);
 const config=configuration(env);
 try{
  if(req.method==='POST')return await startPilot(req,env,user,config,now,fetcher);
  if(!config)return json({configured:false});
  const recent=await env.CONTROL_DB.prepare(`SELECT id,
    CASE WHEN phase='requested' AND provider_request_id IS NOT NULL THEN 'submitted' ELSE phase END AS phase,
    language,created_at FROM scripted_phone_pilots
    WHERE tenant_id=? AND lead_id=? AND job_id IS NULL ORDER BY created_at DESC LIMIT 5`).bind(config.tenant,config.lead).all();
  return json({configured:true,destinationLast4:config.destination.slice(-4),recent:recent.results});
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

async function recordingAnswer(config,env,row,params,fetcher){
 if(!ID.test(params.get('RecordingID')||''))return null;
 const recording=params.get('RecordingID');
 // Fetch a fixed, credentialed Plivo URL. The callback's RecordUrl is never fetched.
 const response=await fetcher('https://media.plivo.com/v1/Account/'+config.authId+'/Recording/'+recording+'.mp3',{
  headers:{Authorization:config.authorization},redirect:'manual',signal:AbortSignal.timeout(5000)
 });
 if(!response.ok||!supportsAnswerAudio(answerContentType(response.headers)))throw Error('recording_unavailable');
 return transcribeScriptedAnswer(env.AI,await readBoundedBytes(response,ANSWER_MAX_BYTES),row.language);
}

export async function handleScriptedPhoneCallback(req,env,{now=Date.now(),fetcher=fetch}={}){
 const url=new URL(req.url);
 if(!url.pathname.startsWith(HOOK+'/'))return null;
 const config=phoneConfiguration(env);
 if(req.method!=='GET'||!config||url.origin!==config.origin||url.href.length>8192)
  return error('pilot_callback_unavailable',404);
 const [id,step,arg,...rest]=url.pathname.slice(HOOK.length+1).split('/');
 if(!UUID.test(id)||rest.length)return error('not_found',404);
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
  if(!await verifiedPlivoGet(req,config,url))return error('invalid_provider_signature',403);
  const params=url.searchParams,call=params.get('CallUUID'),requestId=params.get('ALegRequestUUID')||params.get('RequestUUID');
  if(!ID.test(call||''))return error('invalid_call_reference',400);
  const row=await control.prepare('SELECT * FROM scripted_phone_pilots WHERE id=? AND expires_at>?').bind(id,now).first();
  if(!row||row.provider_account_id!==config.authId||row.caller!==config.caller)return end();
  const operator=configuration(env);
  if(!row.job_id&&(!operator||row.tenant_id!==operator.tenant||row.lead_id!==operator.lead||
     row.destination!==operator.destination))return end();
  if(row.job_id&&step==='answer'&&env.AR3D_SCRIPTED_CAMPAIGNS_ENABLED!=='enabled')return end();
  if(step==='answer'&&!arg){
   if(!ID.test(requestId||'')||params.get('Direction')!=='outbound'||
      normalizePhone(params.get('To'))!==normalizePhone(row.destination)||
      normalizePhone(params.get('From'))!==normalizePhone(row.caller)||
      (row.provider_request_id&&row.provider_request_id!==requestId))return error('call_identity_mismatch',403);
   if(row.provider_call_id)return row.provider_call_id===call&&row.phase==='consent'?responseFor(config,row):end();
   const claim=await control.prepare(`UPDATE scripted_phone_pilots SET provider_call_id=?,provider_request_id=?,phase='consent'
    WHERE id=? AND phase IN('requested','unknown') AND provider_call_id IS NULL
    AND (provider_request_id IS NULL OR provider_request_id=?)`).bind(call,requestId,id,requestId).run();
   return claim.meta.changes===1?responseFor(config,{...row,phase:'consent'}):end();
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
  if(step!=='turn'||!/^\d{1,2}$/.test(arg||''))return end();
  const turn=Number(arg);
  if(row.phase==='finishing')return responseFor(config,await completePilot(env,row,now));
  if(turn===row.turn-1&&row.phase==='question')return responseForPhoneQuestion(config,env,row);
  if(turn!==row.turn)return end();
  if(row.phase==='transcribing')return error('answer_processing',503);
  if(row.phase!=='question')return end();
  const lock=await control.prepare("UPDATE scripted_phone_pilots SET phase='transcribing' WHERE id=? AND phase='question' AND turn=?")
   .bind(id,turn).run();
  if(lock.meta.changes!==1)return error('answer_processing',503);
  let text;
  try{text=await recordingAnswer(config,env,row,params,fetcher)}
  catch{
   await control.prepare("UPDATE scripted_phone_pilots SET phase='needs_review' WHERE id=? AND phase='transcribing' AND turn=?").bind(id,turn).run();
   return responseFor(config,{...row,phase:'needs_review'});
  }
  const result=advanceFixedVoicePreview(JSON.parse(row.survey_json),{transcript:text||'repeat',now});
  if(row.job_id&&result.state.status==='opted_out'){
   await control.prepare("UPDATE scripted_phone_pilots SET phase='suppressing' WHERE id=? AND phase='transcribing'").bind(id).run();
   return await finishCampaignOptOut(env,row,now);
  }
  const phase={active:'question',completed:'finishing',opted_out:'declined',needs_review:'needs_review'}[result.state.status];
  const survey_json=JSON.stringify(result.state);
  const changed=await control.prepare(`UPDATE scripted_phone_pilots SET phase=CASE WHEN ?='question' AND hangup_at IS NOT NULL THEN 'ended' ELSE ? END,
   survey_json=?,turn=turn+1 WHERE id=? AND phase='transcribing' AND turn=?`)
   .bind(phase,phase,survey_json,id,turn).run();
  if(changed.meta.changes!==1)return end();
  const next={...row,phase,survey_json,turn:turn+1};
  return phase==='question'?responseForPhoneQuestion(config,env,next):
   responseFor(config,phase==='finishing'?await completePilot(env,next,now):next);
 }catch{return error('scripted_phone_callback_unavailable',503)}
}
