// One short answer at a time. Audio is forwarded to Workers AI and discarded.
export const ANSWER_MAX_BYTES=524288;
const MODEL='@cf/openai/whisper-large-v3-turbo';
const AUDIO_TYPES=new Set(['audio/webm','audio/ogg','audio/wav','audio/x-wav','audio/mpeg','audio/mp4']);

export function answerContentType(headers){
 return headers.get('content-type')?.split(';')[0].trim().toLowerCase();
}

export async function readBoundedBytes(message,max){
 if(Number(message.headers.get('content-length'))>max||!message.body)throw Error('invalid_body_size');
 const buffer=new Uint8Array(max),reader=message.body.getReader();
 let length=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   if(length+value.length>max){await reader.cancel();throw Error('invalid_body_size')}
   buffer.set(value,length);length+=value.length;
  }
 }finally{reader.releaseLock()}
 if(!length)throw Error('invalid_body_size');
 return buffer.subarray(0,length);
}

export function supportsAnswerAudio(type){return AUDIO_TYPES.has(type)}

export async function transcribeScriptedAnswer(ai,bytes,language,{vadFilter=true,initialPrompt=null}={}){
 if(!ai?.run)throw Error('speech_not_configured');
 if(!bytes.length||bytes.length>ANSWER_MAX_BYTES||!['hi','en'].includes(language))
  throw Error('invalid_audio');
 let binary='';
 for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 const result=await ai.run(MODEL,{audio:btoa(binary),task:'transcribe',language,vad_filter:vadFilter,...(typeof initialPrompt==='string'&&initialPrompt.length<=200?{initial_prompt:initialPrompt}:{})});
 const text=typeof result?.text==='string'?result.text.trim().replace(/\s+/g,' '):'';
 return text&&text.length<=220?text:null;
}

// Recorded-audio Nova-3 via the existing Workers AI binding. No new account or
// streaming socket required. Keep the actual container MIME type; no raw PCM
// encoding override. Do not log audio, recognition results or provider errors.
export async function transcribeNovaRecordedAnswer(ai,bytes,language,contentType){
 if(!ai?.run||!bytes.length||bytes.length>ANSWER_MAX_BYTES||!['hi','en'].includes(language)||!supportsAnswerAudio(contentType))throw Error('invalid_audio');
 let binary='';
 for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 const raw=await ai.run('@cf/deepgram/nova-3',{audio:{body:btoa(binary),contentType},language},{signal:AbortSignal.timeout(12000)});
 const alt=raw?.results?.channels?.[0]?.alternatives?.[0];
 if(typeof alt?.transcript!=='string')throw Error('invalid_nova_response');
 const text=alt.transcript.trim().replace(/\s+/g,' ');
 const confidence=typeof alt.confidence==='number'&&Number.isFinite(alt.confidence)&&alt.confidence>=0&&alt.confidence<=1?alt.confidence:null;
 return {text:text&&text.length<=220?text:null,confidence};
}
