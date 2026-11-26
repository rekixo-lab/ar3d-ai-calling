import test from 'node:test';
import assert from 'node:assert/strict';
import {readPlivoBalance} from '../src/provider-balance.mjs';

const env={PLIVO_AUTH_ID:'MAsyntheticbalance123',PLIVO_AUTH_TOKEN:'syntheticTokenForTest123456789'};
const now=1795690800000;
const account={auth_id:env.PLIVO_AUTH_ID,account_type:'standard',billing_mode:'prepaid',cash_credits:'10.123456789'};
const read=(data=account,extra={})=>readPlivoBalance(env,{now,fetcher:async()=>Response.json(data),...extra});

test('read-only Plivo observation uses strict account identity, Basic auth, manual redirects and an abort signal',async()=>{
 let calls=0;
 const result=await read(account,{fetcher:async(url,options)=>{
  calls++;
  assert.equal(url,'https://api.plivo.com/v1/Account/'+env.PLIVO_AUTH_ID+'/');
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'manual');
  assert.equal(options.headers.Authorization,'Basic '+btoa(env.PLIVO_AUTH_ID+':'+env.PLIVO_AUTH_TOKEN));
  assert.equal(options.headers.Accept,'application/json');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.body,undefined);
  return Response.json(account);
 }});
 assert.equal(calls,1);
 assert.deepEqual(result,{available:true,provider:'plivo',currency:'USD',balanceMicros:10123456,
  accountType:'standard',billingMode:'prepaid',productionEligible:true,checkedAt:now,reason:'verified_account_balance'});
 assert.equal(JSON.stringify(result).includes(env.PLIVO_AUTH_ID),false);
 assert.equal(JSON.stringify(result).includes(env.PLIVO_AUTH_TOKEN),false);
});

test('decimal conversion floors sub-micros without floating point upward rounding',async()=>{
 for(const [cash_credits,expected] of [['0',0],['0.000000999999999999',0],['1.000001999999999999',1000001],
  ['0.999999999999999999',999999],['999999.999999999999',999999999999],['0001.25',1250000]]){
  const result=await read({...account,cash_credits});
  assert.equal(result.available,true,cash_credits);
  assert.equal(result.balanceMicros,expected,cash_credits);
  if(expected===0)assert.equal(result.reason,'provider_balance_exhausted');
 }
});

test('trial, postpaid and unknown account metadata never grant paid prepaid eligibility',async()=>{
 for(const [change,reason] of [[{account_type:'developer'},'trial_account'],[{billing_mode:'postpaid'},'postpaid_account'],
  [{account_type:undefined},'account_type_unverified'],[{account_type:'professional'},'account_type_unverified'],
  [{billing_mode:undefined},'billing_mode_unverified']]){
  const result=await read({...account,...change});
  assert.equal(result.available,true);
  assert.equal(result.productionEligible,false);
  assert.equal(result.reason,reason);
 }
});

test('missing or mismatched identity and contradictory currency cannot fund the account',async()=>{
 for(const data of [{...account,auth_id:undefined},{...account,auth_id:'MAotheraccount123'}]){
  const result=await read(data);
  assert.equal(result.available,false);
  assert.equal(result.balanceMicros,null);
  assert.equal(result.reason,'provider_account_identity_mismatch');
 }
 const result=await read({...account,currency:'INR'});
 assert.equal(result.available,false);
 assert.equal(result.reason,'provider_balance_currency_unverified');
 assert.equal(result.currency,'USD');
 assert.equal((await read({...account,currency:'USD'})).available,true);
});

test('numbers, negative values, exponent notation, whitespace, nonfinite and overflow balances are rejected',async()=>{
 for(const cash_credits of [10.25,null,undefined,'-0','-1','+2','1e3',' 2.00','2.00 ','NaN','Infinity',
  '.5','5.','1,000','1000000','9999999999999999999','1.0000000000000000001']){
  const result=await read({...account,cash_credits});
  assert.equal(result.available,false,String(cash_credits));
  assert.equal(result.balanceMicros,null,String(cash_credits));
  assert.equal(result.productionEligible,false,String(cash_credits));
  assert.equal(result.reason,'provider_balance_invalid',String(cash_credits));
 }
});

