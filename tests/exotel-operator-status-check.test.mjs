import test from 'node:test';
import assert from 'node:assert/strict';
import {handleExotelOperatorStatusCheck} from '../src/exotel-operator-status-check.mjs';
import {getExotelOperatorTestStatusReadOnly} from '../src/exotel-readonly-verification.mjs';

const uid='123e4567-e89b-42d3-a456-426614174000';
const user={id:uid,globalRole:'super_admin',token_hash:'e'.repeat(64)};
const requestId='00112233-4455-4677-8899-aabbccddeeff';
const sid='CA00000000000000000000000000000000';
const now=Date.parse('2026-11-20T13:00:00.000Z');
const env={
  EXOTEL_ACCOUNT_SID:'rekixo1',
  EXOTEL_API_KEY:'FictionalKey0123456789',
  EXOTEL_API_TOKEN:'FictionalToken9876543210',
  EXOTEL_REGION:'singapore',
  EXOTEL_CALLER_ID:'09513886363',
  EXOTEL_OPERATOR_TEST_ENABLED:'',
  EXOTEL_VERIFIED_TEST_NUMBER:'',
  EXOTEL_VOICE_AI_FLOW_ID:'',
};
const body={requestId};
const req=(payload=body)=>new Request(
  'https://aicalling.ar3dstudio.in/v1/human/engineering/exotel-status-check',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
const providerBody={
  Call:{Sid:sid,AccountSid:'rekixo1',Direction:'outbound-api',
    PhoneNumberSid:'09513886363',Status:'completed',Duration:'17',
    To:'+919999999999',From:'+918888888888',Price:'123.45',
    RecordingUrl:'https://private.invalid/secret.mp3'}
};
class DB{
  constructor(){
    this.calls=[{id:requestId,actor:uid,callSid:sid,state:'submitted'}];
    this.checks=[];this.mfa=true;this.writes=0;
  }
  prepare(sql){
    const db=this;
    return {bind(...params){return {
      async first(){
        if(sql.includes('human_mfa_settings m JOIN human_sessions s'))
          return db.mfa&&params[0]===uid&&params[1]===user.token_hash?
            {enabled_at:'2026-11-20T12:00:00.000Z'}:null;
        if(sql.includes('FROM exotel_operator_test_calls')&&sql.includes('AS callSid')){
          const call=db.calls.find(c=>c.id===params[0]&&c.actor===params[1]&&c.state==='submitted');
          return call?{callSid:call.callSid}:null;
        }
        throw Error('unexpected first');
      },
      async run(){
        if(sql.startsWith('INSERT INTO exotel_operator_status_checks')){
          const [id,slot,createdAt,request,actor]=params;
          const call=db.calls.find(x=>x.id===request&&x.actor===actor&&x.state==='submitted');
          if(!call||db.checks.some(c=>c.callRequest===request&&c.slot===slot)||
             db.checks.filter(c=>c.callRequest===request).length>=12)
            return {meta:{changes:0}};
          db.checks.push({id,slot,createdAt,callRequest:request,actor,state:'reserved'});
          db.writes++;
          return {meta:{changes:1}};
        }
        if(sql.startsWith('UPDATE exotel_operator_status_checks')){
          const [state,status,duration,code,,id]=params;
          const row=db.checks.find(c=>c.id===id&&c.state==='reserved');
          if(!row)return {meta:{changes:0}};
          Object.assign(row,{state,status,duration,code});
          db.writes++;
          return {meta:{changes:1}};
        }
        throw Error('unexpected run');
      }
    }}};
  }
}
const okProvider=async(url,opts)=>{
  assert.equal(url,'https://api.exotel.com/v1/Accounts/rekixo1/Calls/'+sid+'.json?details=true');
  assert.equal(opts.method,'GET');
  assert.equal(opts.redirect,'manual');
  assert.equal(opts.cache,'no-store');
  assert.ok(opts.headers.Authorization.startsWith('Basic '));
  return Response.json(providerBody);
};
test('only registered operator CallSid can be reconciled; no API call starts',async()=>{
  const db=new DB();let requests=0;
  const res=await handleExotelOperatorStatusCheck(req(),{...env,CONTROL_DB:db},user,{
    now,apiFetch:async(...args)=>{requests++;return okProvider(...args)}
  });
  assert.equal(res.status,200);
  const result=await res.json();
  assert.equal(result.state,'verified');
  assert.equal(result.providerStatus,'completed');
  assert.equal(result.durationSeconds,17);
  assert.equal(result.dialRequestsStarted,0);
  assert.equal(result.crmLeadsUpdated,0);
  assert.equal(result.recordingsFetched,0);
  assert.equal(db.checks.length,1);
  assert.equal(db.checks[0].state,'verified');
  assert.equal(requests,1);
  const serialized=JSON.stringify({result,checks:db.checks});
  for(const sensitive of ['+919999999999','+918888888888','123.45','secret.mp3',
    env.EXOTEL_API_TOKEN,env.EXOTEL_API_KEY,'09513886363',sid])
    assert.ok(!serialized.includes(sensitive),sensitive);
});
test('second refresh in same five-minute slot is suppressed without network',async()=>{
  const db=new DB(),settings={...env,CONTROL_DB:db};let calls=0;
  const apiFetch=async(...args)=>{calls++;return okProvider(...args)};
  assert.equal((await handleExotelOperatorStatusCheck(req(),settings,user,{now,apiFetch})).status,200);
  const second=await handleExotelOperatorStatusCheck(req(),settings,user,{now:now+2000,apiFetch});
  assert.equal(second.status,429);
  assert.equal(calls,1);
});
test('wrong roles, old logins and forged request/call IDs cannot query provider',async()=>{
  const db=new DB(),settings={...env,CONTROL_DB:db};let calls=0;
  const apiFetch=async()=>{calls++;return Response.json(providerBody)};
  assert.equal((await handleExotelOperatorStatusCheck(req(),settings,
    {...user,globalRole:'client_admin'},{now,apiFetch})).status,403);
  db.mfa=false;
  assert.equal((await handleExotelOperatorStatusCheck(req(),settings,user,{now,apiFetch})).status,403);
  db.mfa=true;
  assert.equal((await handleExotelOperatorStatusCheck(req({
    requestId,callSid:sid
  }),settings,user,{now,apiFetch})).status,400);
  assert.equal((await handleExotelOperatorStatusCheck(req({requestId:
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  }),settings,user,{now,apiFetch})).status,404);
  assert.equal((await handleExotelOperatorStatusCheck(req(),settings,{
    ...user,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  },{now,apiFetch})).status,403);
  assert.equal(calls,0);
  assert.equal(db.writes,0);
});
test('disabled operator self-test flag still allows READ ONLY status of existing call',async()=>{
  const db=new DB(),settings={...env,CONTROL_DB:db};
  assert.equal(settings.EXOTEL_OPERATOR_TEST_ENABLED,'');
  const result=await handleExotelOperatorStatusCheck(req(),settings,user,{
    now,apiFetch:okProvider
  });
  assert.equal(result.status,200);
  assert.equal(db.calls[0].state,'submitted');
});
test('unconfirmed provider identity is quarantined and never exposed as a success',async()=>{
  const db=new DB(),settings={...env,CONTROL_DB:db};
  const res=await handleExotelOperatorStatusCheck(req(),settings,user,{
    now,apiFetch:async()=>Response.json({
      Call:{...providerBody.Call,AccountSid:'another_company'}
    })
  });
  assert.equal(res.status,502);
  const result=await res.json();
  assert.equal(result.state,'unknown');
  assert.equal(result.code,'provider_mismatch');
  assert.equal(db.checks[0].state,'unknown');
  assert.equal(db.checks[0].status,null);
  assert.ok(!JSON.stringify(result).includes('another_company'));
});
test('provider errors, redirects and bad JSON produce no provider claim or PII',async()=>{
  const db=new DB(),settings={...env,CONTROL_DB:db};
  const r=await handleExotelOperatorStatusCheck(req(),settings,user,{
    now,apiFetch:async()=>new Response('secret-call-data',{status:403})
  });
  assert.equal(r.status,502);
  const v=await r.json();
  assert.equal(v.state,'unknown');
  assert.equal(v.code,'provider_unavailable');
  assert.ok(!JSON.stringify(v).includes('secret-call-data'));
});
test('only final provider status enums and bounded numeric duration are trusted',async()=>{
  const auth={accountSid:env.EXOTEL_ACCOUNT_SID,apiKey:env.EXOTEL_API_KEY,
    apiToken:env.EXOTEL_API_TOKEN,region:env.EXOTEL_REGION};
  const known={callSid:sid,callerId:env.EXOTEL_CALLER_ID};
  const success=await getExotelOperatorTestStatusReadOnly(auth,known,{apiFetch:okProvider});
  assert.equal(success.durationSeconds,17);
  assert.equal(success.status,'completed');
  assert.equal(success.outboundCallsInitiated,0);
  for(const field of [
    {Status:'unverified'}, {Duration:'15.5'}, {Duration:'9999999'},
    {Direction:'inbound'}, {PhoneNumberSid:'08000000000'},
    {AccountSid:'otherSid'}, {Sid:'CAfake123456789'}
  ]){
    await assert.rejects(getExotelOperatorTestStatusReadOnly(auth,known,{
      apiFetch:async()=>Response.json({Call:{...providerBody.Call,...field}})
    }));
  }
  const pending=await getExotelOperatorTestStatusReadOnly(auth,known,{
    apiFetch:async()=>Response.json({Call:{
      ...providerBody.Call,Status:'in-progress',Duration:null
    }})
  });
  assert.equal(pending.status,'in-progress');assert.equal(pending.durationSeconds,null);
});
