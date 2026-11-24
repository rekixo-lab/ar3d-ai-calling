// Read-only, on-demand Plivo CDR lookup for a completed tenant call.
// No browser-side provider secrets, no wallet debit and no dial or retry.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb} from './core.mjs';

const PATH='/v1/human/plivo-cdr';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200)=>Response.json(data,{status,headers:HEADERS});
const fail=(error,status=400)=>json({error},status);
const normalize=value=>typeof value==='string'?value.replace(/^\+/,''):null;
const isDuration=v=>Number.isSafeInteger(v)&&v>=0&&v<=86400;
const amount=v=>typeof v==='string'&&/^(?:0|[1-9]\d{0,8})(?:\.\d{1,8})?$/.test(v);

export async function handlePlivoCdrRequest(req,env,user,{fetcher=fetch}={}){
 const url=new URL(req.url);
 if(url.pathname!==PATH)return null;
 if(req.method!=='GET')return fail('method not allowed',405);
 if([...url.searchParams.keys()].some(k=>!['tenantId','jobId'].includes(k)||
    url.searchParams.getAll(k).length!==1)||
    !UUID.test(url.searchParams.get('tenantId')||'')||
    !UUID.test(url.searchParams.get('jobId')||''))
  return fail('invalid CDR request');
 const tid=url.searchParams.get('tenantId'),jid=url.searchParams.get('jobId');
 try{
  const member=await requireMembership(env.CONTROL_DB,user,tid,true);
  if(!member)return fail('forbidden',403);
  const db=resolveCrmDb(env,member);
  const job=await db.prepare(
   'SELECT id,state,account_sid AS accountSid,provider_call_sid AS callUuid,'+
   'caller_id AS caller,destination FROM calling_jobs WHERE tenant_id=? AND id=?'
  ).bind(tid,jid).first();
  if(!job)return fail('call attempt not found',404);
  if(!['completed','failed'].includes(job.state)||!UUID.test(job.callUuid||''))
   return fail('final provider CDR is not yet available for this call',409);
  const auth=env.PLIVO_AUTH_ID,token=env.PLIVO_AUTH_TOKEN;
  if(typeof auth!=='string'||!/^[A-Za-z0-9]{8,64}$/.test(auth)||
     typeof token!=='string'||!/^[A-Za-z0-9]{16,128}$/.test(token)||
     job.accountSid!==auth)return fail('Plivo billing not configured for this call',503);
  const res=await fetcher('https://api.plivo.com/v1/Account/'+encodeURIComponent(auth)+
   '/Call/'+encodeURIComponent(job.callUuid)+'/',{
    method:'GET',redirect:'manual',signal:AbortSignal.timeout(5000),
    headers:{Authorization:'Basic '+btoa(auth+':'+token),Accept:'application/json'}
   });
  if(!res.ok||!res.headers.get('content-type')?.toLowerCase().includes('application/json')||
     Number(res.headers.get('content-length'))>8192)
   return fail('verified Plivo CDR unavailable',503);
  const raw=await res.text();
  if(raw.length>8192)return fail('verified Plivo CDR unavailable',503);
  const cdr=JSON.parse(raw);
  if(cdr?.call_uuid!==job.callUuid||cdr?.call_direction!=='outbound'||
     normalize(cdr.from_number)!==normalize(job.caller)||
     normalize(cdr.to_number)!==normalize(job.destination)||
     !isDuration(cdr.billed_duration)||!isDuration(cdr.call_duration)||
     !amount(cdr.total_amount))
   return fail('Plivo CDR did not match this tenant call',503);
  return json({
   tenantId:tid,jobId:jid,provider:'Plivo',
   billedSeconds:cdr.billed_duration,callSeconds:cdr.call_duration,
   providerReportedAmount:cdr.total_amount,
   currency:'unverified_for_India_account',
   providerRecordMatched:true,creditDeducted:false,spentInr:null,
   notice:'Provider amount was returned for this call, but currency is not independently verified. No INR balance was deducted or marked spendable.'
  });
 }catch{
  console.error('AR3D read-only Plivo CDR lookup unavailable');
  return fail('verified Plivo CDR unavailable',503);
 }
}
