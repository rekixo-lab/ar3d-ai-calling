// Read-only provider observations. This module does not grant dispatch approval,
// change a plan, recharge an account, write funding, or infer India currency.
// Plivo documents Account.cash_credits in USD:
// https://www.plivo.com/docs/account/api/account
const MAX_BODY_BYTES=8192;
const MAX_BALANCE_MICROS=999999999999n;
const TIMEOUT_MS=5000;

function discard(response){
 try{void response.body?.cancel().catch(()=>{});}catch{}
}

// Use integer decimal arithmetic: floating point multiplication can round a
// balance up and make an unfunded reservation appear affordable.
function balanceMicros(value){
 if(typeof value!=='string'||!/^\d{1,12}(?:\.\d{1,18})?$/.test(value))return null;
 const [whole,fraction='']=value.split('.');
 const amount=BigInt(whole)*1000000n+BigInt((fraction+'000000').slice(0,6));
 return amount<=MAX_BALANCE_MICROS?Number(amount):null;
}

async function abortable(promise,signal){
 if(signal.aborted)throw Error('provider_timeout');
 let cancel;
 const aborted=new Promise((_,reject)=>{
  cancel=()=>reject(Error('provider_timeout'));
  signal.addEventListener('abort',cancel,{once:true});
 });
 try{return await Promise.race([promise,aborted]);}
 finally{signal.removeEventListener('abort',cancel);}
}

async function readJson(response,signal){
 const type=response.headers.get('content-type')||'';
 const length=response.headers.get('content-length');
 if(!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(type)||!response.body||
    length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY_BYTES)){
  discard(response);throw Error('provider_response_invalid');
 }
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 let bytes=0,raw='',done=false;
 try{
  while(true){
   const chunk=await abortable(reader.read(),signal);
   if(chunk.done){done=true;break;}
   bytes+=chunk.value.byteLength;
   if(bytes>MAX_BODY_BYTES)throw Error('provider_response_invalid');
   raw+=decoder.decode(chunk.value,{stream:true});
  }
  raw+=decoder.decode();
  return JSON.parse(raw);
 }finally{
  if(!done)void reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
}

/**
 * Observe a Plivo account using its existing server-side credentials.
 * checkedAt is Unix milliseconds. balanceMicros is a floored USD amount or
 * null when unverified. productionEligible describes paid/prepaid account
 * status only; it does not establish route permission, consent, or funding.
 */
export async function readPlivoBalance(env,{fetcher=fetch,now=Date.now()}={}){
 const base={available:false,provider:'plivo',currency:'USD',balanceMicros:null,
  accountType:'unverified',billingMode:'unverified',productionEligible:false,
  checkedAt:Number.isSafeInteger(now)&&now>=0?now:null};
 const fail=reason=>({...base,reason});
 if(base.checkedAt===null)return fail('observation_time_invalid');
 const auth=env?.PLIVO_AUTH_ID,token=env?.PLIVO_AUTH_TOKEN;
 if(typeof auth!=='string'||!/^[A-Za-z0-9]{8,64}$/.test(auth)||
    typeof token!=='string'||!/^[A-Za-z0-9]{16,128}$/.test(token))
  return fail('plivo_credentials_not_configured');
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
 try{
  const response=await abortable(fetcher('https://api.plivo.com/v1/Account/'+encodeURIComponent(auth)+'/',{
   method:'GET',redirect:'manual',signal:controller.signal,
   headers:{Authorization:'Basic '+btoa(auth+':'+token),Accept:'application/json'}
  }),controller.signal);
  if(response.redirected||response.status>=300&&response.status<400){
   discard(response);return fail('provider_redirect_rejected');
  }
  if(response.status===401||response.status===403){discard(response);return fail('provider_authentication_failed');}
  if(!response.ok){discard(response);return fail('provider_balance_http_error');}
  let data;
  try{data=await readJson(response,controller.signal);}
  catch{return fail(controller.signal.aborted?'provider_balance_timeout':'provider_response_invalid');}
  if(!data||typeof data!=='object'||Array.isArray(data))return fail('provider_response_invalid');
  // Missing identity is not sufficient proof that these credentials own the
  // observed funds, even if the request URL contained our Auth ID.
  if(data.auth_id!==auth)return fail('provider_account_identity_mismatch');
  if(data.currency!==undefined&&data.currency!=='USD')return fail('provider_balance_currency_unverified');
  const amount=balanceMicros(data.cash_credits);
  if(amount===null)return fail('provider_balance_invalid');
  const accountType=['developer','standard'].includes(data.account_type)?data.account_type:'unverified';
  const billingMode=['prepaid','postpaid'].includes(data.billing_mode)?data.billing_mode:'unverified';
  const productionEligible=accountType==='standard'&&billingMode==='prepaid';
  const reason=accountType==='developer'?'trial_account':
   accountType!=='standard'?'account_type_unverified':
   billingMode==='postpaid'?'postpaid_account':
   billingMode!=='prepaid'?'billing_mode_unverified':
   amount===0?'provider_balance_exhausted':'verified_account_balance';
  return {...base,available:true,balanceMicros:amount,accountType,billingMode,productionEligible,reason};
 }catch{
  return fail(controller.signal.aborted?'provider_balance_timeout':'provider_balance_unavailable');
 }finally{clearTimeout(timer);}
}
