// Production-only industry campaign preparation in the existing shared CRM.
// A valid recipient review is one prerequisite, NOT permission to dispatch.
// No provider/network request, calling_jobs insert, wallet or hold mutation.
import {requireMembership,mutationOriginAllowed} from './human-auth.mjs';
import {resolveCrmDb,parseJsonBody,sha256hex} from './core.mjs';
import {checkedProductionSchoolSnapshot} from './industry-launch-requests.mjs';
const BASE='/v1/human/industry-campaigns';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const phone=x=>typeof x==='string'&&/^\+91[6-9]\d{9}$/.test(x);
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const text=(x,min,max)=>typeof x==='string'&&x.trim().length>=min&&x.length<=max&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(x);
const reply=(x,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(code,status=400)=>reply({error:code},status);
const iso=n=>new Date(n).toISOString();
const blocked=['shared_funded_dispatch_adapter','production_voice_runtime','provider_approval'];
const latestJoin="LEFT JOIN industry_recipient_reviews v ON v.tenant_id=a.tenant_id AND v.campaign_id=a.campaign_id AND v.lead_id=a.lead_id AND v.revision=(SELECT MAX(r.revision) FROM industry_recipient_reviews r WHERE r.tenant_id=a.tenant_id AND r.campaign_id=a.campaign_id AND r.lead_id=a.lead_id)";
const suppressed="(l.consent_status='denied' OR l.dnd_status='blocked' OR EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id))";
const recipientSelect=`SELECT a.lead_id AS leadId,l.name,l.mobile_e164,l.updated_at,l.consent_status,l.dnd_status,
 ${suppressed} AS suppressed,v.revision,v.decision,v.destination,v.lead_updated_at,v.expires_at,v.consent_ref,v.dnd_ref,v.reason,v.reviewed_at,
 EXISTS(SELECT 1 FROM industry_call_jobs j WHERE j.tenant_id=a.tenant_id AND j.lead_id=a.lead_id AND
  (j.state='prepared' OR (j.campaign_id=a.campaign_id AND j.review_revision=v.revision))) AS preparation_blocked
 FROM industry_campaign_candidates a JOIN leads l ON l.tenant_id=a.tenant_id AND l.id=a.lead_id ${latestJoin}`;
async function readBody(req){
 if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json'||Number(req.headers.get('content-length'))>8192||!req.body)throw Error('invalid_industry_payload');
 const reader=req.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,raw='';
 try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>8192){await reader.cancel();throw Error('invalid_industry_payload')}raw+=decoder.decode(value,{stream:true})}raw+=decoder.decode()}finally{reader.releaseLock()}
 return parseJsonBody(raw,8192);
}
async function access(env,user,tid,write,now){
 if(!uuid(tid)||!user)return null;
 let member;
 if(user.globalRole==='super_admin'){
  if(typeof user.token_hash!=='string'||!await env.CONTROL_DB.prepare("SELECT 1 AS ok FROM human_sessions s JOIN human_users u ON u.id=s.user_id JOIN human_mfa_settings m ON m.user_id=u.id WHERE u.id=? AND u.global_role='super_admin' AND u.status='active' AND s.token_hash=? AND s.expires_at>? AND s.revoked_at IS NULL AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at").bind(user.id,user.token_hash,now).first())return null;
  member=await env.CONTROL_DB.prepare("SELECT id AS tenant_id,storage_mode,dedicated_binding FROM tenants WHERE id=? AND status IN('trial','active')").bind(tid).first();
 }else member=await requireMembership(env.CONTROL_DB,user,tid,write);
 // The migration is installed in the existing shared production CRM only.
 if(!member||member.storage_mode!=='shared')return null;
 return {db:resolveCrmDb(env,member),tid,isAdmin:user.globalRole==='super_admin'};
}
async function reviewedLaunch(control,tid,id){
 const r=await control.prepare("SELECT id,snapshot_id,graph_sha256,purpose,state FROM industry_launch_requests WHERE tenant_id=? AND id=? AND state='configuration_reviewed' AND purpose='school_admission'").bind(tid,id).first();
 if(!r)throw Error('industry_configuration_review_required');
 const snapshot=await checkedProductionSchoolSnapshot(control,tid,r.snapshot_id);
 if(snapshot.digest!==r.graph_sha256)throw Error('industry_configuration_integrity');
 return {r,snapshot};
}
const viewCampaign=r=>({id:r.id,name:r.name,purpose:r.purpose,launchRequestId:r.launch_request_id,snapshotId:r.snapshot_id,
 digest:r.graph_sha256,createdAt:r.created_at,archivedAt:r.archived_at||null,recipientCount:r.recipient_count??0,callable:false});
