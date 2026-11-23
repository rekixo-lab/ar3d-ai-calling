// AR3D-owned PROVISIONAL INR client credit budgets and protected Plivo
// account balance preview. These budgets DO NOT transfer Plivo funds, debit
// live calls, bypass carrier approval or represent spendable billing credits.
import {requireMembership} from './human-auth.mjs';
import {parseJsonBody} from './core.mjs';

const base='/v1/human/credits';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200)=>Response.json(data,{status,headers});
const fail=(error,status=400)=>json({error},status);
const positiveMoney=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000000;
const allowedPack=v=>[0,100,200,300,400,500].includes(v);
const toPaise=v=>v*100;
async function currentMfa(env,user){
 if(user?.globalRole!=='super_admin'||!/^[a-f0-9]{64}$/i.test(user.token_hash||''))return false;
 return !!await env.CONTROL_DB.prepare(
  'SELECT 1 AS valid FROM human_mfa_settings m JOIN human_sessions s ON s.user_id=m.user_id '+
  'WHERE m.user_id=? AND s.token_hash=? AND m.enabled_at IS NOT NULL '+
  'AND s.created_at>=m.enabled_at AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1'
 ).bind(user.id,user.token_hash,Date.now()).first();
}
async function boundedBody(req){
 if(!req.headers.get('content-type')?.startsWith('application/json')||!req.body||
    Number(req.headers.get('content-length'))>2048)throw Error('invalid request');
 const reader=req.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let n=0,text='';
 try{
  while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;
   if(n>2048){await reader.cancel();throw Error('too large')}
   text+=decoder.decode(value,{stream:true});
  }text+=decoder.decode();
 }finally{reader.releaseLock()}
 return parseJsonBody(text,2048);
}
async function tenant(env,id){
 return env.CONTROL_DB.prepare(
  "SELECT id,status FROM tenants WHERE id=? LIMIT 1").bind(id).first();
}
async function budget(db,id){
 return db.prepare('SELECT planned_paise AS plannedPaise,updated_at AS updatedAt FROM tenant_credit_budgets WHERE tenant_id=?')
  .bind(id).first();
}
// The provider API documentation says cash_credits is USD; for INR region
// accounts the API's billing currency must be independently verified.
// A numeric cash_credits alone MUST NEVER be displayed as INR funding.
async function providerPreview(env,fetcher){
 const auth=env.PLIVO_AUTH_ID,token=env.PLIVO_AUTH_TOKEN;
 if(typeof auth!=='string'||!/^[A-Za-z0-9]{8,64}$/.test(auth)||
    typeof token!=='string'||!/^[A-Za-z0-9]{16,128}$/.test(token))
  return json({available:false,reason:'plivo_credentials_not_configured',verifiedInr:false});
 try{
  const res=await fetcher('https://api.plivo.com/v1/Account/'+encodeURIComponent(auth)+'/',{
   method:'GET',redirect:'error',signal:AbortSignal.timeout(5000),
   headers:{Authorization:'Basic '+btoa(auth+':'+token),Accept:'application/json'}
  });
  if(!res.ok)return json({available:false,reason:'provider_balance_unavailable',verifiedInr:false});
  if(!res.headers.get('content-type')?.toLowerCase().includes('json'))
   return json({available:false,reason:'provider_balance_unavailable',verifiedInr:false});
  if(Number(res.headers.get('content-length'))>8192)return json({available:false,reason:'provider_balance_unavailable',verifiedInr:false});
  const raw=await res.text();
  if(raw.length>8192)return json({available:false,reason:'provider_balance_unavailable',verifiedInr:false});
  const data=JSON.parse(raw),credits=data?.cash_credits;
  if(typeof credits!=='string'||!/^\d{1,10}(?:\.\d{1,8})?$/.test(credits))
   return json({available:false,reason:'provider_balance_unavailable',verifiedInr:false});
  return json({available:true,provider:'Plivo',cashCredits:credits,
   cashCreditsCurrency:'unverified_for_India_account',verifiedInr:false,
   accountType:['developer','standard'].includes(data.account_type)?data.account_type:'unverified',
   billingMode:['prepaid','postpaid'].includes(data.billing_mode)?data.billing_mode:'unverified',
   checkedAt:new Date().toISOString(),
   notice:'Plivo cash_credits is provider-reported, NOT allocated INR, and trial credits may be restricted. Check account currency and approved live funds before activation.'});
 }catch{
  return json({available:false,reason:'provider_balance_unavailable',verifiedInr:false});
 }
}
// A diagnostics-only Plivo read. A valid Account API response verifies only
// credentials, not India KYC, approved number status or permission to dial.
async function checkPlivoConnection(env,fetcher){
 const auth=env.PLIVO_AUTH_ID,token=env.PLIVO_AUTH_TOKEN;
 const valid=typeof auth==='string'&&/^[A-Za-z0-9]{8,64}$/.test(auth)&&
  typeof token==='string'&&/^[A-Za-z0-9]{16,128}$/.test(token);
 if(!valid)return json({
  credentialsVerified:false,numberListAvailable:false,reason:'plivo_credentials_not_configured',
  kycVerified:false,routeApproved:false,callsEnabledByThisCheck:false
 });
 const url='https://api.plivo.com/v1/Account/'+encodeURIComponent(auth)+'/';
 const headers={Authorization:'Basic '+btoa(auth+':'+token),Accept:'application/json'};
 const read=async path=>{
  const res=await fetcher(url+path,{method:'GET',redirect:'error',
   signal:AbortSignal.timeout(5000),headers});
  if(!res.ok||!res.headers.get('content-type')?.toLowerCase().includes('json')||
   Number(res.headers.get('content-length'))>16384)throw Error('provider unavailable');
  const body=await res.text();
  if(body.length>16384)throw Error('provider oversized');
  return JSON.parse(body);
 };
 let account;
 try{account=await read('')}
 catch{return json({
  credentialsVerified:false,numberListAvailable:false,reason:'plivo_account_api_unavailable',
  kycVerified:false,routeApproved:false,callsEnabledByThisCheck:false
 })}
 let list=null;
 try{list=await read('Number/?limit=20')}catch{}
 const rows=Array.isArray(list?.objects)?list.objects.filter(x=>x&&typeof x==='object').slice(0,20):null;
 const known=rows!==null;
 const digits=x=>typeof x==='string'?x.replace(/^\+/,''):null;
 const configured=digits(env.AR3D_PLIVO_CALLER_NUMBER);
 const validNumber=x=>typeof x==='string'&&/^\+?[0-9]{8,15}$/.test(x);
 const owned=known&&configured?rows.some(x=>validNumber(x.number)&&digits(x.number)===configured):null;
 const total=list?.meta?.total_count;
 const totalNumbers=Number.isSafeInteger(total)&&total>=0?total:null;
 const listComplete=known&&totalNumbers!==null&&totalNumbers<=rows.length;
 return json({
  credentialsVerified:true,
  accountType:['developer','standard'].includes(account?.account_type)?account.account_type:'unverified',
  numberListAvailable:known,
  listedNumberCount:known?rows.length:null,
  totalNumberCount:totalNumbers,
  listedNumbers:known?rows.filter(x=>validNumber(x.number)).map(x=>({
   maskedNumber:'••••'+digits(x.number).slice(-4),
   voiceEnabled:x.voice_enabled===true,
   inIndia:digits(x.number).startsWith('91')&&digits(x.number).length===12
  })):[],
  configuredCallerPresent:owned===true?true:owned===false&&listComplete?false:null,
  configuredCallerSyntaxValid:typeof env.AR3D_PLIVO_CALLER_NUMBER==='string'&&
   /^\+91[1-9]\d{9}$/.test(env.AR3D_PLIVO_CALLER_NUMBER),
  kycVerified:false,routeApproved:false,callsEnabledByThisCheck:false,
  notice:'Read-only provider API check. An authenticated account and listed number do not prove Indian KYC or legal outbound route approval. No call was placed.'
 });
}
// Operator-only aggregated Voice UsageSummary. Unlike Account cash_credits,
// UsageSummary reports its own currency. We NEVER infer credit fundability or
// settle a client wallet from this account-wide aggregate.
async function providerSevenDayUsage(env,fetcher,now=Date.now()){
 const auth=env.PLIVO_AUTH_ID,token=env.PLIVO_AUTH_TOKEN;
 if(typeof auth!=='string'||!/^[A-Za-z0-9]{8,64}$/.test(auth)||
    typeof token!=='string'||!/^[A-Za-z0-9]{16,128}$/.test(token))
  return json({available:false,reason:'plivo_credentials_not_configured'});
 const today=Math.floor(now/86400000)*86400000;
 const from=new Date(today-6*86400000).toISOString().slice(0,10);
 const until=new Date(today+86400000).toISOString().slice(0,10);
 const params=new URLSearchParams({
  granularity:'day',from_date:from,to_date:until,product:'voice',
  direction:'outbound',country:'IN',page_size:'100'
 });
 try{
  const res=await fetcher('https://api.plivo.com/v1/Account/'+encodeURIComponent(auth)+
   '/UsageSummary/?'+params,{
    method:'GET',redirect:'error',signal:AbortSignal.timeout(5000),
    headers:{Authorization:'Basic '+btoa(auth+':'+token),Accept:'application/json'}
   });
  if(!res.ok||!res.headers.get('content-type')?.toLowerCase().includes('json')||
     Number(res.headers.get('content-length'))>32768)
   return json({available:false,reason:'provider_usage_unavailable'});
  const raw=await res.text();
  if(raw.length>32768)return json({available:false,reason:'provider_usage_unavailable'});
  const data=JSON.parse(raw),meta=data?.meta;
  if(meta?.auth_id!==auth||typeof meta.currency!=='string'||
     !/^[A-Z]{3}$/.test(meta.currency)||!Array.isArray(data.usage)||
     data.usage.length>100)
   return json({available:false,reason:'provider_usage_mismatch'});
  // Amounts are for display only. Never sum floating-point money into a
  // billable wallet. Use per-call idempotent CDR settlement for that later.
  const validAmount=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9;
  if(!data.usage.every(x=>x&&x.product==='voice'&&x.direction==='outbound'&&
     x.country==='IN'&&validAmount(x.total_amount)&&
     Number.isFinite(x.duration_seconds)&&x.duration_seconds>=0&&
     x.duration_seconds<=1e12&&Number.isSafeInteger(x.total_units)&&
     x.total_units>=0&&x.total_units<=1e9))
   return json({available:false,reason:'provider_usage_mismatch'});
  const total=meta.total_spend;
  if(total!==undefined&&!validAmount(total))
   return json({available:false,reason:'provider_usage_mismatch'});
  const calls=data.usage.reduce((sum,row)=>sum+row.total_units,0);
  const seconds=data.usage.reduce((sum,row)=>sum+row.duration_seconds,0);
  const listedAmount=data.usage.reduce((sum,row)=>sum+row.total_amount,0);
  const partial=typeof meta.next_page_token==='string'&&meta.next_page_token.length>0;
  return json({available:true,provider:'Plivo',currency:meta.currency,
   fromDate:from,toDateExclusive:until,product:'voice',country:'IN',direction:'outbound',
   listedCalls:calls,listedBilledSeconds:seconds,
   listedAmount:listedAmount.toFixed(6),
   listedRowsComplete:!partial,hasMorePages:partial,
   providerWindowTotalSpend:total===undefined?null:total.toFixed(6),
   providerCurrencyReported:true,
   clientWalletDebited:false,clientFundingVerified:false,
   notice:'Provider account-level voice usage for the UTC dates shown, not per-client debits. Report currency is not proof that Plivo trial funds can be sold or that any client may dial.'});
 }catch{
  return json({available:false,reason:'provider_usage_unavailable'});
 }
}
export async function handleCreditWalletRequest(req,env,user,{fetcher=fetch}={}){
 const url=new URL(req.url);
 if(!url.pathname.startsWith(base+'/'))return null;
 if(!['GET','POST'].includes(req.method))return fail('method not allowed',405);
 if(!env.CONTROL_DB)return fail('database unavailable',503);
 const db=env.CONTROL_DB,path=url.pathname.slice(base.length+1);
 try{
  if(path==='usage-summary'){
   if(req.method!=='GET'||url.search)return fail('invalid usage query',400);
   if(!await currentMfa(env,user))return fail('current MFA Super Admin required',403);
   return providerSevenDayUsage(env,fetcher);
  }
  if(path==='provider-check'){
   if(req.method!=='GET'||url.search)return fail('invalid connection check',400);
   if(!await currentMfa(env,user))return fail('current MFA Super Admin required',403);
   return checkPlivoConnection(env,fetcher);
  }
  if(path==='provider'){
   if(req.method!=='GET')return fail('method not allowed',405);
   if(url.search)return fail('unsupported query',400);
   if(!await currentMfa(env,user))return fail('current MFA Super Admin required',403);
   return providerPreview(env,fetcher);
  }
  if(path==='overview'){
   if(req.method!=='GET'||url.search)return fail('invalid overview request',400);
   if(!await currentMfa(env,user))return fail('current MFA Super Admin required',403);
   const row=await db.prepare(
    'SELECT COUNT(*) AS fundedClients,COALESCE(SUM(planned_paise),0) AS totalPaise FROM tenant_credit_budgets WHERE planned_paise>0'
   ).first();
   return json({plannedTotalInr:Number(row?.totalPaise||0)/100,
    clientsWithPlan:Number(row?.fundedClients||0),currency:'INR',status:'provisional_only',
    verifiedProviderFunding:false,callingEnabledByCredits:false});
  }
  if(path!=='tenant')return null;
  if(req.method==='GET'){
   const keys=[...url.searchParams.keys()];
   if(keys.length!==1||keys[0]!=='tenantId'||url.searchParams.getAll('tenantId').length!==1||
      !uuid.test(url.searchParams.get('tenantId')||''))return fail('invalid tenantId',400);
   const tid=url.searchParams.get('tenantId');
   if(user?.globalRole==='super_admin'){
    if(!await currentMfa(env,user))return fail('current MFA Super Admin required',403);
   }else{
    if(!await requireMembership(db,user,tid,false))return fail('forbidden',403);
   }
   const t=await tenant(env,tid);
   if(!t)return fail('tenant not found',404);
   const row=await budget(db,tid);
   return json({tenantId:tid,plannedInr:Number(row?.plannedPaise||0)/100,currency:'INR',
    status:'provisional_only',spendableInr:null,spentInr:null,
    providerFundsTransferred:false,callingEnabledByCredits:false,updatedAt:row?.updatedAt||null,
    notice:'AR3D planned client credit, not live Plivo wallet funds or a verified calling balance.'});
  }
  if(url.search)return fail('unsupported query',400);
  if(!await currentMfa(env,user))return fail('current MFA Super Admin required',403);
  const d=await boundedBody(req);
  if(!d||typeof d!=='object'||Array.isArray(d)||
     Object.keys(d).some(k=>!['tenantId','totalInr','expectedCurrentInr','reason'].includes(k))||
     !uuid.test(d.tenantId||'')||!allowedPack(d.totalInr)||
     !positiveMoney(d.expectedCurrentInr)||typeof d.reason!=='string'||
     d.reason.trim().length<10||d.reason.trim().length>200||
     /[\u0000-\u001f]/u.test(d.reason))return fail('invalid credit plan',400);
  const t=await tenant(env,d.tenantId);
  if(!t||!['trial','active'].includes(t.status))return fail('client unavailable',409);
  const old=await budget(db,d.tenantId),prior=Number(old?.plannedPaise||0);
  if(prior!==toPaise(d.expectedCurrentInr))return fail('credit plan changed; refresh',409);
  if(prior===toPaise(d.totalInr))return json({updated:false,
   plannedInr:d.totalInr,spendableInr:null,status:'provisional_only'});
  const at=new Date().toISOString(),id=crypto.randomUUID();
  const steps=await db.batch([
   db.prepare('INSERT OR IGNORE INTO tenant_credit_budgets(tenant_id,planned_paise,updated_by,updated_at) SELECT id,0,?,? FROM tenants WHERE id=?')
    .bind(user.id,at,d.tenantId),
   db.prepare('UPDATE tenant_credit_budgets SET planned_paise=?,updated_by=?,updated_at=? WHERE tenant_id=? AND planned_paise=?')
    .bind(toPaise(d.totalInr),user.id,at,d.tenantId,prior),
   db.prepare('INSERT INTO tenant_credit_audit(id,tenant_id,actor,previous_paise,new_paise,reason,created_at) '+
    'SELECT ?,?,?,?, ?,?,? WHERE changes()=1')
    .bind(id,d.tenantId,user.id,prior,toPaise(d.totalInr),d.reason.trim(),at)
  ]);
  if(Number(steps[1]?.meta?.changes)!==1||Number(steps[2]?.meta?.changes)!==1)
   return fail('credit plan changed; refresh',409);
  return json({updated:true,plannedInr:d.totalInr,previousInr:prior/100,
   currency:'INR',status:'provisional_only',spendableInr:null,
   notice:'Planned budget saved, but no Plivo money transferred and no live calls enabled.'});
 }catch(e){
  if(/invalid|too large|JSON/i.test(String(e?.message||'')))return fail('invalid credit request',400);
  console.error('AR3D credit planning not available');
  return fail('credit planning unavailable; check Control D1 migration',503);
 }
}
