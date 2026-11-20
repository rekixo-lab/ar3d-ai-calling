import test from 'node:test';
import assert from 'node:assert/strict';
import {exotelApiBase,configuredExotelRegion} from '../src/exotel-region.mjs';
import {probeExotelConnectivity} from '../src/provider-connectivity.mjs';
import {checkExotelAccountReadOnly,verifyExotelExistingCallReadOnly}
  from '../src/exotel-readonly-verification.mjs';
import {buildExotelVoiceAiContract} from '../src/exotel-voice-adapter.mjs';
import {prepareExotelConnectRequest} from '../src/exotel-http-preparation.mjs';

const account={
  accountSid:'fictional_account',
  apiKey:'fictional_key_sandbox_2026',
  apiToken:'fictional_token_sandbox_2026'
};
test('Exotel hosts are limited to two official HTTPS hostnames',()=>{
  assert.equal(exotelApiBase('india'),'https://api.in.exotel.com');
  assert.equal(exotelApiBase('singapore'),'https://api.exotel.com');
  for(const region of [undefined,null,'', 'mumbai','Singapore','https://api.exotel.com',
    'singapore.evil.invalid','../singapore','localhost','http://api.exotel.com']){
    assert.throws(()=>exotelApiBase(region),/invalid Exotel account region/);
    assert.equal(configuredExotelRegion({EXOTEL_REGION:region}),null);
  }
  assert.equal(configuredExotelRegion({EXOTEL_REGION:'singapore'}),'singapore');
});
test('newly connected account must provide region before any external API fetch',async()=>{
  let calls=0;
  const fake=async()=>{calls++;return Response.json({Calls:[]})};
  const noRegion=await probeExotelConnectivity({
    EXOTEL_ACCOUNT_SID:account.accountSid,
    EXOTEL_API_KEY:account.apiKey,
    EXOTEL_API_TOKEN:account.apiToken
  },{apiFetch:fake});
  assert.equal(noRegion.verified,false);
  assert.equal(noRegion.configured,false);
  assert.equal(noRegion.apiRegionConfigured,false);
  assert.equal(calls,0);
  for(const rejected of ['http://evil.invalid','mumbai']){
    const x=await probeExotelConnectivity({
      EXOTEL_ACCOUNT_SID:account.accountSid,
      EXOTEL_API_KEY:account.apiKey,
      EXOTEL_API_TOKEN:account.apiToken,
      EXOTEL_REGION:rejected
    },{apiFetch:fake});
    assert.equal(x.verified,false);
    assert.equal(calls,0);
  }
});
test('seven-character Exotel SID reaches only the read-only regional account GET',async()=>{
  let called=0;
  const env={
    EXOTEL_ACCOUNT_SID:'test123',
    EXOTEL_API_KEY:account.apiKey,
    EXOTEL_API_TOKEN:account.apiToken,
    EXOTEL_REGION:'singapore'
  };
  const result=await probeExotelConnectivity(env,{apiFetch:async(url,opts)=>{
    called++;
    assert.equal(url,'https://api.exotel.com/v1/Accounts/test123/Calls.json?PageSize=1');
    assert.equal(opts.method,'GET');
    return Response.json({Calls:[]});
  }});
  assert.equal(result.configured,true);
  assert.equal(result.verified,true);
  assert.equal(result.apiRegionStatus,'configured');
  assert.equal(called,1);
  const invalid=await probeExotelConnectivity({...env,EXOTEL_REGION:'Singapore'},{
    apiFetch:async()=>{throw Error('should not call invalid region')}
  });
  assert.equal(invalid.apiRegionStatus,'invalid');
  assert.equal(invalid.verified,false);
  assert.equal(invalid.outboundCallsEnabled,false);
  assert.ok(!JSON.stringify(invalid).includes(account.apiToken));
});
test('Singapore Exotel account check is read-only and uses correct Singapore endpoint',async()=>{
  let seen;
  const env={
    EXOTEL_ACCOUNT_SID:account.accountSid,
    EXOTEL_API_KEY:account.apiKey,
    EXOTEL_API_TOKEN:account.apiToken,
    EXOTEL_REGION:'singapore'
  };
  const result=await probeExotelConnectivity(env,{apiFetch:async(url,opts)=>{
    seen={url,opts};return Response.json({Calls:[]})
  }});
  assert.equal(result.verified,true);
  assert.equal(result.configured,true);
  assert.equal(result.apiRegion,'singapore');
  assert.equal(result.outboundCallsEnabled,false);
  assert.equal(result.voiceStreamingEnabled,false);
  assert.equal(seen.url,
    'https://api.exotel.com/v1/Accounts/fictional_account/Calls.json?PageSize=1');
  assert.equal(seen.opts.method,'GET');
  assert.equal(seen.opts.redirect,'manual');
  assert.ok(!JSON.stringify(result).includes(account.apiKey));
  assert.ok(!JSON.stringify(result).includes(account.apiToken));
});
test('existing-call read only proof uses the account-specific region',async()=>{
  let called;
  const expected={
    callSid:'fictionalcall12345',status:'completed',
    direction:'outbound-api',callerId:'01234567890'
  };
  const result=await verifyExotelExistingCallReadOnly(
    {...account,region:'singapore'},expected,{apiFetch:async(url)=>{
      called=url;
      return Response.json({Call:{
        Sid:expected.callSid,Status:expected.status,
        Direction:expected.direction,PhoneNumberSid:expected.callerId,
        AccountSid:account.accountSid
      }})
    }}
  );
  assert.equal(result.providerLookupSucceeded,true);
  assert.equal(result.liveCallingAuthorized,false);
  assert.equal(called,
    'https://api.exotel.com/v1/Accounts/fictional_account/Calls/fictionalcall12345.json?details=true');
});
test('prepared but disabled Voice AI request can target Singapore; cannot accept arbitrary API host',async()=>{
  const cfg={
    accountSid:'fictional_account',region:'singapore',
    from:'+919000000001',callerId:'01234567890',
    streamUrl:'wss://fixture.example.invalid/media'
  };
  const planned=buildExotelVoiceAiContract(cfg);
  assert.equal(planned.endpoint,
    'https://api.exotel.com/v1/Accounts/fictional_account/Calls/connect');
  assert.equal(planned.executionAllowed,false);
  const req=prepareExotelConnectRequest(cfg,{
    apiKey:account.apiKey,apiToken:account.apiToken
  });
  assert.equal(req.url,planned.endpoint);
  assert.equal(req.method,'POST');
  assert.throws(()=>buildExotelVoiceAiContract({...cfg,
    region:'http://malicious.invalid'}),/invalid/);
  assert.throws(()=>buildExotelVoiceAiContract({...cfg,apiHost:'malicious.invalid'}),/invalid/);
  assert.ok(!JSON.stringify(planned).includes(account.apiToken));
});
