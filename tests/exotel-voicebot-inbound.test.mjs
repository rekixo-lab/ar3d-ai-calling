import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';

const base='https://aicalling.ar3dstudio.in/v1/provider/exotel/voicebot/';
const secret='a3'.repeat(32);
const accountSid='test123';
const event={
  session_id:'fictional-session-2026',
  conversation_id:'fictional-conversation-2026',
  external_id:'CAfictionalcall2026',
  account_id:accountSid,
  session_state:'session_in_progress',trigger_reason:'turn-complete',
  network_type:'pstn',contact_uri:'+919876543210',
  landing_number:'01234567890',
  custom_parameters:{mobile:'+919876543210'},
  metadata:{call_sid:'CAfictionalcall2026'},
  events:[{event_type:'transcript',event_id:'evt_unique_2026',
    event_data:{transcripts:[{sequence:1,status:'completed',
      transcript_segments:[{speaker:'assistant',text:'What do you need?'},
        {speaker:'user',text:'मुझे शंकर नगर में 1200 sqft का प्लॉट चाहिए।'}]}]}}]
};
const clone=x=>JSON.parse(JSON.stringify(x));
function memoryD1(){
  const rows=new Map();let writes=0,reads=0;
  return {rows,get writes(){return writes},get reads(){return reads},
    prepare(sql){
      return {bind(...args){
        return {
          sql,args,
          async first(){
            if(!sql.startsWith('SELECT account_fingerprint,'))throw Error('unapproved SELECT');
            reads++;
            return rows.get(args[0])||null;
          }
        };
      }};
    },
    async batch(statements){
      const results=[];
      for(const stmt of statements){
        if(!stmt.sql.startsWith('INSERT INTO exotel_voicebot_event_receipts'))
          throw Error('unapproved write');
        const args=stmt.args,key=args[0],old=rows.get(key);
        if(!old){
          rows.set(key,{account_fingerprint:args[1],session_fingerprint:args[2],
            call_fingerprint:args[3],conversation_fingerprint:args[4],
            event_fingerprint:args[5],payload_digest:args[6],
            event_kind:args[7],turn_status:args[8],possible_opt_out:args[9],
            status:'quarantined'});
          writes++;results.push({meta:{changes:1}});
        }else results.push({meta:{changes:0}});
      }
      return results;
    }
  };
}
function fixture(db=memoryD1()){
  return {CONTROL_DB:db,EXOTEL_ACCOUNT_SID:accountSid,
    EXOTEL_VOICEBOT_WEBHOOK_TOKEN:secret};
}
function request(payload=event,{token=secret,route='transcript-events',headers={}}={}){
  return new Request(base+route,{
    method:'POST',
    headers:{'Content-Type':'application/json',
      ...(token?{Authorization:'Bearer '+token}:{}),...headers},
    body:JSON.stringify(payload)
  });
}
test('valid Exotel transcript is 200-compatible, quarantined only and duplicate-safe',async()=>{
  const db=memoryD1(),env=fixture(db);
  const response=await worker.fetch(request(),env);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{http_code:200,response:{data:{}}});
  assert.equal(db.writes,1);
  assert.equal(db.reads,1);
  const stored=[...db.rows.values()][0];
  assert.equal(stored.event_kind,'transcript');
  assert.equal(stored.turn_status,'completed');
  assert.equal(stored.status,'quarantined');
  assert.equal(stored.possible_opt_out,0);
  for(const value of Object.values(stored)){
    const text=String(value);
    assert.ok(!text.includes('+919876543210'));
    assert.ok(!text.includes('शंकर'));
    assert.ok(!text.includes('CAfictionalcall'));
    assert.ok(!text.includes(secret));
    assert.ok(!text.includes('test123'));
  }
  const repeated=await worker.fetch(request(),env);
  assert.equal(repeated.status,200);
  assert.equal(db.writes,1);
  assert.equal(db.reads,2);
});
test('wrong or missing bearer is blocked before body is read or D1 accessed',async()=>{
  const db=memoryD1(),env=fixture(db);
  for(const token of [null,'f'.repeat(64),'a3'.repeat(31),'not-a-secret']){
    const res=await worker.fetch(request(event,{token}),env);
    assert.equal(res.status,401);
    assert.deepEqual(await res.json(),{error:'unauthorized'});
  }
  assert.equal(db.writes,0);
  assert.equal(db.reads,0);
  assert.equal((await worker.fetch(request(event),{
    ...env,EXOTEL_VOICEBOT_WEBHOOK_TOKEN:undefined
  })).status,503);
  assert.equal((await worker.fetch(request(event,{
    headers:{Origin:'https://evil.invalid'}
  }),env)).status,403);
  assert.equal((await worker.fetch(new Request(base+'transcript-events'),env)).status,405);
});
test('no call/lead/CRM writes on malformed, wrong-account or unexpectedly large event',async()=>{
  const db=memoryD1(),env=fixture(db);
  for(const bad of [
    {...event,account_id:'other-account'},
    {...event,session_id:'!'},
    {...event,session_state:'session_end'},
    {...event,events:[]}
  ]){
    const r=await worker.fetch(request(bad),env);
    assert.ok([400,422].includes(r.status),String(r.status));
  }
  const tooLarge=clone(event);
  tooLarge.custom_parameters.padding='x'.repeat(20000);
  assert.equal((await worker.fetch(request(tooLarge),env)).status,400);
  assert.equal(db.writes,0);
  assert.equal(db.reads,0);
});
test('conflicting repeated event ID is never accepted as harmless replay',async()=>{
  const db=memoryD1(),env=fixture(db);
  assert.equal((await worker.fetch(request(),env)).status,200);
  const edited=clone(event);
  edited.events[0].event_data.transcripts[0].transcript_segments[1].text='DIFFERENT property';
  const r=await worker.fetch(request(edited),env);
  assert.equal(r.status,503);
  assert.deepEqual(await r.json(),{error:'webhook_quarantine_unavailable'});
  assert.equal(db.writes,1);
  assert.equal(db.rows.size,1);
});
test('completed opt-out is quarantined as a review signal, never a CRM suppression write',async()=>{
  const db=memoryD1(),env=fixture(db);
  const copy=clone(event);
  copy.events[0].event_data.transcripts[0].transcript_segments[1].text=
    'मुझे दोबारा कॉल मत करना।';
  const r=await worker.fetch(request(copy),env);
  assert.equal(r.status,200);
  assert.equal(db.rows.size,1);
  assert.equal([...db.rows.values()][0].possible_opt_out,1);
});
test('separate session_end receipt is accepted without pretending final transcript is included',async()=>{
  const db=memoryD1(),env=fixture(db);
  const end={...event,session_state:'session_end',trigger_reason:'end',events:[]};
  const a=await worker.fetch(request(end,{route:'session-end'}),env);
  assert.equal(a.status,200);
  const b=await worker.fetch(request(end,{route:'session-end'}),env);
  assert.equal(b.status,200);
  assert.equal(db.writes,1);
  assert.equal([...db.rows.values()][0].event_kind,'session_end');
  assert.equal([...db.rows.values()][0].turn_status,'none');
  assert.equal((await worker.fetch(request(end,{route:'transcript-events'}),env)).status,422);
});

