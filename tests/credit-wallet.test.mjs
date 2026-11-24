import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,admin,client} from './helpers/calling-fixture.mjs';
import {handleCreditWalletRequest} from '../src/credit-wallet-routes.mjs';

const base='https://app.example.invalid/v1/human/credits/';
const request=(path,method='GET',body)=>new Request(base+path,{
 method,headers:{origin:'https://app.example.invalid',...(body?{'content-type':'application/json'}:{})},
 ...(body?{body:JSON.stringify(body)}:{})
});
const route=(f,path,user=admin,method='GET',data,options)=>
 handleCreditWalletRequest(request(path,method,data),f.env,user,options);
function freshMfa(f){
 const now=Date.now();
 f.c.db.prepare("UPDATE human_sessions SET created_at=?,expires_at=? WHERE user_id='admin'")
 .run(new Date(now).toISOString(),now+3600000);
}

test('current-MFA admin sets provisional INR credit; client sees only own balance and no spend',async()=>{
 const f=fixture();
 try{
  freshMfa(f);
  let r=await route(f,'tenant?tenantId='+tid,client);
  assert.equal(r.status,200);let d=await r.json();
  assert.equal(d.plannedInr,0);assert.equal(d.spendableInr,null);
  assert.equal(d.callingEnabledByCredits,false);
  r=await route(f,'tenant',admin,'POST',{
   tenantId:tid,totalInr:500,expectedCurrentInr:0,
   reason:'Initial client package credit plan'});
  assert.equal(r.status,200,await r.clone().text());
  d=await r.json();assert.equal(d.plannedInr,500);assert.equal(d.status,'provisional_only');
  assert.equal(d.spendableInr,null);
  r=await route(f,'tenant?tenantId='+tid,client);
  d=await r.json();assert.equal(d.plannedInr,500);
  assert.ok(!JSON.stringify(d).includes('admin'));
  assert.equal(f.c.db.prepare('SELECT planned_paise AS n FROM tenant_credit_budgets WHERE tenant_id=?').get(tid).n,50000);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_credit_audit').get().n,1);
  assert.equal((await route(f,'overview')).status,200);
  d=await (await route(f,'overview')).json();assert.equal(d.plannedTotalInr,500);
  assert.equal(d.clientsWithPlan,1);
  assert.equal(d.verifiedProviderFunding,false);
  r=await route(f,'tenant',admin,'POST',{
   tenantId:tid,totalInr:300,expectedCurrentInr:500,
   reason:'Increase provisional package allocation'});
  assert.equal(r.status,200);
  assert.equal(f.c.db.prepare('SELECT planned_paise AS n FROM tenant_credit_budgets WHERE tenant_id=?').get(tid).n,30000);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_credit_audit').get().n,2);
 }finally{f.close()}
});

test('credit grants require current MFA, cannot double-use stale budget, refuse other tenant',async()=>{
 const f=fixture();
 try{
  const b={tenantId:tid,totalInr:500,expectedCurrentInr:0,reason:'Required audited provisional package'};
  assert.equal((await route(f,'tenant',client,'POST',b)).status,403);
  assert.equal((await route(f,'tenant',admin,'POST',b)).status,403);
  freshMfa(f);
  assert.equal((await route(f,'tenant',admin,'POST',b)).status,200);
  assert.equal((await route(f,'tenant',admin,'POST',b)).status,409);
  assert.equal((await route(f,'tenant',admin,'POST',{...b,totalInr:-10,expectedCurrentInr:500})).status,400);
  assert.equal((await route(f,'tenant',admin,'POST',{...b,totalInr:1000,expectedCurrentInr:500})).status,400);
  assert.equal((await route(f,'tenant',admin,'POST',{...b,totalInr:150,expectedCurrentInr:500})).status,400);
  assert.equal((await route(f,'tenant',admin,'POST',{...b,totalInr:1.5,expectedCurrentInr:500})).status,400);
  assert.equal((await route(f,'tenant',admin,'POST',{...b,reason:'short',expectedCurrentInr:500})).status,400);
  assert.equal((await route(f,'tenant',admin,'POST',{...b,extra:'force'})).status,400);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_credit_audit').get().n,1);
  const foreign='99999999-9999-4999-8999-999999999999';
  assert.equal((await route(f,'tenant?tenantId='+foreign,client)).status,403);
  assert.equal((await route(f,'tenant?tenantId='+foreign,admin)).status,404);
  assert.equal((await route(f,'overview',client)).status,403);
 }finally{f.close()}
});

