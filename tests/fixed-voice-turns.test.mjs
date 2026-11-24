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
    assert.throws(()=>turn(r.state,'extra'),/already finished/);
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
  assert.match(js,/Record answer for Cloudflare/);
  assert.match(js,/voice-preview\/transcribe/);
  assert.match(js,/Save Reviewed Answers to CRM/);
  assert.match(js,/customer dial|No live call|No phone call/i);
  assert.ok(!js.includes('/v1/human/calls/start'));
  const r=await worker.fetch(new Request(origin+'/app'),{});
  assert.match(r.headers.get('Permissions-Policy'),/microphone=\(self\)/);
});

test('Hindi refusal is not incorrectly classified as later; conflicting yes/no requires repeat',()=>{
  const beforeInterest=()=>{
    let state=beginFixedVoicePreview({language:'hi',now:stamp}).state;
    for(const answer of ['फ्लैट','रायपुर','शंकर नगर','2BHK','35 लाख'])
      state=turn(state,answer).state;
    return state;
  };
  const no=turn(beforeInterest(),'अभी नहीं चाहिए');
  assert.equal(no.action,'completed');
  assert.equal(no.state.answers.interest,'not_interested');
  assert.equal(no.state.answers.visitDate,null);
  const later=turn(beforeInterest(),'अभी नहीं, कुछ दिन बाद');
  assert.equal(later.action,'completed');
  assert.equal(later.state.answers.interest,'later');
  for(const text of ['हाँ, नहीं चाहिए','yes, not interested']){
    const ambiguous=turn(beforeInterest(),text);
    assert.equal(ambiguous.action,'repeat');
    assert.equal(ambiguous.state.index,5);
    assert.equal(ambiguous.state.answers.interest,undefined);
    assert.match(ambiguous.warning,/conflicting/);
  }
});

test('Audio trouble and repeat requests never become a saved location',()=>{
  const locationState=()=>turn(beginFixedVoicePreview({language:'hi',now:stamp}).state,'प्लॉट').state;
  for(const phrase of [
    'आपकी आवाज नहीं आ रही', 'सुनाई नहीं दिया', 'माफ कीजिए फिर से बोलिए',
    'दुबारा बताइए', 'can you repeat', 'I could not hear you',
    'what did you say', 'पता नहीं', 'हाँ', 'हेलो'
  ]){
    const response=turn(locationState(),phrase);
    assert.equal(response.action,'repeat',phrase);
    assert.equal(response.state.index,1,phrase);
    assert.equal(response.state.answers.location,undefined,phrase);
    assert.equal(response.crmWrites,0,phrase);
    assert.equal(response.phoneCallsStarted,0,phrase);
  }
  const accepted=turn(locationState(),'रायपुर');
  assert.equal(accepted.action,'next_question');
  assert.equal(accepted.state.answers.location,'रायपुर');
  const areaRetry=turn(accepted.state,'आवाज कट रही है');
  assert.equal(areaRetry.action,'repeat');
  assert.equal(areaRetry.state.index,2);
  assert.equal(areaRetry.state.answers.area,undefined);
  const areaAccepted=turn(areaRetry.state,'शंकर नगर');
  assert.equal(areaAccepted.state.answers.area,'शंकर नगर');
});

test('Three unintelligible answers end in review, without guessing a city or granting consent',()=>{
  let state=turn(beginFixedVoicePreview({language:'hi',now:stamp}).state,'घर').state;
  for(let attempt=1;attempt<=3;attempt++){
    const response=turn(state,'मुझे सुनाई नहीं दिया');
    assert.equal(response.action,attempt===3?'human_review':'repeat');
    assert.equal(response.state.index,1);
    assert.equal(response.state.answers.location,undefined);
    assert.equal(response.crmWrites,0);
    assert.equal(response.consentGranted,false);
    assert.equal(response.dndCleared,false);
    state=response.state;
  }
  assert.equal(state.status,'needs_review');
  assert.throws(()=>turn(state,'दुर्ग'),/already finished/);
});

