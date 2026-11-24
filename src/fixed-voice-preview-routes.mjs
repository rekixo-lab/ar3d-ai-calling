// Authenticated browser-only preview of seven fixed Hindi/English questions.
// Transcripts are NOT trusted provider transcripts and never touch D1/R2.
import {beginFixedVoicePreview,advanceInternalVoice} from './fixed-voice-turns.mjs';
import {parseJsonBody} from './core.mjs';
import {requireMembership,mutationOriginAllowed} from './human-auth.mjs';
import {ANSWER_MAX_BYTES,answerContentType,readBoundedBytes,supportsAnswerAudio,transcribeSarvamRecordedAnswer} from './scripted-speech.mjs';
const PATH='/v1/human/voice-preview';
const MAX_REQUEST=8192;
const reply=(data,status=200)=>Response.json(data,{status,headers:{
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'
}});
async function bounded(req){
  if(Number(req.headers.get('content-length'))>MAX_REQUEST||!req.body)
    throw Error('voice preview request too large or missing');
  const dec=new TextDecoder('utf-8',{fatal:true}),reader=req.body.getReader();
  let bytes=0,raw='';
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_REQUEST){await reader.cancel();throw Error('voice preview request too large')}
      raw+=dec.decode(value,{stream:true});
    }
    raw+=dec.decode();
  }finally{reader.releaseLock()}
  return parseJsonBody(raw,MAX_REQUEST);
}
export async function handleFixedVoicePreviewRequest(req,env,user,{fetcher=fetch}={}){
  const {pathname,searchParams}=new URL(req.url);
  if(pathname===PATH+'/transcribe'){
    if(req.method!=='POST')return reply({error:'method not allowed'},405);
    const language=searchParams.get('language');
    if(!['hi','en'].includes(language)||!supportsAnswerAudio(answerContentType(req.headers)))
      return reply({error:'invalid answer audio or language'},400);
    if(!await requireMembership(env.CONTROL_DB,user,searchParams.get('tenantId'),true))
      return reply({error:'forbidden'},403);
    if(!mutationOriginAllowed(req)||req.headers.get('X-AR3D-Speech-Consent')!=='sarvam')return reply({error:'explicit Sarvam processing consent required'},403);
    if(typeof env.SARVAM_API_KEY!=='string'||!env.SARVAM_API_KEY.trim())return reply({error:'Sarvam transcription is not configured'},503);
    let audio;
    try{audio=await readBoundedBytes(req,ANSWER_MAX_BYTES)}
    catch{return reply({error:'Use a short recorded answer (up to 512 KiB)'},400)}
    try{
      const {text}=await transcribeSarvamRecordedAnswer(env.SARVAM_API_KEY,audio,language,answerContentType(req.headers),fetcher);
      return reply({text,reviewRequired:true});
    }catch{return reply({error:'Transcription failed. Try again or type the answer.'},502)}
  }
  if(pathname!==PATH)return null;
  if(req.method!=='POST')return reply({error:'method not allowed'},405);
  try{
    const value=await bounded(req);
    if(value.action==='start'){
      if(Object.keys(value).some(k=>!['action','language'].includes(k)))
        throw Error('invalid voice preview start');
      return reply(beginFixedVoicePreview({language:value.language??'hi'}));
    }
    if(value.action==='turn'){
      if(Object.keys(value).some(k=>!['action','state','transcript','confidence'].includes(k)))
        throw Error('invalid voice preview turn');
      return reply((await advanceInternalVoice(null,value.state,{
        transcript:value.transcript,confidence:value.confidence??1
      })).result);
    }
    throw Error('invalid voice preview action');
  }catch{
    // No raw transcripts, user data or vendor content in errors/logs.
    return reply({error:'invalid or expired voice preview; restart the demo'},400);
  }
}
