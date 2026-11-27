// Offline-only immutable flow snapshots and MFA-reviewed simulation decisions.
// No telephony provider, customer record, wallet or messaging integration.
import {requireMembership} from './human-auth.mjs';
import {sha256hex} from './core.mjs';
import {compileDraftToFlow,validateFlowGraph,simulateFlowGraph} from './call-flow-dsl.mjs';
import {runVirtualVoiceTurns} from './virtual-voice-turns.mjs';
import {validateIndustryAgentDraft} from './industry-template-catalog.mjs';

const BASE='/v1/human/ai-flow-snapshots';
const idRE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(code,status=400)=>reply({error:code},status);
const exact=(obj,keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).length===keys.length&&keys.every(x=>Object.hasOwn(obj,x));
async function jsonBody(req){
 if(!req.headers.get('content-type')?.startsWith('application/json')||
    Number(req.headers.get('content-length'))>3500)throw Error('invalid_snapshot_payload');
 const reader=req.body?.getReader();if(!reader)throw Error('invalid_snapshot_payload');
 let size=0,source='';const dec=new TextDecoder('utf-8',{fatal:true});
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
   if(size>3500){await reader.cancel();throw Error('invalid_snapshot_payload')}
   source+=dec.decode(value,{stream:true});
  }source+=dec.decode();
 }finally{reader.releaseLock()}
 try{
  const value=JSON.parse(source);
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
  return value;
 }catch{throw Error('invalid_snapshot_payload')}
}
function pathInfo(path){
 if(path===BASE)return {kind:'collection'};
 const match=path.match(/^\/v1\/human\/ai-flow-snapshots\/([^/]+)(?:\/(review|simulate|voice-turn-preview))?$/);
 if(!match)return null;
 if(!idRE.test(match[1]))return {kind:'invalid'};
 return {kind:match[2]||'detail',id:match[1]};
}
async function freshMfaAdmin(db,user,now){
 if(user.globalRole!=='super_admin'||typeof user.token_hash!=='string')return false;
 const row=await db.prepare("SELECT 1 AS allowed FROM human_mfa_settings m "+
  "JOIN human_sessions s ON s.user_id=m.user_id "+
  "WHERE m.user_id=? AND s.token_hash=? AND m.enabled_at IS NOT NULL "+
  "AND s.created_at>=m.enabled_at AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1")
  .bind(user.id,user.token_hash,now).first();
 return !!row;
}
async function verifyFrozen(row){
 if(!row||row.compiler_version!==1||row.status!=='simulation_only')throw Error('invalid_snapshot_integrity');
 if(await sha256hex('ar3d:offline-flow:v1:'+row.graph_json)!==row.graph_sha256)throw Error('invalid_snapshot_integrity');
 const graph=validateFlowGraph(JSON.parse(row.graph_json));
 const config=validateIndustryAgentDraft(JSON.parse(row.config_json));
 if(graph.templateId!==config.templateId||graph.mode!==config.mode||graph.language!==config.language)
  throw Error('invalid_snapshot_integrity');
 if(JSON.stringify(compileDraftToFlow(config))!==row.graph_json)throw Error('invalid_snapshot_integrity');
 return {graph,config};
}
const view=row=>({
 id:row.id,flowId:row.flow_id,draftRevision:row.source_revision,
 status:'simulation_only',compilerVersion:row.compiler_version,
 digest:row.graph_sha256,createdAt:row.created_at,
 review:row.decision||'awaiting_review',reviewedAt:row.reviewed_at||null,
 callable:false,published:false,liveApproved:false
});
const joined="SELECT v.*,r.decision,r.reviewed_at FROM ai_flow_snapshots v "+
 "LEFT JOIN ai_flow_preview_reviews r ON r.tenant_id=v.tenant_id AND r.snapshot_id=v.id ";
