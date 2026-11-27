// Stage-only provisioning plan. No provider call, credential download or resource creation.
// Run at repository root with dedicated Cloudflare stage credentials.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const STAGE_WORKER='ar3d-ai-calling-school-stage';
export const STAGE_DB='ar3d-calling-school-stage-control';
export const STAGE_BUCKET='ar3d-calling-school-stage-audio';
export const STAGE_CONFIG='wrangler.school-stage.generated.json';
export const STAGE_MIGRATIONS='.school-stage-migrations';
export const MIGRATIONS=Object.freeze([
 '0001_init.sql','0002_human_access.sql','0003_ip_login_limits.sql','0004_super_admin_mfa.sql','0005_mfa_recovery.sql',
 '0034_multi_industry_drafts.sql','0035_ai_flow_simulation_snapshots.sql','0036_synthetic_school_sessions.sql',
 '0037_school_internal_pilot_permits.sql','0038_school_stage_dispatches.sql'
]);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const fail=code=>{throw Error(code)};
export function stageSettings(env){
 const account=env.CLOUDFLARE_ACCOUNT_ID,token=env.CLOUDFLARE_API_TOKEN,database=env.SCHOOL_STAGE_D1_ID,
  tenant=env.SCHOOL_STAGE_TENANT_ID,origin=env.SCHOOL_STAGE_ORIGIN;
 if(typeof account!=='string'||!(/^[a-f0-9]{32}$/i.test(account))||typeof token!=='string'||token.length<20||
    !uuid(database)||!uuid(tenant)||!uuid(env.PRODUCTION_CONTROL_DB_ID)||!uuid(env.PRODUCTION_CRM_DB_ID)||
    [env.PRODUCTION_CONTROL_DB_ID,env.PRODUCTION_CRM_DB_ID].some(x=>x.toLowerCase()===database.toLowerCase()))
  fail('stage_identity_inputs_invalid');
 if(typeof origin!=='string'||!/^https:\/\/ar3d-ai-calling-school-stage\.[a-z0-9-]{1,63}\.workers\.dev$/.test(origin))
  fail('stage_origin_invalid');
 return {account,token,database:database.toLowerCase(),tenant:tenant.toLowerCase(),origin};
}
export function lockedStageConfig(s){
 if(!uuid(s.database)||!uuid(s.tenant)||!/^https:\/\/ar3d-ai-calling-school-stage\.[a-z0-9-]{1,63}\.workers\.dev$/.test(s.origin))fail('stage_config_invalid');
 return {
  name:STAGE_WORKER,main:'./src/school-stage-worker.mjs',compatibility_date:'2026-11-17',
  workers_dev:true,preview_urls:false,observability:{enabled:false},
  d1_databases:[{binding:'SCHOOL_STAGE_CONTROL_DB',database_name:STAGE_DB,database_id:s.database,
   migrations_dir:STAGE_MIGRATIONS,migrations_table:'school_stage_migration_history'}],
  r2_buckets:[{binding:'SCHOOL_PILOT_AUDIO',bucket_name:STAGE_BUCKET}],
  vars:{
   AR3D_SCHOOL_STAGE_ORIGIN:s.origin,AR3D_SCHOOL_STAGE_DB_ID:s.database,
   AR3D_SCHOOL_STAGE_ISOLATED_DB_CONFIRMED:'yes',AR3D_SCHOOL_PILOT_TENANT_ID:s.tenant,
   AR3D_SCHOOL_STAGE_ENABLED:'disabled',AR3D_SCHOOL_PILOT_APPROVAL_ENABLED:'disabled',
   AR3D_SCHOOL_PILOT_AUDIO_ENABLED:'disabled',AR3D_SCHOOL_PILOT_LIVE_ENABLED:'disabled',
   AR3D_SCHOOL_STAGE_BOOTSTRAP_ENABLED:'disabled'
  }
 };
}
async function cf(s,path,apiFetch,body){
 const resp=await apiFetch('https://api.cloudflare.com/client/v4/accounts/'+s.account+path,{
  method:body?'POST':'GET',headers:{Authorization:'Bearer '+s.token,...(body?{'Content-Type':'application/json'}:{})},
  redirect:'error',signal:AbortSignal.timeout(15000),...(body?{body:JSON.stringify(body)}:{})});
 if(!resp.ok)fail('stage_cloudflare_api_failed');
 const doc=await resp.json();
 if(doc.success!==true||doc.result==null)fail('stage_cloudflare_api_failed');
 return doc.result;
}
async function query(s,sql,apiFetch){
 const results=await cf(s,'/d1/database/'+s.database+'/query',apiFetch,{sql});
 if(!Array.isArray(results)||results.length!==1||results[0].success!==true||!Array.isArray(results[0].results))
  fail('stage_schema_query_failed');
 return results[0].results;
}
const systemTables=new Set(['_cf_KV','sqlite_sequence','school_stage_migration_history']);
export async function verifyStageResources(s,{apiFetch=fetch}={}){
 const meta=await cf(s,'/d1/database/'+s.database,apiFetch);
 if(meta.uuid?.toLowerCase()!==s.database||meta.name!==STAGE_DB)fail('stage_d1_identity_mismatch');
 const managed=await cf(s,'/r2/buckets/'+STAGE_BUCKET+'/domains/managed',apiFetch);
 const custom=await cf(s,'/r2/buckets/'+STAGE_BUCKET+'/domains/custom',apiFetch);
 if(managed.enabled!==false||!Array.isArray(custom.domains)||custom.domains.length!==0)fail('stage_r2_not_private');
 const tables=(await query(s,"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",apiFetch))
  .map(r=>r.name).filter(n=>!systemTables.has(n));
 if(tables.length===0)return {schema:'empty',d1Verified:true,privateR2:true};
 if(!tables.includes('school_stage_identity'))fail('stage_nonempty_unmarked_database');
 const marker=await query(s,'SELECT database_id,worker_name FROM school_stage_identity WHERE id=1',apiFetch);
 if(marker.length!==1||marker[0].database_id!==s.database||marker[0].worker_name!==STAGE_WORKER)fail('stage_marker_mismatch');
 if(tables.some(n=>['scripted_phone_pilots','tenant_minute_ledger','whatsapp_connections','provider_financial_journal'].includes(n)))
  fail('stage_legacy_schema_detected');
 const required=['tenants','human_users','human_mfa_settings','human_mfa_recovery_codes','ai_flow_definitions','ai_flow_snapshots',
  'ai_flow_preview_reviews','synthetic_school_sessions','school_internal_pilot_permits','school_internal_provider_evidence','school_stage_dispatches'];
 return {schema:required.every(n=>tables.includes(n))?'ready':'partial',d1Verified:true,privateR2:true};
}
export function markerSql(s){
 if(!uuid(s.database))fail('stage_config_invalid');
 return "CREATE TABLE IF NOT EXISTS school_stage_identity (id INTEGER PRIMARY KEY CHECK(id=1), database_id TEXT NOT NULL, worker_name TEXT NOT NULL);\n"+
  "INSERT INTO school_stage_identity(id,database_id,worker_name) VALUES(1,'"+s.database+"','"+STAGE_WORKER+"');\n"+
  "CREATE TRIGGER IF NOT EXISTS trg_school_stage_identity_immutable BEFORE UPDATE ON school_stage_identity BEGIN SELECT RAISE(ABORT,'immutable stage identity'); END;\n"+
  "CREATE TRIGGER IF NOT EXISTS trg_school_stage_identity_no_delete BEFORE DELETE ON school_stage_identity BEGIN SELECT RAISE(ABORT,'immutable stage identity'); END;\n";
}
export function writeStagePlan(s){
 if(existsSync(STAGE_CONFIG)||existsSync(STAGE_MIGRATIONS))fail('stage_generated_files_already_exist_use_clean_checkout');
 const config=lockedStageConfig(s);
 mkdirSync(STAGE_MIGRATIONS,{mode:0o700});
 writeFileSync(resolve(STAGE_MIGRATIONS,'0000_stage_identity.sql'),markerSql(s),{mode:0o600,flag:'wx'});
 for(const file of MIGRATIONS)copyFileSync(resolve('migrations/control',file),resolve(STAGE_MIGRATIONS,file));
 writeFileSync(STAGE_CONFIG,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
}
export async function main(env=process.env,mode=process.argv[2]){
 if(!['preflight','prepare','verify-ready'].includes(mode))fail('stage_operation_invalid');
 const s=stageSettings(env),status=await verifyStageResources(s);
 if(mode==='verify-ready'&&status.schema!=='ready')fail('stage_schema_incomplete');
 if(mode==='prepare')writeStagePlan(s);
 console.log(JSON.stringify({stageWorker:STAGE_WORKER,...status,liveCalling:false,planWritten:mode==='prepare'}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{await main()}catch(e){console.error(/^stage_[a-z_]+$/.test(e?.message||'')?e.message:'stage_preflight_failed');process.exitCode=1}
}