test('invalid credential or timestamp configuration makes no provider request',async()=>{
 let calls=0;
 const fetcher=async()=>{calls++;return Response.json(account);};
 for(const change of [{PLIVO_AUTH_ID:undefined},{PLIVO_AUTH_ID:'unsafe/id'},{PLIVO_AUTH_TOKEN:'short'},{PLIVO_AUTH_TOKEN:'has a space and many chars'}]){
  const result=await readPlivoBalance({...env,...change},{now,fetcher});
  assert.equal(result.available,false);
  assert.equal(result.reason,'plivo_credentials_not_configured');
 }
 assert.equal((await read(account,{now:NaN,fetcher})).reason,'observation_time_invalid');
 assert.equal(calls,0);
});

test('redirect, authentication, rate and network failures retain no unverified balance',async()=>{
 for(const [status,reason] of [[301,'provider_redirect_rejected'],[302,'provider_redirect_rejected'],[307,'provider_redirect_rejected'],
  [401,'provider_authentication_failed'],[403,'provider_authentication_failed'],[402,'provider_balance_http_error'],
  [429,'provider_balance_http_error'],[503,'provider_balance_http_error']]){
  const result=await read(account,{fetcher:async()=>new Response('untrusted',{status,headers:{Location:'https://example.invalid/'}})});
  assert.equal(result.available,false);
  assert.equal(result.balanceMicros,null);
  assert.equal(result.reason,reason);
 }
 const result=await read(account,{fetcher:async()=>{throw Error('network with '+env.PLIVO_AUTH_TOKEN);}});
 assert.equal(result.reason,'provider_balance_unavailable');
 assert.equal(JSON.stringify(result).includes(env.PLIVO_AUTH_TOKEN),false);
});

test('malformed JSON, wrong media type, absent body and non-object responses fail closed',async()=>{
 for(const fetcher of [
  async()=>new Response('{',{headers:{'content-type':'application/json'}}),
  async()=>new Response(JSON.stringify(account),{headers:{'content-type':'text/html'}}),
  async()=>new Response(JSON.stringify(account),{headers:{'content-type':'text/notjson'}}),
  async()=>new Response(null,{status:204}),
  async()=>Response.json(null),async()=>Response.json([account]),async()=>Response.json('account')
 ]){
  const result=await read(account,{fetcher});
  assert.equal(result.available,false);
  assert.equal(result.reason,'provider_response_invalid');
 }
});

test('body size is limited by streamed bytes even without a content-length header',async()=>{
 let canceled=false,pulls=0;
 const body=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(4097).fill(32));},cancel(){canceled=true;}});
 const result=await read(account,{fetcher:async()=>new Response(body,{headers:{'content-type':'application/json'}})});
 assert.equal(result.reason,'provider_response_invalid');
 assert.equal(canceled,true);
 assert.ok(pulls<=3);
 const largeHeader=await read(account,{fetcher:async()=>new Response(JSON.stringify(account),{
  headers:{'content-type':'application/json','content-length':'8193'}})});
 assert.equal(largeHeader.reason,'provider_response_invalid');
});

test('invalid UTF-8 and a body stream error do not leak partial observations',async()=>{
 const malformed=await read(account,{fetcher:async()=>new Response(new Uint8Array([0xff,0xfe]),{
  headers:{'content-type':'application/json'}})});
 assert.equal(malformed.reason,'provider_response_invalid');
 const failed=await read(account,{fetcher:async()=>new Response(new ReadableStream({start(c){c.error(Error('private provider content'));}}),{
  headers:{'content-type':'application/json'}})});
 assert.equal(failed.reason,'provider_response_invalid');
 assert.equal(failed.balanceMicros,null);
});

test('the five-second deadline covers both connection and a stalled response body',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let signal;
 const connect=read(account,{fetcher:(_url,options)=>{signal=options.signal;return new Promise(()=>{});}});
 t.mock.timers.tick(5000);
 assert.equal((await connect).reason,'provider_balance_timeout');
 assert.equal(signal.aborted,true);
 let canceled=false;
 const stalled=read(account,{fetcher:async()=>new Response(new ReadableStream({cancel(){canceled=true;}}),{
  headers:{'content-type':'application/json'}})});
 // Let the resolved fetch enter its streaming read before advancing the same
 // request-wide deadline; no wall-clock wait or outbound request is involved.
 await new Promise(resolve=>setImmediate(resolve));
 t.mock.timers.tick(5000);
 const result=await stalled;
 assert.equal(result.reason,'provider_balance_timeout');
 assert.equal(result.balanceMicros,null);
 assert.equal(canceled,true);
});
