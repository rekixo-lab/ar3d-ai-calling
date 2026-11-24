// Experimental server-side Saaras v4 realtime protocol probe.
// Not wired to a production route or call dispatch. Only an explicitly
// consented benchmark may send actual voice. No logging, fallback or redial.
// Reference: https://docs.sarvam.ai/api-reference/speech-to-text/transcribe/realtime/ws
const MAX_BYTES=18*8000;
const cleanText=v=>typeof v==='string'&&v.length<=220&&!/[\u0000-\u001f\u007f]/u.test(v)?v.trim().replace(/\s+/g,' '):null;
export async function openSarvamRealtimeSocket(key,language,fetcher=fetch){
 if(typeof key!=='string'||!key.trim()||key.length>512||!['hi','en'].includes(language))throw Error('invalid realtime configuration');
 const url=new URL('https://api.sarvam.ai/speech-to-text-realtime/ws');
 for(const [k,v] of Object.entries({model:'saaras:v4',language_code:language==='hi'?'hi-IN':'en-IN',mode:'transcribe',encoding:'mulaw',sample_rate:'8000',endpointing:'manual',stream_type:'balanced'}))url.searchParams.set(k,v);
 const response=await fetcher(url.toString(),{method:'GET',headers:{Upgrade:'websocket','api-subscription-key':key},redirect:'manual',signal:AbortSignal.timeout(5000)});
 if(response.status!==101||!response.webSocket?.accept)throw Error('realtime upgrade unavailable');
 return response.webSocket;
}
function base64(chunk){let binary='';for(const value of chunk)binary+=String.fromCharCode(value);return btoa(binary)}
// Test/replay only: send a bounded single utterance after session.begin, use
// final text only, and wait for correlated session.end billing. A disconnect
// or timeout never becomes a guessed success or a zero-charge assertion.
export function probeSarvamRealtime(socket,bytes,{timeoutMs=12000}={}){
 if(!(bytes instanceof Uint8Array)||bytes.length<160||bytes.length>MAX_BYTES||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw Error('invalid realtime audio');
 return new Promise(resolve=>{
  let done=false,id=null,final=null,sent=false,ending=false,started=Date.now(),finalMs=null;
  let timer;
  function finish(reason,billedAudioSeconds=null){
   if(done)return;done=true;clearTimeout(timer);
   try{socket.close(1000,'probe complete')}catch{}
   resolve({reason,text:reason==='recognized'?final:null,inputAudioMs:bytes.length/8,billedAudioSeconds,finalMs,providerSessionVerified:billedAudioSeconds!==null});
  }
  const send=(event,more={})=>socket.send(JSON.stringify({event,...more}));
  socket.addEventListener('message',event=>{
   if(done)return;
   try{
    if(typeof event.data!=='string'||event.data.length>16000)throw Error('bad message');
    const m=JSON.parse(event.data);
    if(m.event==='error'){finish('stream_service_failed');return}
    if(m.event==='session.begin'){
     if(id||typeof m.request_id!=='string'||m.request_id.length<1||m.request_id.length>160)throw Error('bad session');
     if(m.config&&(m.config.encoding!=='mulaw'||Number(m.config.sample_rate)!==8000||m.config.turn_detection!=='manual'||m.config.model!=='saaras:v4'))throw Error('wrong config');
     id=m.request_id;sent=true;send('speech_start');
     for(let i=0;i<bytes.length;i+=1600)send('audio_input',{audio:base64(bytes.subarray(i,i+1600))});
     send('speech_end');return;
    }
    if(m.event==='transcript.partial')return;
    if(m.event==='transcript.final'){
     if(!sent||m.utterance_idx!==0||ending)throw Error('unexpected final');
     final=cleanText(m.text);if(final===null)throw Error('bad final');
     finalMs=Date.now()-started;ending=true;send('end');return;
    }
    if(m.event==='session.end'){
     if(!id||m.request_id!==id||!ending)throw Error('unmatched session');
     const raw=m.audio_duration_s;
     if(!((typeof raw==='number'&&Number.isFinite(raw))||(typeof raw==='string'&&/^\d+(?:\.\d+)?$/.test(raw))))throw Error('unknown billing');
     const billed=Number(raw);if(billed<0||billed>60)throw Error('invalid billing');
     finish(final?'recognized':'speech_empty',billed);
    }
   }catch{finish('stream_protocol_invalid')}
  });
  socket.addEventListener('close',()=>finish('stream_disconnected'));
  socket.addEventListener('error',()=>finish('stream_service_failed'));
  timer=setTimeout(()=>finish('stream_final_timeout'),timeoutMs);
  try{socket.accept()}catch{finish('stream_connect_failed')}
 });
}
// Offline silence observation on raw 8 kHz mu-law; never trims live audio.
// Fixed conservative threshold and 300ms context padding are candidates for
// a recorded-data benchmark only, not an accuracy claim or billing estimate.
function mulawSample(byte){const u=(~byte)&255;const n=(((u&15)<<3)+132)<<((u>>4)&7);return (u&128)?132-n:n-132}
export function observeMulawSilence(bytes,{threshold=250,paddingMs=300}={}){
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_BYTES||!Number.isFinite(threshold)||threshold<1||threshold>32768||!Number.isInteger(paddingMs)||paddingMs<0||paddingMs>1000)throw Error('invalid silence observation');
 let first=-1,last=-1;
 for(let start=0;start<bytes.length;start+=160){
  const end=Math.min(start+160,bytes.length);let sum=0;
  for(let i=start;i<end;i++){const s=mulawSample(bytes[i]);sum+=s*s}
  if(Math.sqrt(sum/(end-start))>=threshold){if(first<0)first=start;last=end}
 }
 const left=first<0?0:Math.max(0,first-paddingMs*8),right=first<0?bytes.length:Math.min(bytes.length,last+paddingMs*8);
 return {inputMs:bytes.length/8,speechDetected:first>=0,candidateStartMs:left/8,candidateEndMs:right/8,candidateSavingsMs:(bytes.length-(right-left))/8,liveTrimApplied:false};
}
