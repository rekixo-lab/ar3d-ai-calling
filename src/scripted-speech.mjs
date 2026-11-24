// One short answer at a time. Audio is forwarded only to Sarvam and discarded.
export const ANSWER_MAX_BYTES=524288;
const AUDIO_TYPES=new Set(['audio/wav','audio/x-wav','audio/mpeg']);

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

// Only fixed error categories. Never return raw
// provider error strings (which may contain speech or account information).
export function speechFailureCode(error){
 if(error?.message==='invalid_audio')return 'invalid_audio';
 if(['sarvam_not_configured','sarvam_invalid_response'].includes(error?.message))return error.message;
 if(typeof error?.message==='string'&&/^sarvam_http_[345]\d{2}$/.test(error.message))return error.message;
 if(['TimeoutError','AbortError'].includes(error?.name))return 'timeout';
 return 'provider_error_unclassified';
}

// Single speech provider. The credential remains a Worker secret.
export async function transcribeSarvamRecordedAnswer(key,bytes,language,contentType,fetcher=fetch){
 if(typeof key!=='string'||!key.trim()||key.length>512)throw Error('sarvam_not_configured');
 if(!bytes.length||bytes.length>ANSWER_MAX_BYTES||!['hi','en'].includes(language)||!['audio/mpeg','audio/wav','audio/x-wav'].includes(contentType))throw Error('invalid_audio');
 const form=new FormData();
 form.append('file',new Blob([bytes],{type:contentType}),contentType==='audio/mpeg'?'answer.mp3':'answer.wav');
 form.append('model','saaras:v4');form.append('language_code',language==='hi'?'hi-IN':'en-IN');form.append('mode','transcribe');
 const response=await fetcher('https://api.sarvam.ai/speech-to-text',{method:'POST',headers:{'api-subscription-key':key},body:form,redirect:'manual',signal:AbortSignal.timeout(10000)});
 if(!response.ok){try{await response.body?.cancel()}catch{}throw Error('sarvam_http_'+response.status)}
 const raw=JSON.parse(new TextDecoder().decode(await readBoundedBytes(response,65536)));
 if(typeof raw?.transcript!=='string')throw Error('sarvam_invalid_response');
 const text=raw.transcript.trim().replace(/\s+/g,' ');
 return {text:text&&text.length<=220?text:null,confidence:null};
}
