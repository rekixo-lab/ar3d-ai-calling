// Exotel AgentStream Voicebot frame parser and emitters (PURE, no sockets).
// Protocol: https://developer.exotel.com/docs/agentstream/websocket-protocol
// NO media server is registered; no customer audio can enter this module from
// the deployed Worker until an independently approved transport is integrated.
const SID=/^[a-zA-Z0-9_-]{4,128}$/;
const integer=/^(?:0|[1-9]\d{0,11})$/;
const b64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const RATES=new Set([8000,16000,24000]);
const MAX_INPUT=150000;
function object(x){
  return x!==null&&typeof x==='object'&&!Array.isArray(x);
}
function seq(x){
  if(!(typeof x==='string'||Number.isSafeInteger(x))||!integer.test(String(x)))
    throw Error('invalid AgentStream sequence');
  const n=Number(x);
  if(!Number.isSafeInteger(n))throw Error('invalid AgentStream sequence');
  return n;
}
function known(x,fields){
  if(!object(x)||Object.keys(x).some(k=>!fields.includes(k)))
    throw Error('unsupported AgentStream event fields');
}
function sid(x){
  if(typeof x!=='string'||!SID.test(x))throw Error('invalid AgentStream session ID');
  return x;
}
export function unpackPcmPayload(encoded){
  if(typeof encoded!=='string'||!encoded||encoded.length>135000||
     encoded.length%4!==0||!b64.test(encoded))
    throw Error('invalid AgentStream PCM encoding');
  let bytes;
  try{
    const raw=atob(encoded);
    bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  }catch{throw Error('invalid AgentStream PCM base64')}
  if(bytes.length<3200||bytes.length>100000||bytes.length%320!==0)
    throw Error('unsupported AgentStream PCM chunk size');
  // The frame is raw 16-bit little endian, mono PCM; byte length must be even.
  return bytes;
}
export function packPcmPayload(pcm){
  if(!(pcm instanceof Uint8Array)||pcm.length<3200||pcm.length>100000||
     pcm.length%320!==0)throw Error('invalid AgentStream PCM frame');
  let encoded='';
  // Bounded chunking avoids large spread argument limits.
  for(let i=0;i<pcm.length;i+=4096)
    encoded+=String.fromCharCode(...pcm.subarray(i,i+4096));
  return btoa(encoded);
}
export function createExotelMediaSession(){
  let phase='new',streamSid=null,callSid=null,accountSid=null,rate=null,
    prevSeq=-1,prevTimestamp=-1,frames=0,pcmBytes=0,marks=0,dtmfEvents=0;
  function accept(input){
    const raw=typeof input==='string'?(()=>{
      if(input.length>MAX_INPUT)throw Error('oversized AgentStream input');
      return JSON.parse(input);
    })():input;
    if(!object(raw)||typeof raw.event!=='string')throw Error('invalid AgentStream event');
    if(phase==='stopped')throw Error('AgentStream session already stopped');
    const kind=raw.event;
    if(kind==='connected'){
      known(raw,['event','protocol','version']);
      if(phase!=='new')throw Error('duplicate AgentStream connection');
      phase='connected';return {kind,phase,executable:false};
    }
    if(phase==='new')throw Error('AgentStream connected event required');
    if(kind==='start'){
      known(raw,['event','sequence_number','stream_sid','start']);
      if(phase!=='connected')throw Error('AgentStream start out of order');
      known(raw.start,['stream_sid','call_sid','account_sid','from','to',
        'custom_parameters','media_format']);
      known(raw.start.media_format,['encoding','sample_rate','bit_rate']);
      const format=raw.start.media_format;
      const sampleRate=seq(format.sample_rate);
      if(format.encoding!=='audio/x-raw'||seq(format.bit_rate)!==16||
         !RATES.has(sampleRate))throw Error('unsupported AgentStream audio format');
      streamSid=sid(raw.stream_sid);callSid=sid(raw.start.call_sid);
      accountSid=sid(raw.start.account_sid);
      if(sid(raw.start.stream_sid)!==streamSid)
        throw Error('mismatched AgentStream start stream');
      const current=seq(raw.sequence_number);
      if(current<=prevSeq)throw Error('non-monotonic AgentStream sequence');
      prevSeq=current;rate=sampleRate;phase='active';
      return {kind,phase,sampleRate:rate,executable:false};
    }
    if(phase!=='active')throw Error('AgentStream start event required');
    known(raw,['event','sequence_number','stream_sid',kind]);
    if(sid(raw.stream_sid)!==streamSid)throw Error('cross-stream AgentStream frame');
    const current=seq(raw.sequence_number);
    if(current<=prevSeq)throw Error('replayed/out-of-order AgentStream sequence');
    // Bounded to avoid keeping a session alive endlessly.
    if(frames>=36000)throw Error('AgentStream session frame limit exceeded');
    let result;
    if(kind==='media'){
      known(raw.media,['chunk','timestamp','payload']);
      const timestamp=seq(raw.media.timestamp);
      const chunk=seq(raw.media.chunk);
      if(timestamp<prevTimestamp||chunk===0)
        throw Error('replayed AgentStream media timestamp');
      const pcm=unpackPcmPayload(raw.media.payload);
      if((timestamp>3600000)||pcmBytes+pcm.length>60000000)
        throw Error('AgentStream session media quota exceeded');
      prevTimestamp=timestamp;pcmBytes+=pcm.length;
      // Deliberately never return audio content to logs/browser/CRM.
      result={kind,bytes:pcm.length,phase,executable:false};
    }else if(kind==='dtmf'){
      known(raw.dtmf,['digit','duration']);
      if(!/^[0-9*#]$/.test(raw.dtmf.digit)||seq(raw.dtmf.duration)>10000)
        throw Error('invalid AgentStream DTMF event');
      dtmfEvents++;result={kind,phase,contentRecorded:false,executable:false};
    }else if(kind==='mark'){
      known(raw.mark,['name']);
      if(typeof raw.mark.name!=='string'||raw.mark.name.length>64||
         !/^[a-zA-Z0-9_-]+$/.test(raw.mark.name))
        throw Error('invalid AgentStream playback mark');
      marks++;result={kind,phase,executable:false};
    }else if(kind==='stop'){
      known(raw.stop,['call_sid','account_sid','reason']);
      if(sid(raw.stop.call_sid)!==callSid||
         sid(raw.stop.account_sid)!==accountSid||
         !['stopped','callended'].includes(raw.stop.reason))
        throw Error('invalid AgentStream stop event');
      phase='stopped';result={kind,phase,executable:false};
    }else throw Error('unsupported AgentStream inbound event');
    frames++;prevSeq=current;
    return Object.freeze(result);
  }
  function summary(){
    return Object.freeze({
      phase,sampleRate:rate,processedFrames:frames,pcmBytes,marks,dtmfEvents,
      audioStored:false,transcriptsCreated:false,mediaNetworkConnected:false,
      realCallsStarted:0,billable:false
    });
  }
  // No side-effecting or network code is exposed.
  return Object.freeze({accept,summary});
}
export function makeExotelOutboundAudioFrame(streamSid,pcm){
  return Object.freeze({event:'media',stream_sid:sid(streamSid),
    media:Object.freeze({payload:packPcmPayload(pcm)})});
}
export function makeExotelOutboundMark(streamSid,name){
  if(typeof name!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(name))
    throw Error('invalid Exotel output mark');
  return Object.freeze({event:'mark',stream_sid:sid(streamSid),mark:Object.freeze({name})});
}
export function makeExotelOutboundClear(streamSid){
  return Object.freeze({event:'clear',stream_sid:sid(streamSid)});
}
