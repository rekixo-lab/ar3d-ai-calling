// Phase 3E: isolated staging voice route candidate. NOT mounted by src/index.mjs.
// The first actual use must be one explicitly consented staff test, not a campaign.
import {SCHOOL_CALLBACK_PATH,verifySchoolPlivoGet} from './school-pilot-readiness.mjs';
import {acceptSchoolProviderCallback} from './school-pilot-provider-evidence.mjs';
import {pilotSha,readActiveSchoolPermit} from './school-internal-permits.mjs';
import {schoolStageConfig,stageCallback,linearSchoolNodes,readVerifiedStageAudio} from './school-stage-dispatch.mjs';
import {ANSWER_MAX_BYTES,answerContentType,readBoundedBytes,supportsAnswerAudio,transcribeSarvamRecordedAnswer} from './scripted-speech.mjs';

export const SCHOOL_STAGE_AUDIO_PATH='/v1/provider/plivo/school-stage-audio';
const enc=new TextEncoder();
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const safeRecord=x=>typeof x==='string'&&/^[a-zA-Z0-9-]{10,100}$/.test(x);
const e164=x=>typeof x==='string'&&/^\+?[1-9][0-9]{7,14}$/.test(x)?(x.startsWith('+')?x:'+'+x):null;
const fail=x=>{throw Error(x)};
const esc=x=>x.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const xml=x=>new Response('<?xml version="1.0" encoding="UTF-8"?><Response>'+x+'</Response>',{headers:{...headers,'Content-Type':'application/xml; charset=utf-8'}});
const end=()=>xml('<Hangup/>');
const denied=(status=403)=>new Response(null,{status,headers});
const play=u=>'<Play>'+esc(u)+'</Play>';
async function stageRow(db,id,c){
 const row=await db.prepare('SELECT d.*,e.request_uuid,e.call_uuid,e.ended FROM school_stage_dispatches d LEFT JOIN school_internal_provider_evidence e ON e.permit_id=d.permit_id WHERE d.permit_id=? AND d.provider_account=?').bind(id,c.authId).first();
 if(!row)fail('school_stage_not_found');
 return row;
}
async function active(env,row,now){
 if(row.dispatch_state!=='submitted'||row.ended||now>=row.claimed_at+(row.max_seconds+15)*1000)fail('school_stage_closed');
 const f=await readActiveSchoolPermit(env,row.tenant_id,row.permit_id,now);
 if(f.row.audio_state!=='ready'||f.row.manifest_sha256!==row.manifest_sha256)fail('school_stage_closed');
 return f;
}
function bound(q,row,f){
 return uuid(row.call_uuid)&&q.get('CallUUID')===row.call_uuid&&
  (!q.has('RequestUUID')||q.get('RequestUUID')===row.request_uuid)&&
  (!q.has('Direction')||q.get('Direction')==='outbound')&&
  (!q.has('From')||e164(q.get('From'))===f.target.caller)&&
  (!q.has('To')||e164(q.get('To'))===f.target.recipient);
}
function scopedEnv(env,c){return {...env,AR3D_SCHOOL_PILOT_ORIGIN:c.origin,PLIVO_AUTH_TOKEN:c.token,
 AR3D_SCHOOL_PILOT_LIVE_ENABLED:env.AR3D_SCHOOL_STAGE_ENABLED}}
