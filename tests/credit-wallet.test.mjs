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
