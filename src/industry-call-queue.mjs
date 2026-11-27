// Purpose-aware preparation queue for the existing production shared CRM.
// No telephony adapter, scheduler, call claim, credit reservation or provider POST.
import {currentSuperAdminMfa,requireMembership,mutationOriginAllowed} from './human-auth.mjs';
import {readBoundedBytes} from './scripted-speech.mjs';
import {readIndustryRecipientScope} from './industry-campaigns.mjs';
import {readApprovedSchoolAudioPack} from './industry-school-audio-preparation.mjs';
const BASE='/v1/human/industry-queue';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const reason=x=>typeof x==='string'&&x.trim().length>=4&&x.length<=160&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(x);
const iso=n=>new Date(n).toISOString();
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(d,status=200)=>Response.json(d,status===200?{headers}:{status,headers});
const error=(code,status=400)=>reply({error:code},status);
const fail=x=>{throw Error(x)};
const localEligibility="v.decision='cleared' AND v.revision=(SELECT MAX(r.revision) FROM industry_recipient_reviews r WHERE r.tenant_id=v.tenant_id AND r.campaign_id=v.campaign_id AND r.lead_id=v.lead_id) AND v.destination=l.mobile_e164 AND v.lead_updated_at=l.updated_at AND l.mobile_e164 GLOB '+91[6-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' AND l.consent_status<>'denied' AND l.dnd_status<>'blocked' AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id)";
async function access(env,user,tid,write,now){
 if(!uuid(tid)||!user)return null;
 if(user.globalRole==='super_admin'){
  if(!await currentSuperAdminMfa(env.CONTROL_DB,user,now))return null;
  return env.CONTROL_DB.prepare("SELECT id AS tenant_id,status,storage_mode FROM tenants WHERE id=? AND storage_mode='shared' AND status IN('active','trial','suspended')").bind(tid).first();
 }
 const row=await requireMembership(env.CONTROL_DB,user,tid,write);
 return row?.storage_mode==='shared'?row:null;
}
async function campaignFor(db,tid,id){
 return db.prepare("SELECT * FROM industry_campaigns WHERE tenant_id=? AND id=?").bind(tid,id).first();
}
async function recordedAudio(env,c){
 const row=await env.CONTROL_DB.prepare("SELECT a.manifest_sha256 FROM school_audio_preparations a JOIN industry_launch_requests r ON r.tenant_id=a.tenant_id AND r.id=a.launch_id WHERE a.tenant_id=? AND a.launch_id=? AND a.snapshot_id=? AND a.graph_sha256=? AND a.state='approved' AND r.state='configuration_reviewed' AND r.purpose='school_admission' AND r.snapshot_id=a.snapshot_id AND r.graph_sha256=a.graph_sha256").bind(c.tenant_id,c.launch_request_id,c.snapshot_id,c.graph_sha256).first();
 return digest(row?.manifest_sha256)?row.manifest_sha256:null;
}
async function body(req){
 if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')fail('industry_queue_invalid_request');
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBytes(req,8192)))}catch{fail('industry_queue_invalid_request')}
}
const audit=(db,tid,user,action,target,at)=>db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) SELECT ?,?,?,?,?,? WHERE changes()>0").bind(tid,crypto.randomUUID(),'human:'+user.id,action,target,at);
// Server-only freshness contract for the future funded release/claim step.
// This is read-only and explicitly NOT a dial authorization.
export async function readPreparedIndustryJob(env,{tenantId,jobId,now=Date.now()}){
 if(!uuid(tenantId)||!uuid(jobId))fail('industry_queue_invalid_scope');
 const started=Date.now(),clock=()=>now+Math.max(0,Date.now()-started);
 const db=env.CRM_DB,j=await db.prepare("SELECT * FROM industry_call_jobs WHERE tenant_id=? AND id=? AND state='prepared'").bind(tenantId,jobId).first();
 if(!j)fail('industry_job_not_prepared');
 const scope=await readIndustryRecipientScope(env,{tenantId,campaignId:j.campaign_id,leadId:j.lead_id,now});
 const c=await campaignFor(db,tenantId,j.campaign_id);
 if(!c||scope.snapshotId!==j.snapshot_id||scope.digest!==j.graph_sha256||scope.reviewRevision!==j.review_revision||scope.expiresAt!==j.review_expires_at||scope.purpose!==j.purpose)fail('industry_job_scope_changed');
 const pack=await readApprovedSchoolAudioPack(env,{tenantId,launchId:c.launch_request_id});
 if(pack.manifestSha256!==j.manifest_sha256||pack.snapshotId!==j.snapshot_id||pack.graphSha256!==j.graph_sha256)fail('industry_job_audio_changed');
 const fresh=await readIndustryRecipientScope(env,{tenantId,campaignId:j.campaign_id,leadId:j.lead_id,now:clock()});
 const still=await db.prepare("SELECT id FROM industry_call_jobs WHERE tenant_id=? AND id=? AND state='prepared'").bind(tenantId,jobId).first();
 if(!still||Date.parse(fresh.expiresAt)<=clock()||fresh.reviewRevision!==j.review_revision||fresh.expiresAt!==j.review_expires_at||fresh.destination!==scope.destination||fresh.leadUpdatedAt!==scope.leadUpdatedAt||fresh.digest!==scope.digest)fail('industry_job_scope_changed');
 return {jobId,scope:fresh,pack,dispatchReady:false};
}
export async function handleIndustryCallQueue(req,env,user,{now=Date.now()}={}){
 const url=new URL(req.url),m=url.pathname.match(/^\/v1\/human\/industry-queue\/([a-f0-9-]{36})(?:\/(prepare|cancel))?$/i);
 if(!url.pathname.startsWith(BASE+'/'))return null;
 if(!m||!uuid(m[1]))return error('industry_queue_invalid_scope');
 const op=m[2],get=!op;
 if(req.method!==(get?'GET':'POST'))return error('method_not_allowed',405);
 if(!get&&(!mutationOriginAllowed(req)||url.search))return error('same_origin_required',403);
 const started=Date.now(),clock=()=>now+Math.max(0,Date.now()-started);
 try{
  const data=get?{tenantId:url.searchParams.get('tenantId')}:await body(req),tid=data?.tenantId,id=m[1],db=env.CRM_DB;
  if(!uuid(tid))return error('industry_queue_invalid_scope');
  const member=await access(env,user,tid,!get,now);
  if(!member)return error('industry_queue_access_denied',403);
  const c=await campaignFor(db,tid,id);
  if(!c)return error('industry_campaign_not_found',404);
  if(get){
   if([...url.searchParams.keys()].some(k=>!['tenantId','offset'].includes(k)||url.searchParams.getAll(k).length!==1))return error('industry_queue_invalid_query');
   const offset=url.searchParams.get('offset')||'0';
   if(!/^\d{1,5}$/.test(offset)||Number(offset)>10000)return error('industry_queue_invalid_query');
   const manifestSha256=await recordedAudio(env,c);
   const rows=await db.prepare("SELECT j.id,j.lead_id,j.review_revision,j.state,j.manifest_sha256,j.created_at,j.review_expires_at,a.state AS admission_state,a.max_seconds AS admission_seconds,a.expires_at AS admission_expires_at,z.closed_at AS terminal_closed_at,CASE WHEN j.state='prepared' AND c.archived_at IS NULL AND v.expires_at>? AND "+localEligibility+" THEN 1 ELSE 0 END AS current FROM industry_call_jobs j JOIN industry_campaigns c ON c.tenant_id=j.tenant_id AND c.id=j.campaign_id JOIN industry_recipient_reviews v ON v.tenant_id=j.tenant_id AND v.campaign_id=j.campaign_id AND v.lead_id=j.lead_id AND v.revision=j.review_revision JOIN leads l ON l.tenant_id=j.tenant_id AND l.id=j.lead_id LEFT JOIN industry_funded_admissions a ON a.tenant_id=j.tenant_id AND a.job_id=j.id LEFT JOIN industry_terminal_closures z ON z.tenant_id=j.tenant_id AND z.job_id=j.id WHERE j.tenant_id=? AND j.campaign_id=? ORDER BY j.created_at DESC,j.id LIMIT 51 OFFSET ?")
    .bind(iso(now),tid,id,Number(offset)).all();
   return reply({manifestSha256,archived:!!c.archived_at,tenantActive:member.status==='active',jobs:rows.results.slice(0,50).map(j=>({id:j.id,leadId:j.lead_id,reviewRevision:j.review_revision,state:j.state,current:!j.terminal_closed_at&&j.current===1&&member.status==='active'&&manifestSha256===j.manifest_sha256,terminalState:j.terminal_closed_at?'settled':null,capacityReleased:!!j.terminal_closed_at,createdAt:j.created_at,expiresAt:j.review_expires_at,admissionState:j.admission_state||'not_released',admissionSeconds:j.admission_seconds??null,admissionExpiresAt:j.admission_expires_at??null})),hasMore:rows.results.length>50,dispatchReady:false});
  }
  if(op==='cancel'){
   if(!exact(data,['tenantId','jobId','reason'])||!uuid(data.jobId)||!reason(data.reason))return error('industry_queue_invalid_request');
   const at=iso(clock());
   const out=await db.batch([db.prepare("UPDATE industry_call_jobs SET state='cancelled',cancelled_by=?,cancelled_at=?,cancel_reason=? WHERE tenant_id=? AND campaign_id=? AND id=? AND state='prepared' AND NOT EXISTS(SELECT 1 FROM industry_funded_admissions a WHERE a.tenant_id=industry_call_jobs.tenant_id AND a.job_id=industry_call_jobs.id AND a.state IN('claiming','funded','unknown'))").bind(user.id,at,data.reason.trim(),tid,id,data.jobId),audit(db,tid,user,'industry.job_cancelled',data.jobId,at)]);
   return out[0].meta.changes===1?reply({cancelled:true,dispatchReady:false}):error('industry_job_not_prepared',409);
  }
  if(user.globalRole==='super_admin'||member.status!=='active')return error('active_client_admin_required',403);
  if(c.archived_at)return error('industry_campaign_archived',409);
  if(!exact(data,['tenantId','manifestSha256','recipients','acknowledgePreparationOnly'])||!digest(data.manifestSha256)||data.acknowledgePreparationOnly!==true||
   !Array.isArray(data.recipients)||data.recipients.length<1||data.recipients.length>50||
   data.recipients.some(r=>!exact(r,['leadId','reviewRevision'])||!uuid(r.leadId)||!Number.isSafeInteger(r.reviewRevision)||r.reviewRevision<1||r.reviewRevision>1000)||
   new Set(data.recipients.map(r=>r.leadId.toLowerCase())).size!==data.recipients.length)return error('industry_queue_invalid_request');
  if(await recordedAudio(env,c)!==data.manifestSha256)return error('industry_audio_approval_required',409);
  const pack=await readApprovedSchoolAudioPack(env,{tenantId:tid,launchId:c.launch_request_id});
  if(pack.manifestSha256!==data.manifestSha256||pack.snapshotId!==c.snapshot_id||pack.graphSha256!==c.graph_sha256)return error('industry_audio_approval_required',409);
  const fresh=await access(env,user,tid,true,clock());
  if(fresh?.status!=='active')return error('active_client_admin_required',403);
  const at=iso(clock()),requested=data.recipients.map(r=>({...r,jobId:crypto.randomUUID()}));
  // Single CRM statement: every selected recipient must match the current
  // exact review and lead; otherwise insert zero. The trigger independently
  // enforces these conditions. No cross-D1 transaction is assumed.
  const out=await db.batch([
   db.prepare("WITH requested AS (SELECT json_extract(value,'$.leadId') AS lead_id,json_extract(value,'$.reviewRevision') AS revision,json_extract(value,'$.jobId') AS id FROM json_each(?)), eligible AS (SELECT c.tenant_id,c.id AS campaign_id,c.snapshot_id,c.graph_sha256,c.purpose,v.lead_id,v.revision,v.expires_at,x.id FROM requested x JOIN industry_recipient_reviews v ON v.tenant_id=? AND v.campaign_id=? AND v.lead_id=x.lead_id AND v.revision=x.revision JOIN industry_campaigns c ON c.tenant_id=v.tenant_id AND c.id=v.campaign_id JOIN leads l ON l.tenant_id=v.tenant_id AND l.id=v.lead_id WHERE c.archived_at IS NULL AND c.snapshot_id=? AND c.graph_sha256=? AND c.purpose='school_admission' AND v.expires_at>? AND "+localEligibility+" AND NOT EXISTS(SELECT 1 FROM industry_call_jobs j WHERE j.tenant_id=v.tenant_id AND j.lead_id=v.lead_id AND (j.state='prepared' OR (j.campaign_id=v.campaign_id AND j.review_revision=v.revision)))) INSERT INTO industry_call_jobs(tenant_id,id,campaign_id,lead_id,review_revision,snapshot_id,graph_sha256,manifest_sha256,purpose,review_expires_at,created_by,created_at) SELECT tenant_id,id,campaign_id,lead_id,revision,snapshot_id,graph_sha256,?,purpose,expires_at,?,? FROM eligible WHERE (SELECT COUNT(*) FROM eligible)=?")
    .bind(JSON.stringify(requested),tid,id,c.snapshot_id,c.graph_sha256,at,pack.manifestSha256,user.id,at,requested.length),
   audit(db,tid,user,'industry.jobs_prepared',id,at)
  ]);
  return out[0].meta.changes===requested.length?reply({prepared:requested.length,dispatchReady:false},201):error('industry_recipient_changed_or_already_prepared',409);
 }catch(e){
  const code=String(e?.message||'');
  if(code==='industry_queue_invalid_request')return error(code);
  if(/^school_audio_|^school_snapshot_|^school_production_/.test(code))return error('industry_audio_approval_required',409);
  return error('industry_queue_unavailable',503);
 }
}