test('Plivo balance is only Super Admin MFA, account type/currency are never inferred',async()=>{
 const f=fixture();
 try{
  f.env.PLIVO_AUTH_ID='TESTACCOUNT123';
  f.env.PLIVO_AUTH_TOKEN='SYNTHETICAUTHTOKEN123';
  assert.equal((await route(f,'provider',client)).status,403);
  freshMfa(f);
  let seen=0;
  const result=await route(f,'provider',admin,'GET',undefined,{fetcher:async(url,options)=>{
   seen++;
   assert.equal(url,'https://api.plivo.com/v1/Account/TESTACCOUNT123/');
   assert.equal(options.method,'GET');
    assert.equal(options.redirect,'manual');
   assert.ok(options.headers.Authorization.startsWith('Basic '));
   return Response.json({cash_credits:'1000.00',account_type:'developer',billing_mode:'prepaid'});
  }});
  assert.equal(result.status,200);
  const d=await result.json();
  assert.equal(d.cashCredits,'1000.00');assert.equal(d.accountType,'developer');
  assert.equal(d.cashCreditsCurrency,'unverified_for_India_account');
  assert.equal(d.verifiedInr,false);assert.equal(seen,1);
  assert.ok(!JSON.stringify(d).includes('TESTACCOUNT123'));
  assert.ok(!JSON.stringify(d).includes('SYNTHETICAUTHTOKEN123'));
  const outage=await route(f,'provider',admin,'GET',undefined,{fetcher:async()=>{throw Error('synthetic provider secret')}})
  assert.equal((await outage.json()).available,false);
  const noKeys=await route({...f,env:{...f.env,PLIVO_AUTH_TOKEN:undefined}},'provider',admin);
  assert.equal((await noKeys.json()).reason,'plivo_credentials_not_configured');
 }finally{f.close()}
});


test('Plivo connection check verifies only server credentials and masked rented-number inventory',async()=>{
 const f=fixture();
 try{
  f.env.PLIVO_AUTH_ID='TESTACCOUNT123';
  f.env.PLIVO_AUTH_TOKEN='SYNTHETICAUTHTOKEN123';
  f.env.AR3D_PLIVO_CALLER_NUMBER='+919123456789';
  assert.equal((await route(f,'provider-check',client)).status,403);
  freshMfa(f);
  const urls=[];
  const provider=async(url,opts)=>{
   urls.push(url);
   assert.equal(opts.method,'GET');
   assert.ok(opts.headers.Authorization.startsWith('Basic '));
   if(url.endsWith('/Number/?limit=20'))return Response.json({
    meta:{total_count:1},objects:[{number:'919123456789',voice_enabled:true}]
   });
   return Response.json({account_type:'developer'});
  };
  const r=await route(f,'provider-check',admin,'GET',undefined,{fetcher:provider});
  assert.equal(r.status,200,await r.clone().text());
  const d=await r.json();
  assert.equal(d.credentialsVerified,true);
  assert.equal(d.accountType,'developer');
  assert.equal(d.numberListAvailable,true);
  assert.equal(d.totalNumberCount,1);
  assert.equal(d.configuredCallerPresent,true);
  assert.equal(d.listedNumbers[0].maskedNumber,'••••6789');
  assert.equal(d.listedNumbers[0].voiceEnabled,true);
  assert.equal(d.kycVerified,false);
  assert.equal(d.routeApproved,false);
  assert.equal(d.callsEnabledByThisCheck,false);
  assert.deepEqual(urls,[
   'https://api.plivo.com/v1/Account/TESTACCOUNT123/',
   'https://api.plivo.com/v1/Account/TESTACCOUNT123/Number/?limit=20'
  ]);
  const raw=JSON.stringify(d);
  for(const secret of ['TESTACCOUNT123','SYNTHETICAUTHTOKEN123','919123456789'])
   assert.ok(!raw.includes(secret));
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_jobs').get().n,0);
 }finally{f.close()}
});