test('Misheard speech and mixed interest responses are never accepted as customer choices',()=>{
  const original=beginFixedVoicePreview({language:'hi',now:stamp}).state;
  const cityState=turn(original,'प्लॉट').state;
  for(const text of [
    'आप गलत बोल रहे हो', 'आपने मुझे गलत समझा', 'आप क्या बोल रहे हो?',
    'क्या सवाल था', 'you misunderstood me', 'that is not what I said',
    'dobara boliye', 'sunai nahi diya'
  ]){
    const x=turn(cityState,text);
    assert.equal(x.action,'repeat',text);
    assert.equal(x.state.index,1,text);
    assert.equal(x.state.answers.location,undefined,text);
    assert.equal(x.phoneCallsStarted,0,text);
    assert.equal(x.crmWrites,0,text);
  }
  const correct=turn(cityState,'Korba').state;
  assert.equal(correct.index,2);
  const wrongArea=turn(correct,'आपने गलत सुना');
  assert.equal(wrongArea.action,'repeat');
  assert.equal(wrongArea.state.answers.area,undefined);

  let interestState=beginFixedVoicePreview({language:'hi',now:stamp}).state;
  for(const answer of ['प्लॉट','कोरबा','पुराना बस स्टैंड','1200 वर्ग फुट','15 लाख']){
    const step=turn(interestState,answer);
    assert.equal(step.action,'next_question',answer);
    interestState=step.state;
  }
  assert.equal(interestState.index,5);
  for(const ambiguous of ['yes no','हाँ नहीं','हाँ, नहीं अभी','yes, नहीं']){
    const x=turn(interestState,ambiguous);
    assert.equal(x.action,'repeat',ambiguous);
    assert.equal(x.state.index,5,ambiguous);
    assert.equal(x.state.answers.interest,undefined,ambiguous);
    assert.equal(x.crmWrites,0,ambiguous);
  }
  const later=turn(interestState,'अभी नहीं, कुछ दिन बाद');
  assert.equal(later.action,'completed');
  assert.equal(later.state.answers.interest,'later');
  const optout=turn(interestState,'कॉल मत करना, आप गलत बोल रहे हो');
  assert.equal(optout.action,'opt_out_requested');
  assert.equal(optout.state.answers.interest,undefined);
  assert.equal(optout.consentGranted,false);
});

test('Spoken Hindi and Hinglish plot sizes normalize without a paid call',()=>{
 const sizeState=()=>{let s=beginFixedVoicePreview({now:stamp}).state;
  for(const a of ['प्लॉट','कोरबा','पुराना बस स्टैंड'])s=turn(s,a).state;return s};
 for(const [answer,expected] of [
  ['एक हजार वर्ग फीट','1000 वर्ग फुट'],
  ['बारह सौ वर्ग फीट','1200 वर्ग फुट'],
  ['एक हज़ार दो सौ वर्ग फुट','1200 वर्ग फुट'],
  ['मुझे लगभग पंद्रह सौ स्क्वायर फीट चाहिए','1500 वर्ग फुट'],
  ['१२०० वर्ग फीट','1200 वर्ग फुट'],
  ['1,200 sqft','1200 वर्ग फुट'],
  ['twelve hundred square feet','1200 वर्ग फुट'],
  ['barah sau square feet','1200 वर्ग फुट'],
  ['वन थाउजेंड स्क्वेयर फीट','1000 वर्ग फुट'],
  ['एक सौ गज','100 वर्ग गज'],
  ['तीस बाय चालीस फीट','30 x 40 ft']
 ]){
  const r=turn(sizeState(),answer);
  assert.equal(r.action,'next_question',answer);
  assert.equal(r.state.answers.size,expected,answer);
  assert.equal(r.currentField,'budgetInr');
 }
 for(const answer of ['बारह सौ','1000 या 1200 वर्ग फीट','एक हजार से बारह सौ वर्ग फीट','1200 1500 sqft','नहीं चाहिए 1200 वर्ग फुट','-1200 sqft','0 वर्ग फुट','20 लाख रुपये','1000 वर्ग मीटर','दो हजार हजार वर्ग फीट']){
  const r=turn(sizeState(),answer);
  assert.equal(r.action,'repeat',answer);
  assert.equal(r.state.answers.size,undefined,answer);
 }
 assert.equal(turn(sizeState(),'एक हजार वर्ग फीट',.5).action,'repeat');
 assert.equal(turn(sizeState(),'कॉल मत करना, एक हजार वर्ग फीट').action,'opt_out_requested');
});
