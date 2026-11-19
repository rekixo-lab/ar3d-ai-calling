import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../src/index.mjs';
import {js} from '../src/app-assets.mjs';
import {beginFixedVoicePreview,advanceFixedVoicePreview}
  from '../src/fixed-voice-turns.mjs';

const origin='https://calling.example.test',cookie='ar3d_calling_session='+'a'.repeat(64);
const tokenUser={id:'test-human',email:'staff@example.invalid',globalRole:'user'};
const stamp=Date.parse('2026-11-19T13:00:00Z');
function route(data,method='POST',originHeader=origin,cookieHeader=cookie){
  return new Request(origin+'/v1/human/voice-preview',{
    method,headers:{
      ...(cookieHeader?{Cookie:cookieHeader}:{}),
      ...(originHeader?{Origin:originHeader}:{}),
      ...(method==='POST'?{'Content-Type':'application/json'}:{})
    },...(method==='POST'?{body:JSON.stringify(data)}:{})
  });
}
function fixture(){
  const sql=[];
  const db={prepare(q){
    sql.push(q);
    if(!q.includes('FROM human_sessions'))throw Error('unexpected CRM/telecom/database query');
    return {bind(){return {first:async()=>tokenUser}}};
  }};
  return {env:{CONTROL_DB:db,CRM_DB:{prepare(){throw Error('CRM access prohibited for demo')}}},sql};
}
function turn(state,transcript,confidence=1,now=stamp){
  return advanceFixedVoicePreview(state,{transcript,confidence,now});
}
test('A seven-turn Hindi and English questionnaire collects only requirements, never name/mobile',()=>{
  for(const language of ['hi','en']){
    let r=beginFixedVoicePreview({language,now:stamp});
    assert.equal(r.state.index,0);
    assert.equal(r.phoneCallsStarted,0);
    assert.equal(r.verifiedSpeech,false);
    assert.equal(r.crmWrites,0);
    assert.ok(!/mobile|phone number|आपका नाम|your name/i.test(r.prompt));
    const answers=['flat','Raipur','Shankar Nagar','3BHK','35 lakh','yes','2027-01-12'];
    for(let i=0;i<answers.length;i++){
      r=turn(r.state,answers[i]);
      if(i<6)assert.equal(r.action,'next_question');
    }
    assert.equal(r.action,'completed');
    assert.equal(r.state.status,'completed');
    assert.equal(r.state.index,7);
    assert.deepEqual(r.state.answers,{
      propertyType:'flat',location:'Raipur',area:'Shankar Nagar',
      size:'3BHK',budgetInr:3500000,interest:'interested',visitDate:'2027-01-12'
    });
    assert.equal(r.prompt,null);
    assert.equal(r.reviewRequired,true);
    assert.equal(r.consentGranted,false);
    assert.equal(r.dndCleared,false);
    assert.equal(r.recordingSaved,false);
    await assert.rejects(async()=>turn(r.state,'extra'),/already finished/);
  }
});
test('Plot size, Hindi labels, lakh/crore and customer not interested skips visit',()=>{
  let r=beginFixedVoicePreview({language:'hi',now:stamp});
  for(const answer of ['मुझे प्लॉट चाहिए','रायपुर','शंकर नगर','1200 वर्ग फुट','पच्चीस लाख','बाद में']){
    r=turn(r.state,answer);
  }
  assert.equal(r.state.status,'completed');
  assert.deepEqual(r.state.answers,{
    propertyType:'plot',location:'रायपुर',area:'शंकर नगर',
    size:'1200 वर्ग फुट',budgetInr:2500000,interest:'later',visitDate:null
  });
  assert.equal(r.state.index,7);
  const different=beginFixedVoicePreview({now:stamp});
  let x=different;
  for(const answer of ['घर','दुर्ग','मोहन नगर','दो बीएचके','3.5 crore','नहीं चाहिए'])
    x=turn(x.state,answer);
  assert.equal(x.state.status,'completed');
  assert.equal(x.state.answers.size,'2BHK');
  assert.equal(x.state.answers.budgetInr,35000000);
  assert.equal(x.state.answers.interest,'not_interested');
});
test('Tomorrow and weekdays resolve from explicit India-local anchor, never assume unknown day',()=>{
  let s=beginFixedVoicePreview({now:stamp}).state;
  for(const answer of ['flat','Durg','Bhilai','2BHK','20 lakh','interested'])
    s=turn(s,answer).state;
  const x=turn(s,'कल',1,stamp);
  assert.equal(x.action,'completed');
  assert.equal(x.state.answers.visitDate,'2026-11-20');
  let s2=beginFixedVoicePreview({now:stamp}).state;
  for(const answer of ['flat','Durg','Bhilai','2BHK','20 lakh','interested'])
    s2=turn(s2,answer).state;
  assert.equal(turn(s2,'Sunday',1,stamp).state.answers.visitDate,'2026-11-22');
  assert.equal(turn(s2,'2026-11-18',1,stamp).action,'repeat');
});
test('Low recognition confidence, repeat commands and unsupported responses never advance',()=>{
  const r=beginFixedVoicePreview({now:stamp});
  const one=turn(r.state,'flat',0.5);
  assert.equal(one.action,'repeat');assert.equal(one.state.index,0);
  const two=turn(one.state,'repeat',1);
  assert.equal(two.action,'repeat');
  const three=turn(two.state,'something',1);
  assert.equal(three.action,'human_review');
  assert.equal(three.state.status,'needs_review');
  assert.deepEqual(three.state.answers,{});
  assert.throws(()=>turn(three.state,'plot'),/already finished/);
  assert.throws(()=>turn(r.state,'a'.repeat(300)),/invalid/);
  assert.throws(()=>turn(r.state,'yes',-1),/invalid/);
  assert.throws(()=>turn(r.state,'yes',2),/invalid/);
  assert.throws(()=>advanceFixedVoicePreview({...r.state,tenantId:'foreign'},{
    transcript:'flat',now:stamp
  }),/invalid/);
});
test('Explicit opt-out interrupts without converting to consent or mutating CRM',()=>{
  for(const text of ['कॉल मत करना','do not call','remove my number']){
    const result=turn(beginFixedVoicePreview({now:stamp}).state,text);
    assert.equal(result.action,'opt_out_requested');
    assert.equal(result.state.status,'opted_out');
    assert.equal(result.crmWrites,0);
    assert.equal(result.consentGranted,false);
    assert.equal(result.dndCleared,false);
    assert.match(result.warning,/Do Not Call|Stop/);
  }
});
test('Authenticated server preview no DB writes, no phone calls and strict method/origin/body gates',async()=>{
  const f=fixture();
  const start=await worker.fetch(route({action:'start',language:'hi'}),f.env);
  assert.equal(start.status,200);
  const first=await start.json();
  assert.equal(first.state.status,'active');
  assert.equal(first.phoneCallsStarted,0);
  const next=await worker.fetch(route({action:'turn',state:first.state,
    transcript:'flat',confidence:1}),f.env);
  assert.equal(next.status,200);
  assert.equal((await next.json()).currentField,'location');
  assert.equal((await worker.fetch(route({action:'start',language:'hi',phone:'9876543210'}),f.env)).status,400);
  assert.equal((await worker.fetch(route({action:'turn',state:first.state,
    transcript:'flat',agentId:'abc'}),f.env)).status,400);
  assert.equal((await worker.fetch(route({action:'start'},'POST','https://evil.test'),f.env)).status,403);
  assert.equal((await worker.fetch(route({action:'start'},'GET'),f.env)).status,405);
  const anon=new Request(origin+'/v1/human/voice-preview');
  assert.equal((await worker.fetch(anon,f.env)).status,401);
  assert.ok(f.sql.every(q=>q.includes('FROM human_sessions')));
});
test('Browser client offers sequential voice demo with opt-in microphone and staff save only',async()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  assert.match(js,/Start 7-question voice preview/);
  assert.match(js,/Next fixed question/);
  assert.match(js,/Speak current question/);
  assert.match(js,/Answer with browser microphone/);
  assert.match(js,/Save Reviewed Answers to CRM/);
  assert.match(js,/customer dial|No live call|No phone call/i);
  assert.ok(!js.includes('/v1/human/calls/start'));
  const r=await worker.fetch(new Request(origin+'/app'),{});
  assert.match(r.headers.get('Permissions-Policy'),/microphone=\(self\)/);
});