export function industryRecipientReviewStatus(r,now){
 if(!r||r.suppressed||r.consent_status==='denied'||r.dnd_status==='blocked')return 'suppressed_or_missing';
 if(!phone(r.mobile_e164))return 'unsupported_destination';
 if(!r.revision)return 'review_required';
 if(r.decision!=='cleared')return 'revoked';
 if(typeof r.expires_at!=='string'||!Number.isFinite(Date.parse(r.expires_at))||Date.parse(r.expires_at)<=now)return 'expired';
 if(r.destination!==r.mobile_e164||r.lead_updated_at!==r.updated_at)return 'recipient_changed';
 return 'review_current';
}
const targetDigest=(tid,campaignId,r)=>sha256hex('ar3d:industry-review-target:v1:'+JSON.stringify([tid,campaignId,r.leadId,r.mobile_e164,r.updated_at]));
async function viewRecipient(r,now,isAdmin,tid,campaignId){
 return {leadId:r.leadId,name:r.name,destinationLast4:r.mobile_e164.slice(-4),revision:r.revision??0,status:industryRecipientReviewStatus(r,now),
  expiresAt:r.expires_at||null,reviewedAt:r.reviewed_at||null,preparationBlocked:r.preparation_blocked===1,...(isAdmin?{reviewTarget:await targetDigest(tid,campaignId,r),consentReference:r.consent_ref||null,dndReference:r.dnd_ref||null,reason:r.reason||null}:{}),callable:false};
}
const audit=(db,tid,user,action,target,at,conditional=false)=>db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) SELECT ?,?,?,?,?,?"+(conditional?' WHERE changes()>0':'')).bind(tid,crypto.randomUUID(),'human:'+user.id,action,target,at);
const paging=u=>{
 if([...u.searchParams.keys()].some(k=>!['tenantId','offset','q'].includes(k)||u.searchParams.getAll(k).length!==1))return null;
 const raw=u.searchParams.get('offset')||'0',q=u.searchParams.get('q')||'';
 if(!/^\d{1,5}$/.test(raw)||Number(raw)>10000||q.length>80||/[\u0000-\u001f]/.test(q))return null;
 return {offset:Number(raw),q:q.trim()};
};
/** Future funded dispatcher MUST recheck this after reservation and atomically
 * bind the returned scope to a job. Readiness is NOT dispatch authorization. */
