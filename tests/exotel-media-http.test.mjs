import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {createExotelMediaSession,unpackPcmPayload,packPcmPayload,
  makeExotelOutboundAudioFrame,makeExotelOutboundMark,
  makeExotelOutboundClear} from '../src/exotel-media-protocol.mjs';
import {prepareExotelConnectRequest,summarizeUntrustedExotelConnectResponse,
  submitExotelConnect} from '../src/exotel-http-preparation.mjs';
import {correlateUnverifiedExotelCallback} from '../src/exotel-callback-correlation.mjs';
import {runExotelMediaHarness} from '../src/exotel-media-harness.mjs';

const stream='MZfictionalstream002',call='CAfictionalcall002',
      account='ACfictionalaccount002';
const url='https://aicalling.ar3dstudio.in';
const cookie='ar3d_calling_session='+'a'.repeat(64);
const pcm=Uint8Array.from({length:3200},(_,i)=>i%256);
const frame=(seq,ts,extra={})=>({
  event:'media',sequence_number:String(seq),stream_sid:stream,
  media:{chunk:String(seq),timestamp:String(ts),payload:packPcmPayload(pcm)},...extra
});
const start=(rate='8000',id=stream)=>({
  event:'start',sequence_number:'1',stream_sid:id,
  start:{stream_sid:id,call_sid:call,account_sid:account,
    media_format:{encoding:'audio/x-raw',sample_rate:rate,bit_rate:'16'}}
});
const stop=seq=>({
  event:'stop',sequence_number:String(seq),stream_sid:stream,
  stop:{call_sid:call,account_sid:account,reason:'callended'}
});
function active(){
  const s=createExotelMediaSession();
  s.accept({event:'connected'});s.accept(start());
  return s;
}

test('Exotel bidirectional PCM builder roundtrips mono linear16 byte-perfect',()=>{
  const raw=packPcmPayload(pcm);
  assert.deepEqual(unpackPcmPayload(raw),pcm);
  assert.deepEqual(unpackPcmPayload(makeExotelOutboundAudioFrame(stream,pcm).media.payload),pcm);
  assert.deepEqual(makeExotelOutboundMark(stream,'turn_3_end'),{
    event:'mark',stream_sid:stream,mark:{name:'turn_3_end'}
  });
  assert.deepEqual(makeExotelOutboundClear(stream),{event:'clear',stream_sid:stream});
  const large=new Uint8Array(99840);
  assert.equal(unpackPcmPayload(packPcmPayload(large)).length,99840);
  for(const bad of [new Uint8Array(1),new Uint8Array(3199),
    new Uint8Array(100320),[1,2,3],null])
    assert.throws(()=>packPcmPayload(bad),/invalid/);
  for(const bad of ['not base64####','AAAA','AA==','AAA','',0])
    assert.throws(()=>unpackPcmPayload(bad),/invalid|unsupported/);
  assert.throws(()=>makeExotelOutboundMark(stream,'with spaces'),/invalid/);
  assert.throws(()=>makeExotelOutboundClear('xyz'),/invalid/);
});

test('AgentStream state machine consumes real event shape without exposing media or customer numbers',()=>{
  const session=createExotelMediaSession();
  assert.equal(session.accept({event:'connected'}).phase,'connected');
  assert.equal(session.accept(start('16000')).sampleRate,16000);
  const result=session.accept(frame(2,0));
  assert.deepEqual(result,{kind:'media',bytes:3200,phase:'active',executable:false});
  session.accept({event:'mark',sequence_number:'3',stream_sid:stream,
    mark:{name:'playback_1'}});
  const dtmf=session.accept({event:'dtmf',sequence_number:'4',stream_sid:stream,
    dtmf:{digit:'5',duration:'100'}});
  assert.equal(dtmf.contentRecorded,false);
  session.accept(stop(5));
  const summary=session.summary();
  assert.equal(summary.phase,'stopped');
  assert.equal(summary.sampleRate,16000);
  assert.equal(summary.processedFrames,4);
  assert.equal(summary.pcmBytes,3200);
  assert.equal(summary.marks,1);
  assert.equal(summary.dtmfEvents,1);
  assert.equal(summary.audioStored,false);
  assert.equal(summary.billable,false);
  assert.ok(!JSON.stringify(summary).includes(call));
  assert.equal(Object.hasOwn(summary,'rawAudio'),false);
  assert.throws(()=>session.accept(frame(6,200)),/stopped/);
});