test('Plivo setup check fails safely on API rejection or partial rented-number inventory',async()=>{
 const f=fixture();
 try{
  freshMfa(f);
  f.env.PLIVO_AUTH_ID='TESTACCOUNT123';
  f.env.PLIVO_AUTH_TOKEN='SYNTHETICAUTHTOKEN123';
  f.env.AR3D_PLIVO_CALLER_NUMBER='+919123456789';
  const rejected=await route(f,'provider-check',admin,'GET',undefined,{
   fetcher:async()=>new Response('unauthorized',{status:401})
  });
  const denied=await rejected.json();
  assert.equal(denied.credentialsVerified,false);
  assert.equal(denied.kycVerified,false);
  const fallback=await route(f,'provider-check',admin,'GET',undefined,{
   fetcher:async(url)=>url.endsWith('/Number/?limit=20')?
    new Response('unavailable',{status:503}):Response.json({account_type:'standard'})
  });
  const d=await fallback.json();
  assert.equal(d.credentialsVerified,true);
  assert.equal(d.numberListAvailable,false);
  assert.equal(d.configuredCallerPresent,null);
  assert.equal(d.callsEnabledByThisCheck,false);
  assert.equal((await route(f,'provider-check?forceCall=true')).status,400);
  assert.equal((await route(f,'provider-check',admin,'POST',{x:1})).status,400);
 }finally{f.close()}
});

test('Plivo UsageSummary shows verified report currency without client-wallet debit',async()=>{
 const f=fixture();
 try{
  f.env.PLIVO_AUTH_ID='TESTACCOUNT123';
  f.env.PLIVO_AUTH_TOKEN='SYNTHETICAUTHTOKEN123';
  freshMfa(f);
  assert.equal((await route(f,'usage-summary',client)).status,403);
  const before=f.c.db.prepare('SELECT total_changes() AS n').get().n;
  const r=await route(f,'usage-summary',admin,'GET',undefined,{fetcher:async(url,options)=>{
   assert.match(url,/^https:\/\/api\.plivo\.com\/v1\/Account\/TESTACCOUNT123\/UsageSummary\/\?/);
   const query=new URL(url).searchParams;
   assert.equal(query.get('granularity'),'day');
   assert.equal(query.get('product'),'voice');
   assert.equal(query.get('direction'),'outbound');
   assert.equal(query.get('country'),'IN');
   assert.equal(query.get('page_size'),'100');
   assert.equal(options.method,'GET');
   assert.match(options.headers.Authorization,/^Basic /);
   return Response.json({
    meta:{auth_id:'TESTACCOUNT123',currency:'INR',total_spend:14.555,from_date:'2026-11-17'},
    usage:[{product:'voice',country:'IN',direction:'outbound',
     duration_seconds:105,total_units:2,total_amount:14.555}]
   });
  }});
  assert.equal(r.status,200,await r.clone().text());
  const d=await r.json();
  assert.equal(d.available,true);
  assert.equal(d.currency,'INR');
  assert.equal(d.listedCalls,2);
  assert.equal(d.listedBilledSeconds,105);
  assert.equal(d.listedAmount,'14.555000');
  assert.equal(d.providerWindowTotalSpend,'14.555000');
  assert.equal(d.clientWalletDebited,false);
  assert.equal(d.clientFundingVerified,false);
  assert.equal(d.listedRowsComplete,true);
  assert.equal(f.c.db.prepare('SELECT total_changes() AS n').get().n,before);
  assert.ok(!JSON.stringify(d).includes('TESTACCOUNT123'));
  assert.ok(!JSON.stringify(d).includes('SYNTHETICAUTHTOKEN123'));
 }finally{f.close()}
});

