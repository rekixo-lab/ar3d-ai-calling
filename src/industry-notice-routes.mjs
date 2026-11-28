// Tenant-scoped review, bulk release and revocation for announcement calls.
// No caller-provided private record, recipient proof, phone number or amount.
import {currentSuperAdminMfa,requireMembership,mutationOriginAllowed} from './human-auth.mjs';
import {currentIndustryDispatchAuthorizer} from './industry-dispatch-authority.mjs';
import {readBoundedBytes} from './scripted-speech.mjs';
import {industryNoticeConnectorStatus} from './industry-notice-connectors.mjs';
import {uuid,exact,reference,reviewDigest,readNoticeSnapshot,noticeEligibility,noticeJob,contractFor,NOTICE_SECONDS} from './industry-notice-common.mjs';
import {noticeDispatchConfig,noticeDeliveryAvailable} from './industry-notice-dispatch.mjs';
const BASE='/v1/human/industry-notice-jobs';
const reply=(d,status=200)=>Response.json(d,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const err=(error,status=400)=>reply({error},status);
const ids=x=>Array.isArray(x)&&x.length>0&&x.length<=50&&x.every(uuid)&&new Set(x).size===x.length;
const phone=x=>typeof x==='string'&&/^\+91[6-9]\d{9}$/.test(x);
const publicJob=j=>({id:j.id,leadId:j.lead_id,templateId:j.template_id,language:j.language,deliveryMode:j.delivery_mode,state:j.state,reviewExpiresAt:j.review_expires_at,releaseExpiresAt:j.release_expires_at,revoked:!!j.revoked_at,connectedSeconds:j.connected_seconds,chargedSeconds:j.billed_seconds,result:j.result,destinationLast4:j.destination.slice(-4)});
const reviewFields=['tenantId','action','snapshotId','leadIds','consentReference','dndReference','providerReference','privateSpeechReference','deliveryMode','reviewExpiresAt','confirmReviewedRecipients'];
export async function handleIndustryNoticeJobs(req,env,user,{now=Date.now()}={}){
 const url=new URL(req.url);if(url.pathname!==BASE)return null;
 if(!['GET','POST'].includes(req.method))return err('method_not_allowed',405);
 let d,tid;
 try{
  if(req.method==='POST'){
   if(url.search||!mutationOriginAllowed(req)||req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return err('invalid_notice_request',400);
   d=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBytes(req,8192)));tid=d?.tenantId;
  }else tid=url.searchParams.get('tenantId');
 }catch{return err('invalid_notice_request',400)}
 if(!uuid(tid)||!user?.id)return err('forbidden',403);
 const c=env.CONTROL_DB,db=env.CRM_DB,started=Date.now(),clock=()=>now+Math.max(0,Date.now()-started);
 try{
  const admin=user.globalRole==='super_admin';
  if(admin){if(!await currentSuperAdminMfa(c,user,now))return err('forbidden',403)}
  else if(!await requireMembership(c,user,tid,req.method==='POST'))return err('forbidden',403);
  if(!await c.prepare("SELECT 1 AS ok FROM tenants WHERE id=? AND status='active' AND storage_mode='shared'").bind(tid).first())return err('active_shared_tenant_required',403);
  if(req.method==='GET'){
   const q=(url.searchParams.get('q')||'').trim();
   if(q.length>80||[...url.searchParams].some(([k])=>!['tenantId','q','offset'].includes(k)))return err('invalid_notice_request');
   const offset=Number(url.searchParams.get('offset')||0);
   if(!Number.isSafeInteger(offset)||offset<0||offset>10000)return err('invalid_notice_request');
   const jobs=await db.prepare('SELECT * FROM industry_notice_jobs WHERE tenant_id=? ORDER BY reviewed_at DESC,id LIMIT 51 OFFSET ?').bind(tid,offset).all();
   const snapshots=admin?await c.prepare("SELECT v.id,v.template_id,v.graph_sha256,v.source_revision,v.config_json FROM ai_flow_snapshots v JOIN ai_flow_definitions f ON f.tenant_id=v.tenant_id AND f.id=v.flow_id JOIN ai_flow_preview_reviews r ON r.tenant_id=v.tenant_id AND r.snapshot_id=v.id WHERE v.tenant_id=? AND r.decision='simulation_reviewed' AND v.source_revision=f.revision AND v.config_json=f.config_json ORDER BY v.created_at DESC LIMIT 100").bind(tid).all():{results:[]};
   const leads=admin?await db.prepare("SELECT id,name,mobile_e164 FROM leads l WHERE tenant_id=? AND consent_status<>'denied' AND dnd_status<>'blocked' AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id) AND (instr(lower(COALESCE(name,'')),lower(?))>0 OR instr(mobile_e164,?)>0) ORDER BY updated_at DESC,id LIMIT 50").bind(tid,q,q).all():{results:[]};
   const ready=await noticeDispatchConfig(env,{now});
   return reply({jobs:jobs.results.slice(0,50).map(publicJob),hasMore:jobs.results.length>50,maxSeconds:NOTICE_SECONDS,carrierReady:!!ready,carrierApprovalConfigured:reference(env.AR3D_NOTICE_CARRIER_APPROVAL_REFERENCE,10),callingWindowOpen:ready?.windowOpen??false,connectors:industryNoticeConnectorStatus(env,tid),privateSpeechConfigured:reference(env.AR3D_NOTICE_PRIVATE_SPEECH_APPROVAL_REFERENCE,10)&&industryNoticeConnectorStatus(env,tid).state==='configured_unverified',snapshots:snapshots.results.filter(x=>contractFor(x.template_id)&&JSON.parse(x.config_json).mode==='announcement').map(x=>({id:x.id,templateId:x.template_id,digest:x.graph_sha256,revision:x.source_revision})),leads:leads.results.filter(x=>phone(x.mobile_e164)).map(x=>({id:x.id,name:x.name,last4:x.mobile_e164.slice(-4)}))});
  }
  if(!await currentIndustryDispatchAuthorizer(c,user,tid,now))return err('forbidden',403);
  if(d.action==='review'){
   if(!admin)return err('independent_super_admin_required',403);
   if(!exact(d,reviewFields)||!uuid(d.snapshotId)||!ids(d.leadIds)||d.confirmReviewedRecipients!==true||!reference(d.consentReference)||!reference(d.dndReference)||!reference(d.providerReference,10)||!['general','verified'].includes(d.deliveryMode)||!Number.isSafeInteger(d.reviewExpiresAt)||d.reviewExpiresAt<=now+120000||d.reviewExpiresAt>now+7*86400000|| (d.deliveryMode==='general'?d.privateSpeechReference!==null:!reference(d.privateSpeechReference,10)))return err('invalid_notice_review');
   if(!noticeDeliveryAvailable(env,{tenant_id:tid,delivery_mode:d.deliveryMode,private_speech_ref:d.privateSpeechReference}))return err('private_notice_setup_required',409);
   const frozen=await readNoticeSnapshot(c,tid,d.snapshotId,{latest:true});
   if(!frozen||frozen.row.created_by===user.id)return err('reviewed_current_announcement_snapshot_required',409);
   const stamp=clock(),rows=[];
   for(const leadId of d.leadIds){
    const l=await db.prepare("SELECT mobile_e164,updated_at FROM leads l WHERE tenant_id=? AND id=? AND consent_status<>'denied' AND dnd_status<>'blocked' AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id)").bind(tid,leadId).first();
    if(!l||!phone(l.mobile_e164))return err('recipient_unavailable',409);
    const j={tenant_id:tid,id:crypto.randomUUID(),lead_id:leadId,snapshot_id:d.snapshotId,graph_sha256:frozen.row.graph_sha256,template_id:frozen.row.template_id,language:frozen.language,delivery_mode:d.deliveryMode,destination:l.mobile_e164,lead_updated_at:l.updated_at,consent_ref:d.consentReference.trim(),dnd_ref:d.dndReference.trim(),provider_ref:d.providerReference.trim(),private_speech_ref:d.privateSpeechReference?.trim()??null,reviewed_by:user.id,reviewed_at:stamp,review_expires_at:d.reviewExpiresAt,updated_at:stamp};
    j.review_sha256=await reviewDigest(j);rows.push(j);
   }
   if(!await currentSuperAdminMfa(c,user,clock()))return err('forbidden',403);
   const results=await db.batch(rows.map(j=>{const keys=Object.keys(j);return db.prepare('INSERT INTO industry_notice_jobs('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(j))}));
   if(results.some(x=>x.meta.changes!==1))throw Error('notice_review_conflict');
   return reply({reviewed:rows.length,jobIds:rows.map(x=>x.id),callsStarted:0},201);
  }
  if(d.action==='start'){
   if(!exact(d,['tenantId','action','jobIds','confirmDialing'])||!ids(d.jobIds)||d.confirmDialing!==true)return err('invalid_notice_release');
   const ready=await noticeDispatchConfig(env,{now});if(!ready)return err('provider_funding_or_settlement_required',409);
   const rows=await db.prepare("SELECT * FROM industry_notice_jobs WHERE tenant_id=? AND id IN("+d.jobIds.map(()=>'?').join(',')+")").bind(tid,...d.jobIds).all();
   const stamp=clock(),end=Math.min(stamp+55*60000,...rows.results.map(j=>j.review_expires_at));
   if(rows.results.length!==d.jobIds.length||end<=stamp+115000||rows.results.some(j=>j.state!=='reviewed'||j.revoked_at!==null||!noticeDeliveryAvailable(env,j)))return err('review_or_setup_changed',409);
   for(const j of rows.results){if(await reviewDigest(j)!==j.review_sha256)return err('review_or_setup_changed',409)}
   if(!await currentIndustryDispatchAuthorizer(c,user,tid,clock()))return err('forbidden',403);
   // A single conditional UPDATE is all-or-none in the serialized shared CRM.
   const list=d.jobIds.map(()=>'?').join(',');
   const guard="tenant_id=? AND state='reviewed' AND revoked_at IS NULL AND review_expires_at>=? AND "+noticeEligibility;
   const result=await db.prepare("UPDATE industry_notice_jobs SET state='authorized',actor_id=?,authorized_at=?,release_expires_at=?,updated_at=? WHERE "+guard+" AND id IN("+list+") AND (SELECT COUNT(*) FROM industry_notice_jobs WHERE "+guard+" AND id IN("+list+"))=?")
    .bind(user.id,stamp,end,stamp,tid,end,...d.jobIds,tid,end,...d.jobIds,d.jobIds.length).run();
   if(result.meta.changes!==d.jobIds.length)return err('review_or_recipient_changed',409);
   return reply({authorized:d.jobIds.length,maxReservedSeconds:d.jobIds.length*NOTICE_SECONDS,callsStarted:0,releaseExpiresAt:end},202);
  }
  if(d.action==='revoke'){
   if(!exact(d,['tenantId','action','jobId'])||!uuid(d.jobId))return err('invalid_notice_revoke');
   const stamp=clock();
   const result=await db.prepare("UPDATE industry_notice_jobs SET state=CASE WHEN state IN('reviewed','authorized') THEN 'revoked' ELSE state END,revoked_at=?,revoked_by=?,updated_at=? WHERE tenant_id=? AND id=? AND revoked_at IS NULL AND state IN('reviewed','authorized','claiming','funded','claimed','posting','submitted','unknown','receipt','no_post')").bind(stamp,user.id,stamp,tid,d.jobId).run();
   return result.meta.changes===1?reply({revoked:true}):err('notice_job_not_revocable',409);
  }
  return err('invalid_notice_action');
 }catch{return err('notice_request_conflict_or_unavailable',409)}
}