export async function handleIndustryFlowSnapshots(req,env,user,{now=Date.now()}={}){
 const p=pathInfo(new URL(req.url).pathname);
 if(!p)return null;
 if(p.kind==='invalid')return fail('not_found',404);
 const method=req.method,allowed=p.kind==='collection'?['GET','POST']:p.kind==='detail'?['GET']:['POST'];
 if(!allowed.includes(method))return fail('method_not_allowed',405);
 try{
  const body=method==='POST'?await jsonBody(req):null;
  const query=new URL(req.url).searchParams;
  const tid=method==='POST'?body.tenantId:query.get('tenantId');
  if(!idRE.test(tid||''))return fail('invalid_tenant_id');
  const db=env.CONTROL_DB,admin=user.globalRole==='super_admin';
  if(admin){
   if(!await freshMfaAdmin(db,user,now))return fail('current_super_admin_mfa_required',403);
   if(!await db.prepare("SELECT id FROM tenants WHERE id=? AND status IN('active','trial')").bind(tid).first())
    return fail('tenant_unavailable',404);
  }else {
   const write=(p.kind==='collection'&&method==='POST')||p.kind==='simulate'||p.kind==='voice-turn-preview';
   if(!await requireMembership(db,user,tid,write))return fail('forbidden',403);
  }
  if(p.kind==='collection'&&method==='GET'){
   const flowId=query.get('flowId');
   if(flowId!==null&&!idRE.test(flowId))return fail('invalid_flow_id');
   const rows=flowId?
    await db.prepare(joined+"WHERE v.tenant_id=? AND v.flow_id=? ORDER BY v.created_at DESC,v.id DESC LIMIT 30")
     .bind(tid,flowId).all():
    await db.prepare(joined+"WHERE v.tenant_id=? ORDER BY v.created_at DESC,v.id DESC LIMIT 30")
     .bind(tid).all();
   return reply({snapshots:rows.results.map(view),callable:false,notice:'Immutable rehearsal snapshots; none are approved to make live calls.'});
  }
  if(p.kind==='collection'&&method==='POST'){
   if(admin)return fail('client_admin_required',403);
   if(!exact(body,['tenantId','flowId','baseRevision'])||!idRE.test(body.flowId||'')||
       !Number.isSafeInteger(body.baseRevision)||body.baseRevision<1)return fail('invalid_snapshot_request');
   const row=await db.prepare("SELECT id,revision,config_json,template_id FROM ai_flow_definitions "+
     "WHERE tenant_id=? AND id=? AND status='draft'").bind(tid,body.flowId).first();
   if(!row)return fail('draft_not_found',404);
   if(row.revision!==body.baseRevision)return fail('draft_changed_refresh_first',409);
   const config=validateIndustryAgentDraft(JSON.parse(row.config_json));
   if(config.templateId!==row.template_id)return fail('invalid_snapshot_integrity',409);
   const graphJson=JSON.stringify(compileDraftToFlow(config));
   const digest=await sha256hex('ar3d:offline-flow:v1:'+graphJson);
   const id=crypto.randomUUID(),at=new Date(now).toISOString();
   const statements=[
    db.prepare("INSERT INTO ai_flow_snapshots(tenant_id,id,flow_id,source_revision,template_id,config_json,graph_json,graph_sha256,compiler_version,status,created_by,created_at) "+
     "SELECT tenant_id,?,id,revision,template_id,config_json,?,?,1,'simulation_only',?,? "+
     "FROM ai_flow_definitions WHERE tenant_id=? AND id=? AND revision=? AND config_json=? AND status='draft' "+
     "AND (SELECT COUNT(*) FROM ai_flow_snapshots WHERE tenant_id=? AND flow_id=?)<30 "+
     "AND NOT EXISTS(SELECT 1 FROM ai_flow_snapshots WHERE tenant_id=? AND flow_id=? AND source_revision=?)")
     .bind(id,graphJson,digest,user.id,at,tid,body.flowId,row.revision,row.config_json,tid,body.flowId,tid,body.flowId,row.revision),
    db.prepare("INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,detail_json,created_at) "+
      "SELECT ?,?,?,'ai_flow.simulation_snapshot_created',?,'{}',? WHERE changes()=1")
     .bind(crypto.randomUUID(),tid,'human:'+user.id,id,at)
   ];
   const changed=await db.batch(statements);
   if(Number(changed[0]?.meta?.changes)!==1)return fail('snapshot_already_saved_or_draft_changed',409);
   return reply({created:true,snapshot:{id,flowId:body.flowId,draftRevision:row.revision,
    status:'simulation_only',compilerVersion:1,digest,createdAt:at,review:'awaiting_review',
    callable:false,published:false,liveApproved:false}},201);
  }
  const row=await db.prepare(joined+"WHERE v.tenant_id=? AND v.id=?").bind(tid,p.id).first();
  if(!row)return fail('snapshot_not_found',404);
  const frozen=await verifyFrozen(row);
  if(p.kind==='detail')return reply({snapshot:view(row),graph:frozen.graph,
    notice:'Immutable offline simulation graph only; not authorized for calling.'});
  if(p.kind==='simulate'){
   if(admin)return fail('client_admin_required',403);
   if(!exact(body,['tenantId','answers'])||!Array.isArray(body.answers)||body.answers.length>12||
      body.answers.some(x=>typeof x!=='string'||x.length>160))return fail('invalid_fictional_answers');
   return reply({...simulateFlowGraph(frozen.graph,{answers:body.answers}),snapshot:view(row)});
  }
  if(p.kind==='voice-turn-preview'){
   if(admin)return fail('client_admin_required',403);
   // The server verifies the immutable snapshot digest and graph above.
   // Never accept caller-supplied cursor, verification flags, voice URIs or provider IDs.
   if(!exact(body,['tenantId','answers'])||!Array.isArray(body.answers)||body.answers.length>12||
      body.answers.some(x=>typeof x!=='string'||x.length>160))
    return fail('invalid_fictional_voice_answers');
   const output=runVirtualVoiceTurns(frozen.graph,{answers:body.answers});
   return reply({...output,snapshot:view(row)});
  }
  if(p.kind==='review'){
   if(!admin)return fail('super_admin_required',403);
   if(!exact(body,['tenantId','decision','reason','acknowledgeSimulationOnly'])||
     !['simulation_reviewed','simulation_rejected'].includes(body.decision)||
     body.acknowledgeSimulationOnly!==true||typeof body.reason!=='string'||
     body.reason.trim().length<3||body.reason.length>300||/[\u0000-\u001f\u007f-\u009f]/u.test(body.reason))
    return fail('invalid_review_request');
   const at=new Date(now).toISOString();
   const changed=await db.batch([
    db.prepare("INSERT INTO ai_flow_preview_reviews(tenant_id,snapshot_id,decision,review_note,reviewed_by,reviewed_at) "+
     "SELECT tenant_id,id,?,?,?,? FROM ai_flow_snapshots "+
     "WHERE tenant_id=? AND id=? AND created_by<>? "+
     "AND NOT EXISTS(SELECT 1 FROM ai_flow_preview_reviews WHERE tenant_id=? AND snapshot_id=?)")
     .bind(body.decision,body.reason.trim(),user.id,at,tid,p.id,user.id,tid,p.id),
    db.prepare("INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,detail_json,created_at) "+
     "SELECT ?,?,?,'ai_flow.simulation_review_recorded',?,'{}',? WHERE changes()=1")
     .bind(crypto.randomUUID(),tid,'human:'+user.id,p.id,at)
   ]);
   if(Number(changed[0]?.meta?.changes)!==1)return fail('review_already_recorded_or_self_review',409);
   return reply({reviewed:true,decision:body.decision,simulationOnly:true,liveApproved:false,callable:false});
  }
  return fail('not_found',404);
 }catch(e){
  if((e?.message||'').startsWith('invalid_'))return fail('invalid_snapshot_payload');
  console.error('AR3D frozen offline flow error (no customer payload)',String(e?.name||'error'));
  return fail('offline_flow_unavailable',503);
 }
}
