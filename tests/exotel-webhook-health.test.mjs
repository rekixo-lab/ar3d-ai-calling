import test from 'node:test';
import assert from 'node:assert/strict';
import {handleExotelWebhookHealth} from '../src/exotel-webhook-health.mjs';

const now=Date.parse('2026-11-20T13:00:00.000Z');
const user={id:'123e4567-e89b-42d3-a456-426614174000',
  globalRole:'super_admin',token_hash:'e'.repeat(64)};
const req=(path='exotel-webhook-health',method='GET')=>
  new Request('https://aicalling.ar3dstudio.in/v1/human/engineering/'+path,{method});
function fakeDb({mfa=true,throwCounts=false,counts={}}={}){
  const sqls=[];let writes=0,binds=[];
  const db={
    prepare(sql){
      sqls.push(sql);
      if(!sql.startsWith('SELECT'))throw Error('read-only guarantee');
      return {bind(...params){
        binds.push(params);
        return {async first(){
          if(sql.includes('human_mfa_settings m JOIN human_sessions s'))
            return mfa&&params[0]===user.id&&params[1]===user.token_hash?
              {enabled_at:'2026-11-20T12:00:00.000Z'}:null;
          if(sql.includes('FROM exotel_voicebot_event_receipts')){
            if(throwCounts)throw Error('secret database failure');
            return {uniqueReceipts:3,transcriptReceipts:2,
              sessionEndReceipts:1,completedTurns:1,inProgressTurns:1,
              possibleOptOutSignals:1,distinctSessions:1,
              lastReceivedAt:'2026-11-20T12:20:00.000Z',...counts};
          }
          throw Error('unexpected query');
        }};
      }};
    }
  };
  return {db,sqls,binds,get writes(){return writes}};
}
test('MFA Super Admin can view safe aggregate receipts without writing or calling',async()=>{
  const fx=fakeDb();
  const response=await handleExotelWebhookHealth(req(),{
    CONTROL_DB:fx.db,EXOTEL_VOICEBOT_WEBHOOK_TOKEN:'a'.repeat(64)
  },user,{now});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const data=await response.json();
  assert.equal(data.metrics.uniqueReceipts,3);
  assert.equal(data.metrics.possibleOptOutSignals,1);
  assert.equal(data.metrics.distinctSessions,1);
  assert.equal(data.webhookTokenConfigured,true);
  assert.equal(data.sourceVerified,false);
  assert.equal(data.callToLeadLinked,false);
  assert.equal(data.crmWrites,0);
  assert.equal(data.liveCallsStarted,0);
  assert.equal(data.recordingsFetched,0);
  assert.equal(fx.writes,0);
  assert.equal(fx.sqls.length,2);
  assert.ok(fx.sqls.every(sql=>sql.startsWith('SELECT')));
  assert.ok(fx.sqls[1].includes('expires_at>?'));
  assert.deepEqual(fx.binds[1],[now]);
  const serialized=JSON.stringify(data);
  for(const forbidden of ['a'.repeat(64),user.token_hash,user.id,
    'mobile_e164','call_fingerprint','session_fingerprint','transcript_text'])
    assert.ok(!serialized.includes(forbidden),forbidden);
});
test('missing or old MFA session, other roles and anonymous callers cannot read receipt counts',async()=>{
  for(const principal of [
    {...user,globalRole:'client_admin'},
    {...user,globalRole:'viewer'},null
  ]){
    const fx=fakeDb();
    assert.equal((await handleExotelWebhookHealth(req(),{CONTROL_DB:fx.db},principal,{now})).status,403);
    assert.equal(fx.sqls.length,0);
  }
  const fx=fakeDb({mfa:false});
  const result=await handleExotelWebhookHealth(req(),{CONTROL_DB:fx.db},user,{now});
  assert.equal(result.status,403);
  assert.equal(fx.sqls.length,1);
});
test('GET only with no query parameters; no generic receipt or caller searches',async()=>{
  const fx=fakeDb();
  const env={CONTROL_DB:fx.db};
  assert.equal((await handleExotelWebhookHealth(req('exotel-webhook-health','POST'),env,user,{now})).status,405);
  assert.equal((await handleExotelWebhookHealth(req('exotel-webhook-health?callSid=CA123'),env,user,{now})).status,400);
  assert.equal(fx.sqls.length,0);
  assert.equal(await handleExotelWebhookHealth(req('different-route'),env,user,{now}),null);
});
test('empty quarantine returns zero counts and no fabricated callback health',async()=>{
  const fx=fakeDb({counts:{uniqueReceipts:0,transcriptReceipts:null,
    sessionEndReceipts:null,completedTurns:null,inProgressTurns:null,
    possibleOptOutSignals:null,distinctSessions:0,lastReceivedAt:null}});
  const response=await handleExotelWebhookHealth(req(),{CONTROL_DB:fx.db},user,{now});
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(data.metrics.uniqueReceipts,0);
  assert.equal(data.metrics.completedTurns,0);
  assert.equal(data.lastReceivedAt,null);
  assert.equal(data.webhookTokenConfigured,false);
});
test('schema errors, untrusted counts and timestamps never leak provider or database data',async()=>{
  for(const options of [
    {throwCounts:true},{counts:{uniqueReceipts:-1}},
    {counts:{lastReceivedAt:'PRIVATE_PHONE_9999999999'}},
    {counts:{possibleOptOutSignals:1.25}}
  ]){
    const fx=fakeDb(options);
    const response=await handleExotelWebhookHealth(req(),{CONTROL_DB:fx.db},user,{now});
    assert.equal(response.status,503);
    assert.ok(!(await response.text()).includes('9999999999'));
    assert.equal(fx.writes,0);
  }
  assert.equal((await handleExotelWebhookHealth(req(),{},user,{now})).status,503);
});
