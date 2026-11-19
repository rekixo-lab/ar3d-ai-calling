// Offline 100-frame AgentStream compatibility run. Exactly no websocket,
// speech engine, microphone, customer lead, provider API or database touch.
import {createExotelMediaSession,packPcmPayload,unpackPcmPayload,
 makeExotelOutboundAudioFrame,makeExotelOutboundMark,
 makeExotelOutboundClear} from './exotel-media-protocol.mjs';
export function runExotelMediaHarness(options={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||
     Object.keys(options).some(k=>!['frames','sampleRate'].includes(k)))
    throw Error('invalid AgentStream harness input');
  const {frames=100,sampleRate=8000}=options;
  if(!Number.isSafeInteger(frames)||frames<1||frames>100||
     ![8000,16000,24000].includes(sampleRate))
    throw Error('invalid AgentStream harness settings');
  const stream='MZfictionalstream001',call='CAfictionalcall001',
    account='ACfictionalaccount001';
  const session=createExotelMediaSession();
  session.accept({event:'connected'});
  session.accept({event:'start',stream_sid:stream,sequence_number:'1',
    start:{stream_sid:stream,call_sid:call,account_sid:account,
      media_format:{encoding:'audio/x-raw',sample_rate:String(sampleRate),bit_rate:'16'}}});
  const payload=new Uint8Array(3200);
  for(let i=0;i<frames;i++){
    for(let j=0;j<payload.length;j+=2){
      const s=Math.round(Math.sin((i*1600+j/2)*2*Math.PI*440/sampleRate)*1200);
      payload[j]=s&255;payload[j+1]=(s>>8)&255;
    }
    const incoming={event:'media',stream_sid:stream,sequence_number:String(i+2),
      media:{chunk:String(i+1),timestamp:String(i*200),payload:packPcmPayload(payload)}};
    const check=session.accept(incoming);
    if(check.bytes!==payload.byteLength)throw Error('AgentStream test frame mismatch');
    const outgoing=makeExotelOutboundAudioFrame(stream,payload);
    const reloaded=unpackPcmPayload(outgoing.media.payload);
    if(reloaded.length!==payload.length||
       reloaded.some((n,index)=>n!==payload[index]))
      throw Error('AgentStream PCM round trip failed');
  }
  makeExotelOutboundMark(stream,'fictional-end');
  makeExotelOutboundClear(stream);
  session.accept({event:'stop',stream_sid:stream,sequence_number:String(frames+2),
    stop:{call_sid:call,account_sid:account,reason:'callended'}});
  const result=session.summary();
  if(result.phase!=='stopped'||result.processedFrames!==frames+1)
    throw Error('AgentStream session not closed');
  return Object.freeze({
    mode:'offline_agentstream_protocol',frames,sampleRate,
    inboundBytes:result.pcmBytes,decodedFrames:frames,encodedFrames:frames,
    stopVerified:true,sequenceVerified:true,
    status:'protocol_test_only',mediaServerListening:false,
    websocketConnections:0,sttCalls:0,ttsCalls:0,llmCalls:0,
    realCallsStarted:0,customerDataRead:false,
    recordingsSaved:0,providerRequests:0,billable:false,
    notice:'Real-format bidirectional PCM packets round-tripped in memory only. No live WSS, STT, TTS, LLM, Exotel account or telephone call.'
  });
}