test('authenticated explicit Exotel Test URL probes receive vendor ACK without D1 or CRM writes',async()=>{
  const db=memoryD1(),env=fixture(db);
  for(const probe of [
    {test:true},
    {is_test:true},
    {webhook_test:true,message:'Test the webhook'},
    {event:'test',timestamp:'2026-11-20T10:00:00Z'},
    {type:'webhook_test',webhook_type:'transcript_events'},
    {event_type:'ping',source:'exotel'}
  ]){
    const res=await worker.fetch(request(probe),env);
    assert.equal(res.status,200,JSON.stringify(probe));
    assert.deepEqual(await res.json(),{http_code:200,response:{data:{}}});
  }
  assert.equal(db.writes,0);
  assert.equal(db.reads,0);
});
test('test marker cannot disguise real calls or malformed transcript payloads',async()=>{
  const db=memoryD1(),env=fixture(db);
  for(const bad of [
    {test:true,session_id:'call-session-id'},
    {type:'test',events:[]},
    {test:true,contact_uri:'+919876543210'},
    {test:true,phone:'+919876543210'},
    {test:true,unrecognized_field:'x'},
    {test:false},
    {event:'sample_transcript'},
    {message:'test'},
    {...event,test:true,session_id:'!'},
    {test:true,description:'x'.repeat(2000)}
  ]){
    const r=await worker.fetch(request(bad),env);
    assert.equal(r.status,400,JSON.stringify(bad).slice(0,100));
    const v=await r.json();
    assert.equal(v.error,'invalid_webhook_payload');
  }
  assert.equal(db.writes,0);
});
test('Exotel diagnostic reveals only documented top-level field presence, never values',async()=>{
  const db=memoryD1(),env=fixture(db);
  const input={
    session_id:'PRIVATE_CALL_SID',contact_uri:'+919876543210',
    custom_parameters:{mobile:'+919876543210'},
    somePrivateText:'₹20 lakh in Raipur'
  };
  const res=await worker.fetch(request(input),env);
  assert.equal(res.status,400);
  const data=await res.json();
  assert.equal(data.validation,'session identity');
  assert.deepEqual(data.present_fields,['session_id']);
  for(const pii of ['PRIVATE_CALL_SID','+919876543210','₹20 lakh','somePrivateText']){
    assert.ok(!JSON.stringify(data).includes(pii),pii);
  }
});
test('even explicit verification request requires matching private Bearer token',async()=>{
  const env=fixture(memoryD1());
  assert.equal((await worker.fetch(request({test:true},{token:null}),env)).status,401);
  assert.equal((await worker.fetch(request({test:true},{token:'f'.repeat(64)}),env)).status,401);
});

