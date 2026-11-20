import test from 'node:test';
import assert from 'node:assert/strict';
import {operatorTestConfig,makeOperatorTestRequest,validateOperatorTestResult,
  handleExotelOperatorTest} from '../src/exotel-operator-test-routes.mjs';

const user={id:'123e4567-e89b-42d3-a456-426614174000',globalRole:'super_admin'};
const envBase=Object.freeze({
  EXOTEL_OPERATOR_TEST_ENABLED:'enabled',
  EXOTEL_ACCOUNT_SID:'rekixo1',
  EXOTEL_API_KEY:'exampleAPiKey123456789',
  EXOTEL_API_TOKEN:'exampleToken123456789',
  EXOTEL_REGION:'singapore',
  EXOTEL_CALLER_ID:'09513886363',
  EXOTEL_VOICE_AI_FLOW_ID:'1392699',
  EXOTEL_VERIFIED_TEST_NUMBER:'+917415011511'
});
const at=Date.parse('2026-11-20T10:00:00Z');
const req=(method='GET',body=null)=>new Request(
  'https://aicalling.ar3dstudio.in/v1/human/engineering/exotel-self-test',
  {method,...(body?{body:JSON.stringify(body),headers:{'content-type':'application/json'}}:{})}
);
const confirm={confirm:'CALL_MY_VERIFIED_NUMBER_ONCE'};
class MockDb{
  constructor(){this.mfa=true;this.entries=[];this.writes=0}
  prepare(sql){
    const db=this;
    return {bind(...params){
      return {
        async first(){
          if(sql.includes('human_mfa_settings'))
            return db.mfa?{enabled_at:'2026-11-20T09:00:00Z'}:null;
          throw Error('unknown first '+sql)
        },
        async all(){
          if(sql.includes('SELECT id,state,error_code AS errorCode'))
            return {results:db.entries.filter(r=>r.actor===params[0]).map(r=>({
              id:r.id,state:r.state,errorCode:r.code||null,
              createdAt:r.createdAt
            })).reverse().slice(0,5)};
          throw Error('unknown all')
        },
        async run(){
          if(sql.startsWith('INSERT INTO exotel_operator_test_calls')){
            const [id,actor,slot,createdAt,,threshold]=params;
            if(db.entries.some(r=>r.slot===slot)||
              db.entries.filter(r=>r.createdAt>=threshold).length>=2)
              return {meta:{changes:0}};
            db.entries.push({id,actor,slot,createdAt,state:'reserved'});
            db.writes++;
            return {meta:{changes:1}};
          }
          if(sql.startsWith('UPDATE exotel_operator_test_calls')){
            const [state,sid,code,,id]=params;
            const row=db.entries.find(r=>r.id===id&&r.state==='reserved');
            if(!row)return {meta:{changes:0}};
            Object.assign(row,{state,sid,code});
            db.writes++;
            return {meta:{changes:1}};
          }
          throw Error('unknown run')
        }
      };
    }};
  }
}
const success=(caller='09513886363')=>new Response(JSON.stringify({Call:{
  Sid:'CA12345678912345678912345678912345',
  Status:'in-progress',Direction:'outbound-api',PhoneNumberSid:caller,
  RecordingUrl:null
}}),{status:200,headers:{'content-type':'application/json'}});