test('UsageSummary does not expose untrusted charge or misleading partial usage',async()=>{
 const f=fixture();
 try{
  f.env.PLIVO_AUTH_ID='TESTACCOUNT123';
  f.env.PLIVO_AUTH_TOKEN='SYNTHETICAUTHTOKEN123';
  freshMfa(f);
  const call=async(data)=>await(await route(f,'usage-summary',admin,'GET',undefined,{
   fetcher:async()=>Response.json(data)
  })).json();
  const good={meta:{auth_id:'TESTACCOUNT123',currency:'USD',
   next_page_token:'next',total_spend:3},
   usage:[{product:'voice',country:'IN',direction:'outbound',
    duration_seconds:60,total_units:1,total_amount:3}]};
  const partial=await call(good);
  assert.equal(partial.available,true);
  assert.equal(partial.hasMorePages,true);
  assert.equal(partial.listedRowsComplete,false);
  assert.equal(partial.currency,'USD');
  assert.equal(partial.clientWalletDebited,false);
  assert.equal((await call({...good,meta:{...good.meta,auth_id:'OTHER'}})).available,false);
  assert.equal((await call({...good,meta:{...good.meta,currency:'Rupees'}})).available,false);
  assert.equal((await call({...good,usage:[{...good.usage[0],total_amount:-1}]})).available,false);
  assert.equal((await call({...good,usage:[{...good.usage[0],country:'US'}]})).available,false);
  const unavailable=await route(f,'usage-summary',admin,'GET',undefined,{
   fetcher:async()=>new Response('rate limit',{status:429})
  });
  assert.equal((await unavailable.json()).available,false);
  assert.equal((await route(f,'usage-summary?forceDebit=true')).status,400);
  assert.equal((await route(f,'usage-summary',admin,'POST',{anything:true})).status,400);
 }finally{f.close()}
});


test('diagnostic reports which runtime Plivo Secret is missing or malformed without exposing values',async()=>{
 const f=fixture();
 try{
  freshMfa(f);
  f.env.PLIVO_AUTH_ID='TESTACCOUNT123';
  f.env.PLIVO_AUTH_TOKEN='SYNTHETICAUTHTOKEN123';
  const call=async()=>{
   const r=await route(f,'provider-check');
   assert.equal(r.status,200);
   return r.json();
  };
  delete f.env.PLIVO_AUTH_ID;
  assert.equal((await call()).reason,'plivo_auth_id_missing');
  f.env.PLIVO_AUTH_ID=' TESTACCOUNT123';
  assert.equal((await call()).reason,'plivo_auth_id_format_invalid');
  f.env.PLIVO_AUTH_ID='TESTACCOUNT123';
  delete f.env.PLIVO_AUTH_TOKEN;
  assert.equal((await call()).reason,'plivo_auth_token_missing');
  f.env.PLIVO_AUTH_TOKEN='incorrect whitespace token ';
  const bad=await call();
  assert.equal(bad.reason,'plivo_auth_token_format_invalid');
  assert.equal(bad.credentialChecks.authTokenConfigured,true);
  assert.equal(bad.credentialChecks.authTokenFormatValid,false);
  assert.equal(bad.credentialsVerified,false);
  assert.ok(!JSON.stringify(bad).includes('incorrect whitespace token'));
 }finally{f.close()}
});

test('diagnostic differentiates provider 401, 403, 404, 429, 503, bad JSON and unreachable network',async()=>{
 const f=fixture();
 try{
  freshMfa(f);
  f.env.PLIVO_AUTH_ID='TESTACCOUNT123';
  f.env.PLIVO_AUTH_TOKEN='SYNTHETICAUTHTOKEN123';
  for(const [status,reason] of [
   [401,'plivo_account_unauthorized'],
   [403,'plivo_account_forbidden'],
   [404,'plivo_account_not_found'],
   [429,'plivo_account_rate_limited'],
   [503,'plivo_account_http_error']
  ]){
   const r=await route(f,'provider-check',admin,'GET',undefined,{
    fetcher:async()=>new Response('provider error: secret must never be echoed',{status})
   });
   const data=await r.json();
   assert.equal(data.credentialsVerified,false);
   assert.equal(data.reason,reason);
   assert.equal(data.httpStatus,status);
   assert.ok(!JSON.stringify(data).includes('secret must never'));
  }
  const network=await (await route(f,'provider-check',admin,'GET',undefined,{
   fetcher:async()=>{throw new Error('secret included in network failure')}
  })).json();
  assert.equal(network.reason,'plivo_account_network_error');
  assert.equal(network.httpStatus,null);
  assert.ok(!JSON.stringify(network).includes('secret included'));
  const invalid=await (await route(f,'provider-check',admin,'GET',undefined,{
   fetcher:async()=>new Response('<html>ok</html>',{
    status:200,headers:{'content-type':'text/html'}
   })
  })).json();
  assert.equal(invalid.reason,'plivo_account_invalid_response');
 }finally{f.close()}
});

