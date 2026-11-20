import test from 'node:test';
import assert from 'node:assert/strict';
import {probeExotelConnectivity} from '../src/provider-connectivity.mjs';

const env={
  EXOTEL_ACCOUNT_SID:'test123',
  EXOTEL_API_KEY:'fictional_api_key_only',
  EXOTEL_API_TOKEN:'fictional_api_token_only',
  EXOTEL_REGION:'singapore'
};
const SECRET='fictional_api_token_only';
const vendorBody='SENSITIVE vendor body '+SECRET+' +919876543210';

test('Exotel HTTP failures are classified without vendor responses, credentials or PII',async()=>{
  for(const [status,code] of [
    [401,'http_401'],[403,'http_403'],[404,'http_404'],[429,'http_429'],
    [500,'http_5xx'],[503,'http_5xx'],[402,'unexpected_http_status']
  ]){
    let requests=0;
    const r=await probeExotelConnectivity(env,{apiFetch:async(url,opts)=>{
      requests++;
      assert.equal(url,'https://api.exotel.com/v1/Accounts/test123/Calls.json?PageSize=1');
      assert.equal(opts.method,'GET');
      return new Response(vendorBody,{status,headers:{'Content-Type':'text/plain'}});
    }});
    assert.equal(requests,1);
    assert.equal(r.configured,true);
    assert.equal(r.verified,false);
    assert.equal(r.checkCode,code);
    assert.equal(r.outboundCallsEnabled,false);
    assert.equal(r.voiceStreamingEnabled,false);
    const display=JSON.stringify(r);
    assert.ok(!display.includes(SECRET),String(status));
    assert.ok(!display.includes('+919876543210'),String(status));
    assert.ok(!display.includes('test123'),String(status));
    assert.ok(!display.includes(vendorBody),String(status));
  }
});
test('Exotel JSON schema and content-type errors are safe, not reported as invalid credentials',async()=>{
  for(const [response,expected] of [
    [Response.json({RestException:{Message:vendorBody}}),'unexpected_call_list_schema'],
    [new Response('<html>Unauthorized</html>',{status:200,headers:{'Content-Type':'text/html'}}),'unexpected_content_type'],
    [new Response('{', {status:200,headers:{'Content-Type':'application/json'}}),'invalid_response_json'],
    [new Response(JSON.stringify({Calls:[]})+' '.repeat(70000),
      {status:200,headers:{'Content-Type':'application/json'}}),'response_unreadable']
  ]){
    const result=await probeExotelConnectivity(env,{apiFetch:async()=>response});
    assert.equal(result.checkCode,expected);
    assert.equal(result.verified,false);
    assert.equal(result.outboundCallsEnabled,false);
    assert.ok(!JSON.stringify(result).includes(SECRET));
    assert.ok(!JSON.stringify(result).includes(vendorBody));
  }
});
test('Exotel transport error cannot echo private exception text or start a call',async()=>{
  const result=await probeExotelConnectivity(env,{
    apiFetch:async()=>{throw Error('SECRET_PRIVATE '+SECRET+' '+vendorBody)}
  });
  assert.equal(result.checkCode,'transport_unavailable');
  assert.equal(result.verified,false);
  assert.equal(result.outboundCallsEnabled,false);
  assert.ok(!JSON.stringify(result).includes('SECRET_PRIVATE'));
  assert.ok(!JSON.stringify(result).includes(SECRET));
});
test('Exotel legitimate empty call list verifies read-only without generating a call',async()=>{
  const r=await probeExotelConnectivity(env,{
    apiFetch:async()=>Response.json({Metadata:{Total:0},Calls:[]})
  });
  assert.equal(r.verified,true);
  assert.equal(r.outboundCallsEnabled,false);
  assert.equal(r.voiceStreamingEnabled,false);
  assert.equal(r.checkCode,undefined);
});
