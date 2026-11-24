import test from 'node:test';
import assert from 'node:assert/strict';
import {openSarvamRealtimeSocket,probeSarvamRealtime,observeMulawSilence} from '../src/sarvam-realtime-probe.mjs';
class Socket{
 constructor(){this.handlers={};this.sent=[];this.closed=false}
 addEventListener(name,fn){(this.handlers[name]??=[]).push(fn)}
 emit(name,value){for(const fn of this.handlers[name]||[])fn(value)}
 message(value){this.emit('message',{data:JSON.stringify(value)})}
 accept(){this.accepted=true}
 send(value){this.sent.push(JSON.parse(value))}
 close(){if(this.closed)return;this.closed=true;this.emit('close',{})}
}
test('realtime upgrade uses only fixed server host, authenticated 8k mu-law and no redirects',async()=>{
 const socket=new Socket();
 const result=await openSarvamRealtimeSocket('synthetic-key','hi',async(url,options)=>{
  const u=new URL(url);assert.equal(u.origin,'https://api.sarvam.ai');assert.equal(u.pathname,'/speech-to-text-realtime/ws');assert.equal(u.searchParams.get('encoding'),'mulaw');assert.equal(u.searchParams.get('sample_rate'),'8000');assert.equal(u.searchParams.get('model'),'saaras:v4');assert.equal(u.searchParams.get('endpointing'),'manual');assert.equal(options.redirect,'manual');assert.equal(options.headers['api-subscription-key'],'synthetic-key');assert.equal(url.includes('synthetic-key'),false);return {status:101,webSocket:socket}
 });
 assert.equal(result,socket);
 await assert.rejects(openSarvamRealtimeSocket('synthetic-key','hi',async()=>({status:302,webSocket:socket})),/unavailable/);
});
test('replay ignores partials and uses correlated provider billed audio on graceful end',async()=>{
 const socket=new Socket(),bytes=new Uint8Array(3200).fill(255);
 const promise=probeSarvamRealtime(socket,bytes);
 socket.message({event:'session.begin',request_id:'synthetic-request'});
 assert.deepEqual(socket.sent.map(x=>x.event),['speech_start','audio_input','audio_input','speech_end']);
 assert.equal(atob(socket.sent[1].audio).length,1600);
 socket.message({event:'transcript.partial',utterance_idx:0,text:'wrong'});
 socket.message({event:'transcript.final',utterance_idx:0,text:'बीस लाख'});
 assert.equal(socket.sent.at(-1).event,'end');
 socket.message({event:'session.end',request_id:'synthetic-request',audio_duration_s:'0.4'});
 const r=await promise;assert.equal(r.text,'बीस लाख');assert.equal(r.billedAudioSeconds,.4);assert.equal(r.inputAudioMs,400);assert.equal(r.providerSessionVerified,true);assert.equal(socket.closed,true);
});
test('mismatched session, timeout or service error never infer a transcript or billing',async()=>{
 for(const mode of ['mismatch','timeout','error']){
  const socket=new Socket(),promise=probeSarvamRealtime(socket,new Uint8Array(160),{timeoutMs:20});
  socket.message({event:'session.begin',request_id:'synthetic-request'});
  if(mode==='mismatch'){socket.message({event:'transcript.final',utterance_idx:0,text:'बीस लाख'});socket.message({event:'session.end',request_id:'other',audio_duration_s:'0.02'});}
  if(mode==='error')socket.message({event:'error',code:'private'});
  const r=await promise;assert.equal(r.text,null);assert.equal(r.billedAudioSeconds,null);assert.equal(r.providerSessionVerified,false);
 }
});
test('silence observation preserves context and never actually cuts audio',()=>{
 const bytes=new Uint8Array(8000*2).fill(255);bytes.fill(0,8000,9600);const original=bytes.slice();
 const result=observeMulawSilence(bytes);assert.equal(result.speechDetected,true);assert.equal(result.candidateStartMs,700);assert.equal(result.candidateEndMs,1500);assert.equal(result.candidateSavingsMs,1200);assert.equal(result.liveTrimApplied,false);assert.deepEqual(bytes,original);
 const silent=observeMulawSilence(new Uint8Array(8000).fill(255));assert.equal(silent.speechDetected,false);assert.equal(silent.candidateSavingsMs,0);
});
