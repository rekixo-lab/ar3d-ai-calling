// Production signed Plivo callback adapter for version-pinned School sessions.
// Reuses the existing Control DB, CRM, RECORDINGS bucket, carrier account and
// Sarvam credential. No dialer, public session creation or paid audio job.
import {sha256hex} from './core.mjs';
import {readIndustryRecipientScope} from './industry-campaigns.mjs';
import {SCHOOL_VOICE_MODE,schoolVoicePlan,validateSchoolAudioPack,readSchoolAudioAsset,validateSchoolVoiceProgress,advanceSchoolVoice,schoolVoiceNodes} from './industry-school-voice-plan.mjs';
import {ANSWER_MAX_BYTES,answerContentType,readBoundedBytes,supportsAnswerAudio,speechFailureCode,transcribeSarvamRecordedAnswer} from './scripted-speech.mjs';
import {providerFaultBlocked,recordProviderFault} from './provider-safety.mjs';
import {signalProviderThrottle} from './capacity-signals.mjs';
const HOOK='/v1/provider/plivo/scripted-pilot';
const enc=new TextEncoder(),idRE=/^[a-zA-Z0-9-]{8,80}$/,digestRE=/^[a-f0-9]{64}$/;
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const error=(code,status)=>Response.json({error:code},{status,headers});
const escape=x=>x.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]);
const xml=x=>new Response('<Response>'+x+'</Response>',{headers:{...headers,'Content-Type':'application/xml;charset=utf-8'}});
const end=()=>xml('<Hangup/>');
const fail=x=>{throw Error(x)};
const phone=x=>String(x||'').replace(/^\+/,'');
const href=(config,row,step)=>config.origin+HOOK+'/'+row.id+'/'+step;
const say=(lang,text)=>'<Speak voice="Polly.Aditi" language="'+(lang==='en'?'en-IN':'hi-IN')+'">'+escape(text)+'</Speak>';
const clockFrom=now=>{const start=Date.now();return ()=>now+Math.max(0,Date.now()-start)};
export function isSchoolVoiceSession(row){
 try{return JSON.parse(row.survey_json).phoneMeta?.mode===SCHOOL_VOICE_MODE}catch{return false}
}
function parse(row){
 const doc=JSON.parse(row.survey_json),v=doc.industryVoice,m=doc.phoneMeta;
 if(!row.job_id||!v||m?.mode!==SCHOOL_VOICE_MODE||m.engine!=='sarvam'||m.costMeterVersion!==1||
    !['hi','en'].includes(row.language)||v.language!==row.language||v.turn!==row.turn||
    !['sttRoundedSeconds','sttFailedRequests','sttAudioMs','sttDurationUnknown','llmRequests','llmInputTokens','llmOutputTokens','llmUsageUnknown'].every(k=>Number.isSafeInteger(m[k])&&m[k]>=0&&m[k]<=1000000000))
  fail('school_session_invalid');
 return doc;
}
function enabled(env){
 return env.AR3D_INDUSTRY_SCHOOL_VOICE_ENABLED==='enabled'&&env.AR3D_SCRIPTED_CAMPAIGNS_ENABLED==='enabled'&&
  env.AR3D_CAMPAIGN_SARVAM_DISCLOSURE==='approved'&&typeof env.SARVAM_API_KEY==='string'&&!!env.SARVAM_API_KEY.trim()&&env.SARVAM_API_KEY.length<=512;
}
async function current(env,row,now){
 if(!enabled(env)||row.hangup_at!==null||row.expires_at<=now)fail('school_voice_disabled');
 const doc=parse(row),v=doc.industryVoice;
 if(doc.phoneMeta.dispatchVersion===1&&!await env.CRM_DB.prepare("SELECT 1 AS ok FROM industry_dispatch_releases WHERE tenant_id=? AND job_id=? AND session_id=? AND state IN('posting','submitted','unknown')").bind(row.tenant_id,row.job_id,row.id).first())fail('school_dispatch_claim_unavailable');
 const hold=await env.CONTROL_DB.prepare("SELECT h.reserved_seconds,t.display_name FROM tenant_minute_holds h JOIN provider_cost_reservations p ON p.tenant_id=h.tenant_id AND p.job_id=h.job_id JOIN tenants t ON t.id=h.tenant_id WHERE h.tenant_id=? AND h.job_id=? AND h.state='held' AND h.reserved_seconds=p.reserved_seconds AND t.status='active'").bind(row.tenant_id,row.job_id).first();
 const created=Date.parse(row.created_at),company=hold?.display_name;
 if(!hold||!Number.isSafeInteger(hold.reserved_seconds)||hold.reserved_seconds<30||hold.reserved_seconds>600||
  !Number.isFinite(created)||now<created||now>=created+(hold.reserved_seconds+25)*1000||
  typeof company!=='string'||!company.trim()||company.length>160||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(company))fail('school_voice_hold_unavailable');
 const scope=await readIndustryRecipientScope(env,{tenantId:row.tenant_id,campaignId:v.campaignId,leadId:row.lead_id,now});
 if(scope.snapshotId!==v.snapshotId||scope.digest!==v.graphSha256||scope.reviewRevision!==v.reviewRevision||
  scope.expiresAt!==v.reviewExpiresAt||scope.destination!==row.destination||scope.leadUpdatedAt!==row.lead_updated_at)fail('school_voice_scope_changed');
 const plan=await schoolVoicePlan(scope.graph,scope.digest);
 validateSchoolVoiceProgress(v,plan);
 await validateSchoolAudioPack(scope,v.manifest,v.manifestSha256);
 return {doc,v,scope,plan,company:company.trim(),deadline:Math.min(row.expires_at,created+(hold.reserved_seconds+25)*1000,Date.parse(scope.expiresAt))};
}
function notice(config,row,c){
 const hindi=row.language==='hi',text=hindi?
  'नमस्ते। मैं '+c.company+' की ओर से ए आर थ्री डी की ए आई सहायक हूँ। यह स्कूल एडमिशन संबंधी कॉल है। आपके जवाब रिकॉर्ड होकर सर्वम ए आई से प्रोसेस होंगे। कृपया निजी पहचान, बैंक या बच्चे की निजी जानकारी न दें। सहमति देकर आगे बढ़ने के लिए 1 दबाएँ। आगे कॉल नहीं चाहिए तो 2 दबाएँ।':
  'Hello. I am the AR3D AI assistant calling on behalf of '+c.company+' about school admissions. Short answers will be recorded and processed by Sarvam AI. Please do not share personal identity, banking or private child information. Press 1 to consent and continue, or 2 to opt out of future calls.';
 return xml('<GetDigits action="'+escape(href(config,row,'consent'))+'" method="GET" numDigits="1" retries="1" timeout="8">'+say(row.language,text)+'</GetDigits><Hangup/>');
}
async function mediaKey(config,uses){return crypto.subtle.importKey('raw',enc.encode(config.token),{name:'HMAC',hash:'SHA-256'},false,uses)}
function mediaPayload(row,node,expires){return 'ar3d:industry-school-media:v1:'+JSON.stringify([row.id,row.provider_call_id,row.turn,node,expires])}
async function mediaURL(config,row,node,now,deadline){
 const expires=Math.min(now+60000,deadline);
 if(!idRE.test(row.provider_call_id||'')||expires<=now)fail('school_voice_media_expired');
 const sig=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',await mediaKey(config,['sign']),enc.encode(mediaPayload(row,node,expires)))),b=>b.toString(16).padStart(2,'0')).join('');
 return href(config,row,'industry-audio/'+node+'.mp3')+'?'+new URLSearchParams({expires:String(expires),sig});
}
async function speechXML(config,row,c,now){
 if(row.hangup_at!==null||now>=c.deadline)return end();
 if(row.phase==='needs_review')return xml(say(row.language,row.language==='en'?'Thank you. Our team can review the information received. Goodbye.':'धन्यवाद। हमारी टीम प्राप्त जानकारी की समीक्षा कर सकती है। अलविदा।')+'<Hangup/>');
 if(row.phase==='declined')return xml(say(row.language,row.language==='en'?'Thank you for your time. Goodbye.':'आपके समय के लिए धन्यवाद। अलविदा।')+'<Hangup/>');
 if(row.phase!=='question'&&row.phase!=='completed')return end();
 const nodes=schoolVoiceNodes(c.plan,c.v);
 if(!nodes.length)return end();
 let body=row.phase==='question'&&c.v.attempt?say(row.language,row.language==='en'?'Please say that again.':'कृपया दोबारा बताइए।'):'';
 for(const n of nodes)body+='<Play>'+escape(await mediaURL(config,row,n,now,c.deadline))+'</Play>';
 if(row.phase==='question')body+='<Record action="'+escape(href(config,row,'turn/'+row.turn))+'" method="GET" fileFormat="mp3" maxLength="8" timeout="3" finishOnKey="#" playBeep="true"/>';
 return xml(body+'<Hangup/>');
}
async function latestRow(env,id){return env.CONTROL_DB.prepare('SELECT * FROM scripted_phone_pilots WHERE id=?').bind(id).first()}
function sameActiveRow(old,fresh){return !!fresh&&fresh.hangup_at===null&&fresh.phase===old.phase&&fresh.turn===old.turn&&fresh.survey_json===old.survey_json&&fresh.provider_call_id===old.provider_call_id}
export async function serveSchoolVoiceAudio(req,env,config,id,arg,now){
 const clock=clockFrom(now);
 try{
  const url=new URL(req.url),q=url.searchParams,node=/^([a-z][a-z0-9_]{0,31})\.mp3$/.exec(arg||'')?.[1];
  if(!node||[...q].length!==2||q.getAll('expires').length!==1||q.getAll('sig').length!==1)return error('school_audio_unavailable',404);
  const raw=q.get('expires'),sig=q.get('sig'),expires=Number(raw);
  if(!/^\d{13}$/.test(raw||'')||!Number.isSafeInteger(expires)||expires<=now||expires>now+60000||!digestRE.test(sig||''))return error('school_audio_unavailable',404);
  const row=await latestRow(env,id);
  if(!row||!isSchoolVoiceSession(row)||row.provider_account_id!==config.authId||row.caller!==config.caller||
    !idRE.test(row.provider_call_id||'')||!['question','completed'].includes(row.phase)||row.hangup_at!==null)return error('school_audio_unavailable',404);
  const valid=await crypto.subtle.verify('HMAC',await mediaKey(config,['verify']),Uint8Array.from(sig.match(/../g),x=>parseInt(x,16)),enc.encode(mediaPayload(row,node,expires)));
  if(!valid)return error('school_audio_unavailable',404);
  const c=await current(env,row,now);
  if(expires>c.deadline||!schoolVoiceNodes(c.plan,c.v).includes(node))return error('school_audio_unavailable',404);
  const bytes=await readSchoolAudioAsset(env.RECORDINGS,c.scope,{manifest:c.v.manifest,manifestSha256:c.v.manifestSha256},node);
  const fresh=await latestRow(env,id),after=clock();
  if(!sameActiveRow(row,fresh)||expires<=after)return error('school_audio_unavailable',404);
  await current(env,fresh,after);
  return new Response(bytes,{headers:{...headers,'Content-Type':'audio/mpeg','Content-Length':String(bytes.length)}});
 }catch{return error('school_audio_unavailable',404)}
}
async function markProviderFault(env,provider,status,row,now){
 if([401,402,403].includes(status))await recordProviderFault(env.CONTROL_DB,provider,status,'school:'+row.id+':'+row.turn,now);
 if(status===429&&provider==='sarvam')await signalProviderThrottle(env,'sarvam',now);
}
/** Only authenticated provider metadata can select the recording URL. No
 * callback URL is trusted, no redirects, and no repeat paid STT request. */
