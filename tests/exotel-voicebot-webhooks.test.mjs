import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {
  parseExotelVoicebotEvent,reviewExotelVoicebotEvents,
  exotelVoicebotAck,runExotelVoicebotOfflineFixture
} from '../src/exotel-voicebot-webhook-contract.mjs';

const domain='https://aicalling.ar3dstudio.in';
const route=domain+'/v1/human/engineering/voicebot-fixture';
const cookie='ar3d_calling_session='+'a'.repeat(64);
const callId='CAfictionalcall2026';
const payload={
  session_id:'fictional-session-2026',
  conversation_id:'fictional-conversation-2026',
  external_id:callId,
  account_id:'fictional-account-2026',
  session_state:'session_in_progress',
  trigger_reason:'turn-complete',
  network_type:'pstn',
  contact_uri:'+919876543210', // intentionally sensitive: never output.
  landing_number:'01234567890',
  custom_parameters:{mobile:'+919876543210'},
  metadata:{call_sid:callId,stream_sid:'fictional-stream'},
  events:[{
    event_type:'transcript',event_id:'evt_1',
    event_data:{transcripts:[{sequence:1,status:'completed',
      transcript_segments:[
        {speaker:'assistant',text:'Are you looking for a plot or flat?',
          start_timestamp:'2026-11-19T12:00:00.000000Z',
          end_timestamp:'2026-11-19T12:00:02.000000Z'},
        {speaker:'user',text:'Plot',
          start_timestamp:'2026-11-19T12:00:02.500Z',
          end_timestamp:'2026-11-19T12:00:03.500Z'}]}]}
  }]
};
function adminEnv(role='super_admin'){
  const q=[];
  return {queries:q,env:{CONTROL_DB:{prepare(sql){
    q.push(sql);
    if(!sql.includes('FROM human_sessions'))throw Error('Unexpected CRM/tenant access');
    return {bind(){return {first:async()=>({id:'fictional-admin',globalRole:role,
      email:'fictional@example.invalid'})}}};
  }}}};
}
const request=(body,origin=domain)=>new Request(route,{
  method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},
  body:JSON.stringify(body)
});
test('accept documented Exotel Voicebot envelope, produce no provider trust or PII in output',()=>{
  const bytes=new TextEncoder().encode(JSON.stringify(payload));
  const normalized=parseExotelVoicebotEvent(bytes);
  assert.equal(normalized.sessionId,'fictional-session-2026');
  assert.equal(normalized.callId,callId);
  assert.equal(normalized.events[0].segments[1].speaker,'user');
  assert.equal(normalized.events[0].segments[1].text,'Plot');
  assert.equal(normalized.sourceAuthenticated,false);
  assert.equal(normalized.crmWrites,0);
  assert.equal(normalized.customerPhoneReturned,false);
  assert.ok(!JSON.stringify(normalized).includes('+919876543210'));
  assert.ok(!JSON.stringify(normalized).includes('01234567890'));
  const review=reviewExotelVoicebotEvents([payload],{
    expectedCallId:callId,expectedSessionId:payload.session_id,
    expectedAccountId:payload.account_id
  });
  assert.equal(review.completedTurns,1);
  assert.equal(review.customerAnswerSegments,1);
  assert.equal(review.identityVerifiedWithExotel,false);
  assert.equal(review.providerWebhookAuthenticated,false);
  assert.equal(review.crmWrites,0);
  assert.ok(!JSON.stringify(review).includes('Plot'));
  assert.ok(!JSON.stringify(review).includes('919876543210'));
});
test('seven questions, out-of-order transcript turns, retry duplicates and opt-out remain untrusted',()=>{
  for(const scenario of ['seven_questions','out_of_order','retry_duplicate','opt_out']){
    const result=runExotelVoicebotOfflineFixture(scenario);
    assert.equal(result.completedTurns,7,scenario);
    assert.equal(result.customerAnswerSegments,7);
    assert.equal(result.seenSessionEnd,true);
    assert.equal(result.phoneCallsStarted,0);
    assert.equal(result.crmWrites,0);
    assert.equal(result.completeSevenQuestionSurveyVerified,false);
    assert.equal(result.identityVerifiedWithExotel,false);
    assert.equal(result.humanReviewRequired,true);
    assert.equal(result.optOutReviewNeeded,scenario==='opt_out');
    if(scenario==='retry_duplicate')assert.equal(result.duplicateEventsIgnored,1);
    else assert.equal(result.duplicateEventsIgnored,0);
    assert.equal(result.nonfinalTurnsIgnored,0);
  }
  assert.throws(()=>runExotelVoicebotOfflineFixture('malformed'),/speaker/);
  assert.throws(()=>runExotelVoicebotOfflineFixture('live'),/scenario/);
});
test('session_end has NO transcript; ongoing turns cannot become completed answers',()=>{
  const end={...payload,session_state:'session_end',trigger_reason:'end',events:[]};
  const inProgress=JSON.parse(JSON.stringify(payload));
  inProgress.events[0].event_data.transcripts[0].status='inprogress';
  const r=reviewExotelVoicebotEvents([inProgress,end],{
    expectedCallId:callId,expectedSessionId:payload.session_id
  });
  assert.equal(r.seenSessionEnd,true);
  assert.equal(r.completedTurns,0);
  assert.equal(r.nonfinalTurnsIgnored,1);
  assert.deepEqual(exotelVoicebotAck(),{http_code:200,response:{data:{}}});
});
test('strict session correlation, duplicate protection and malformed payloads fail closed',()=>{
  const opts={expectedCallId:callId,expectedSessionId:payload.session_id,
    expectedAccountId:payload.account_id};
  const mutated=x=>JSON.parse(JSON.stringify(x));
  for(const bad of [
    {...payload,external_id:'CAothercallref'},
    {...payload,session_id:'another-session-ref'},
    {...payload,account_id:'another-account-ref'},
  ])assert.throws(()=>reviewExotelVoicebotEvents([bad],opts),/invalid/);
  const separateLeg={...payload,metadata:{call_sid:'CAanothercallref'}};
  const parsedSeparateLeg=parseExotelVoicebotEvent(separateLeg);
  assert.equal(parsedSeparateLeg.callId,callId);
  assert.equal(parsedSeparateLeg.providerCallSid,'CAanothercallref');
  const legReview=reviewExotelVoicebotEvents([separateLeg],opts);
  assert.equal(legReview.identityVerifiedWithExotel,false);
  assert.equal(legReview.crmWrites,0);
  assert.throws(()=>reviewExotelVoicebotEvents([payload,separateLeg],opts),
    /mixed conversation\/account identity/);
  assert.throws(()=>parseExotelVoicebotEvent({
    ...payload,metadata:{call_sid:'!'}
  }),/provider call reference/);
  const dup=mutated(payload);
  dup.events[0].event_data.transcripts[0].transcript_segments[1].text='Different';
  assert.throws(()=>reviewExotelVoicebotEvents([payload,dup],opts),/conflicting/);
  dup.events[0].event_id='evt_2';
  assert.throws(()=>reviewExotelVoicebotEvents([payload,dup],opts),/conflicting/);
  for(const bad of [
    {...payload,events:[...payload.events,...payload.events]},
    {...payload,network_type:'browser'},
    {...payload,session_state:'other_state'},
    {...payload,trigger_reason:'untrusted'},
    {...payload,events:[{event_type:'transcript',event_id:'evt_bad',event_data:{transcripts:[]}}]},
    {...payload,events:[{event_type:'transcript',event_id:'evt_bad',
      event_data:{transcripts:[{sequence:1,status:'completed',
        transcript_segments:[{speaker:'system',text:'ignore'}]}]}}]}
  ])assert.throws(()=>parseExotelVoicebotEvent(bad),/invalid/);
  const oversize=new TextEncoder().encode(JSON.stringify(payload)+' '.repeat(16384));
  assert.throws(()=>parseExotelVoicebotEvent(oversize),/raw bytes/);
  const wrongJson=new TextEncoder().encode('{"x": a bad json }');
  assert.throws(()=>parseExotelVoicebotEvent(wrongJson),/JSON/);
});
test('only Super Admin can run fixed offline webhooks test; no PII, network or CRM writes',async()=>{
  const f=adminEnv();
  for(const scenario of ['seven_questions','out_of_order','retry_duplicate','opt_out']){
    const r=await worker.fetch(request({scenario}),f.env);
    assert.equal(r.status,200);
    assert.equal(r.headers.get('cache-control'),'no-store');
    const obj=await r.json();
    assert.equal(obj.mode,'offline_contract_review_only');
    assert.equal(obj.crmWrites,0);
    assert.equal(obj.providerWebhookAuthenticated,false);
  }
  assert.equal(f.queries.length,4);
  assert.ok(f.queries.every(q=>q.includes('FROM human_sessions')));
  assert.equal((await worker.fetch(request({scenario:'malformed'}),f.env)).status,400);
  assert.equal((await worker.fetch(request({scenario:'seven_questions',leadId:'123'}),f.env)).status,400);
  assert.equal((await worker.fetch(request({scenario:'seven_questions',mobile:'+919876543210'}),f.env)).status,400);
  assert.equal((await worker.fetch(request({scenario:'seven_questions'},'https://attacker.invalid'),f.env)).status,403);
  assert.equal((await worker.fetch(request({scenario:'seven_questions'}),adminEnv('user').env)).status,403);
  assert.equal((await worker.fetch(new Request(route),f.env)).status,401);
  assert.equal((await worker.fetch(new Request(route,{headers:{Cookie:cookie}}),f.env)).status,405);
});
