import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgePlivoTurn,openNovaSocket,streamToken,validStreamToken} from '../src/streaming-speech.mjs';
class Socket {
 constructor(){this.handlers={};this.sent=[];this.closed=false}
 addEventListener(k,fn){(this.handlers[k]??=[]).push(fn)}
 accept(){this.accepted=true}
 send(value){this.sent.push(value)}
 close(){if(this.closed)return;this.closed=true;this.emit('close',{})}
 emit(k,value){for(const fn of this.handlers[k]||[])fn(value)}
 message(value){this.emit('message',{data:JSON.stringify(value)})}
}
const wait=()=>new Promise(resolve=>setImmediate(resolve));
const start={event:'start',start:{callId:'call-test-123',accountId:'account-test',streamId:'stream-test-123',tracks:['inbound'],mediaFormat:{encoding:'audio/x-mulaw',sampleRate:8000}}};
const media={event:'media',streamId:'stream-test-123',media:{track:'inbound',chunk:1,payload:'//8='}};
test('Nova websocket binding and token are scoped to one call and turn',async()=>{
 const ws=new Socket(),row={id:'pilot',provider_call_id:'call',turn:0,expires_at:1234};
 const capability=await streamToken('secret',row);
 assert.equal(await validStreamToken('secret',row,capability),true);
 assert.equal(await validStreamToken('secret',{...row,turn:1},capability),false);
 assert.equal(await openNovaSocket({async run(model,params,options){assert.equal(model,'@cf/deepgram/nova-3');assert.equal(params.encoding,'mulaw');assert.equal(params.sample_rate,'8000');assert.equal(params.language,'hi');assert.equal(params.endpointing,'1200');assert.deepEqual(options,{websocket:true});return {webSocket:ws}}},'hi'),ws);
});
test('Plivo inbound mu-law chunks become binary speech input; final text commits once',async()=>{
 const socket=new Socket(),upstream=new Socket(),answers=[];
 bridgePlivoTurn(socket,{accountId:'account-test',callId:'call-test-123',language:'hi',connect:async()=>upstream,onAnswer:async a=>answers.push(a)});
 socket.message(start);socket.message(media);socket.message(media);await wait();
 assert.equal(upstream.sent.length,1);assert.deepEqual([...new Uint8Array(upstream.sent[0])],[255,255]);
 upstream.message({type:'Results',is_final:false,channel:{alternatives:[{transcript:'wrong'}]}});assert.equal(answers.length,0);
 upstream.message({type:'Results',is_final:true,speech_final:false,channel:{alternatives:[{transcript:'मुझे',confidence:.94}]}});
 upstream.message({type:'Results',is_final:true,speech_final:true,channel:{alternatives:[{transcript:'प्लॉट चाहिए',confidence:.91}]}});
 await wait();assert.deepEqual(answers,[{text:'मुझे प्लॉट चाहिए',reason:'recognized',confidence:.91,audioMs:0,streamStarted:true,sttConnected:true}]);assert.equal(socket.closed,true);assert.equal(upstream.closed,true);
});
test('wrong call identity, provider errors and timeout never invent a transcript',async()=>{
 for(const mode of ['identity','error','timeout']){
  const socket=new Socket(),upstream=new Socket(),answers=[];let opened=0;
  bridgePlivoTurn(socket,{accountId:'account-test',callId:'call-test-123',language:'hi',connect:async()=>{opened++;return upstream},onAnswer:async a=>answers.push(a),maxMs:20,finalMs:10});
  socket.message(mode==='identity'?{...start,start:{...start.start,callId:'other'}}:start);
  if(mode!=='identity'){socket.message(media);await wait();if(mode==='error')upstream.message({type:'Error',message:'private'});}
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(answers.length,1);assert.equal(answers[0].text,null);assert.equal(answers[0].reason,{identity:'stream_protocol_invalid',error:'stream_service_failed',timeout:'stream_final_timeout'}[mode]);
  assert.equal(opened,mode==='identity'?0:1);assert.equal(socket.closed,true);
 }
});

test('empty final during start does not consume the answer before audio arrives',async()=>{
 const socket=new Socket(),upstream=new Socket(),answers=[];
 bridgePlivoTurn(socket,{accountId:'account-test',callId:'call-test-123',language:'hi',connect:async()=>upstream,onAnswer:async a=>answers.push(a),maxMs:100,setupMs:100});
 socket.message(start);await wait();
 upstream.message({type:'Results',is_final:true,speech_final:true,channel:{alternatives:[{transcript:''}]}});
 assert.equal(answers.length,0);
 socket.message({...media,media:{...media.media,payload:btoa(String.fromCharCode(...new Uint8Array(160).fill(255)))}});
 upstream.message({type:'Results',is_final:true,speech_final:true,channel:{alternatives:[{transcript:'प्लॉट',confidence:.95}]}});
 await wait();assert.equal(answers[0].audioMs,20);assert.equal(answers[0].text,'प्लॉट');
});
