// End-to-end synthetic Exotel webhook -> actual Control D1 quarantine SQL
// -> HMAC-only operator test correlation. No live provider network or CRM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {quarantineExotelVoicebotDelivery} from '../src/exotel-voicebot-inbound.mjs';
import {parseExotelVoicebotEvent} from '../src/exotel-voicebot-webhook-contract.mjs';
import {inspectOperatorWebhookCandidates} from '../src/exotel-operator-webhook-correlation.mjs';

const secret='1'.repeat(64),account='rekixo1';
const sid='CAfictionaloperatorcall20261120';
const now=Date.parse('2026-11-20T12:00:00.000Z');
function dbFixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/control/0008_exotel_voicebot_receipts.sql','utf8'));
  const db={
    prepare(sql){
      const stmt=sqlite.prepare(sql);
      return {bind(...args){return {
        async run(){return {meta:{changes:Number(stmt.run(...args).changes)}}},
        async first(){return stmt.get(...args)??null},
        async all(){return {results:stmt.all(...args)}}
      }}};
    },
    async batch(statements){
      sqlite.exec('BEGIN IMMEDIATE');
      try{
        const rows=[];
        for(const stmt of statements)rows.push(await stmt.run());
        sqlite.exec('COMMIT');
        return rows;
      }catch(error){sqlite.exec('ROLLBACK');throw error}
    }
  };
  return {sqlite,db,env:{CONTROL_DB:db,EXOTEL_VOICEBOT_WEBHOOK_TOKEN:secret}};
}
function payload({externalId=sid,legSid=sid,accountId=account,
  state='session_in_progress',turn=1,answer='Raipur',eventId='evt_test_one'
}={}){
  const p={
    session_id:'session_test_2026',conversation_id:'conversation_test_2026',
    external_id:externalId,session_state:state,trigger_reason:state==='session_end'?'end':'turn-complete',
    network_type:'pstn',events:state==='session_end'?[]:[{
      event_type:'transcript',event_id:eventId,
      event_data:{transcripts:[{sequence:turn,status:'completed',
        transcript_segments:[{speaker:'user',text:answer}]}]}
    }]
  };
  if(accountId!==null)p.account_id=accountId;
  if(legSid!==null)p.metadata={call_sid:legSid};
  return parseExotelVoicebotEvent(p);
}
const preview=(db,overrides={})=>inspectOperatorWebhookCandidates(db,{
  webhookToken:secret,accountSid:account,registeredCallSid:sid,now,
  ...overrides
});
test('registered self-test SID matches exact HMAC metadata: no raw phone, text or CRM',async()=>{
  const f=dbFixture();
  try{
    const parsed=payload({answer:'fictional 3 BHK enquiry'});
    const written=await quarantineExotelVoicebotDelivery(f.env,parsed,{kind:'transcript',now});
    assert.equal(written.receipts,1);
    await quarantineExotelVoicebotDelivery(f.env,parsed,{kind:'transcript',now});
    await quarantineExotelVoicebotDelivery(f.env,payload({state:'session_end'}),{
      kind:'session_end',now:now+1000
    });
    const result=await preview(f.db);
    assert.equal(result.state,'candidate_only');
    assert.equal(result.uniqueReceipts,2);
    assert.equal(result.transcriptEvents,1);
    assert.equal(result.completedTurns,1);
    assert.equal(result.sessionEnds,1);
    assert.equal(result.uniqueSessions,1);
    assert.equal(result.sourceAuthenticated,false);
    assert.equal(result.providerCallDetailsVerifiedByThisCheck,false);
    assert.equal(result.leadMatched,false);
    assert.equal(result.canUpdateCrm,false);
    assert.equal(result.customerCallsStarted,0);
    const all=JSON.stringify(result);
    for(const forbidden of [sid,account,secret,'fictional 3 BHK enquiry',
      'recipient','mobile_e164','provider_call_sid'])
      assert.ok(!all.includes(forbidden),forbidden);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM exotel_voicebot_event_receipts').get().n,2);
    assert.equal(f.sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{f.sqlite.close()}
});
test('outbound CallSid mismatches and different leg IDs never attach as a match',async()=>{
  const f=dbFixture();
  try{
    await quarantineExotelVoicebotDelivery(f.env,payload({
      externalId:'CAdifferentoperatorcall2026',eventId:'evt_2'
    }),{kind:'transcript',now});
    await quarantineExotelVoicebotDelivery(f.env,payload({
      legSid:'CAseparatelegcall2026',eventId:'evt_3'
    }),{kind:'transcript',now});
    const r=await preview(f.db);
    assert.equal(r.uniqueReceipts,0);
    assert.equal(r.uniqueSessions,0);
    assert.equal(r.lastReceivedAt,null);
    assert.equal(r.sourceAuthenticated,false);
  }finally{f.sqlite.close()}
});
test('omitted account and optional call-leg SID are candidate-only, not verified',async()=>{
  const f=dbFixture();
  try{
    await quarantineExotelVoicebotDelivery(f.env,payload({
      accountId:null,legSid:null,eventId:'evt_no_account'
    }),{kind:'transcript',now});
    const matched=await preview(f.db);
    assert.equal(matched.uniqueReceipts,1);
    assert.equal(matched.sourceAuthenticated,false);
    assert.equal(matched.leadMatched,false);
    assert.equal((await preview(f.db,{accountSid:'differentaccount'})).uniqueReceipts,1,
      'no account in the payload cannot independently prove which provider account sent it');
  }finally{f.sqlite.close()}
});
test('quarantined potential opt-out stays a count only, never changes suppression',async()=>{
  const f=dbFixture();
  try{
    await quarantineExotelVoicebotDelivery(f.env,payload({
      answer:'मुझे दोबारा कॉल मत करना',eventId:'evt_opt_out'
    }),{kind:'transcript',now});
    const report=await preview(f.db);
    assert.equal(report.possibleOptOutEvents,1);
    assert.equal(report.canUpdateCrm,false);
    assert.equal(report.leadMatched,false);
    assert.equal(f.sqlite.prepare(
      'SELECT possible_opt_out FROM exotel_voicebot_event_receipts'
    ).get().possible_opt_out,1);
  }finally{f.sqlite.close()}
});
test('expired receipts are absent; unavailable means cannot determine delivery',async()=>{
  const f=dbFixture();
  try{
    await quarantineExotelVoicebotDelivery(f.env,payload(),{kind:'transcript',now});
    const older=await preview(f.db,{now:now+32*86400000});
    assert.equal(older.state,'candidate_only');
    assert.equal(older.uniqueReceipts,0);
    for(const change of [
      {webhookToken:''},{accountSid:'bad'},{registeredCallSid:''},
      {now:-1}
    ]){
      const r=await preview(f.db,change);
      assert.equal(r.state,'unavailable');
      assert.equal(r.canUpdateCrm,false);
    }
    f.sqlite.exec('DROP TABLE exotel_voicebot_event_receipts');
    assert.equal((await preview(f.db)).state,'unavailable');
  }finally{f.sqlite.close()}
});