test('AgentStream rejects missing connect, duplicate start and sequence replay',()=>{
  const empty=createExotelMediaSession();
  assert.throws(()=>empty.accept(start()),/connected event required/);
  empty.accept({event:'connected'});
  assert.throws(()=>empty.accept({event:'connected'}),/duplicate/);
  empty.accept(start());
  assert.throws(()=>empty.accept(start()),/out of order/);
  empty.accept(frame(2,0));
  assert.throws(()=>empty.accept(frame(2,100)),/replayed|out-of-order/);
  assert.throws(()=>empty.accept(frame(1,100)),/replayed|out-of-order/);
  empty.accept(frame(3,200));
  assert.throws(()=>empty.accept(frame(4,199)),/timestamp/);
});

test('AgentStream hard rejects cross-call, wrong media format, forged DTMF and event shape',()=>{
  for(const rate of ['6000','48000']){
    const s=createExotelMediaSession();s.accept({event:'connected'});
    assert.throws(()=>s.accept(start(rate)),/unsupported/);
  }
  const broken=createExotelMediaSession();broken.accept({event:'connected'});
  assert.throws(()=>broken.accept(start('8000','x')),/invalid/);
  assert.throws(()=>broken.accept({...start(),start:{...start().start,from:'+911111111111',
    unexpected:'inject'}}),/unsupported/);
  const s=active();
  assert.throws(()=>s.accept(frame(2,0,{stream_sid:'MZwrongstream567'})),/cross-stream/);
  assert.throws(()=>s.accept({...frame(2,0),media:{...frame(2,0).media,
    payload:'AAAA'}}),/unsupported/);
  assert.throws(()=>s.accept({...frame(2,0),media:{...frame(2,0).media,
    payload:'../path'}}),/invalid/);
  assert.throws(()=>s.accept({event:'dtmf',sequence_number:'2',stream_sid:stream,
    dtmf:{digit:'A',duration:'100'}}),/invalid/);
  assert.throws(()=>s.accept({event:'mark',sequence_number:'2',stream_sid:stream,
    mark:{name:'bad mark!'}}),/invalid/);
  assert.throws(()=>s.accept({event:'clear',sequence_number:'2',stream_sid:stream}),
    /unsupported AgentStream inbound/);
  assert.throws(()=>s.accept({...stop(2),stop:{...stop(2).stop,call_sid:'CAothercallxxx'}}),/invalid/);
});

test('AgentStream accepts 8000/16000/24000, 100-round-trip fake PCM frames and stops',()=>{
  for(const rate of [8000,16000,24000]){
    const result=runExotelMediaHarness({frames:100,sampleRate:rate});
    assert.equal(result.frames,100);
    assert.equal(result.inboundBytes,320000);
    assert.equal(result.decodedFrames,100);
    assert.equal(result.encodedFrames,100);
    assert.equal(result.sequenceVerified,true);
    assert.equal(result.stopVerified,true);
    assert.equal(result.mediaServerListening,false);
    assert.equal(result.websocketConnections,0);
    assert.equal(result.realCallsStarted,0);
    assert.equal(result.sttCalls,0);
    assert.equal(result.ttsCalls,0);
    assert.equal(result.llmCalls,0);
    assert.equal(result.billable,false);
  }
  for(const invalid of [{frames:0},{frames:101},{frames:'100'},
    {sampleRate:44100},{frames:1,live:true}])
    assert.throws(()=>runExotelMediaHarness(invalid),/invalid/);
});

test('Exotel HTTP Basic auth request is genuinely multipart encoded but never sent',async()=>{
  const cfg={accountSid:'synthetic_account',from:'+919000000001',
    callerId:'01234567890',streamUrl:'wss://bot.example.invalid/media',
    statusCallback:'https://callback.example.invalid/webhook'};
  const req=prepareExotelConnectRequest(cfg,{
    apiKey:'fictional_API_KEY',apiToken:'fictional_API_TOKEN'
  });
  assert.equal(req.method,'POST');
  assert.equal(req.redirect,'error');
  assert.equal(req.url,'https://api.in.exotel.com/v1/Accounts/synthetic_account/Calls/connect');
  assert.equal(req.headers.get('Authorization'),'Basic '+btoa('fictional_API_KEY:fictional_API_TOKEN'));
  assert.match(req.headers.get('Content-Type'),/^multipart\/form-data; boundary=/);
  const body=await req.formData();
  assert.equal(body.get('From'),'+919000000001');
  assert.equal(body.get('CallerId'),'01234567890');
  assert.equal(body.get('StreamType'),'bidirectional');
  assert.equal(body.get('Record'),'false');
  assert.equal(body.get('StreamUrl'),'wss://bot.example.invalid/media');
  assert.equal(body.get('StatusCallbackEvents[]'),'terminal');
  for(const raw of [{apiKey:'short',apiToken:'fictional_API_TOKEN'},
    {apiKey:'fictional_API_KEY',apiToken:'short'},
    {apiKey:'fictional:KEY',apiToken:'fictional_API_TOKEN'}])
    assert.throws(()=>prepareExotelConnectRequest(cfg,raw),/invalid/);
  await assert.rejects(submitExotelConnect(),/disabled/);
});

