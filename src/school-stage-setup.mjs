// Stage setup uses a fixed fictional School flow; no client/CRM/provider data.
import {compileDraftToFlow} from './call-flow-dsl.mjs';
import {validateIndustryAgentDraft} from './industry-template-catalog.mjs';
import {pilotSha,requireSchoolPilotMfa} from './school-internal-permits.mjs';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const fail=x=>{throw Error(x)};
export async function stageDatabaseIdentity(env){
 if(!uuid(env.AR3D_SCHOOL_STAGE_DB_ID))return false;
 try{
  const db=env.CONTROL_DB;
  const row=await db.prepare('SELECT database_id,worker_name FROM school_stage_identity WHERE id=1').first();
  return row?.database_id===env.AR3D_SCHOOL_STAGE_DB_ID&&row.worker_name==='ar3d-ai-calling-school-stage';
 }catch{return false}
}
export async function stageSetupStatus(env,user,{now=Date.now()}={}){
 const db=env.CONTROL_DB;await requireSchoolPilotMfa(db,user,now);
 const tenantId=env.AR3D_SCHOOL_PILOT_TENANT_ID;
 if(!uuid(tenantId))fail('school_stage_tenant_not_configured');
 const row=await db.prepare("SELECT s.id,s.graph_sha256,r.decision,s.config_json FROM ai_flow_snapshots s LEFT JOIN ai_flow_preview_reviews r ON r.tenant_id=s.tenant_id AND r.snapshot_id=s.id WHERE s.tenant_id=? AND s.template_id='school_admission_v1' ORDER BY s.created_at DESC LIMIT 1").bind(tenantId).first();
 return {tenantId,snapshot:row?{id:row.id,digest:row.graph_sha256,review:row.decision||'awaiting_review',config:JSON.parse(row.config_json)}:null,
  switches:{stage:env.AR3D_SCHOOL_STAGE_ENABLED==='approved',approval:env.AR3D_SCHOOL_PILOT_APPROVAL_ENABLED==='approved',audio:env.AR3D_SCHOOL_PILOT_AUDIO_ENABLED==='approved'},
  callsStartedByThisRequest:0};
}
/** One-time setup of a fixed fictional tenant + disabled author + immutable snapshot.
 * The MFA reviewer is not the author. Explicit later review is still required.
 */
export async function seedStageSchoolDemo(env,user,input,{now=Date.now()}={}){
 const db=env.CONTROL_DB;await requireSchoolPilotMfa(db,user,now);
 if(!input||Object.keys(input).length!==1||input.confirm!=='CREATE_ONE_FICTIONAL_SCHOOL_STAGE_TENANT')fail('school_stage_seed_confirmation_required');
 if(env.AR3D_SCHOOL_STAGE_ENABLED==='approved'||env.AR3D_SCHOOL_PILOT_AUDIO_ENABLED==='approved'||env.AR3D_SCHOOL_PILOT_APPROVAL_ENABLED==='approved')
  fail('school_stage_seed_requires_locked_switches');
 const tenantId=env.AR3D_SCHOOL_PILOT_TENANT_ID;
 if(!uuid(tenantId))fail('school_stage_tenant_not_configured');
 const date=new Date(now).toISOString(),authorId=crypto.randomUUID(),flowId=crypto.randomUUID(),snapshotId=crypto.randomUUID();
 const config=validateIndustryAgentDraft({templateId:'school_admission_v1',name:'Internal fictional School admission',mode:'interactive',language:'hi-en',
  greeting:'नमस्ते, यह एक काल्पनिक स्कूल का आंतरिक ए आई परीक्षण है।',
  questions:['क्या आप काल्पनिक स्कूल के एडमिशन की जानकारी चाहते हैं?','किस कक्षा के बारे में काल्पनिक जानकारी चाहिए?','क्या आप आगे काल्पनिक जानकारी चाहते हैं?'],
  closing:'धन्यवाद। यह केवल आंतरिक परीक्षण था।'});
 const configJson=JSON.stringify(config),graphJson=JSON.stringify(compileDraftToFlow(config)),digest=await pilotSha('ar3d:offline-flow:v1:'+graphJson);
 // This account is permanently disabled by operational policy; no password is issued.
 const salt=crypto.randomUUID().replaceAll('-',''),hash=await pilotSha(crypto.randomUUID()+crypto.randomUUID());
 await db.batch([
  db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,'school-stage-fictional','Fictional School Stage','starter','shared','trial',?,?)").bind(tenantId,date,date),
  db.prepare("INSERT INTO human_users(id,email,password_salt,password_hash,password_iterations,global_role,status,created_at,updated_at) VALUES(?,'school-stage-disabled-author@example.invalid',?,?,300000,'user','disabled',?,?)").bind(authorId,salt,hash,date,date),
  db.prepare("INSERT INTO ai_flow_definitions(tenant_id,id,template_id,industry_code,name,config_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,'school_admission_v1','school',?,?,?,?,?,?)").bind(tenantId,flowId,config.name,configJson,authorId,date,authorId,date),
  db.prepare("INSERT INTO ai_flow_snapshots(tenant_id,id,flow_id,source_revision,template_id,config_json,graph_json,graph_sha256,compiler_version,status,created_by,created_at) VALUES(?,?,?,1,'school_admission_v1',?,?,?,1,'simulation_only',?,?)").bind(tenantId,snapshotId,flowId,configJson,graphJson,digest,authorId,date)
 ]);
 return {tenantId,snapshotId,digest,review:'awaiting_review',liveCall:false,config};
}