async function mediaKey(c,uses){return crypto.subtle.importKey('raw',enc.encode(c.mediaSecret),{name:'HMAC',hash:'SHA-256'},false,uses)}
const mediaPayload=(id,call,node,turn,expires)=>'ar3d:school-stage-media:v1:'+JSON.stringify([id,call,node,turn,expires]);
async function audioURL(c,row,node,now){
 const expires=Math.min(row.claimed_at+(row.max_seconds+15)*1000,now+60000);
 const sig=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',await mediaKey(c,['sign']),enc.encode(mediaPayload(row.permit_id,row.call_uuid,node,row.turn,expires)))),b=>b.toString(16).padStart(2,'0')).join('');
 return c.origin+SCHOOL_STAGE_AUDIO_PATH+'?'+new URLSearchParams({permitId:row.permit_id,call:row.call_uuid,node,turn:String(row.turn),expires:String(expires),sig});
}
function mediaAllowed(row,nodes,node){
 return row.phase==='question'&&(node===nodes.questions[row.turn]?.id||(row.turn===0&&node===nodes.greeting.id))||
  row.phase==='finished'&&node===nodes.closing.id;
}
async function questionXML(c,row,f,now){
 const n=linearSchoolNodes(f.graph);
 if(row.phase!=='question'||!n.questions[row.turn])return end();
 let prefix='';
 if(row.turn===0)prefix+=play(await audioURL(c,row,n.greeting.id,now));
 prefix+=play(await audioURL(c,row,n.questions[row.turn].id,now));
 return xml(prefix+'<Record action="'+esc(stageCallback(c,row.permit_id,'turn',row.turn))+
  '" method="GET" fileFormat="mp3" maxLength="8" timeout="3" finishOnKey="#" playBeep="true"/><Hangup/>');
}
async function closingXML(c,row,f,now){
 return xml(play(await audioURL(c,row,linearSchoolNodes(f.graph).closing.id,now))+'<Hangup/>');
}
async function privateAudio(req,env,c,now){
 try{
  const q=new URL(req.url).searchParams,ks=['permitId','call','node','turn','expires','sig'];
  if(req.method!=='GET'||[...q].length!==ks.length||ks.some(k=>q.getAll(k).length!==1))return denied();
  const id=q.get('permitId'),call=q.get('call'),node=q.get('node'),turn=Number(q.get('turn')),expires=Number(q.get('expires')),sig=q.get('sig');
  if(!uuid(id)||!uuid(call)||!/^[a-z][a-z0-9_]{0,31}$/.test(node||'')||!Number.isInteger(turn)||turn<0||turn>3||
   !Number.isSafeInteger(expires)||expires<=now||expires>now+60000||!/^[a-f0-9]{64}$/.test(sig||''))return denied();
  const verified=await crypto.subtle.verify('HMAC',await mediaKey(c,['verify']),Uint8Array.from(sig.match(/../g),x=>parseInt(x,16)),
   enc.encode(mediaPayload(id,call,node,turn,expires)));
  if(!verified)return denied();
  const row=await stageRow(env.CONTROL_DB,id,c),f=await active(env,row,now);
  if(row.call_uuid!==call||row.turn!==turn||!mediaAllowed(row,linearSchoolNodes(f.graph),node))return denied();
  const bytes=await readVerifiedStageAudio(env,row.tenant_id,f,node);
  return new Response(bytes,{headers:{...headers,'Content-Type':'audio/mpeg','Content-Length':String(bytes.length)}});
 }catch{return denied()}
}
// Only authenticated exact provider metadata, not caller-supplied RecordUrl,
// can select recording media. No recording/transcript stored by this runtime.
async function recognize(c,record,call,language,fetcher){
 const meta=await fetcher('https://api.plivo.com/v1/Account/'+c.authId+'/Recording/'+record+'/',{
  headers:{Authorization:c.authorization},redirect:'manual',signal:AbortSignal.timeout(5000)});
 if(!meta.ok)fail('school_stage_recording_unavailable');
 const d=JSON.parse(new TextDecoder().decode(await readBoundedBytes(meta,65536)));
 const duration=Number(d.recording_duration_ms);
 if(d.recording_id!==record||d.call_uuid!==call||d.recording_type!=='normal'||
  !['mp3','wav'].includes(d.recording_format)||!Number.isFinite(duration)||duration<250||duration>8500)fail('school_stage_recording_mismatch');
 const u=new URL(d.recording_url),path='/v1/Account/'+c.authId+'/Recording/'+record+'.'+d.recording_format;
 if(!['https://media.plivo.com','https://aps1.media.plivo.com'].includes(u.origin)||u.pathname!==path||
  u.username||u.password||u.hash||u.search)fail('school_stage_recording_url_invalid');
 const media=await fetcher(u.href,{headers:{Authorization:c.authorization},redirect:'manual',signal:AbortSignal.timeout(5000)});
 if(!media.ok||!supportsAnswerAudio(answerContentType(media.headers)))fail('school_stage_recording_unavailable');
 const bytes=await readBoundedBytes(media,ANSWER_MAX_BYTES);
 const result=await transcribeSarvamRecordedAnswer(c.sttKey,bytes,language==='en'?'en':'hi',answerContentType(media.headers),fetcher);
 // Internal connectivity test only: no raw speech retained; explicit stop words end.
 const text=result.text?.trim();
 if(!text||text.length>160)return false;
 if(/^(stop|no|not interested|do not call|नहीं|ना|बंद करो|मत कॉल करो)[.!।]?$/iu.test(text))return false;
 return true;
}
export async function handleSchoolStageRequest(req,env,{clock=Date.now,fetcher=fetch}={}){
 const u=new URL(req.url);
 if(![SCHOOL_CALLBACK_PATH,SCHOOL_STAGE_AUDIO_PATH].includes(u.pathname))return null;
 try{
  const q=u.searchParams,step=q.get('step'),isHangup=u.pathname===SCHOOL_CALLBACK_PATH&&step==='hangup';
  const c=schoolStageConfig(env,{forStop:isHangup});
  if(u.origin!==c.origin)return denied();
  if(u.pathname===SCHOOL_STAGE_AUDIO_PATH)return privateAudio(req,env,c,clock());
  if(!await verifySchoolPlivoGet(req,{origin:c.origin,token:c.token}))return denied();
  const id=q.get('permitId');
  if(!uuid(id)||!['answer','hangup','consent','turn'].includes(step))return end();
  const db=env.CONTROL_DB,now=clock(),row=await stageRow(db,id,c);
  if(row.dispatch_state==='claimed'&&['answer','hangup'].includes(step))return denied(503);
  if(row.dispatch_state!=='submitted')return end();
  if(step==='hangup'){
   await acceptSchoolProviderCallback(req,scopedEnv(env,c),{now});
   await db.prepare("UPDATE school_stage_dispatches SET phase='ended' WHERE permit_id=? AND phase<>'ended'").bind(id).run();
   return new Response(null,{status:204,headers});
  }
  const f=await active(env,row,now);
  if(step==='answer'){
   const evidence=await acceptSchoolProviderCallback(req,scopedEnv(env,c),{now});
   if(evidence.ended)return end();
   const claimed=await db.prepare("UPDATE school_stage_dispatches SET phase='consent' WHERE permit_id=? AND phase='waiting' AND EXISTS(SELECT 1 FROM school_internal_pilot_permits p WHERE p.id=permit_id AND p.stopped_at IS NULL AND p.expires_at>?)").bind(id,now).run();
   if(claimed.meta.changes!==1)return end();
   const notice=f.graph.language==='en'?'This is an internal AI school test. Your short answers will be recorded and processed by Sarvam AI. Use fictional answers only. Press 1 to consent or any other key to stop.':'यह स्कूल ए आई का आंतरिक परीक्षण है। आपके छोटे जवाब रिकॉर्ड होकर सर्वम ए आई से प्रोसेस होंगे। केवल काल्पनिक जवाब दें। सहमति के लिए एक दबाएँ, अन्यथा कॉल बंद करें।';
   return xml('<GetDigits action="'+esc(stageCallback(c,id,'consent'))+'" method="GET" numDigits="1" retries="1" timeout="8"><Speak language="'+(f.graph.language==='en'?'en-IN':'hi-IN')+'" voice="Polly.Aditi">'+esc(notice)+'</Speak></GetDigits><Hangup/>');
  }
  if(!bound(q,row,f))return denied();
  if(step==='consent'){
   const yes=q.get('Digits')==='1',phase=yes?'question':'ended';
   const changed=await db.prepare("UPDATE school_stage_dispatches SET phase=? WHERE permit_id=? AND phase='consent' AND EXISTS(SELECT 1 FROM school_internal_pilot_permits p WHERE p.id=permit_id AND p.stopped_at IS NULL AND p.expires_at>?)").bind(phase,id,now).run();
   return changed.meta.changes===1&&yes?questionXML(c,{...row,phase},f,now):end();
  }
  const rawTurn=q.get('turn'),record=q.get('RecordingID');
  if(!/^[0-2]$/.test(rawTurn||'')||Number(rawTurn)!==row.turn||row.phase!=='question'||!safeRecord(record))return end();
  const seen=JSON.parse(row.recordings_json),hash=await pilotSha(record);
  if(seen.includes(hash)||seen.length!==row.turn)return end();
  const lock=await db.prepare("UPDATE school_stage_dispatches SET phase='processing',recordings_json=? WHERE permit_id=? AND phase='question' AND turn=? AND recordings_json=? AND EXISTS(SELECT 1 FROM school_internal_pilot_permits p WHERE p.id=permit_id AND p.stopped_at IS NULL AND p.expires_at>?)")
   .bind(JSON.stringify([...seen,hash]),id,row.turn,row.recordings_json,now).run();
  if(lock.meta.changes!==1)return end();
  let ok=false;
  try{await active(env,row,clock());ok=await recognize(c,record,row.call_uuid,f.graph.language,fetcher)}catch{}
  let valid=false;try{await active(env,row,clock());valid=true}catch{}
  const nextTurn=row.turn+1,nodes=linearSchoolNodes(f.graph),phase=ok&&valid?(nextTurn===nodes.questions.length?'finished':'question'):'ended';
  const changed=await db.prepare("UPDATE school_stage_dispatches SET phase=?,turn=? WHERE permit_id=? AND phase='processing' AND turn=?")
   .bind(phase,nextTurn,id,row.turn).run();
  if(changed.meta.changes!==1||phase==='ended')return end();
  // Recheck revocation before sending any new playback or recording command.
  const next={...row,phase,turn:nextTurn};
  try{await active(env,next,clock())}catch{return end()}
  return phase==='finished'?closingXML(c,next,f,clock()):questionXML(c,next,f,clock());
 }catch{return u.pathname===SCHOOL_STAGE_AUDIO_PATH?denied():end()}
}
