// AR3D-owned PROVISIONAL INR client credit budgets and protected Plivo
// account balance preview. These budgets DO NOT transfer Plivo funds, debit
// live calls, bypass carrier approval or represent spendable billing credits.
import {requireMembership,mutationOriginAllowed} from './human-auth.mjs';
import {parseJsonBody,resolveCrmDb} from './core.mjs';
import {estimateProductionCost} from './production-cost-plan.mjs';
import {costObservation,readInternalPlivoCdr} from './cost-intelligence.mjs';
import {minutePosition,fundingCap,fundingPosition,affordableCallSeconds,providerFundingCaps} from './minute-holds.mjs';
import {scriptedCampaignConfiguration} from './scripted-campaign-dispatch.mjs';

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
   method:'GET',redirect:'manual',signal:AbortSignal.timeout(5000),
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
  if(data.auth_id!==undefined&&data.auth_id!==auth)return json({available:false,reason:'provider_account_identity_mismatch',verifiedInr:false});
  return json({available:true,provider:'Plivo',cashCredits:credits,
   cashCreditsCurrency:'USD',verifiedInr:false,
   accountType:['developer','standard'].includes(data.account_type)?data.account_type:'unverified',
   billingMode:['prepaid','postpaid'].includes(data.billing_mode)?data.billing_mode:'unverified',
   checkedAt:new Date().toISOString(),
   notice:'Plivo Account API documents cash_credits in USD. India console conversion is not verified by this endpoint. Trial credits may be restricted; this is not approved live funding.'});
 }catch{
  return json({available:false,reason:'provider_balance_unavailable',verifiedInr:false});
 }
}
// Cloudflare Workers does not implement the RequestInit error redirect mode.
// Use redirect:'manual' and reject non-2xx statuses to prevent credential
// forwarding across provider redirects. Do not replace with 'follow'.
// A diagnostics-only Plivo read. A valid Account API response verifies only
// credentials, not India KYC, approved number status or permission to dial.
async function checkPlivoConnection(env,fetcher){
 const auth=env.PLIVO_AUTH_ID,token=env.PLIVO_AUTH_TOKEN;
 const authIdConfigured=typeof auth==='string'&&auth.length>0;
 const authTokenConfigured=typeof token==='string'&&token.length>0;
 const authIdFormatValid=authIdConfigured&&/^[A-Za-z0-9]{8,64}$/.test(auth);
 const authTokenFormatValid=authTokenConfigured&&/^[A-Za-z0-9]{16,128}$/.test(token);
 const credentials={
  authIdConfigured,authTokenConfigured,authIdFormatValid,authTokenFormatValid
 };
 const blocked=(reason,httpStatus=null)=>json({
  credentialsVerified:false,numberListAvailable:false,
  configuredCallerPresent:null,reason,httpStatus,
  credentialChecks:credentials,
  kycVerified:false,routeApproved:false,callsEnabledByThisCheck:false
 });
 // The Worker must distinguish missing Secrets, invalid binding values, a
 // provider HTTP rejection and a network failure. Never send the credentials,
 // raw provider response, or the full rented caller to the browser.
 if(!authIdConfigured)return blocked('plivo_auth_id_missing');
 if(!authTokenConfigured)return blocked('plivo_auth_token_missing');
 if(!authIdFormatValid)return blocked('plivo_auth_id_format_invalid');
 if(!authTokenFormatValid)return blocked('plivo_auth_token_format_invalid');
 const url='https://api.plivo.com/v1/Account/'+encodeURIComponent(auth)+'/';
 const requestHeaders={Authorization:'Basic '+btoa(auth+':'+token),Accept:'application/json'};
 const httpFailure=(stage,status)=>{
  if(status===401)return stage+'_unauthorized';
  if(status===403)return stage+'_forbidden';
  if(status===404)return stage+'_not_found';
  if(status===429)return stage+'_rate_limited';
  return stage+'_http_error';
 };
 const read=async(path,stage)=>{
  let response;
  try{
   response=await fetcher(url+path,{
    method:'GET',redirect:'manual',signal:AbortSignal.timeout(5000),
    headers:requestHeaders
   });
  }catch(e){
   const error=new Error('Plivo connection failed');
   error.reason=e?.name==='TimeoutError'||e?.name==='AbortError'?
    stage+'_timeout':stage+'_network_error';
   throw error;
  }
  if(!response?.ok){
   const error=new Error('Plivo rejected request');
   error.reason=httpFailure(stage,response?.status);
   error.httpStatus=Number.isInteger(response?.status)?response.status:null;
   throw error;
  }
  if(!response.headers.get('content-type')?.toLowerCase().includes('json')||
     Number(response.headers.get('content-length'))>16384){
   const error=new Error('Invalid Plivo response');
   error.reason=stage+'_invalid_response';
   throw error;
  }
  try{
   const raw=await response.text();
   if(raw.length>16384)throw new Error('Response too large');
   const data=JSON.parse(raw);
   if(!data||typeof data!=='object'||Array.isArray(data))
    throw new Error('Unexpected response shape');
   return data;
  }catch{
   const error=new Error('Invalid Plivo response');
   error.reason=stage+'_invalid_response';
   throw error;
  }
 };
 let account;
 try{account=await read('','plivo_account')}
 catch(e){return blocked(e.reason||'plivo_account_unavailable',e.httpStatus??null)}
 if(typeof account.auth_id==='string'&&account.auth_id!==auth)
  return blocked('plivo_account_identity_mismatch');
 if(!['developer','standard'].includes(account.account_type))
  return blocked('plivo_account_invalid_response');
 let list=null,numberListReason=null,numberListHttpStatus=null;
 try{list=await read('Number/?limit=20','plivo_number_list')}
 catch(e){numberListReason=e.reason||'plivo_number_list_unavailable';numberListHttpStatus=e.httpStatus??null}
 const rows=Array.isArray(list?.objects)?list.objects.filter(x=>x&&typeof x==='object').slice(0,20):null;
 const known=rows!==null;
 if(list!==null&&!known)numberListReason='plivo_number_list_invalid_response';
 const digits=x=>typeof x==='string'?x.replace(/^\+/,''):null;
 const validNumber=x=>typeof x==='string'&&/^\+?[0-9]{8,15}$/.test(x);
 const configured=digits(env.AR3D_PLIVO_CALLER_NUMBER);
 const total=list?.meta?.total_count;
 const totalNumbers=Number.isSafeInteger(total)&&total>=0?total:null;
 const listComplete=known&&totalNumbers!==null&&totalNumbers<=rows.length;
 let owned=known&&configured?rows.some(x=>validNumber(x.number)&&digits(x.number)===configured):null;
 let callerVerifiedBy='account_number_list';
 let callerProbeReason=null;
 // A single GET of the configured *already-rented* number is safe and can
 // confirm ownership even when a paginated list is unavailable/incomplete.
 if(configured&&/^[0-9]{10,15}$/.test(configured)&&owned!==true){
  try{
   const number=await read('Number/'+encodeURIComponent(configured)+'/','plivo_caller');
   if(validNumber(number.number)&&digits(number.number)===configured){
    owned=true;callerVerifiedBy='account_number_detail';
   }else callerProbeReason='plivo_caller_number_mismatch';
  }catch(e){callerProbeReason=e.reason||'plivo_caller_unavailable'}
 }
 return json({
  credentialsVerified:true,
  reason:'plivo_account_authenticated',
  httpStatus:200,
  credentialChecks:credentials,
  accountType:account.account_type,
  numberListAvailable:known,
  numberListReason,numberListHttpStatus,
  listedNumberCount:known?rows.length:null,
  totalNumberCount:totalNumbers,
  listedNumbers:known?rows.filter(x=>validNumber(x.number)).map(x=>({
   maskedNumber:'••••'+digits(x.number).slice(-4),
   voiceEnabled:x.voice_enabled===true||x.voice_enabled==='true',
   inIndia:digits(x.number).startsWith('91')&&digits(x.number).length===12
  })):[],
  configuredCallerPresent:owned===true?true:owned===false&&listComplete?false:null,
  callerVerifiedBy:owned===true?callerVerifiedBy:null,
  callerProbeReason,
  configuredCallerSyntaxValid:typeof env.AR3D_PLIVO_CALLER_NUMBER==='string'&&
   /^\+91[1-9]\d{9}$/.test(env.AR3D_PLIVO_CALLER_NUMBER),
  kycVerified:false,routeApproved:false,callsEnabledByThisCheck:false,
  notice:'Read-only provider authentication and owned-number lookup; no call, KYC or telecom traffic approval is inferred.'
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
    method:'GET',redirect:'manual',signal:AbortSignal.timeout(5000),
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
  if(path==='admin-transactions'){
   if(req.method!=='GET')return fail('method not allowed',405);
   if(!await currentMfa(env,user))return fail('current MFA Super Admin required',403);
   const keys=[...url.searchParams.keys()],tid=url.searchParams.get('tenantId'),kind=url.searchParams.get('kind')||'all',offset=url.searchParams.get('offset')||'0';
   if(keys.some(k=>!['tenantId','kind','offset'].includes(k)||url.searchParams.getAll(k).length!==1)||
      (tid!==null&&!uuid.test(tid))||!['all','allocation','recovery','call_reversal','reserved','settled','released'].includes(kind)||!/^\d{1,6}$/.test(offset))return fail('invalid transaction filter',400);
   // One row per actual immutable ledger adjustment or call reservation.
   // Settlement is a state of that reservation, not a second debit.
   const rows=(await db.prepare(`WITH entries AS (
    SELECT l.tenant_id AS tenantId,l.id AS reference,l.created_at AS createdAt,NULL AS closedAt,
     CASE WHEN l.id LIKE 'call-reversal:%' THEN 'call_reversal' ELSE l.kind END AS kind,
     l.delta_seconds AS deltaSeconds,l.balance_seconds AS allocatedBalanceSeconds,NULL AS reservedSeconds,NULL AS chargedSeconds
     FROM tenant_minute_ledger l WHERE (? IS NULL OR l.tenant_id=?)
    UNION ALL
    SELECT h.tenant_id,h.job_id,h.created_at,h.closed_at,CASE WHEN h.state='held' THEN 'reserved' ELSE h.state END,
     NULL,NULL,h.reserved_seconds,h.charged_seconds FROM tenant_minute_holds h WHERE (? IS NULL OR h.tenant_id=?))
    SELECT e.*,t.display_name AS company FROM entries e JOIN tenants t ON t.id=e.tenantId
    WHERE (?='all' OR e.kind=?) ORDER BY e.createdAt DESC,e.tenantId,e.reference LIMIT 51 OFFSET ?`).bind(tid,tid,tid,tid,kind,kind,Number(offset)).all()).results;
   return json({transactions:rows.slice(0,50),offset:Number(offset),hasMore:rows.length>50,providerRequests:0});
  }
  if(path==='admin-dashboard'){
   if(req.method!=='GET')return fail('method not allowed',405);
   if(!await currentMfa(env,user))return fail('current MFA Super Admin required',403);
   if(url.search)return fail('invalid dashboard query',400);
   // No CRM binding enumeration, PII or carrier API request. Financial
   // aggregate includes inactive companies to retain outstanding liability.
   const position=await db.prepare(`SELECT
    COALESCE((SELECT SUM(balance_seconds) FROM tenant_minute_ledger l WHERE l.sequence=(SELECT MAX(sequence) FROM tenant_minute_ledger WHERE tenant_id=l.tenant_id)),0) AS allocatedSeconds,
    COALESCE(SUM(CASE WHEN state='held' THEN reserved_seconds ELSE 0 END),0) AS heldSeconds,
    COALESCE(SUM(CASE WHEN state='settled' THEN charged_seconds ELSE 0 END),0) AS usedSeconds
    FROM tenant_minute_holds`).first();
   const [clients,sessions,transactions,funding]=await Promise.all([
    db.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END),0) AS active FROM tenants").first(),
    db.prepare("SELECT COALESCE(SUM(CASE WHEN job_id IS NULL THEN 1 ELSE 0 END),0) AS internalEnded,COALESCE(SUM(CASE WHEN job_id IS NOT NULL THEN 1 ELSE 0 END),0) AS campaignEnded FROM scripted_phone_pilots WHERE hangup_at IS NOT NULL").first(),
    db.prepare("SELECT l.created_at AS createdAt,t.display_name AS company,CASE WHEN l.id LIKE 'call-reversal:%' THEN 'call_reversal' ELSE l.kind END AS kind,l.delta_seconds AS deltaSeconds,l.balance_seconds AS balanceSeconds FROM tenant_minute_ledger l JOIN tenants t ON t.id=l.tenant_id ORDER BY l.sequence DESC LIMIT 10").all(),fundingPosition(db,fundingCap(env))
   ]);
   return json({clients,funding:{...funding,reviewedProviderCeilings:providerFundingCaps(env)},position:{...position,uncommittedSeconds:position.allocatedSeconds-position.heldSeconds-position.usedSeconds},internal:{ended:sessions.internalEnded},campaign:{ended:sessions.campaignEnded},transactions:transactions.results,providerRequests:0,externalPaymentsRecorded:false,dispatchEnabledByDashboard:false});
  }
  if(path==='reverse-call-charge'){
   if(req.method!=='POST')return fail('method not allowed',405);
   if(!await currentMfa(env,user)||!mutationOriginAllowed(req))return fail('current MFA Super Admin and same origin required',403);
   if(url.search)return fail('unsupported query',400);
   const d=await boundedBody(req);
   const jid=d?.jobId,tid=d?.tenantId;
   if(!d||Object.keys(d).length!==4||Object.keys(d).some(k=>!['tenantId','jobId','expectedBalanceSeconds','reason'].includes(k))||
    !uuid.test(tid||'')||!(uuid.test(jid||'')||/^[a-f0-9]{32}$/i.test(jid||''))||
    !Number.isSafeInteger(d.expectedBalanceSeconds)||d.expectedBalanceSeconds<0||d.expectedBalanceSeconds>1000000000||
    typeof d.reason!=='string'||d.reason.trim().length<10||d.reason.trim().length>200||/[\u0000-\u001f]/u.test(d.reason))return fail('invalid call reversal',400);
   // A compensating allocation, not modification of the historical provider
   // charge. Reserved ID namespace cannot be used by normal allocation API.
   const id='call-reversal:'+tid+':'+jid,reason=d.reason.trim();
   const h=await db.prepare("SELECT charged_seconds AS charged FROM tenant_minute_holds WHERE tenant_id=? AND job_id=? AND state='settled'").bind(tid,jid).first();
   if(!h||!Number.isSafeInteger(h.charged)||h.charged<=0)return fail('no settled charge to reverse',409);
   const lookup=()=>db.prepare('SELECT tenant_id AS tenantId,actor,delta_seconds AS creditedSeconds,balance_seconds AS balanceSeconds,reason FROM tenant_minute_ledger WHERE id=?').bind(id).first();
   const replay=old=>old&&old.tenantId===tid&&old.actor===user.id&&old.creditedSeconds===h.charged&&old.reason===reason?
    json({transactionId:id,creditedSeconds:h.charged,allocatedSeconds:old.balanceSeconds,replayed:true}):fail('charge already reversed or conflicting request',409);
   const prior=await lookup();if(prior)return replay(prior);
   const next=d.expectedBalanceSeconds+h.charged;
   if(next>1000000000)return fail('balance out of range',409);
   const inserted=await db.prepare(`INSERT INTO tenant_minute_ledger(id,tenant_id,kind,delta_seconds,previous_seconds,balance_seconds,actor,reason,created_at)
    SELECT ?,t.id,'allocation',h.charged_seconds,?,?,?,?,? FROM tenants t JOIN tenant_minute_holds h ON h.tenant_id=t.id
    WHERE t.id=? AND t.status IN('trial','active','suspended') AND h.job_id=? AND h.state='settled' AND h.charged_seconds=?
    AND COALESCE((SELECT balance_seconds FROM tenant_minute_ledger WHERE tenant_id=t.id ORDER BY sequence DESC LIMIT 1),0)=?
    AND NOT EXISTS(SELECT 1 FROM tenant_minute_ledger WHERE id=?)`)
    .bind(id,d.expectedBalanceSeconds,next,user.id,reason,new Date().toISOString(),tid,jid,h.charged,d.expectedBalanceSeconds,id).run();
   if(Number(inserted.meta.changes)!==1){const old=await lookup();return old?replay(old):fail('balance changed; refresh before reversing',409)}
   return json({transactionId:id,creditedSeconds:h.charged,allocatedSeconds:next,replayed:false},201);
  }
  if(path==='minute-ledger'){
   const isAdmin=user?.globalRole==='super_admin';
   if(isAdmin&&!await currentMfa(env,user))return fail('current MFA Super Admin required',403);
   if(req.method==='GET'){
    const keys=[...url.searchParams.keys()],tid=url.searchParams.get('tenantId'),offset=url.searchParams.get('offset')||'0';
    if(keys.some(k=>!['tenantId','offset'].includes(k)||url.searchParams.getAll(k).length!==1)||!uuid.test(tid||'')||!/^\d{1,6}$/.test(offset))return fail('invalid ledger query',400);
    const t=isAdmin?await tenant(env,tid):await requireMembership(db,user,tid,true);
    if(!t)return fail(isAdmin?'tenant not found':'forbidden',isAdmin?404:403);
    // Single SELECT gives a consistent balance and history snapshot.
    const rows=(await db.prepare(`SELECT id AS transactionId,CASE WHEN id LIKE 'call-reversal:%' THEN 'call_reversal' ELSE kind END AS kind,delta_seconds AS deltaSeconds,previous_seconds AS previousSeconds,balance_seconds AS balanceSeconds,created_at AS createdAt${isAdmin?',actor,reason':''},
     (SELECT balance_seconds FROM tenant_minute_ledger WHERE tenant_id=? ORDER BY sequence DESC LIMIT 1) AS currentBalance
     FROM tenant_minute_ledger WHERE tenant_id=? ORDER BY sequence DESC LIMIT 51 OFFSET ?`).bind(tid,tid,Number(offset)).all()).results;
    const position=await minutePosition(db,tid);
    // Financial position is a single SQL snapshot. Transaction pages are
    // observational; a concurrent adjustment must still pass the write CAS.
    const holds=(await db.prepare(`SELECT h.job_id AS jobId,h.state,h.reserved_seconds AS reservedSeconds,h.charged_seconds AS chargedSeconds,h.created_at AS createdAt,h.closed_at AS closedAt,COALESCE(r.delta_seconds,0) AS reversedSeconds
     FROM tenant_minute_holds h LEFT JOIN tenant_minute_ledger r ON r.tenant_id=h.tenant_id AND r.id='call-reversal:'||h.tenant_id||':'||h.job_id
     WHERE h.tenant_id=? ORDER BY h.created_at DESC,h.job_id DESC LIMIT 51 OFFSET ?`).bind(tid,Number(offset)).all()).results;
    const configuration=await scriptedCampaignConfiguration(env);
    let dispatchEnabled=false,spendableSeconds=null;
    if(configuration.ready&&t.status==='active'){
     const member=isAdmin?await db.prepare('SELECT id AS tenant_id,storage_mode,dedicated_binding FROM tenants WHERE id=?').bind(tid).first():t;
     const policy=await resolveCrmDb(env,member).prepare('SELECT max_seconds FROM calling_policies WHERE tenant_id=? AND enabled=1 AND expires_at>?').bind(tid,new Date().toISOString()).first();
     if(policy){const f=await fundingPosition(db,fundingCap(env));spendableSeconds=Math.max(0,Math.min(position.uncommittedSeconds,f.remainingFundedSeconds));dispatchEnabled=affordableCallSeconds(policy.max_seconds,position.uncommittedSeconds,f.remainingFundedSeconds)>0;}
    }
    return json({tenantId:tid,...position,spendableSeconds,dispatchEnabled,offset:Number(offset),hasMore:rows.length>50||holds.length>50,
     transactions:rows.slice(0,50).map(({currentBalance,...row})=>row),callTransactions:holds.slice(0,50),status:spendableSeconds===null?'allocation_only':'funding_checked'});
   }
   if(!isAdmin||!mutationOriginAllowed(req))return fail('current MFA Super Admin and same origin required',403);
   if(url.search)return fail('unsupported query',400);
   const d=await boundedBody(req);
   if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).length!==5||
      Object.keys(d).some(k=>!['tenantId','transactionId','deltaSeconds','expectedBalanceSeconds','reason'].includes(k))||
      !uuid.test(d.tenantId||'')||!uuid.test(d.transactionId||'')||!Number.isSafeInteger(d.deltaSeconds)||d.deltaSeconds===0||Math.abs(d.deltaSeconds)>1000000000||
      !Number.isSafeInteger(d.expectedBalanceSeconds)||d.expectedBalanceSeconds<0||d.expectedBalanceSeconds>1000000000||
      typeof d.reason!=='string'||d.reason.trim().length<10||d.reason.trim().length>200||/[\u0000-\u001f]/u.test(d.reason))return fail('invalid ledger adjustment',400);
   const tid=d.tenantId,kind=d.deltaSeconds>0?'allocation':'recovery',reason=d.reason.trim();
   const lookup=()=>db.prepare('SELECT tenant_id AS tenantId,actor,kind,delta_seconds AS deltaSeconds,previous_seconds AS previousSeconds,balance_seconds AS balanceSeconds,reason,created_at AS createdAt FROM tenant_minute_ledger WHERE id=?').bind(d.transactionId).first();
   function replay(old){
    if(!old||old.tenantId!==tid||old.actor!==user.id||old.deltaSeconds!==d.deltaSeconds||old.previousSeconds!==d.expectedBalanceSeconds||old.reason!==reason)return fail('transaction conflict; refresh ledger',409);
    return json({transactionId:d.transactionId,allocatedSeconds:old.balanceSeconds,replayed:true,dispatchEnabled:false,status:'allocation_only'});
   }
   const prior=await lookup();if(prior)return replay(prior);
   const next=d.expectedBalanceSeconds+d.deltaSeconds;
   if(next<0||next>1000000000)return fail('insufficient allocated minutes or balance out of range',409);
   const result=await db.prepare(`INSERT INTO tenant_minute_ledger(id,tenant_id,kind,delta_seconds,previous_seconds,balance_seconds,actor,reason,created_at)
    SELECT ?,id,?,?,?,?,?,?,? FROM tenants WHERE id=? AND status IN ('trial','active')
    AND COALESCE((SELECT balance_seconds FROM tenant_minute_ledger WHERE tenant_id=tenants.id ORDER BY sequence DESC LIMIT 1),0)=?
    AND NOT EXISTS(SELECT 1 FROM tenant_minute_ledger WHERE id=?)
    AND ?>=COALESCE((SELECT SUM(CASE WHEN state='held' THEN reserved_seconds ELSE charged_seconds END) FROM tenant_minute_holds WHERE tenant_id=tenants.id),0)`)
    .bind(d.transactionId,kind,d.deltaSeconds,d.expectedBalanceSeconds,next,user.id,reason,new Date().toISOString(),tid,d.expectedBalanceSeconds,d.transactionId,next).run();
   if(Number(result.meta.changes)!==1){const old=await lookup();return old?replay(old):fail('balance changed, minutes committed or client unavailable; refresh',409)}
   return json({transactionId:d.transactionId,allocatedSeconds:next,replayed:false,dispatchEnabled:false,status:'allocation_only'},201);
  }
  if(path==='call-costs'||path==='internal-call-cdr'){
   if(req.method!=='GET')return fail('method not allowed',405);
   if(!await currentMfa(env,user))return fail('current MFA Super Admin required',403);
   const keys=[...url.searchParams.keys()],tid=url.searchParams.get('tenantId'),id=url.searchParams.get('sessionId'),offset=url.searchParams.get('offset')||'0';
   const allowed=path==='call-costs'?['tenantId','offset']:['tenantId','sessionId'];
   if(keys.some(k=>!allowed.includes(k)||url.searchParams.getAll(k).length!==1)||!uuid.test(tid||'')||
      (path==='call-costs'?!/^\d{1,6}$/.test(offset):!uuid.test(id||'')))return fail('invalid cost query',400);
   const t=await db.prepare('SELECT id AS tenant_id,storage_mode,dedicated_binding FROM tenants WHERE id=?').bind(tid).first();
   if(!t)return fail('tenant not found',404);
   if(path==='internal-call-cdr'){
    const row=await db.prepare('SELECT * FROM scripted_phone_pilots WHERE tenant_id=? AND id=? AND job_id IS NULL AND hangup_at IS NOT NULL AND provider_call_id IS NOT NULL').bind(tid,id).first();
    if(!row)return fail('signed ended internal call not found',404);
    try{return json({record:costObservation(row,await readInternalPlivoCdr(env,row,fetcher)),status:'read_only',clientCreditsDebited:false})}
    catch{return fail('provider CDR unavailable or mismatched',503)}
   }
   const rows=(await db.prepare('SELECT id,job_id,phase,survey_json,created_at,duration_seconds FROM scripted_phone_pilots WHERE tenant_id=? AND hangup_at IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?').bind(tid,Number(offset)).all()).results;
   const page=rows.slice(0,50),jobs=page.filter(x=>x.job_id).map(x=>x.job_id);
   const verified=jobs.length?(await resolveCrmDb(env,t).prepare('SELECT job_id,reported_amount AS reportedAmount,billed_seconds AS billedSeconds FROM verified_provider_call_costs WHERE tenant_id=? AND job_id IN (SELECT value FROM json_each(?))').bind(tid,JSON.stringify(jobs)).all()).results:[];
   const byJob=new Map(verified.map(x=>[x.job_id,x]));
   return json({records:page.map(x=>costObservation(x,byJob.get(x.job_id))),offset:Number(offset),hasMore:rows.length>50,status:'observation_only',clientCreditsDebited:false,providerRequests:0});
  }
  if(path==='production-cost-plan'){
   if(req.method!=='GET')return fail('method not allowed',405);
   if(!await currentMfa(env,user))return fail('current MFA Super Admin required',403);
   const keys=[...url.searchParams.keys()],allowed=['minutes','audioPercent','numbers'];
   if(keys.length!==3||keys.some(k=>!allowed.includes(k)||url.searchParams.getAll(k).length!==1)||
      allowed.some(k=>!/^\d{1,7}$/.test(url.searchParams.get(k)||'')))return fail('invalid cost estimate',400);
   try{return json(estimateProductionCost(Object.fromEntries(allowed.map(k=>[k,Number(url.searchParams.get(k))]))))}
   catch{return fail('invalid cost estimate',400)}
  }
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
  if(path==='minute-usage'){
   if(req.method!=='GET')return fail('method not allowed',405);
   const keys=[...url.searchParams.keys()],tid=url.searchParams.get('tenantId'),offsetText=url.searchParams.get('offset')||'0';
   if(keys.some(k=>!['tenantId','offset'].includes(k)||url.searchParams.getAll(k).length!==1)||
      !uuid.test(tid||'')||!/^[0-9]{1,6}$/.test(offsetText))return fail('invalid usage query',400);
   const admin=user?.globalRole==='super_admin';
   let t;
   if(admin){
    if(!await currentMfa(env,user))return fail('current MFA Super Admin required',403);
    t=await db.prepare('SELECT id AS tenant_id,storage_mode,dedicated_binding FROM tenants WHERE id=?').bind(tid).first();
   }else t=await requireMembership(db,user,tid,true);
   if(!t)return fail(admin?'tenant not found':'forbidden',admin?404:403);
   const crm=resolveCrmDb(env,t),offset=Number(offsetText);
   const [plan,usage,pending,history,records,internal,settled]=await Promise.all([
    budget(db,tid),
    crm.prepare('SELECT COUNT(*) AS verifiedCalls,COALESCE(SUM(call_seconds),0) AS connectedSeconds,COALESCE(SUM(billed_seconds),0) AS billedSeconds FROM verified_provider_call_costs WHERE tenant_id=?').bind(tid).first(),
    crm.prepare(`SELECT COUNT(*) AS pendingCalls FROM calling_jobs j
     WHERE j.tenant_id=? AND j.state IN('completed','failed') AND j.provider_call_sid IS NOT NULL
     AND NOT EXISTS(SELECT 1 FROM verified_provider_call_costs v WHERE v.tenant_id=j.tenant_id AND v.job_id=j.id)`).bind(tid).first(),
    db.prepare('SELECT id AS transactionId,previous_paise AS previousPaise,new_paise AS newPaise,created_at AS createdAt'+(admin?',actor,reason':'')+' FROM tenant_credit_audit WHERE tenant_id=? ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?').bind(tid,offset).all(),
    crm.prepare(`SELECT j.id AS jobId,j.updated_at AS updatedAt,j.state,l.name AS customerName,
      CASE WHEN j.provider_call_sid IS NOT NULL THEN 1 ELSE 0 END AS hasProviderCall,v.call_seconds AS connectedSeconds,
      v.billed_seconds AS billedSeconds,v.verified_at AS verifiedAt
      FROM calling_jobs j LEFT JOIN verified_provider_call_costs v ON v.tenant_id=j.tenant_id AND v.job_id=j.id
      LEFT JOIN leads l ON l.tenant_id=j.tenant_id AND l.id=j.lead_id
      WHERE j.tenant_id=? AND j.state IN('completed','failed')
      ORDER BY j.updated_at DESC,j.id DESC LIMIT 51 OFFSET ?`).bind(tid,offset).all(),
    admin?db.prepare(`SELECT COUNT(*) AS calls,COALESCE(SUM(duration_seconds),0) AS connectedSeconds
     FROM scripted_phone_pilots WHERE tenant_id=? AND job_id IS NULL AND hangup_at IS NOT NULL`).bind(tid).first():Promise.resolve(null),
    db.prepare(`SELECT COALESCE(SUM(h.charged_seconds),0) AS grossSeconds,COALESCE(SUM(r.delta_seconds),0) AS returnedSeconds
     FROM tenant_minute_holds h LEFT JOIN tenant_minute_ledger r ON r.tenant_id=h.tenant_id AND r.id='call-reversal:'||h.tenant_id||':'||h.job_id
     WHERE h.tenant_id=? AND h.state='settled'`).bind(tid).first()
   ]);
   const page=records.results.slice(0,50),jobIds=page.map(x=>x.jobId);
   const holds=jobIds.length?(await db.prepare(`SELECT h.job_id AS jobId,h.state,h.reserved_seconds AS reservedSeconds,h.charged_seconds AS chargedSeconds,COALESCE(r.delta_seconds,0) AS returnedSeconds
    FROM tenant_minute_holds h LEFT JOIN tenant_minute_ledger r ON r.tenant_id=h.tenant_id AND r.id='call-reversal:'||h.tenant_id||':'||h.job_id
    WHERE h.tenant_id=? AND h.job_id IN (SELECT value FROM json_each(?))`).bind(tid,JSON.stringify(jobIds)).all()).results:[];
   const byJob=new Map(holds.map(h=>[h.jobId,h]));
   return json({tenantId:tid,plannedPaise:Number(plan?.plannedPaise||0),spendableSeconds:null,
    debitedSeconds:settled.grossSeconds-settled.returnedSeconds,grossDebitedSeconds:settled.grossSeconds,returnedSeconds:settled.returnedSeconds,verifiedCalls:Number(usage.verifiedCalls),connectedSeconds:Number(usage.connectedSeconds),
    billedSeconds:Number(usage.billedSeconds),pendingCalls:Number(pending.pendingCalls),
    internal:internal?{calls:Number(internal.calls),connectedSeconds:Number(internal.connectedSeconds)}:null,
    transactions:history.results.slice(0,50).map(x=>({...x,deltaPaise:x.newPaise-x.previousPaise,
     type:x.newPaise>x.previousPaise?'allocation':x.newPaise<x.previousPaise?'recovery':'unchanged'})),
    records:page.map(x=>{
     const h=byJob.get(x.jobId);
     return {...x,hasProviderCall:Boolean(x.hasProviderCall),settlementPending:h?.state==='held',
      walletState:h?.state||'no_ledger',reservedSeconds:h?.reservedSeconds??null,
      chargedSeconds:h?.chargedSeconds??null,returnedSeconds:h?.returnedSeconds??null,
      netDebitedSeconds:h?.chargedSeconds!=null?h.chargedSeconds-h.returnedSeconds:null};
    }),offset,hasMore:history.results.length>50||records.results.length>50,
    status:'observation_only',notice:'Verified provider seconds and historical INR plan records. Check the minute ledger for actual holds and settlements. No online payments.'});
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
  if(/minutes already committed/i.test(String(e?.message||'')))return fail('minutes already committed; recovery would reduce reserved or used credits',409);
  if(/invalid|too large|JSON/i.test(String(e?.message||'')))return fail('invalid credit request',400);
  console.error('AR3D credit planning not available');
  return fail('credit planning unavailable; check Control D1 migration',503);
 }
}