async function recognize(env,config,row,record,fetcher,ensure,now){
 const response=await fetcher('https://api.plivo.com/v1/Account/'+config.authId+'/Recording/'+record+'/',{
  method:'GET',headers:{Authorization:config.authorization},redirect:'manual',signal:AbortSignal.timeout(5000)});
 if(!response.ok){await markProviderFault(env,'plivo',response.status,row,now);fail('school_recording_metadata_unavailable')}
 const d=JSON.parse(new TextDecoder().decode(await readBoundedBytes(response,65536)));
 const duration=Number(d.recording_duration_ms);
 if(d.recording_id!==record||d.call_uuid!==row.provider_call_id||!['mp3','wav'].includes(d.recording_format)||
  !Number.isFinite(duration)||duration<=0||duration>8500||typeof d.recording_url!=='string'||d.recording_url.length>4096)fail('school_recording_mismatch');
 const url=new URL(d.recording_url),path='/v1/Account/'+config.authId+'/Recording/'+record+'.'+d.recording_format;
 if(!['https://media.plivo.com','https://aps1.media.plivo.com'].includes(url.origin)||url.pathname!==path||
    url.username||url.password||url.search||url.hash)fail('school_recording_url_invalid');
 await ensure();
 const media=await fetcher(url.href,{method:'GET',headers:{Authorization:config.authorization},redirect:'manual',signal:AbortSignal.timeout(5000)});
 if(!media.ok){await markProviderFault(env,'plivo',media.status,row,now);fail('school_recording_media_unavailable')}
 const type=answerContentType(media.headers);
 if(!supportsAnswerAudio(type))fail('school_recording_type_invalid');
 const bytes=await readBoundedBytes(media,ANSWER_MAX_BYTES);
 await ensure();
 try{
  const answer=await transcribeSarvamRecordedAnswer(env.SARVAM_API_KEY,bytes,row.language,type,fetcher);
  return {text:answer.text,durationMs:Math.ceil(duration),sttConfirmed:true};
 }catch(e){
  const code=speechFailureCode(e);
  if(/^sarvam_http_\d{3}$/.test(code))await markProviderFault(env,'sarvam',Number(code.slice(-3)),row,now);
  throw e;
 }
}
const targetMatches=(row,p)=>p.get('Direction')==='outbound'&&phone(p.get('To'))===phone(row.destination)&&phone(p.get('From'))===phone(row.caller);
const requestMatches=(row,p)=>{
 const a=p.get('ALegRequestUUID'),b=p.get('RequestUUID'),request=a||b;
 return idRE.test(request||'')&&(!a||!b||a===b)&&row.provider_request_id===request;
};
async function changePhase(env,row,phase,doc=row.survey_json){
 const raw=typeof doc==='string'?doc:JSON.stringify(doc);
 const changed=await env.CONTROL_DB.prepare("UPDATE scripted_phone_pilots SET phase=?,survey_json=? WHERE id=? AND phase=? AND turn=? AND survey_json=? AND hangup_at IS NULL").bind(phase,raw,row.id,row.phase,row.turn,row.survey_json).run();
 return changed.meta.changes===1?{...row,phase,survey_json:raw}:null;
}
/** Called ONLY by the existing signature-verified callback dispatcher.
 * No unauthenticated HTTP route or live session creator is exported.
 */
