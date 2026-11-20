import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {ipv4Integer,parseApprovedExotelCidrs,checkExotelWebhookNetwork}
  from '../src/exotel-webhook-network-guard.mjs';

const token='e'.repeat(64);
const path='https://aicalling.ar3dstudio.in/v1/provider/exotel/voicebot/transcript-events';
const validEvent={
  session_id:'fictional_session_2026',
  conversation_id:'fictional_conversation_2026',
  external_id:'CAfictional_2026',
  account_id:'accttest',
  session_state:'session_in_progress',trigger_reason:'turn-complete',
  network_type:'pstn',metadata:{call_sid:'CAfictional_2026'},
  events:[{event_id:'event_01',event_type:'transcript',event_data:{
    transcripts:[{sequence:1,status:'completed',
      transcript_segments:[{speaker:'user',text:'fictional request for plots'}]}]
  }}]
};
function db(){
  const rows=new Map();let writes=0;
  return {
    get writes(){return writes},
    rows,
    prepare(sql){return {bind(...args){return {
      sql,args,
      async first(){return rows.get(args[0])??null}
    }}}},
    async batch(statements){
      return statements.map(statement=>{
        const args=statement.args;
        const row={account_fingerprint:args[1],session_fingerprint:args[2],
          call_fingerprint:args[3],conversation_fingerprint:args[4],
          event_fingerprint:args[5],payload_digest:args[6],
          event_kind:args[7],turn_status:args[8],possible_opt_out:args[9],
          status:'quarantined'};
        if(rows.has(args[0]))return {meta:{changes:0}};
        rows.set(args[0],row);writes++;
        return {meta:{changes:1}};
      });
    }
  };
}
function request(ip,auth='Bearer '+token,extraHeaders={}){
  return new Request(path,{
    method:'POST',headers:{
      'content-type':'application/json',
      ...(ip===null?{}:{'CF-Connecting-IP':ip}),
      ...(auth===null?{}:{Authorization:auth}),
      ...extraHeaders
    },body:JSON.stringify(validEvent)
  });
}
test('strict approved IPv4 CIDR parser rejects broad, private, IPv6 and ambiguous ranges',()=>{
  const accepted=parseApprovedExotelCidrs('8.8.8.0/24, 1.1.1.1');
  assert.equal(accepted.length,2);
  assert.equal(ipv4Integer('8.8.8.8'),134744072);
  for(const value of ['8.8.08.8','256.8.8.8','8.8.8','::ffff:8.8.8.8',
    '8.8.8.8\nX-Test: true','1.2.3.04',42,null])
    assert.equal(ipv4Integer(value),null,String(value));
  for(const invalid of ['', ' ', '8.8.8.8/24','8.8.8.0/12',
    '8.8.8.0/33','0.0.0.0/0','10.0.0.0/24','127.0.0.0/24',
    '192.168.1.0/24','172.16.0.1','198.51.100.0/24',
    '203.0.113.0/24','8.8.8.8,','8.8.8.0/24, 8.8.8.0/24',
    '8.8.8.0/24\n1.1.1.0/24','::1/128','8.8.8.0/24,,1.1.1.1',
    '8.8.8.0/24,'.repeat(40)])
    assert.equal(parseApprovedExotelCidrs(invalid),null,invalid.slice(0,35));
});
test('source match reads only Cloudflare edge header; never XFF / body supplied IP',()=>{
  const config={EXOTEL_VOICEBOT_ALLOWED_SOURCE_IPV4_CIDRS:'8.8.8.0/24,1.1.1.1'};
  assert.equal(checkExotelWebhookNetwork(request('8.8.8.8'),config).state,
    'source_network_allowlisted');
  assert.equal(checkExotelWebhookNetwork(request('8.8.9.8'),config).state,
    'not_allowlisted');
  assert.equal(checkExotelWebhookNetwork(request(null,undefined,{
    'X-Forwarded-For':'8.8.8.8'}),config).state,'not_allowlisted');
  assert.equal(checkExotelWebhookNetwork(request('10.0.0.1'),config).state,
    'not_allowlisted');
  assert.equal(checkExotelWebhookNetwork(request('::ffff:8.8.8.8'),config).state,
    'not_allowlisted');
  assert.equal(checkExotelWebhookNetwork(request('8.8.8.8'),{}).state,
    'bearer_only_quarantine');
  for(const invalid of ['', '10.0.0.0/8','8.8.8.8/25']){
    assert.equal(checkExotelWebhookNetwork(request('8.8.8.8'),{
      EXOTEL_VOICEBOT_ALLOWED_SOURCE_IPV4_CIDRS:invalid
    }).state,'invalid_allowlist');
  }
});
test('configured CIDR denies unsigned/wrong source before transcript parsing or D1',async()=>{
  const memory=db(),env={CONTROL_DB:memory,
    EXOTEL_VOICEBOT_WEBHOOK_TOKEN:token,EXOTEL_ACCOUNT_SID:'accttest',
    EXOTEL_VOICEBOT_ALLOWED_SOURCE_IPV4_CIDRS:'8.8.8.0/24'};
  let r=await worker.fetch(request('8.8.9.9'),env);
  assert.equal(r.status,403);
  assert.deepEqual(await r.json(),{error:'webhook_source_not_allowed'});
  r=await worker.fetch(request(null,'Bearer '+token,{
    'X-Forwarded-For':'8.8.8.8'
  }),env);
  assert.equal(r.status,403);
  r=await worker.fetch(request('8.8.8.8','Bearer '+'0'.repeat(64)),env);
  assert.equal(r.status,401,'bearer remains mandatory even from allowed IP');
  r=await worker.fetch(request('8.8.8.8'),{
    ...env,EXOTEL_VOICEBOT_ALLOWED_SOURCE_IPV4_CIDRS:'8.8.8.8/16'
  });
  assert.equal(r.status,503,'invalid allowlist fails closed');
  assert.equal(memory.writes,0);
  assert.equal(memory.rows.size,0);
});
test('configured permitted source still only saves hashed quarantined metadata',async()=>{
  const memory=db(),env={CONTROL_DB:memory,
    EXOTEL_VOICEBOT_WEBHOOK_TOKEN:token,EXOTEL_ACCOUNT_SID:'accttest',
    EXOTEL_VOICEBOT_ALLOWED_SOURCE_IPV4_CIDRS:'8.8.8.0/24'};
  let r=await worker.fetch(request('8.8.8.8'),env);
  assert.equal(r.status,200);
  assert.equal(memory.writes,1);
  assert.equal(memory.rows.size,1);
  r=await worker.fetch(request('8.8.8.100'),env);
  assert.equal(r.status,200);
  assert.equal(memory.writes,1,'duplicate receipt must not be written again');
  for(const value of Object.values([...memory.rows.values()][0])){
    const text=String(value);
    for(const sensitive of ['fictional request','CAfictional','8.8.8.8',token])
      assert.ok(!text.includes(sensitive),sensitive);
  }
});
