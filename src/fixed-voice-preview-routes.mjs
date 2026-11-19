// Authenticated browser-only preview of seven fixed Hindi/English questions.
// Transcripts are NOT trusted provider transcripts and never touch D1/R2.
import {beginFixedVoicePreview,advanceFixedVoicePreview} from './fixed-voice-turns.mjs';
import {parseJsonBody} from './core.mjs';
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
export async function handleFixedVoicePreviewRequest(req){
  if(new URL(req.url).pathname!==PATH)return null;
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
      return reply(advanceFixedVoicePreview(value.state,{
        transcript:value.transcript,confidence:value.confidence??1
      }));
    }
    throw Error('invalid voice preview action');
  }catch{
    // No raw transcripts, user data or vendor content in errors/logs.
    return reply({error:'invalid or expired voice preview; restart the demo'},400);
  }
}
