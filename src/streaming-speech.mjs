// Per-answer live audio bridge. No recordings, raw transcripts or credentials
// are persisted here. The caller has already been pre-consented and notified.
const MAX_BYTES=18*8000;
export async function streamToken(secret,row){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(['ar3d-stream-v2',row.id,row.provider_call_id,row.turn,row.expires_at].join(':')));
 return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function validStreamToken(secret,row,token){
 if(!/^[a-f0-9]{64}$/.test(token||''))return false;
 const expected=await streamToken(secret,row);
 let diff=0;for(let i=0;i<64;i++)diff|=expected.charCodeAt(i)^token.charCodeAt(i);
 return diff===0;
}
export async function openNovaSocket(ai,language){
 // Cloudflare Workers AI websocket transport, not a public Deepgram API key.
 const resp=await ai.run('@cf/deepgram/nova-3',{
  encoding:'mulaw',sample_rate:'8000',channels:'1',language:language==='hi'?'hi':'en-IN',
  interim_results:'true',endpointing:'1200',punctuate:'false',smart_format:'false'
 },{websocket:true});
 const ws=resp?.webSocket;
 if(!ws||typeof ws.accept!=='function')throw Error('stream_upgrade_failed');
 return ws;
}
const parse=raw=>typeof raw==='string'&&raw.length<=16000?JSON.parse(raw):null;
const close=ws=>{try{ws?.close(1000,'turn complete')}catch{}};
function decode(payload){
 if(typeof payload!=='string'||payload.length>4400||!/^[A-Za-z0-9+/]+={0,2}$/.test(payload))throw Error('invalid media');
 const raw=atob(payload);if(!raw.length||raw.length>3200)throw Error('invalid media');
 return Uint8Array.from(raw,c=>c.charCodeAt(0)).buffer;
}
export function bridgePlivoTurn(socket,{accountId,callId,language,connect,onAnswer,maxMs=18000,finalMs=2000,setupMs=6500}){
 let upstream=null,streamId=null,finished=false,started=false,bytes=0,lastChunk=0,queue=[],parts=[],confidence=1,flushing=false;
 let deadline,flushTimer,setupTimer,firstAudioTimer;
 let connected=false;
 const finish=async(text,reason)=>{
  if(finished)return;finished=true;
  clearTimeout(deadline);clearTimeout(flushTimer);clearTimeout(setupTimer);clearTimeout(firstAudioTimer);
  queue=[];parts=[];close(upstream);
  try{await onAnswer({text,reason,confidence,audioMs:Math.floor(bytes/8),streamStarted:started,sttConnected:connected})}catch{/* signed next callback fails closed or recovers */}
  finally{close(socket)}
 };
 function finalText(){
  const text=parts.join(' ').trim().replace(/\s+/g,' ');
  return text&&text.length<=220?text:null;
 }
 function finalize(){
  if(finished||flushing)return;flushing=true;
  if(!upstream){void finish(null,started?'stream_connect_failed':'stream_start_missing');return}
  try{upstream.send(JSON.stringify({type:'Finalize'}))}
  catch{void finish(null,'stream_service_failed');return}
  flushTimer=setTimeout(()=>{const text=finalText();void finish(text,text?'recognized':bytes?'stream_final_timeout':'stream_no_audio')},finalMs);
 }
 async function start(){
  setupTimer=setTimeout(()=>void finish(null,'stream_connect_failed'),setupMs);
  try{
   const ws=await connect(language);
   if(finished){try{ws.accept()}catch{}close(ws);return}
   upstream=ws;
   ws.addEventListener('message',event=>{
    if(finished)return;
    try{
     const m=parse(event.data);if(!m)return;
     if(m.type==='Error'||m.error){void finish(null,'stream_service_failed');return}
     if(m.type!=='Results')return;
     const a=m.channel?.alternatives?.[0];
     if(m.is_final===true&&typeof a?.transcript==='string'&&a.transcript.trim()){
      parts.push(a.transcript.trim());if(parts.join(' ').length>220){void finish(null,'speech_unrecognized');return}
      if(Number.isFinite(a.confidence)&&a.confidence>=0&&a.confidence<=1)confidence=Math.min(confidence,a.confidence);
     }
     if(bytes>0&&(m.speech_final===true||(flushing&&m.from_finalize===true))){
      const text=finalText();
      if(text||flushing)void finish(text,text?'recognized':'speech_empty');
     }
    }catch{void finish(null,'stream_service_failed')}
   });
   ws.addEventListener('close',()=>{if(!finished)void finish(null,'stream_service_failed')});
   ws.addEventListener('error',()=>void finish(null,'stream_service_failed'));
   ws.accept();connected=true;clearTimeout(setupTimer);
   for(const chunk of queue)ws.send(chunk);
   queue=[];
   if(flushing)ws.send(JSON.stringify({type:'Finalize'}));
  }catch{void finish(null,'stream_connect_failed')}
 }
 socket.addEventListener('message',event=>{
  if(finished||flushing)return;
  try{
   const m=parse(event.data);if(!m)throw Error('invalid event');
   if(m.event==='start'){
    const s=m.start;
    if(started||s?.callId!==callId||s?.accountId!==accountId||typeof s.streamId!=='string'||
       !/^[a-zA-Z0-9-]{8,80}$/.test(s.streamId)||s.mediaFormat?.encoding!=='audio/x-mulaw'||
       Number(s.mediaFormat?.sampleRate)!==8000||!Array.isArray(s.tracks)||s.tracks.length!==1||s.tracks[0]!=='inbound')
     throw Error('invalid start');
    started=true;streamId=s.streamId;void start();return;
   }
   if(m.event==='stop'){finalize();return}
   if(m.event!=='media')return;
   if(!started||m.streamId!==streamId||m.media?.track!=='inbound')throw Error('invalid stream');
   const chunk=Number(m.media.chunk);
   if(!Number.isSafeInteger(chunk)||chunk<1)throw Error('invalid chunk');
   if(chunk<=lastChunk)return;
   lastChunk=chunk;
   const data=decode(m.media.payload);
   if(bytes+data.byteLength>MAX_BYTES){finalize();return}
   if(bytes===0){clearTimeout(firstAudioTimer);deadline=setTimeout(finalize,maxMs)}
   bytes+=data.byteLength;
   if(upstream)upstream.send(data);
   else {if(queue.length>=250)throw Error('buffer limit');queue.push(data)}
  }catch{void finish(null,'stream_protocol_invalid')}
 });
 socket.addEventListener('close',()=>{if(!finished)void finish(null,'stream_disconnected')});
 socket.addEventListener('error',()=>void finish(null,'stream_disconnected'));
 firstAudioTimer=setTimeout(()=>void finish(null,started?'stream_no_audio':'stream_start_missing'),setupMs+2000);
 socket.accept();
}
export function upgradePlivoTurn(args){
 const pair=new WebSocketPair();
 bridgePlivoTurn(pair[1],args);
 return new Response(null,{status:101,webSocket:pair[0]});
}
