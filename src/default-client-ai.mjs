// One-time, tenant-scoped AI draft defaults for real-estate clients.
// No fabricated prices, projects or approvals. Drafts require separate approval for calling.
// Existing profile/script versions are never overwritten by this helper.
import {buildMasterAIQuickSetup,MASTER_TEMPLATE_VERSION} from './ai-master-templates.mjs';
import {compileScript} from './calling-script-core.mjs';

export const DEFAULT_AI_TEMPLATE_ID='property_enquiry';

export function initialClientAI(db,{tenantId,companyName,createdBy,createdAt}){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(tenantId||'')||
    typeof createdBy!=='string'||!createdBy||typeof createdAt!=='string')
   throw Error('invalid_default_ai_provisioning');
 const ai=buildMasterAIQuickSetup({templateId:DEFAULT_AI_TEMPLATE_ID,language:'hi-en',
  projectName:'',location:'',price:'',size:''},companyName);
 const scriptId=crypto.randomUUID();
 const statements=[
  db.prepare('INSERT INTO company_profile_versions(tenant_id,revision,config_json,created_by,created_at) VALUES(?,1,?,?,?)')
   .bind(tenantId,JSON.stringify(ai.profile),createdBy,createdAt),
  db.prepare("INSERT INTO calling_script_versions(tenant_id,id,revision,config_json,prompt,created_by,created_at) VALUES(?,?,1,?,?,?,?)")
   .bind(tenantId,scriptId,JSON.stringify(ai.config),compileScript(ai.config),createdBy,createdAt)
 ];
 return {statements,scriptId,templateId:ai.templateId,
  templateVersion:MASTER_TEMPLATE_VERSION,profile:ai.profile,config:ai.config};
}
export async function prepareMissingClientAI(db,{tenantId,companyName,createdBy,createdAt}){
 const old=await db.prepare(
  'SELECT (SELECT COUNT(*) FROM company_profile_versions WHERE tenant_id=?) AS profiles,'+
  '(SELECT COUNT(*) FROM calling_script_versions WHERE tenant_id=?) AS scripts'
 ).bind(tenantId,tenantId).first();
 if(Number(old?.profiles||0)>0||Number(old?.scripts||0)>0)
  return {created:false,reason:'already_configured_no_overwrite'};
 const ai=initialClientAI(db,{tenantId,companyName,createdBy,createdAt});
 try{
  const r=await db.batch(ai.statements);
  if(r.length!==2||r.some(x=>Number(x.meta?.changes)!==1))
   throw Error('default_ai_insert_unconfirmed');
  return {created:true,templateId:ai.templateId,templateVersion:ai.templateVersion};
 }catch(e){
  if(/constraint|UNIQUE|conflict|PRIMARY KEY/i.test(String(e?.message||'')))
   return {created:false,reason:'concurrent_setup_no_overwrite'};
  throw e;
 }
}