test('rented-number list failure is distinct from valid Plivo authentication and direct caller lookup can succeed',async()=>{
 const f=fixture();
 try{
  freshMfa(f);
  f.env.PLIVO_AUTH_ID='TESTACCOUNT123';
  f.env.PLIVO_AUTH_TOKEN='SYNTHETICAUTHTOKEN123';
  f.env.AR3D_PLIVO_CALLER_NUMBER='+918065491333';
  const paths=[];
  const d=await (await route(f,'provider-check',admin,'GET',undefined,{
   fetcher:async(url,options)=>{
    paths.push(url);
    assert.equal(options.method,'GET');
    if(url.endsWith('/Number/?limit=20'))return new Response('provider unavailable',{
     status:503,headers:{'content-type':'application/json'}
    });
    if(url.endsWith('/Number/918065491333/'))
     return Response.json({number:'918065491333',voice_enabled:true});
    return Response.json({auth_id:'TESTACCOUNT123',account_type:'standard'});
   }
  })).json();
  assert.equal(d.credentialsVerified,true);
  assert.equal(d.numberListAvailable,false);
  assert.equal(d.numberListReason,'plivo_number_list_http_error');
  assert.equal(d.numberListHttpStatus,503);
  assert.equal(d.configuredCallerPresent,true);
  assert.equal(d.callerVerifiedBy,'account_number_detail');
  assert.equal(d.callsEnabledByThisCheck,false);
  assert.deepEqual(paths,[
   'https://api.plivo.com/v1/Account/TESTACCOUNT123/',
   'https://api.plivo.com/v1/Account/TESTACCOUNT123/Number/?limit=20',
   'https://api.plivo.com/v1/Account/TESTACCOUNT123/Number/918065491333/'
  ]);
  assert.ok(!JSON.stringify(d).includes('+918065491333'));
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
 }finally{f.close()}
});

test('Plivo API account identity mismatch never marks credentials verified',async()=>{
 const f=fixture();
 try{
  freshMfa(f);
  f.env.PLIVO_AUTH_ID='TESTACCOUNT123';
  f.env.PLIVO_AUTH_TOKEN='SYNTHETICAUTHTOKEN123';
  const d=await (await route(f,'provider-check',admin,'GET',undefined,{
   fetcher:async()=>Response.json({auth_id:'OTHERACCOUNT123',account_type:'standard'})
  })).json();
  assert.equal(d.reason,'plivo_account_identity_mismatch');
  assert.equal(d.credentialsVerified,false);
  assert.equal(d.numberListAvailable,false);
  assert.ok(!JSON.stringify(d).includes('OTHERACCOUNT123'));
 }finally{f.close()}
});

