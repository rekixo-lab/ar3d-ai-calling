// Shared, read-only identity and amount verification for Plivo CDRs.
// Never selects a job, grants dispatch authorization, writes a ledger, or
// treats a provider observation as permission to settle a wallet hold.
import {readBoundedBytes} from './scripted-speech.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const phone=x=>typeof x==='string'&&/^\+?[1-9]\d{6,14}$/.test(x)?x.replace(/^\+/,''):null;
const seconds=x=>Number.isSafeInteger(x)&&x>=0&&x<=86400;
const money=x=>typeof x==='string'&&/^(?:0|[1-9]\d{0,8})(?:\.\d{1,8})?$/.test(x);
const fail=error=>({ok:false,error});
const unavailable='provider CDR unavailable',mismatch='provider call identity or amount did not match';
const jsonType=value=>/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/i.test((value||'').split(';')[0].trim());

export async function readVerifiedPlivoCdr(env,job,{fetcher=fetch}={}){
 const auth=env?.PLIVO_AUTH_ID,token=env?.PLIVO_AUTH_TOKEN;
 if(typeof auth!=='string'||!/^[A-Za-z0-9]{8,64}$/.test(auth)||
    typeof token!=='string'||!/^[A-Za-z0-9]{16,128}$/.test(token)||
    job?.accountSid!==auth)return fail('Plivo billing credentials unavailable');
 const caller=phone(job?.caller),destination=phone(job?.destination);
 if(typeof job?.callUuid!=='string'||!UUID.test(job.callUuid)||!caller||!destination)
  return fail(mismatch);
 let cdr;
 try{
  const response=await fetcher(
   'https://api.plivo.com/v1/Account/'+encodeURIComponent(auth)+'/Call/'+encodeURIComponent(job.callUuid)+'/',{
    method:'GET',redirect:'manual',signal:AbortSignal.timeout(5000),
    headers:{Authorization:'Basic '+btoa(auth+':'+token),Accept:'application/json'}
   });
  if(!response.ok||!jsonType(response.headers.get('content-type')))return fail(unavailable);
  cdr=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBytes(response,8192)));
 }catch{return fail(unavailable)}
 if(!cdr||typeof cdr!=='object'||Array.isArray(cdr)||
    cdr.call_uuid!==job.callUuid||cdr.call_direction!=='outbound'||
    phone(cdr.from_number)!==caller||phone(cdr.to_number)!==destination||
    !seconds(cdr.billed_duration)||!seconds(cdr.call_duration)||cdr.billed_duration<cdr.call_duration||
    !money(cdr.total_amount))return fail(mismatch);
 // Project only the bounded fields consumed by settlement. Do not expose raw
 // provider metadata, credentials, phone numbers or an inferred currency.
 return {ok:true,cdr:{call_uuid:cdr.call_uuid,billed_duration:cdr.billed_duration,
  call_duration:cdr.call_duration,total_amount:cdr.total_amount}};
}