test('official Exotel docs literal placeholder example is ACKed as an authenticated no-write connectivity check',async()=>{
  const db=memoryD1(),env=fixture(db);
  const sample={
    session_id:'<voicebot session id>',
    conversation_id:'<voicebot conversation id>',
    start_time:'2025-07-16T11:40:57.000Z',end_time:null,
    landing_number:'',
    external_id:'CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    session_state:'session_start | session_in_progress | session_end',
    trigger_reason:'timer | turn-complete | turn-progress | pre-agent-transfer | start | end',
    contact_uri:'<phone number / endpoint>',network_type:'sip | pstn',
    account_id:'',bot_id:'bot_uuid',bot_name:'bot_name',
    metadata:{call_sid:'CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',stream_sid:''},
    custom_parameters:{key1:'value1',key2:'value2'},
    events:[{event_type:'sentiment',event_id:'evt_1',event_data:{}}]
  };
  let res=await worker.fetch(request(sample),env);
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{http_code:200,response:{data:{}}});
  assert.equal(db.writes,0);
  assert.equal(db.reads,0);
  // Require the exact documented placeholder values; never ACK an
  // alternate malformed pseudo-call as a docs fixture.
  for(const altered of [
    {...sample,session_id:'<random session id>'},
    {...sample,external_id:'CArealbad'},
    {...sample,metadata:{call_sid:'CArealbad',stream_sid:''}},
    {...sample,events:[{event_type:'transcript',event_id:'evt_1',event_data:{}}]},
    {...sample,session_state:'session_in_progress'},
    {...sample,network_type:'pstn'}
  ]){
    res=await worker.fetch(request(altered),env);
    assert.equal(res.status,400);
    const info=await res.json();
    assert.equal(info.error,'invalid_webhook_payload');
    assert.ok(!JSON.stringify(info).includes('<voicebot session id>'));
  }
  assert.equal(db.writes,0);
});
test('vendor validation categories and field flags are redacted and accurately identify malformed samples',async()=>{
  const db=memoryD1(),env=fixture(db);
  const input={...event,account_id:12,contact_uri:'+919876543210',
    custom_parameters:{mobile:'+919876543210'}};
  const res=await worker.fetch(request(input),env);
  assert.equal(res.status,400);
  const info=await res.json();
  assert.equal(info.validation,'account');
  assert.deepEqual(info.format_checks,{
    session_id:true,conversation_id:true,external_id:true,session_state:true,
    trigger_reason:true,network_type:true,events:true
  });
  assert.equal(info.documentation_sample,false);
  for(const pii of ['919876543210','CAfictionalcall2026','test123','a3a3a3',
    'fictional-session-2026']){
    assert.ok(!JSON.stringify(info).includes(pii));
  }
  assert.equal(db.writes,0);
});
