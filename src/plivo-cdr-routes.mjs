// Client-facing call credit history. No provider amount, credentials or API requests.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb} from './core.mjs';
const PATH='/v1/human/plivo-cdr';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const JOB_ID=/^[a-f0-9]{32}$/i;
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const fail=(error,status=400)=>json({error},status);
export async function handlePlivoCdrRequest(req,env,user){
 const url=new URL(req.url);
 if(url.pathname!==PATH)return null;
 if(req.method!=='GET')return fail('method not allowed',405);
 if([...url.searchParams.keys()].some(k=>!['tenantId','jobId'].includes(k)||url.searchParams.getAll(k).length!==1)||
    !UUID.test(url.searchParams.get('tenantId')||'')||!(UUID.test(url.searchParams.get('jobId')||'')||JOB_ID.test(url.searchParams.get('jobId')||'')))return fail('invalid call credit request');
 const tid=url.searchParams.get('tenantId'),jid=url.searchParams.get('jobId');
 try{
  const member=await requireMembership(env.CONTROL_DB,user,tid,true);
  if(!member)return fail('forbidden',403);
  const db=resolveCrmDb(env,member);
  const job=await db.prepare('SELECT id,state,duration_seconds AS connectedSeconds FROM calling_jobs WHERE tenant_id=? AND id=?').bind(tid,jid).first();
  if(!job)return fail('call attempt not found',404);
  const hold=await env.CONTROL_DB.prepare('SELECT state,reserved_seconds AS reservedSeconds,charged_seconds AS chargedSeconds,closed_at AS closedAt FROM tenant_minute_holds WHERE tenant_id=? AND job_id=?').bind(tid,jid).first();
  const status=hold?.state??'not_recorded';
  return json({tenantId:tid,jobId:jid,callState:job.state,connectedSeconds:job.connectedSeconds,
   settlementStatus:status,reservedSeconds:hold?.state==='held'?hold.reservedSeconds:0,
   chargedSeconds:hold&&['settled','released'].includes(status)?hold.chargedSeconds:null,
   closedAt:hold?.closedAt??null});
 }catch{return fail('call credit record unavailable',503)}
}