test('operator route is disabled without explicit operator consent and configured keys',async()=>{
  const db=new MockDb(),env={...envBase,CONTROL_DB:db,EXOTEL_OPERATOR_TEST_ENABLED:''};
  let called=0;
  const apiFetch=async()=>{called++;return success()};
  const r=await handleExotelOperatorTest(req('POST',confirm),env,user,{apiFetch,now:at});
  assert.equal(r.status,503);
  assert.equal(called,0);assert.equal(db.writes,0);
  const status=await (await handleExotelOperatorTest(req(),env,user)).json();
  assert.equal(status.configured,false);
  assert.ok(status.missing.includes('operator_explicit_opt_in'));
  assert.equal(status.destinationLast4,'1511');
  assert.ok(!JSON.stringify(status).includes('+917415011511'));
  assert.ok(!JSON.stringify(status).includes(env.EXOTEL_API_TOKEN));
});
test('only super-admin MFA signed-in actor can launch; forged target is rejected',async()=>{
  const db=new MockDb(),env={...envBase,CONTROL_DB:db};
  let called=0;const apiFetch=async()=>{called++;return success()};
  assert.equal((await handleExotelOperatorTest(req('POST',confirm),env,
    {...user,globalRole:null},{apiFetch,now:at})).status,403);
  db.mfa=false;
  assert.equal((await handleExotelOperatorTest(req('POST',confirm),env,user,
    {apiFetch,now:at})).status,403);
  db.mfa=true;
  assert.equal((await handleExotelOperatorTest(req('POST',
    {...confirm,mobile:'+919999999999'}),env,user,{apiFetch,now:at})).status,400);
  assert.equal(called,0);assert.equal(db.writes,0);
});
test('never accepts arbitrary API hosts, account names, flow IDs or recipient numbers',()=>{
  for(const key of ['EXOTEL_REGION','EXOTEL_VERIFIED_TEST_NUMBER',
    'EXOTEL_VOICE_AI_FLOW_ID','EXOTEL_CALLER_ID','EXOTEL_API_TOKEN']){
    const cfg={...envBase,[key]:'https://evil.invalid'};
    assert.equal(operatorTestConfig(cfg).ready,false,key);
  }
  const request=makeOperatorTestRequest(envBase);
  assert.equal(request.url,'https://api.exotel.com/v1/Accounts/rekixo1/Calls/connect');
  assert.equal(request.method,'POST');
  assert.equal(request.redirect,'manual');
  assert.equal(request.headers.get('authorization'),
    'Basic '+btoa(envBase.EXOTEL_API_KEY+':'+envBase.EXOTEL_API_TOKEN));
  return request.formData().then(body=>{
    assert.equal(body.get('From'),'+917415011511');
    assert.equal(body.get('CallerId'),'09513886363');
    assert.equal(body.get('Url'),'http://my.exotel.com/rekixo1/exoml/start_voice/1392699');
    assert.equal(body.get('Record'),'false');
    assert.equal(body.get('TimeLimit'),'120');
    assert.equal(body.has('StatusCallbackEvents'),false);
    assert.equal(body.has('StreamUrl'),false);
    assert.equal(body.has('CustomField'),false);
  });
});
test('one explicit approved self-test reserves before fetch, submits once and stores no phone',async()=>{
  const db=new MockDb(),env={...envBase,CONTROL_DB:db};
  let called=0;
  const apiFetch=async(request,opts)=>{
    called++;assert.equal(db.entries[0].state,'reserved');
    assert.ok(opts.signal);
    assert.equal(opts.redirect,'manual');
    const form=await request.formData();
    assert.equal(form.get('From'),envBase.EXOTEL_VERIFIED_TEST_NUMBER);
    return success();
  };
  const result=await handleExotelOperatorTest(req('POST',confirm),env,user,{apiFetch,now:at});
  assert.equal(result.status,202);
  const payload=await result.json();
  assert.equal(payload.state,'submitted');
  assert.equal(payload.crmUpdated,false);
  assert.equal(payload.realCallsRequested,1);
  assert.equal(called,1);
  assert.equal(db.entries.length,1);
  assert.equal(db.entries[0].state,'submitted');
  assert.ok(!JSON.stringify(db.entries).includes('7415011511'));
  const replay=await handleExotelOperatorTest(req('POST',confirm),env,user,
    {apiFetch,now:at+1000});
  assert.equal(replay.status,429);assert.equal(called,1);
});
test('unconfirmed provider response cannot be retried; rolling quota is two calls per day',async()=>{
  const db=new MockDb(),env={...envBase,CONTROL_DB:db};
  let called=0;
  const apiFetch=async()=>{
    called++;return success('09000000000');
  };
  const first=await handleExotelOperatorTest(req('POST',confirm),env,user,{apiFetch,now:at});
  assert.equal(first.status,502);
  assert.equal((await first.json()).state,'unknown');
  const second=await handleExotelOperatorTest(req('POST',confirm),env,user,
    {apiFetch,now:at+31*60*1000});
  assert.equal(second.status,502);
  const third=await handleExotelOperatorTest(req('POST',confirm),env,user,
    {apiFetch,now:at+62*60*1000});
  assert.equal(third.status,429);
  assert.equal(db.entries.length,2);assert.equal(called,2);
});
test('network timeout is unknown and permanent for that slot; HTTP 403 is a known provider refusal',async()=>{
  const db=new MockDb(),env={...envBase,CONTROL_DB:db};
  let result=await handleExotelOperatorTest(req('POST',confirm),env,user,{
    now:at,apiFetch:async()=>{throw Error('secret other tenant') }
  });
  assert.equal(result.status,502);
  assert.deepEqual(await result.json(),{
    requestId:db.entries[0].id,state:'unknown',
    notice:'Call outcome uncertain. Do not retry; check Exotel reports.'
  });
  result=await handleExotelOperatorTest(req('POST',confirm),env,user,{
    now:at+31*60*1000,
    apiFetch:async()=>new Response('any secret 403 body',{status:403})
  });
  assert.equal(result.status,502);
  assert.equal((await result.json()).code,'provider_http_403');
  assert.equal(db.entries[1].state,'rejected');
  assert.ok(!JSON.stringify(db.entries).includes('any secret'));
});
test('response must correlate provider call SID, outbound direction and caller ID; no recordings',()=>{
  const valid={Call:{Sid:'CA123456789',Status:'queued',PhoneNumberSid:'09513886363',
    Direction:'outbound-api',RecordingUrl:null}};
  assert.equal(validateOperatorTestResult(valid,'09513886363').status,'queued');
  for(const bad of [
    {...valid,Call:{...valid.Call,Direction:'inbound'}},
    {...valid,Call:{...valid.Call,PhoneNumberSid:'09513880000'}},
    {...valid,Call:{...valid.Call,RecordingUrl:'https://recordings.example/audio'}},
    {...valid,Call:{...valid.Call,Status:'failed'}},
    {...valid,Call:{...valid.Call,Sid:'invalid space'}}
  ])assert.throws(()=>validateOperatorTestResult(bad,'09513886363'));
});
