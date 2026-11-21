import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,lead,now,at,setup as setupCampaign} from './helpers/calling-fixture.mjs';
import {setupPublication,publicationProvider,publishForTest} from './helpers/publication-fixture.mjs';
import {registerVoiceCall} from '../src/shared-voice-gateway.mjs';
import {recordVerifiedVoicebotTurn,pruneVerifiedVoicebotTurns} from '../src/verified-voicebot-bridge.mjs';

const sid='CAverifiedanswers123456';
async function prepared(){
 const f=fixture();await setupCampaign(f);
 const script=await setupPublication(f),p=publicationProvider();
 await publishForTest(f,script,p);
 const pub=f.c.db.prepare('SELECT * FROM calling_agent_publications').get();
 const job=f.r.db.prepare('SELECT * FROM calling_jobs').get();
 f.r.db.prepare("UPDATE calling_jobs SET state='submitted',reserved_at=?,account_sid=?,caller_id=?,flow_id='123456',destination='+919000000001',provider_call_sid=? WHERE id=?")
  .run(at,f.env.EXOTEL_ACCOUNT_SID,f.env.EXOTEL_CALLER_ID,sid,job.id);
 await registerVoiceCall(f.env,{tenantId:tid,publicationId:pub.id,jobId:job.id,callSid:sid,now});
 return f;
}
const base={accountId:'fictionalaccount',botId:'44444444-4444-4444-8444-444444444444',
 callId:sid,providerCallSid:sid,sessionId:'fictional-session-2026',conversationId:'fictional-conversation-2026'};
const delivery=(i,answer)=>({...base,events:[{eventId:'event-'+i,sequence:i,status:'completed',
 segments:[{speaker:'assistant',text:'Question'},{speaker:'user',text:answer}]}]});
const provider=async()=>Response.json({Call:{
 Sid:sid,AccountSid:'fictionalaccount',PhoneNumberSid:'08000000000',Direction:'outbound-api',
 Status:'completed',From:'09000000001',Duration:'90'
}});
test('registered provider session-end stages tenant-owned seven customer answers for staff review',async()=>{
 const f=await prepared();
 try{
  const answers=['Plot','Raipur','Shankar Nagar','1200 sqft','25 lakh','interested',
    new Date(now+7*86400000+330*60000).toISOString().slice(0,10)];
  for(let i=0;i<answers.length;i++){
   const result=await recordVerifiedVoicebotTurn(f.env,delivery(i+1,answers[i]),'transcript',{now,apiFetch:provider});
   assert.equal(result.stage,'awaiting_session_end');
  }
  const end={...base,events:[]};
  const r=await recordVerifiedVoicebotTurn(f.env,end,'session_end',{now,apiFetch:provider});
  assert.equal(r.stage,'human_review_created');
  const review=f.r.db.prepare("SELECT * FROM voicebot_qualification_reviews WHERE tenant_id=?").get(tid);
  assert.equal(review.lead_id,lead);
  assert.equal(review.status,'pending');
  assert.equal(JSON.parse(review.survey_json).budgetInr,2500000);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM voicebot_verified_turns').get().n,8);
  assert.equal(f.r.db.prepare('SELECT consent_status FROM leads WHERE id=?').get(lead).consent_status,'unknown');
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
  assert.equal((await recordVerifiedVoicebotTurn(f.env,end,'session_end',{now,apiFetch:provider})).stage,'human_review_created');
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM voicebot_qualification_reviews').get().n,1);
  assert.equal(await pruneVerifiedVoicebotTurns(f.env,{now:now+31*86400000}),8);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM voicebot_qualification_reviews').get().n,1);
 }finally{f.close()}
});
test('unknown Exotel SID and spoofed published bot cannot stage any CRM answers',async()=>{
 const f=await prepared();
 try{
  await assert.rejects(recordVerifiedVoicebotTurn(f.env,{...delivery(1,'Plot'),callId:'CAunknown123456789',providerCallSid:'CAunknown123456789'},'transcript',{now,apiFetch:provider}));
  await assert.rejects(recordVerifiedVoicebotTurn(f.env,{...delivery(1,'Plot'),botId:'wrong-bot'},'transcript',{now,apiFetch:provider}));
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM voicebot_verified_turns').get().n,0);
 }finally{f.close()}
});