export async function handleSchoolVoiceCallback(env,config,row,step,arg,params,{now,fetcher,finishOptOut}){
 const clock=clockFrom(now),control=env.CONTROL_DB,call=params.get('CallUUID');
 if(!row.job_id||!idRE.test(call||''))return error('school_call_identity',403);
 // Signed callback may arrive before POST response or after loss of it.
 // Only an exact managed posting claim and signed outbound identity may bind.
 if(!row.provider_request_id&&!arg&&['answer','hangup'].includes(step)){
  let managed=false;try{managed=parse(row).phoneMeta.dispatchVersion===1}catch{}
  const a=params.get('ALegRequestUUID'),b=params.get('RequestUUID'),request=a||b;
  if(managed&&idRE.test(request||'')&&(!a||!b||a===b)&&targetMatches(row,params)&&
     await env.CRM_DB.prepare("SELECT 1 AS ok FROM industry_dispatch_releases WHERE tenant_id=? AND job_id=? AND session_id=? AND state IN('posting','submitted','unknown')").bind(row.tenant_id,row.job_id,row.id).first()){
   await control.prepare("UPDATE scripted_phone_pilots SET provider_request_id=? WHERE id=? AND provider_request_id IS NULL AND provider_call_id IS NULL AND phase IN('requested','unknown') AND hangup_at IS NULL").bind(request,row.id).run();
   row=await latestRow(env,row.id);
   if(!row)return end();
  }
 }
 if(step==='hangup'&&!arg){
  // Preserve signed termination evidence even if consent/enablement was revoked.
  if(row.provider_call_id?row.provider_call_id!==call:!requestMatches(row,params)||!targetMatches(row,params))return end();
  const seconds=params.get('Duration'),duration=/^\d{1,3}$/.test(seconds||'')?Number(seconds):null;
  await control.prepare("UPDATE scripted_phone_pilots SET hangup_at=COALESCE(hangup_at,?),duration_seconds=COALESCE(duration_seconds,?),provider_call_id=COALESCE(provider_call_id,?),phase=CASE WHEN phase='transcribing' THEN 'needs_review' WHEN phase IN('requested','unknown','consent','question') THEN 'ended' ELSE phase END WHERE id=? AND (provider_call_id IS NULL OR provider_call_id=?)")
   .bind(now,duration,call,row.id,call).run();
  if(row.phase==='suppressing')await finishOptOut(env,row,now);
  return new Response(null,{status:204,headers});
 }
 if(row.phase==='suppressing'&&row.provider_call_id===call)return finishOptOut(env,row,now);
 try{
  if(step==='answer'&&!arg){
   if(!row.provider_request_id)return error('school_request_binding_pending',503);
   if(!requestMatches(row,params)||!targetMatches(row,params))return error('school_call_identity',403);
   const c=await current(env,row,clock());
   if(await providerFaultBlocked(control))return end();
   if(row.provider_call_id)return row.provider_call_id===call&&row.phase==='consent'&&row.turn===0?notice(config,row,c):end();
   const claimed=await control.prepare("UPDATE scripted_phone_pilots SET provider_call_id=?,phase='consent' WHERE id=? AND phase IN('requested','unknown') AND provider_call_id IS NULL AND provider_request_id=? AND hangup_at IS NULL AND survey_json=?")
    .bind(call,row.id,row.provider_request_id,row.survey_json).run();
   return claimed.meta.changes===1?notice(config,{...row,provider_call_id:call,phase:'consent'},c):end();
  }
  // A signed keypad STOP on the bound call is suppression, not permission
  // to record or speak. Honor it even when a simultaneous hangup/revocation
  // invalidates normal continuation. CAS still binds the exact prior document.
  if(step==='consent'&&!arg&&params.get('Digits')==='2'&&row.provider_call_id===call&&row.turn===0&&['consent','ended','question'].includes(row.phase)){
   const prior=parse(row);
   const doc={...prior,industryVoice:{...prior.industryVoice,status:'opted_out'}},raw=JSON.stringify(doc);
   const saved=await control.prepare("UPDATE scripted_phone_pilots SET phase='suppressing',survey_json=? WHERE id=? AND provider_call_id=? AND turn=0 AND survey_json=? AND phase IN('consent','ended','question')")
    .bind(raw,row.id,call,row.survey_json).run();
   if(saved.meta.changes===1)return await finishOptOut(env,{...row,phase:'suppressing',survey_json:raw},now);
   const fresh=await latestRow(env,row.id);
   return fresh?.provider_call_id===call&&fresh.phase==='suppressing'?await finishOptOut(env,fresh,now):end();
  }
  if(row.provider_call_id!==call||row.hangup_at!==null)return end();
  const c=await current(env,row,clock());
  if(step==='consent'&&!arg){
   if(row.phase!=='consent')return row.phase==='question'&&row.turn===0&&params.get('Digits')==='1'?speechXML(config,row,c,clock()):end();
   const digit=params.get('Digits'),phase=digit==='1'?'question':'declined';
   if(phase==='question'&&await providerFaultBlocked(control))return end();
   const nextDoc={...c.doc,industryVoice:{...c.v,status:digit==='1'?'active':'declined'}};
   const next=await changePhase(env,row,phase,nextDoc);
   if(!next)return end();
   return phase==='question'?speechXML(config,next,{...c,doc:nextDoc,v:nextDoc.industryVoice},clock()):end();
  }
  if(step!=='turn'||!/^\d{1,2}$/.test(arg||''))return end();
  if(row.phase==='transcribing'&&Number(arg)===row.turn)return error('school_answer_processing',503);
  if(row.phase!=='question'||Number(arg)!==row.turn||c.v.status!=='active')return end();
  const record=params.get('RecordingID');
  if(!idRE.test(record||''))return end();
  const hash=await sha256hex('ar3d:school-recording:v1:'+record);
  if(c.v.recordings.includes(hash))return end();
  if(await providerFaultBlocked(control))return end();
  // Charge uncertainty is persisted BEFORE external work. A crash never permits
  // another STT for the same turn, and never understates metered provider cost.
  const pending={...c.doc,phoneMeta:{...c.doc.phoneMeta,sttFailedRequests:c.doc.phoneMeta.sttFailedRequests+1}};
  const claimed=await changePhase(env,row,'transcribing',pending);
  if(!claimed)return error('school_answer_processing',503);
  const ensure=async()=>{
   const fresh=await latestRow(env,row.id);
   if(!sameActiveRow(claimed,fresh))fail('school_voice_changed');
   await current(env,fresh,clock());
   if(await providerFaultBlocked(control))fail('school_provider_blocked');
  };
  let answer=null;
  try{await ensure();answer=await recognize(env,config,claimed,record,fetcher,ensure,clock())}catch{}
  let next=advanceSchoolVoice(c.plan,c.v,{recordingSha256:hash,text:answer?.text,technicalFailure:!answer});
  const meta={...pending.phoneMeta};
  if(answer?.sttConfirmed){
   meta.sttFailedRequests--;meta.sttRoundedSeconds+=Math.ceil(answer.durationMs/1000);meta.sttAudioMs+=answer.durationMs;
  }
  let active=true;
  try{await ensure()}catch{active=false}
  if(!active&&next.status!=='opted_out')next={...c.v,turn:next.turn,recordings:next.recordings,status:'needs_review'};
  const phase=next.status==='opted_out'?'suppressing':next.status==='active'?'question':next.status;
  const doc={...pending,industryVoice:next,phoneMeta:meta},raw=JSON.stringify(doc);
  // After hangup, only STOP can change a session to suppressing. The exact
  // pending document, call and turn prove this is the already-claimed answer.
  const predicate=phase==='suppressing'?
   "((phase='transcribing' AND hangup_at IS NULL) OR (phase='needs_review' AND hangup_at IS NOT NULL))":
   "phase='transcribing' AND hangup_at IS NULL";
  const saved=await control.prepare("UPDATE scripted_phone_pilots SET phase=?,survey_json=?,turn=? WHERE id=? AND provider_call_id=? AND turn=? AND survey_json=? AND "+predicate)
   .bind(phase,raw,next.turn,row.id,call,row.turn,claimed.survey_json).run();
  if(saved.meta.changes!==1){
   if(phase!=='suppressing'){
    // A late non-STOP answer cannot authorize continuation or save personal
    // responses. Preserve confirmed STT costs and the consumed turn only.
    const stopped={...pending,phoneMeta:meta,industryVoice:{...c.v,turn:next.turn,recordings:next.recordings,status:'needs_review'}};
    await control.prepare("UPDATE scripted_phone_pilots SET survey_json=?,turn=? WHERE id=? AND provider_call_id=? AND turn=? AND survey_json=? AND phase='needs_review' AND hangup_at IS NOT NULL")
     .bind(JSON.stringify(stopped),next.turn,row.id,call,row.turn,claimed.survey_json).run();
   }
   return end();
  }
  const after={...claimed,phase,survey_json:raw,turn:next.turn};
  if(phase==='suppressing')return finishOptOut(env,after,now);
  if(!active)return end();
  return speechXML(config,after,{...c,v:next,doc},clock());
 }catch{return end()}
}