export async function readIndustryRecipientScope(env,{tenantId,campaignId,leadId,now=Date.now()}){
 if(![tenantId,campaignId,leadId].every(uuid))throw Error('invalid_industry_scope');
 const tenant=await env.CONTROL_DB.prepare("SELECT id,storage_mode,dedicated_binding FROM tenants WHERE id=? AND status='active'").bind(tenantId).first();
 if(!tenant||tenant.storage_mode!=='shared')throw Error('industry_tenant_unavailable');
 const db=resolveCrmDb(env,tenant),campaign=await db.prepare("SELECT * FROM industry_campaigns WHERE tenant_id=? AND id=? AND archived_at IS NULL").bind(tenantId,campaignId).first();
 if(!campaign)throw Error('industry_campaign_unavailable');
 const {r,snapshot}=await reviewedLaunch(env.CONTROL_DB,tenantId,campaign.launch_request_id);
 if(campaign.snapshot_id!==r.snapshot_id||campaign.graph_sha256!==r.graph_sha256||campaign.purpose!==r.purpose)throw Error('industry_configuration_integrity');
 const recipient=await db.prepare(recipientSelect+" WHERE a.tenant_id=? AND a.campaign_id=? AND a.lead_id=?").bind(tenantId,campaignId,leadId).first();
 const status=industryRecipientReviewStatus(recipient,now);
 if(status!=='review_current')throw Error('industry_recipient_'+status);
 return {campaignId,tenantId,leadId,launchRequestId:campaign.launch_request_id,purpose:campaign.purpose,snapshotId:campaign.snapshot_id,digest:campaign.graph_sha256,
  graph:snapshot.graph,reviewRevision:recipient.revision,destination:recipient.mobile_e164,leadUpdatedAt:recipient.updated_at,
  expiresAt:recipient.expires_at,dispatchReady:false};
}
export async function handleIndustryCampaigns(req,env,user,{now=Date.now()}={}){
 const u=new URL(req.url),m=u.pathname.match(/^\/v1\/human\/industry-campaigns\/([a-f0-9-]{36})\/(recipients|available-leads|review|archive)$/i);
 if(u.pathname!==BASE&&!m)return null;
 if(m&&!uuid(m[1]))return fail('invalid_industry_campaign');
 const action=m?.[2]||'collection',method=req.method;
 if(!['GET','POST'].includes(method)||['review','archive'].includes(action)&&method!=='POST'||action==='available-leads'&&method!=='GET')return fail('method_not_allowed',405);
 if(method==='POST'&&(!mutationOriginAllowed(req)||u.search))return fail('same_origin_required',403);
 try{
  const data=method==='POST'?await readBody(req):null,page=method==='GET'?paging(u):null;
  if(method==='GET'&&!page)return fail('invalid_industry_query');
  const tid=method==='POST'?data.tenantId:u.searchParams.get('tenantId');
  const ctx=await access(env,user,tid,method==='POST',now);
  if(!ctx)return fail('industry_access_denied',403);
  const {db,isAdmin}=ctx,at=iso(now);
  if(action==='collection'){
   if(method==='GET'){
    const rows=await db.prepare("SELECT c.*,(SELECT COUNT(*) FROM industry_campaign_candidates a WHERE a.tenant_id=c.tenant_id AND a.campaign_id=c.id) AS recipient_count FROM industry_campaigns c WHERE c.tenant_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT 51 OFFSET ?").bind(tid,page.offset).all();
    return reply({campaigns:rows.results.slice(0,50).map(viewCampaign),hasMore:rows.results.length>50,dispatchReady:false,blockers:blocked});
   }
   if(isAdmin)return fail('client_admin_required',403);
   if(!exact(data,['tenantId','launchRequestId','name'])||!uuid(data.launchRequestId)||!text(data.name,1,80))return fail('invalid_industry_campaign');
   const {r,snapshot}=await reviewedLaunch(env.CONTROL_DB,tid,data.launchRequestId);
   if(snapshot.row.current_revision!==snapshot.row.source_revision||snapshot.row.current_config!==snapshot.row.config_json)return fail('industry_freeze_and_review_latest_version',409);
   const id=crypto.randomUUID(),result=await db.batch([
    db.prepare("INSERT INTO industry_campaigns(tenant_id,id,launch_request_id,snapshot_id,graph_sha256,purpose,name,created_by,created_at) SELECT ?,?,?,?,?,'school_admission',?,?,? WHERE (SELECT COUNT(*) FROM industry_campaigns WHERE tenant_id=? AND archived_at IS NULL)<50").bind(tid,id,r.id,r.snapshot_id,r.graph_sha256,data.name.trim(),user.id,at,tid),
    audit(db,tid,user,'industry.campaign_created',id,at,true)
   ]);
   if(result[0]?.meta?.changes!==1)return fail('industry_campaign_limit',409);
   return reply({id,callable:false,dispatchReady:false},201);
  }
  const campaign=await db.prepare('SELECT * FROM industry_campaigns WHERE tenant_id=? AND id=?').bind(tid,m[1]).first();
  if(!campaign)return fail('industry_campaign_not_found',404);
  if(action==='recipients'&&method==='GET'){
   const rows=await db.prepare(recipientSelect+" WHERE a.tenant_id=? AND a.campaign_id=? ORDER BY a.added_at,a.lead_id LIMIT 51 OFFSET ?").bind(tid,campaign.id,page.offset).all();
   return reply({campaign:viewCampaign(campaign),recipients:await Promise.all(rows.results.slice(0,50).map(r=>viewRecipient(r,now,isAdmin,tid,campaign.id))),hasMore:rows.results.length>50,dispatchReady:false,blockers:blocked});
  }
  if(campaign.archived_at)return fail('industry_campaign_archived',409);
  if(action==='available-leads'){
   if(isAdmin)return fail('client_admin_required',403);
   const member=await requireMembership(env.CONTROL_DB,user,tid,true);
   if(!member)return fail('client_admin_required',403);
   // Parameterized literal substring: percent/underscore in search are literal.
   const rows=await db.prepare(`SELECT l.id,l.name,substr(l.mobile_e164,-4) AS destinationLast4 FROM leads l WHERE l.tenant_id=?
    AND NOT ${suppressed} AND l.mobile_e164 GLOB '+91[6-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    AND NOT EXISTS(SELECT 1 FROM industry_campaign_candidates a WHERE a.tenant_id=l.tenant_id AND a.campaign_id=? AND a.lead_id=l.id)
    AND (?='' OR instr(lower(l.name),lower(?))>0 OR instr(l.mobile_e164,?)>0)
    ORDER BY l.created_at DESC,l.id LIMIT 51 OFFSET ?`).bind(tid,campaign.id,page.q,page.q,page.q,page.offset).all();
   return reply({leads:rows.results.slice(0,50),hasMore:rows.results.length>50,dispatchReady:false});
  }
  if(action==='archive'){
   if(isAdmin||!exact(data,['tenantId','confirm'])||data.confirm!==true)return fail('client_admin_required',403);
   const result=await db.batch([db.prepare('UPDATE industry_campaigns SET archived_at=?,archived_by=? WHERE tenant_id=? AND id=? AND archived_at IS NULL').bind(at,user.id,tid,campaign.id),audit(db,tid,user,'industry.campaign_archived',campaign.id,at,true)]);
   return result[0]?.meta?.changes===1?reply({archived:true,dispatchReady:false}):fail('industry_campaign_archived',409);
  }
  if(action==='recipients'){
   if(isAdmin)return fail('client_admin_required',403);
   if(!exact(data,['tenantId','leadIds'])||!Array.isArray(data.leadIds)||data.leadIds.length<1||data.leadIds.length>50||!data.leadIds.every(uuid)||new Set(data.leadIds).size!==data.leadIds.length)return fail('invalid_industry_candidates');
   const ids=JSON.stringify(data.leadIds);
   const result=await db.batch([
    db.prepare(`INSERT INTO industry_campaign_candidates(tenant_id,campaign_id,lead_id,added_by,added_at)
     SELECT l.tenant_id,?,l.id,?,? FROM leads l WHERE l.tenant_id=? AND l.id IN(SELECT value FROM json_each(?))
     AND EXISTS(SELECT 1 FROM industry_campaigns c WHERE c.tenant_id=l.tenant_id AND c.id=? AND c.archived_at IS NULL)
     AND (SELECT COUNT(*) FROM industry_campaign_candidates a WHERE a.tenant_id=l.tenant_id AND a.campaign_id=?)+?<=1000
     AND (SELECT COUNT(*) FROM leads l WHERE l.tenant_id=? AND l.id IN(SELECT value FROM json_each(?)) AND NOT ${suppressed}
      AND l.mobile_e164 GLOB '+91[6-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
      AND NOT EXISTS(SELECT 1 FROM industry_campaign_candidates a WHERE a.tenant_id=l.tenant_id AND a.campaign_id=? AND a.lead_id=l.id))=?`)
     .bind(campaign.id,user.id,at,tid,ids,campaign.id,campaign.id,data.leadIds.length,tid,ids,campaign.id,data.leadIds.length),
    audit(db,tid,user,'industry.candidates_added',campaign.id,at,true)
   ]);
   return result[0]?.meta?.changes===data.leadIds.length?reply({added:data.leadIds.length,dispatchReady:false},201):fail('industry_candidates_changed_or_unavailable',409);
  }
  const clear=data.decision==='cleared',revoke=data.decision==='revoked';
  if(clear&&!isAdmin)return fail('current_super_admin_mfa_required',403);
  if(!uuid(data.leadId)||!Number.isSafeInteger(data.baseRevision)||data.baseRevision<0||data.baseRevision>=1000||
    (!clear&&!revoke))return fail('invalid_industry_review');
  if(clear&&(!exact(data,['tenantId','leadId','baseRevision','decision','consentReference','dndReference','expiresAt','reviewTarget','acknowledgeGuardianAndPurpose'])||
    data.acknowledgeGuardianAndPurpose!==true||typeof data.reviewTarget!=='string'||!/^[a-f0-9]{64}$/.test(data.reviewTarget)||!text(data.consentReference,4,160)||!text(data.dndReference,4,160)||
    typeof data.expiresAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(data.expiresAt)||
    !Number.isFinite(Date.parse(data.expiresAt))||iso(Date.parse(data.expiresAt))!==data.expiresAt||Date.parse(data.expiresAt)<=now||Date.parse(data.expiresAt)>now+90*86400000))
   return fail('invalid_industry_clearance');
  if(revoke&&(!exact(data,['tenantId','leadId','baseRevision','decision','reason'])||!text(data.reason,4,160)||data.baseRevision===0))return fail('invalid_industry_revocation');
  let target=null;
  if(clear){
   target=await db.prepare(recipientSelect+" WHERE a.tenant_id=? AND a.campaign_id=? AND a.lead_id=?").bind(tid,campaign.id,data.leadId).first();
   if(!target||await targetDigest(tid,campaign.id,target)!==data.reviewTarget)return fail('industry_review_target_changed',409);
   const {r}=await reviewedLaunch(env.CONTROL_DB,tid,campaign.launch_request_id);
   if(r.snapshot_id!==campaign.snapshot_id||r.graph_sha256!==campaign.graph_sha256)return fail('industry_configuration_integrity',409);
  }
  const result=await db.batch([
   db.prepare(`INSERT INTO industry_recipient_reviews(tenant_id,campaign_id,lead_id,revision,decision,destination,lead_updated_at,consent_ref,dnd_ref,expires_at,reason,reviewed_by,reviewed_at)
    SELECT a.tenant_id,a.campaign_id,a.lead_id,?+1,?,CASE WHEN ? THEN l.mobile_e164 ELSE NULL END,CASE WHEN ? THEN l.updated_at ELSE NULL END,?,?,?,?,?,?
    FROM industry_campaign_candidates a JOIN industry_campaigns c ON c.tenant_id=a.tenant_id AND c.id=a.campaign_id JOIN leads l ON l.tenant_id=a.tenant_id AND l.id=a.lead_id
    WHERE a.tenant_id=? AND a.campaign_id=? AND a.lead_id=? AND c.archived_at IS NULL
    AND COALESCE((SELECT MAX(v.revision) FROM industry_recipient_reviews v WHERE v.tenant_id=a.tenant_id AND v.campaign_id=a.campaign_id AND v.lead_id=a.lead_id),0)=?
    AND (?=0 OR (l.updated_at=? AND l.mobile_e164=? AND NOT ${suppressed} AND l.mobile_e164 GLOB '+91[6-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'))`)
    .bind(data.baseRevision,data.decision,+clear,+clear,clear?data.consentReference.trim():null,clear?data.dndReference.trim():null,clear?data.expiresAt:null,revoke?data.reason.trim():null,user.id,at,tid,campaign.id,data.leadId,data.baseRevision,+clear,target?.updated_at??null,target?.mobile_e164??null),
   audit(db,tid,user,'industry.recipient_'+data.decision,data.leadId,at,true)
  ]);
  return result[0]?.meta?.changes===1?reply({revision:data.baseRevision+1,decision:data.decision,dispatchReady:false}):fail('industry_recipient_changed_or_suppressed',409);
 }catch(e){
  const code=String(e?.message||'');
  return fail(/^(industry_configuration_review_required|industry_configuration_integrity|school_snapshot_unavailable|school_production_flow_not_supported)$/.test(code)?code:'industry_campaign_operation_unavailable',/^(industry_configuration_|school_)/.test(code)?409:503);
 }
}
