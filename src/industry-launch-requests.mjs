// Production dashboard launch preparation. This module cannot dial, allocate money,
// grant lead consent or activate a calling policy. A separate purpose-aware
// dispatcher must enforce recipient eligibility and reserve shared funds.
import {requireMembership} from './human-auth.mjs';
import {sha256hex} from './core.mjs';
import {compileDraftToFlow,validateFlowGraph} from './call-flow-dsl.mjs';
import {validateIndustryAgentDraft} from './industry-template-catalog.mjs';
const BASE='/v1/human/industry-launch-requests';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const fail=x=>{throw Error(x)};
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const error=(code,status=400)=>reply({error:code},status);
const blocked=['purpose_specific_customer_consent','shared_funded_dispatch_adapter','production_voice_runtime'];
async function body(req){
 if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json'||Number(req.headers.get('content-length'))>4096||!req.body)
  fail('invalid_launch_payload');
 const r=req.body.getReader(),d=new TextDecoder('utf-8',{fatal:true});let n=0,s='';
 try{while(true){const {value,done}=await r.read();if(done)break;n+=value.length;if(n>4096){await r.cancel();fail('invalid_launch_payload')}s+=d.decode(value,{stream:true})}s+=d.decode()}finally{r.releaseLock()}
 try{return JSON.parse(s)}catch{fail('invalid_launch_payload')}
}
async function activeAdmin(db,user,now){
 return user?.globalRole==='super_admin'&&typeof user.token_hash==='string'&&!!await db.prepare(
  "SELECT 1 AS ok FROM human_sessions s JOIN human_users u ON u.id=s.user_id JOIN human_mfa_settings m ON m.user_id=u.id WHERE u.id=? AND u.global_role='super_admin' AND u.status='active' AND s.token_hash=? AND s.expires_at>? AND s.revoked_at IS NULL AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at"
 ).bind(user.id,user.token_hash,now).first();
}
export async function checkedProductionSchoolSnapshot(db,tenantId,snapshotId){
 const row=await db.prepare("SELECT v.*,f.revision AS current_revision,f.config_json AS current_config FROM ai_flow_snapshots v JOIN ai_flow_definitions f ON f.tenant_id=v.tenant_id AND f.id=v.flow_id WHERE v.tenant_id=? AND v.id=?").bind(tenantId,snapshotId).first();
 if(!row||row.template_id!=='school_admission_v1'||row.status!=='simulation_only'||row.compiler_version!==1||
   await sha256hex('ar3d:offline-flow:v1:'+row.graph_json)!==row.graph_sha256)fail('school_snapshot_unavailable');
 const config=validateIndustryAgentDraft(JSON.parse(row.config_json)),graph=validateFlowGraph(JSON.parse(row.graph_json));
 if(config.templateId!=='school_admission_v1'||config.mode!=='interactive'||config.questions.length<1||config.questions.length>3||
  !['hi','en','hi-en'].includes(config.language)||graph.regulated||graph.industry!=='school'||graph.callable!==false||
  JSON.stringify(compileDraftToFlow(config))!==row.graph_json)fail('school_production_flow_not_supported');
 const nodes=graph.nodes;
 if(nodes.length!==config.questions.length+3||nodes[0].type!=='greeting'||nodes.at(-2).type!=='speak_static'||nodes.at(-1).type!=='end_call'||
  nodes.slice(1,-2).some(n=>n.type!=='ask_text_bounded')||nodes.slice(0,-1).some((n,i)=>n.next!==nodes[i+1].id))
  fail('school_production_flow_not_supported');
 return {row,config,graph,digest:row.graph_sha256};
}
const view=r=>({id:r.id,snapshotId:r.snapshot_id,digest:r.graph_sha256,purpose:r.purpose,state:r.state,
 requestedAt:r.requested_at,decidedAt:r.decided_at||null,reviewReference:r.review_reference||null,callable:false,dispatchReady:false,blockers:blocked});