test('minute usage separates connected and billed seconds, pending CDRs and planning transactions',async()=>{
 const f=fixture();try{
  freshMfa(f);
  const run='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',job='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',pending='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const at=new Date().toISOString(),call='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  f.r.db.prepare("INSERT INTO calling_runs(tenant_id,id,campaign_id,state,created_by,created_at,updated_at) VALUES(?,?,?,'completed','client',?,?)").run(tid,run,'22222222-2222-4222-8222-222222222222',at,at);
  const secondLead='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  f.r.db.prepare("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES(?,?,'Synthetic pending lead','+919000000008','other',?,?)").run(tid,secondLead,at,at);
  for(const [id,ref] of [[job,call],[pending,pending]])f.r.db.prepare("INSERT INTO calling_jobs(tenant_id,id,run_id,lead_id,state,account_sid,caller_id,destination,provider_call_sid,created_at,updated_at) VALUES(?,?,?,?,'completed','TESTACCOUNT123','+918000000000','+919000000001',?,?,?)").run(tid,id,run,id===job?'33333333-3333-4333-8333-333333333333':secondLead,ref,at,at);
  f.r.db.prepare("INSERT INTO verified_provider_call_costs(tenant_id,job_id,provider_call_uuid,reported_amount,billed_seconds,call_seconds,verified_by,verified_at) VALUES(?,?,?,'0.01',30,16,'admin',?)").run(tid,job,call,at);
  await route(f,'tenant',admin,'POST',{tenantId:tid,totalInr:500,expectedCurrentInr:0,reason:'Initial test planning allocation'});
  await route(f,'tenant',admin,'POST',{tenantId:tid,totalInr:300,expectedCurrentInr:500,reason:'Test planning recovery transaction'});
  const path='minute-usage?tenantId='+tid;
  const res=await route(f,path,client);assert.equal(res.status,200,await res.clone().text());
  const d=await res.json();assert.equal(d.connectedSeconds,16);assert.equal(d.billedSeconds,30);
  assert.equal(d.pendingCalls,1);assert.equal(d.verifiedCalls,1);assert.equal(d.plannedPaise,30000);
  assert.equal(d.spendableSeconds,null);assert.equal(d.debitedSeconds,null);assert.equal(d.internal,null);
  assert.deepEqual(d.transactions.map(x=>x.deltaPaise).sort((a,b)=>a-b),[-20000,50000]);
  assert.ok(d.transactions.every(x=>typeof x.transactionId==='string'&&!Object.hasOwn(x,'actor')&&!Object.hasOwn(x,'reason')));
  assert.equal(d.records.length,2);assert.ok(!JSON.stringify(d).includes('919000000001'));
  assert.equal((await route(f,path,{id:'viewer',globalRole:'user'})).status,403);
  assert.equal((await route(f,'minute-usage?tenantId=99999999-9999-4999-8999-999999999999',client)).status,403);
  assert.equal((await route(f,path+'&offset=bad',client)).status,400);
  assert.equal((await route(f,path,admin,'POST',{})).status,405);
  const operator=await route(f,path,admin);assert.equal(operator.status,200);
  const audit=await operator.json();assert.ok(audit.transactions.every(x=>x.actor&&x.reason&&x.transactionId));
 }finally{f.close()}
});


test('production cost plan is admin-only, exact and does not change credits or contact providers',async()=>{
 const f=fixture();try{
  const q='production-cost-plan?minutes=1000&audioPercent=50&numbers=1';
  assert.equal((await route(f,q,client)).status,403);
  assert.equal((await route(f,q,admin)).status,403);
  freshMfa(f);
  const options={fetcher:async()=>{throw Error('no provider call allowed')}};
  const res=await route(f,q,admin,'GET',undefined,options);
  assert.equal(res.status,200);
  const d=await res.json();
  assert.equal(d.variablePerMinute,655000);assert.equal(d.conservativePerMinute,900000);
  assert.equal(d.fixedTotal,675000000);assert.equal(d.variableTotal,655000000);assert.equal(d.total,1330000000);
  assert.equal(d.actualProviderBillingVerified,false);assert.equal(d.clientCreditsDebited,false);
  assert.equal((await route(f,q+'&minutes=1')).status,400);
  assert.equal((await route(f,q.replace('audioPercent=50','audioPercent=101'))).status,400);
  assert.equal((await route(f,q.replace('minutes=1000','minutes=0'))).status,400);
  assert.equal((await route(f,q,admin,'POST',{})).status,405);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_credit_budgets').get().n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_credit_audit').get().n,0);
 }finally{f.close()}
});

