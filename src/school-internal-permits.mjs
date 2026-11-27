// Phase 3D internal permit. No HTTP route, dispatcher or live activation here.
// Trusted server callers only: user comes from existing authenticated session.
import {compileDraftToFlow,validateFlowGraph} from './call-flow-dsl.mjs';
import {validateIndustryAgentDraft} from './industry-template-catalog.mjs';
const enc=new TextEncoder();
export const pilotSha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof bytes==='string'?enc.encode(bytes):bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const phone=x=>typeof x==='string'&&/^\+[1-9][0-9]{7,14}$/.test(x);
const safeTime=x=>Number.isSafeInteger(x)&&x>0;
const fail=x=>{throw Error(x)};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
export async function schoolTarget(env,tenantId){
 const caller=env.AR3D_SCHOOL_PILOT_CALLER,recipient=env.AR3D_SCHOOL_PILOT_VERIFIED_STAFF_NUMBER,secret=env.AR3D_SCHOOL_PILOT_BINDING_SECRET;
 if(!uuid(tenantId)||env.AR3D_SCHOOL_PILOT_TENANT_ID!==tenantId||!phone(caller)||!phone(recipient)||caller===recipient||
  typeof secret!=='string'||secret.length<32||secret.length>512)fail('school_pilot_target_not_configured');
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const hash=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode('ar3d:school:target:v1:'+JSON.stringify([tenantId,caller,recipient])))),b=>b.toString(16).padStart(2,'0')).join('');
 return {caller,recipient,hash};
}
async function mfa(db,user,now){
 if(user?.globalRole!=='super_admin'||typeof user.id!=='string'||typeof user.token_hash!=='string'||!safeTime(now))fail('school_pilot_mfa_required');
 const row=await db.prepare("SELECT 1 AS allowed FROM human_mfa_settings m JOIN human_sessions s ON s.user_id=m.user_id JOIN human_users u ON u.id=m.user_id WHERE u.global_role='super_admin' AND m.user_id=? AND s.token_hash=? AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1").bind(user.id,user.token_hash,now).first();
 if(!row)fail('school_pilot_mfa_required');
}
export async function reviewedSchoolGraph(db,tenantId,snapshotId){
 if(!uuid(tenantId)||!uuid(snapshotId))fail('invalid_school_snapshot');
 const row=await db.prepare("SELECT v.graph_json,v.graph_sha256,v.config_json,v.compiler_version,v.status,v.template_id FROM ai_flow_snapshots v JOIN ai_flow_preview_reviews r ON r.tenant_id=v.tenant_id AND r.snapshot_id=v.id JOIN tenants t ON t.id=v.tenant_id WHERE v.tenant_id=? AND v.id=? AND r.decision='simulation_reviewed' AND t.status IN ('active','trial')").bind(tenantId,snapshotId).first();
 if(!row||row.compiler_version!==1||row.status!=='simulation_only'||row.template_id!=='school_admission_v1'||
  await pilotSha('ar3d:offline-flow:v1:'+row.graph_json)!==row.graph_sha256)fail('school_pilot_review_required');
 const graph=validateFlowGraph(JSON.parse(row.graph_json)),config=validateIndustryAgentDraft(JSON.parse(row.config_json));
 if(graph.industry!=='school'||graph.templateId!=='school_admission_v1'||graph.regulated||graph.callable||
  JSON.stringify(compileDraftToFlow(config))!==row.graph_json)fail('invalid_school_snapshot');
 return {graph,graphJson:row.graph_json,graphSha256:row.graph_sha256};
}
export async function approveSchoolInternalPilot(env,user,input,{now=Date.now()}={}){
 const db=env.CONTROL_DB;await mfa(db,user,now);
 if(env.AR3D_SCHOOL_PILOT_APPROVAL_ENABLED!=='approved')fail('school_pilot_approval_disabled');
 if(!exact(input,['tenantId','snapshotId','evidenceRef','expiresAt','maxAudioChars','maxCallSeconds','confirm'])||
  input.confirm!=='ONE_OPTED_IN_STAFF_DEVICE_ONLY_NO_CUSTOMER_CALLS'||
  typeof input.evidenceRef!=='string'||!/^[a-zA-Z0-9._:/-]{8,160}$/.test(input.evidenceRef)||
  !safeTime(input.expiresAt)||input.expiresAt<=now||input.expiresAt>now+3600000||
  !Number.isSafeInteger(input.maxAudioChars)||input.maxAudioChars<1||input.maxAudioChars>4000||
  !Number.isSafeInteger(input.maxCallSeconds)||input.maxCallSeconds<1||input.maxCallSeconds>60)fail('invalid_school_pilot_approval');
 const target=await schoolTarget(env,input.tenantId);
 const frozen=await reviewedSchoolGraph(db,input.tenantId,input.snapshotId);
 const chars=frozen.graph.nodes.reduce((n,x)=>n+(typeof x.text==='string'?Array.from(x.text).length:0),0);
 if(chars>input.maxAudioChars)fail('school_pilot_audio_budget_exceeded');
 const id=crypto.randomUUID();
 const r=await db.prepare("INSERT INTO school_internal_pilot_permits(id,tenant_id,snapshot_id,graph_sha256,target_sha256,approved_by,evidence_ref,expires_at,created_at,max_audio_chars,max_call_seconds) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM school_internal_pilot_permits WHERE tenant_id=? AND expires_at>? AND stopped_at IS NULL)")
  .bind(id,input.tenantId,input.snapshotId,frozen.graphSha256,target.hash,user.id,input.evidenceRef,input.expiresAt,now,input.maxAudioChars,input.maxCallSeconds,input.tenantId,now).run();
 if(r.meta.changes!==1)fail('school_pilot_active_permit_exists');
 return {permitId:id,expiresAt:input.expiresAt,maxAudioChars:input.maxAudioChars,maxCallSeconds:input.maxCallSeconds,liveCall:false};
}
export async function stopSchoolInternalPilot(env,user,tenantId,permitId,{now=Date.now()}={}){
 const db=env.CONTROL_DB;await mfa(db,user,now);
 if(!uuid(tenantId)||!uuid(permitId))fail('invalid_school_pilot_permit');
 const r=await db.prepare('UPDATE school_internal_pilot_permits SET stopped_at=?,stopped_by=? WHERE tenant_id=? AND id=? AND stopped_at IS NULL').bind(now,user.id,tenantId,permitId).run();
 return {stopped:r.meta.changes===1,liveCall:false,notice:'Blocks future permit work; not a carrier hangup API.'};
}
export async function readActiveSchoolPermit(env,tenantId,permitId,now){
 if(!uuid(tenantId)||!uuid(permitId)||!safeTime(now))fail('invalid_school_pilot_permit');
 const row=await env.CONTROL_DB.prepare('SELECT * FROM school_internal_pilot_permits WHERE tenant_id=? AND id=? AND stopped_at IS NULL AND expires_at>? AND created_at<=?').bind(tenantId,permitId,now,now).first();
 const target=await schoolTarget(env,tenantId);
 if(!row||row.target_sha256!==target.hash)fail('school_pilot_permit_unavailable');
 const frozen=await reviewedSchoolGraph(env.CONTROL_DB,tenantId,row.snapshot_id);
 if(frozen.graphSha256!==row.graph_sha256)fail('school_pilot_snapshot_mismatch');
 return {row,target,...frozen};
}
