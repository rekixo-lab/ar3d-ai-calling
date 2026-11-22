import {requireMembership,mutationOriginAllowed} from './human-auth.mjs';
import {parseJsonBody,sha256hex} from './core.mjs';
import {buildMasterAIQuickSetup,MASTER_TEMPLATE_VERSION} from './ai-master-templates.mjs';
import {prepareMissingClientAI} from './default-client-ai.mjs';
import {defaultScript,validateScript,compileScript} from './calling-script-core.mjs';
const BASE='/v1/human/calling-scripts';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function read(req){
 if(!req.body||!req.headers.get('content-type')?.startsWith('application/json'))throw Error('invalid_json');
 const reader=req.body.getReader(),dec=new TextDecoder('utf-8',{fatal:true});let raw='',size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>100000){await reader.cancel();throw Error('body_too_large')}raw+=dec.decode(value,{stream:true})}raw+=dec.decode()}finally{reader.releaseLock()}
 return parseJsonBody(raw,100000);
}
async function freshAdmin(db,user,now){
 return user.globalRole==='super_admin'&&!!await db.prepare('SELECT m.enabled_at FROM human_mfa_settings m JOIN human_sessions s ON s.user_id=m.user_id WHERE m.user_id=? AND s.token_hash=? AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1').bind(user.id,user.token_hash,now).first();
}
export async function handleCallingScripts(req,env,user,{now=Date.now()}={}){
 const url=new URL(req.url),path=url.pathname;
 if(path!==BASE&&!path.startsWith(BASE+'/'))return null;
 const action=path===BASE?'versions':path.slice(BASE.length+1),db=env.CONTROL_DB;
 const fail=(error,status=400)=>json({error},status);
 if(!['versions','quick-setup','apply-defaults'].includes(action))return fail('not_found',404);
 if(!['GET','POST'].includes(req.method)||['quick-setup','apply-defaults'].includes(action)&&req.method!=='POST')return fail('method_not_allowed',405);
 if(req.method==='POST'&&!mutationOriginAllowed(req))return fail('same_origin_required',403);
 try{
  const d=req.method==='POST'?await read(req):Object.fromEntries(url.searchParams);
  if(!UUID.test(d.tenantId||''))return fail('invalid_tenant');
  const isAdmin=await freshAdmin(db,user,now);
  if(user.globalRole==='super_admin'&&!isAdmin)return fail('current_super_admin_mfa_required',403);
  if(isAdmin){if(!await db.prepare("SELECT id FROM tenants WHERE id=? AND status IN('trial','active')").bind(d.tenantId).first())return fail('tenant_unavailable',404)}
  else if(!await requireMembership(db,user,d.tenantId,req.method==='POST'))return fail('forbidden',403);
  if((req.method==='POST'||!['versions'].includes(action))&&!isAdmin)
   return fail('super_admin_required',403);
  const tid=d.tenantId,at=new Date(now).toISOString();
  if(action==='apply-defaults'){
    if(req.method!=='POST'||Object.keys(d).some(k=>k!=='tenantId'))
      return fail('invalid_default_ai_request');
    const tenant=await db.prepare("SELECT display_name FROM tenants WHERE id=? AND status IN('trial','active')").bind(tid).first();
    if(!tenant)return fail('tenant_unavailable',404);
    const outcome=await prepareMissingClientAI(db,{tenantId:tid,companyName:tenant.display_name,createdBy:user.id,createdAt:at});
    return outcome.created?
      json({...outcome,profileRevision:1,scriptRevision:1,published:false,customerCallsStarted:0,
        notice:'Generic AI defaults saved as drafts only. Review the builder name and draft.'},201):
      fail(outcome.reason,409);
   }
   if(action==='quick-setup'){
   // Zero remote/provider calls, zero consent/calling mutations. One atomic,
   // create-only, tenant-scoped pair of immutable version-1 records.
   if(req.method!=='POST'||Object.keys(d).some(k=>!['tenantId','mode','details','previewDigest','templateVersion','acknowledgedReview'].includes(k))||
       !['preview','create'].includes(d.mode))return fail('invalid_quick_setup');
   const tenant=await db.prepare("SELECT display_name FROM tenants WHERE id=? AND status IN('trial','active')").bind(tid).first();
   if(!tenant)return fail('tenant_unavailable',404);
   const generated=buildMasterAIQuickSetup(d.details,tenant.display_name);
   const state=await db.prepare(
    'SELECT (SELECT COALESCE(MAX(revision),0) FROM company_profile_versions WHERE tenant_id=?) AS profileRevision,'+
    '(SELECT COALESCE(MAX(revision),0) FROM calling_script_versions WHERE tenant_id=?) AS scriptRevision'
   ).bind(tid,tid).first();
   const profileRevision=Number(state?.profileRevision||0),scriptRevision=Number(state?.scriptRevision||0);
   const canCreate=profileRevision===0&&scriptRevision===0;
   const previewDigest=await sha256hex(JSON.stringify([tid,generated.templateVersion,generated.profile,generated.config]));
   if(d.mode==='preview')return json({
    canCreate,profileRevision,scriptRevision,templateId:generated.templateId,
    templateVersion:generated.templateVersion,profile:generated.profile,
    script:generated.config,promptPreview:generated.prompt,
    warnings:generated.warnings,previewDigest,
    notice:canCreate?'Preview only. No draft saved, no calls and no phone-provider changes.':'Existing setup found. Use the versioned manual editor; nothing will be overwritten.'
   });
   if(!canCreate)return fail('existing_ai_setup_will_not_be_overwritten',409);
   if(d.templateVersion!==MASTER_TEMPLATE_VERSION||d.previewDigest!==previewDigest||
      d.acknowledgedReview!==true)return fail('preview_and_confirm_current_template_first',409);
   const id=crypto.randomUUID();
   try{
    const outcomes=await db.batch([
     db.prepare('INSERT INTO company_profile_versions(tenant_id,revision,config_json,created_by,created_at) VALUES(?,1,?,?,?)')
      .bind(tid,JSON.stringify(generated.profile),user.id,at),
     db.prepare("INSERT INTO calling_script_versions(tenant_id,id,revision,config_json,prompt,created_by,created_at) VALUES(?,?,1,?,?,?,?)")
      .bind(tid,id,JSON.stringify(generated.config),compileScript(generated.config),user.id,at)
    ]);
    if(outcomes.some(x=>Number(x.meta?.changes)!==1))return fail('quick_setup_unconfirmed_check_versions',503);
    return json({created:true,profileRevision:1,scriptRevision:1,scriptId:id,
      templateId:generated.templateId,templateVersion:generated.templateVersion,
      published:false,customerCallsStarted:0,
      notice:'Company facts and AI script saved as drafts. Review the drafts in Super Admin. Calling approvals remain unchanged.'},201);
   }catch(e){
    if(/unique|constraint|conflict/i.test(String(e?.message)))return fail('existing_ai_setup_will_not_be_overwritten',409);
    return fail('quick_setup_unavailable_no_calls_started',503);
   }
  }
  if(action==='versions'&&req.method==='GET'){
   const rows=await db.prepare('SELECT id,revision,config_json,provider_state AS providerState,provider_version AS providerVersion,error_code AS errorCode,created_at AS createdAt,synced_at AS syncedAt FROM calling_script_versions WHERE tenant_id=? ORDER BY revision DESC LIMIT 50').bind(tid).all();
   const profile=await db.prepare('SELECT MAX(revision) AS revision FROM company_profile_versions WHERE tenant_id=?').bind(tid).first();
   return json({profileRevision:profile?.revision||0,versions:rows.results.map(({config_json,...r})=>({...r,config:JSON.parse(config_json)})),defaults:defaultScript(),canEdit:isAdmin,notice:'Draft scripts are stored in AR3D. The phone pilot uses the fixed questionnaire.'});
  }
  if(action==='versions'){
   if(Object.keys(d).some(k=>!['tenantId','baseRevision','config'].includes(k))||!Number.isInteger(d.baseRevision)||d.baseRevision<0)return fail('invalid_revision');
   const config=validateScript(d.config),prompt=compileScript(config),id=crypto.randomUUID();
   // Atomic compare-and-save prevents silent overwrites between tabs/operators.
   const result=await db.prepare('INSERT INTO calling_script_versions(tenant_id,id,revision,config_json,prompt,created_by,created_at) SELECT ?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM calling_script_versions WHERE tenant_id=?),0)=?').bind(tid,id,d.baseRevision+1,JSON.stringify(config),prompt,user.id,at,tid,d.baseRevision).run();
   if(result.meta.changes!==1)return fail('script_changed_refresh_first',409);
   return json({id,revision:d.baseRevision+1,providerState:'draft',prompt},201);
  }
 }catch(e){
  const error=String(e.message||'');
  if(/invalid|Agent needs|body_too_large/i.test(error))return fail(error);
  return fail('script_unavailable_refresh_or_check_migration',503);
 }
}