test('cost intelligence is MFA-only, scoped and never charges credits; raw CDR remains unverified currency',async()=>{
 const f=fixture();try{
  freshMfa(f);
  const id='77777777-7777-4777-8777-777777777777',call='88888888-8888-4888-8888-888888888888',auth='TESTACCOUNT123',caller='+918000000000';
  f.env.PLIVO_AUTH_ID=auth;f.env.PLIVO_AUTH_TOKEN='SYNTHETICAUTHTOKEN123';
  f.c.db.prepare(`INSERT INTO scripted_phone_pilots(id,tenant_id,lead_id,lead_updated_at,actor_id,language,destination,caller,rate_slot,expires_at,phase,provider_call_id,provider_account_id,survey_json,created_at,hangup_at,duration_seconds)
  VALUES(?,?,?,'2026-11-24','admin','hi','+919000000001',?,1,9999999999999,'completed',?,?,?,'2026-11-24T08:00:00Z',999,145)`).run(id,tid,'33333333-3333-4333-8333-333333333333',caller,call,auth,JSON.stringify({phoneMeta:{engine:'sarvam',sttAudioMs:71160,sttDurationUnknown:0,llmRequests:6,llmInputTokens:1448,llmOutputTokens:238,llmUsageUnknown:0}}));
  const path='call-costs?tenantId='+tid;
  assert.equal((await route(f,path,client)).status,403);
  const res=await route(f,path);assert.equal(res.status,200,await res.clone().text());
  const d=await res.json(),x=d.records[0];assert.equal(x.scope,'internal');assert.equal(x.plannedBilledSeconds,150);assert.equal(x.estimatedMicroInr.plivo,950000);assert.equal(x.estimatedMicroInr.stt,581140);assert.equal(x.sttBasis,'aggregate_audio_unrounded');assert.equal(x.providerCdr,null);assert.equal(x.clientCharge,null);
  assert.doesNotMatch(JSON.stringify(d),/919000000001|TESTACCOUNT123/);
  let requests=0;
  const fetcher=async(url,o)=>{requests++;assert.equal(url,'https://api.plivo.com/v1/Account/'+auth+'/Call/'+call+'/');assert.equal(o.method,'GET');return Response.json({call_uuid:call,call_direction:'outbound',from_number:caller,to_number:'919000000001',billed_duration:150,call_duration:145,total_amount:'0.9496'})};
  const cdrPath='internal-call-cdr?tenantId='+tid+'&sessionId='+id;
  assert.equal((await route(f,cdrPath,client,'GET',undefined,{fetcher})).status,403);assert.equal(requests,0);
  const c=await (await route(f,cdrPath,admin,'GET',undefined,{fetcher})).json();
  assert.equal(c.record.providerCdr.reportedAmount,'0.9496');assert.equal(c.record.providerCdr.currencyStatus,'unverified');assert.equal(c.clientCreditsDebited,false);assert.equal(requests,1);
  assert.equal((await route(f,cdrPath,admin,'GET',undefined,{fetcher:async()=>Response.json({call_uuid:'wrong'})})).status,503);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_credit_audit').get().n,0);
 }finally{f.close()}
});

test('manual minute ledger is append-only, idempotent, nonnegative and tenant scoped',async()=>{
 const f=fixture();try{
  const q='minute-ledger?tenantId='+tid;
  const d={tenantId:tid,transactionId:'77777777-7777-4777-8777-777777777777',deltaSeconds:6000,expectedBalanceSeconds:0,reason:'External allocation reference'};
  assert.equal((await route(f,'minute-ledger',admin,'POST',d)).status,403);
  freshMfa(f);
  assert.equal((await route(f,'minute-ledger',client,'POST',d)).status,403);
  const first=await route(f,'minute-ledger',admin,'POST',d);assert.equal(first.status,201,await first.clone().text());
  const replay=await route(f,'minute-ledger',admin,'POST',d);assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
  assert.equal((await route(f,'minute-ledger',admin,'POST',{...d,deltaSeconds:12000})).status,409);
  const second={...d,transactionId:'88888888-8888-4888-8888-888888888888',deltaSeconds:-1200,expectedBalanceSeconds:6000};
  assert.equal((await route(f,'minute-ledger',admin,'POST',{...second,expectedBalanceSeconds:0})).status,409);
  assert.equal((await route(f,'minute-ledger',admin,'POST',second)).status,201);
  assert.equal((await route(f,'minute-ledger',admin,'POST',{...second,transactionId:'99999999-9999-4999-8999-999999999999',deltaSeconds:-5000,expectedBalanceSeconds:4800})).status,409);
  const data=await (await route(f,q,client)).json();
  assert.equal(data.allocatedSeconds,4800);assert.equal(data.spendableSeconds,null);assert.equal(data.dispatchEnabled,false);assert.equal(data.transactions.length,2);assert.equal(data.transactions[0].reason,undefined);
  assert.equal((await route(f,'minute-ledger?tenantId=99999999-9999-4999-8999-999999999999',client)).status,403);
  assert.throws(()=>f.c.db.prepare('UPDATE tenant_minute_ledger SET reason=? WHERE id=?').run('Changed reason',d.transactionId),/immutable/);
  assert.throws(()=>f.c.db.prepare('DELETE FROM tenant_minute_ledger WHERE id=?').run(d.transactionId),/immutable/);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_credit_audit').get().n,0);
 }finally{f.close()}
});