export async function handleIndustryLaunchRequests(req,env,user,{now=Date.now()}={}){
 const u=new URL(req.url),path=u.pathname,match=path.match(/^\/v1\/human\/industry-launch-requests\/([a-f0-9-]{36})\/(review|withdraw)$/i);
 if(path!==BASE&&!match)return null;
 if(!user||match&&!uuid(match[1]))return error('forbidden',403);
 const method=req.method,isAdmin=user.globalRole==='super_admin';
 if(match?method!=='POST':!['GET','POST'].includes(method))return error('method_not_allowed',405);
 try{
  const data=method==='POST'?await body(req):null,tenantId=method==='POST'?data?.tenantId:u.searchParams.get('tenantId');
  if(!uuid(tenantId)||method==='POST'&&u.search||method==='GET'&&([...u.searchParams].length!==1))return error('invalid_launch_scope');
  const db=env.CONTROL_DB;
  if(isAdmin){
   if(!await activeAdmin(db,user,now))return error('current_super_admin_mfa_required',403);
  }else if(!await requireMembership(db,user,tenantId,method==='POST'))return error('forbidden',403);
  const tenant=await db.prepare("SELECT status FROM tenants WHERE id=? AND status IN('active','trial')").bind(tenantId).first();
  if(!tenant)return error('tenant_unavailable',404);
  if(method==='GET'){
   const rows=await db.prepare("SELECT r.*,s.config_json FROM industry_launch_requests r JOIN ai_flow_snapshots s ON s.tenant_id=r.tenant_id AND s.id=r.snapshot_id WHERE r.tenant_id=? ORDER BY r.requested_at DESC,r.id DESC LIMIT 100").bind(tenantId).all();
   return reply({requests:rows.results.map(r=>({...view(r),...(isAdmin?{config:JSON.parse(r.config_json)}:{})})),supportedTemplate:'school_admission_v1',dispatchReady:false,blockers:blocked});
  }
  const at=new Date(now).toISOString();
  if(!match){
   if(isAdmin)return error('client_admin_required',403);
   if(!exact(data,['tenantId','snapshotId','acknowledgeProductionReview'])||!uuid(data.snapshotId)||data.acknowledgeProductionReview!==true)
    return error('invalid_launch_request');
   const frozen=await checkedProductionSchoolSnapshot(db,tenantId,data.snapshotId),id=crypto.randomUUID();
   // Freeze the exact saved current revision, never a stale/different draft.
   if(frozen.row.current_revision!==frozen.row.source_revision||frozen.row.current_config!==frozen.row.config_json)
    return error('freeze_latest_saved_version',409);
   const result=await db.batch([
    db.prepare("INSERT INTO industry_launch_requests(tenant_id,id,snapshot_id,graph_sha256,purpose,requested_by,requested_at) SELECT ?,?,?,?,'school_admission',?,? WHERE EXISTS(SELECT 1 FROM ai_flow_snapshots v JOIN ai_flow_definitions f ON f.tenant_id=v.tenant_id AND f.id=v.flow_id WHERE v.tenant_id=? AND v.id=? AND v.graph_sha256=? AND f.revision=v.source_revision AND f.config_json=v.config_json) AND NOT EXISTS(SELECT 1 FROM industry_launch_requests WHERE tenant_id=? AND snapshot_id=?)")
      .bind(tenantId,id,data.snapshotId,frozen.digest,user.id,at,tenantId,data.snapshotId,frozen.digest,tenantId,data.snapshotId),
    db.prepare("INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,detail_json,created_at) SELECT ?,?,?,'industry.production_review_requested',?,'{}',? WHERE changes()=1").bind(crypto.randomUUID(),tenantId,'human:'+user.id,id,at)
   ]);
   if(result[0]?.meta?.changes!==1)return error('launch_request_already_exists_or_draft_changed',409);
   return reply({created:true,requestId:id,state:'requested',callable:false,dispatchReady:false,blockers:blocked},201);
  }
  const existing=await db.prepare("SELECT * FROM industry_launch_requests WHERE tenant_id=? AND id=?").bind(tenantId,match[1]).first();
  if(!existing)return error('launch_request_not_found',404);
  if(existing.state!=='requested')return error('launch_request_already_decided',409);
  let decision,reference;
  if(match[2]==='review'){
   if(!isAdmin||existing.requested_by===user.id)return error('independent_super_admin_required',403);
   if(!exact(data,['tenantId','decision','reference','acknowledgeNoCalling'])||
    !['configuration_reviewed','rejected'].includes(data.decision)||data.acknowledgeNoCalling!==true||
    typeof data.reference!=='string'||data.reference.trim().length<3||data.reference.length>300||/[\u0000-\u001f\u007f-\u009f]/u.test(data.reference))return error('invalid_launch_review');
   const frozen=await checkedProductionSchoolSnapshot(db,tenantId,existing.snapshot_id);
   if(existing.graph_sha256!==frozen.digest)return error('launch_snapshot_integrity',409);
   if(data.decision==='configuration_reviewed'&&(frozen.row.current_revision!==frozen.row.source_revision||frozen.row.current_config!==frozen.row.config_json))return error('freeze_latest_saved_version',409);
   decision=data.decision;reference=data.reference.trim();
  }else{
   if(isAdmin||existing.requested_by!==user.id||!exact(data,['tenantId','confirm'])||data.confirm!==true)return error('request_owner_required',403);
   decision='withdrawn';reference='Withdrawn by requesting client admin';
  }
  const result=await db.batch([
   db.prepare("UPDATE industry_launch_requests SET state=?,decided_by=?,decided_at=?,review_reference=? WHERE tenant_id=? AND id=? AND state='requested' AND (?<>'configuration_reviewed' OR EXISTS(SELECT 1 FROM ai_flow_snapshots v JOIN ai_flow_definitions f ON f.tenant_id=v.tenant_id AND f.id=v.flow_id WHERE v.tenant_id=industry_launch_requests.tenant_id AND v.id=industry_launch_requests.snapshot_id AND f.revision=v.source_revision AND f.config_json=v.config_json))")
    .bind(decision,user.id,at,reference,tenantId,existing.id,decision),
   db.prepare("INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,detail_json,created_at) SELECT ?,?,?,?,?,'{}',? WHERE changes()=1").bind(crypto.randomUUID(),tenantId,'human:'+user.id,'industry.production_review_'+decision,existing.id,at)
  ]);
  if(result[0]?.meta?.changes!==1)return error('launch_request_already_decided_or_draft_changed',409);
  return reply({state:decision,callable:false,dispatchReady:false,blockers:blocked});
 }catch(e){
  const code=String(e?.message||'');
  return error(/^(school_snapshot_unavailable|school_production_flow_not_supported|invalid_launch_payload)$/.test(code)?code:'production_launch_review_unavailable',/^(school_|invalid_launch_payload)/.test(code)?409:503);
 }
}