test('unverified vendor response is not accepted as consent/billable evidence',()=>{
  const parsed=summarizeUntrustedExotelConnectResponse({Call:{
    Sid:'fictionalcall12345',Status:'in-progress',From:'+919000000001',
    PhoneNumberSid:'01234567890',Direction:'outbound-api'
  }});
  assert.equal(parsed.status,'in-progress');
  assert.equal(parsed.customerCallCreated,false);
  assert.equal(parsed.usageBillable,false);
  assert.equal(parsed.authenticated,false);
  assert.throws(()=>summarizeUntrustedExotelConnectResponse({Call:{Sid:'xx',Status:'completed'}}),/invalid/);
  assert.throws(()=>summarizeUntrustedExotelConnectResponse({
    Call:{Sid:'fictionalcall12345',Status:'completed',Price:50}}),/invalid/);
});

test('callback correlation checks signed-off call IDs but still quarantines any untrusted webhook',()=>{
  const original={CallSid:'fictionalcall12345',Status:'completed',EventType:'terminal',
    ConversationDuration:'15',CustomField:'fictionalnonceABC123456'};
  const bytes=new TextEncoder().encode(new URLSearchParams(original).toString());
  const out=correlateUnverifiedExotelCallback(bytes,{
    callSid:original.CallSid,correlationNonce:original.CustomField
  });
  assert.equal(out.callSidMatched,true);
  assert.equal(out.correlationMatched,true);
  assert.equal(out.vendorSourceAuthenticated,false);
  assert.equal(out.providerLookupVerified,false);
  assert.equal(out.result,'quarantine_pending_provider_verification');
  assert.equal(out.callLedgerUpdated,false);
  assert.equal(out.billable,false);
  assert.throws(()=>correlateUnverifiedExotelCallback(bytes,{
    callSid:'wrongcall123456',correlationNonce:original.CustomField}),/CallSid mismatch/);
  assert.throws(()=>correlateUnverifiedExotelCallback(bytes,{
    callSid:original.CallSid,correlationNonce:'differentNonce123456'}),/correlation mismatch/);
  assert.throws(()=>correlateUnverifiedExotelCallback(bytes,{
    callSid:original.CallSid,correlationNonce:'short'}),/invalid/);
});

test('Super Admin-only offline audio validation protects HTTP method, Origin and body',async()=>{
  const sql=[];
  const fakeEnv={
    CONTROL_DB:{prepare(q){sql.push(q);if(!q.includes('FROM human_sessions'))
      throw Error('Unexpected D1 access');
      return {bind(){return {first:async()=>({id:'synthetic-user',
        email:'test@example.invalid',globalRole:'super_admin',token_hash:'test'})}}};
    }}
  };
  const unauth=await worker.fetch(new Request(url+'/v1/human/engineering/media-protocol'),{
    CONTROL_DB:{prepare(){throw Error('Unauthorized access queried DB')}}
  });
  assert.equal(unauth.status,401);
  const build=(options,{method='POST',origin=url}={})=>new Request(
    url+'/v1/human/engineering/media-protocol',{
      method,headers:{cookie,...(method==='POST'?{Origin:origin,'Content-Type':'application/json'}:{})},
      ...(method==='POST'?{body:JSON.stringify(options)}:{})
    }
  );
  const res=await worker.fetch(build({frames:100,sampleRate:8000}),fakeEnv);
  assert.equal(res.status,200);
  const out=await res.json();
  assert.equal(out.realCallsStarted,0);
  assert.equal(out.websocketConnections,0);
  assert.equal(out.decodedFrames,100);
  const wrongMethod=await worker.fetch(build(null,{method:'GET'}),fakeEnv);
  assert.equal(wrongMethod.status,405);
  const wrongOrigin=await worker.fetch(build({frames:5},{origin:'https://evil.example'}),fakeEnv);
  assert.equal(wrongOrigin.status,403);
  const forged=await worker.fetch(build({frames:5,streamUrl:'wss://evil.example'}),fakeEnv);
  assert.equal(forged.status,400);
  const oversized=await worker.fetch(build({frames:5,junk:'x'.repeat(700)}),fakeEnv);
  assert.equal(oversized.status,400);
  assert.ok(sql.every(q=>q.includes('FROM human_sessions')));
  assert.ok(sql.length>=4);
});