test('ledger view separates allocated held and settled seconds and refuses recovery of commitments',async()=>{const f=fixture();try{freshMfa(f);const {reserveMinutes,closeMinuteHold}=await import('../src/minute-holds.mjs');const d={tenantId:tid,transactionId:'11111111-2222-4333-8444-555555555555',deltaSeconds:300,expectedBalanceSeconds:0,reason:'Manual allocation test'};assert.equal((await route(f,'minute-ledger',admin,'POST',d)).status,201);const job='a'.repeat(32),other='b'.repeat(32);assert.equal((await reserveMinutes(f.env.CONTROL_DB,{tenantId:tid,job,maxSeconds:90})).ok,true);assert.equal((await reserveMinutes(f.env.CONTROL_DB,{tenantId:tid,job:other,maxSeconds:60})).ok,true);assert.equal((await closeMinuteHold(f.env.CONTROL_DB,{tenantId:tid,job:other,billedSeconds:30,evidenceRef:'synthetic-cdr',kind:'verified_cdr'})).ok,true);const view=await (await route(f,'minute-ledger?tenantId='+tid,client)).json();assert.equal(view.allocatedSeconds,300);assert.equal(view.heldSeconds,90);assert.equal(view.usedSeconds,30);assert.equal(view.uncommittedSeconds,180);assert.equal(view.spendableSeconds,null);assert.equal(view.callTransactions.length,2);assert.doesNotMatch(JSON.stringify(view),/synthetic-cdr/);assert.equal((await route(f,'minute-ledger',admin,'POST',{...d,transactionId:'22222222-2222-4333-8444-555555555555',deltaSeconds:-240,expectedBalanceSeconds:300})).status,409);assert.equal((await route(f,'minute-ledger',admin,'POST',{...d,transactionId:'33333333-2222-4333-8444-555555555555',deltaSeconds:-180,expectedBalanceSeconds:300})).status,201)}finally{f.close()}});


test('admin dashboard reports actual balances, is MFA-only and never queries carrier',async()=>{
 const f=fixture();
 try{
  const noFetch=()=>{throw Error('unexpected carrier request')};
  assert.equal((await route(f,'admin-dashboard',client,'GET',undefined,{fetcher:noFetch})).status,403);
  assert.equal((await route(f,'admin-dashboard')).status,403);
  freshMfa(f);
  const grant=await route(f,'minute-ledger',admin,'POST',{tenantId:tid,transactionId:'44444444-4444-4444-8444-444444444444',deltaSeconds:600,expectedBalanceSeconds:0,reason:'Manual synthetic allocation'});
  assert.equal(grant.status,201);
  const r=await route(f,'admin-dashboard',admin,'GET',undefined,{fetcher:noFetch});
  assert.equal(r.status,200,await r.clone().text());const d=await r.json();
  assert.deepEqual(d.clients,{total:1,active:1});
  assert.deepEqual(d.position,{allocatedSeconds:600,heldSeconds:0,usedSeconds:0,uncommittedSeconds:600});
  assert.equal(d.transactions.length,1);assert.equal(d.transactions[0].company,'Demo');
  assert.equal(d.providerRequests,0);assert.equal(d.externalPaymentsRecorded,false);assert.equal(d.dispatchEnabledByDashboard,false);
  assert.equal((await route(f,'admin-dashboard?tenantId='+tid)).status,400);
 }finally{f.close()}
});
