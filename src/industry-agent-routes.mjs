// Client-only, purpose-unapproved Multi-Industry AI Agent drafts.
// Do not wire to calling_scripts, caller policy, campaigns, Plivo or WhatsApp.
import {requireMembership} from './human-auth.mjs';
import {INDUSTRY_NOTICE_CONTRACTS} from './industry-verified-notice.mjs';
import {INDUSTRY_CODES,INDUSTRY_DRAFT_VERSION,INDUSTRY_TEMPLATES,getIndustryTemplate,
 defaultIndustryAgentDraft,validateIndustryAgentDraft,draftOnlyPreview} from './industry-template-catalog.mjs';

const base='/v1/human/', uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const bad=(error,status=400)=>reply({error},status);
const date=now=>new Date(now).toISOString();
async function jsonBody(req){
 if(!req.headers.get('content-type')?.startsWith('application/json'))throw Error('json_required');
 if(Number(req.headers.get('content-length'))>11000)throw Error('body_too_large');
 const reader=req.body?.getReader();if(!reader)throw Error('json_required');
 let bytes=0,raw='';const decoder=new TextDecoder('utf-8',{fatal:true});
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;
  if(bytes>11000){await reader.cancel();throw Error('body_too_large');}
  raw+=decoder.decode(value,{stream:true});
 }raw+=decoder.decode();}finally{reader.releaseLock();}
 let value;try{value=JSON.parse(raw)}catch{throw Error('invalid_json')}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_json');
 return value;
}
function exactKeys(obj,keys){
 return Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k));
}
function rowConfig(row){
 return {id:row.id,revision:row.revision,templateId:row.template_id,
  industry:row.industry_code,status:'draft',config:JSON.parse(row.config_json),
  createdAt:row.created_at,updatedAt:row.updated_at,
  callable:false,published:false};
}
async function writeAudit(db,tenantId,actor,action,id,at){
 return db.prepare("INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,detail_json,created_at) SELECT ?,?,? ,?,?, '{}',? WHERE changes()=1")
  .bind(crypto.randomUUID(),tenantId,'human:'+actor,action,id,at);
}
export async function handleIndustryAgentRequest(req,env,user,{now=Date.now()}={}){
 const path=new URL(req.url).pathname,method=req.method;
 const isTemplates=path===base+'industry-templates',isProfile=path===base+'industry-profiles';
 const isList=path===base+'ai-flows';
 const matched=path.match(/^\/v1\/human\/ai-flows\/([0-9a-f-]{36})$/i);
 if(!isTemplates&&!isProfile&&!isList&&!matched)return null;
 if(!(['GET','POST','PATCH'].includes(method)))return bad('method_not_allowed',405);
 if((isTemplates&&method!=='GET')||(isProfile&&!['GET','PATCH'].includes(method))||
    (isList&&!['GET','POST'].includes(method))||(matched&&!['GET','PATCH'].includes(method)))return bad('method_not_allowed',405);
 try{
  const data=method==='GET'?null:await jsonBody(req);
  const q=new URL(req.url).searchParams;
  const tenantId=method==='GET'?q.get('tenantId'):data.tenantId;
  const member=await requireMembership(env.CONTROL_DB,user,tenantId,method!=='GET');
  if(!member)return bad('forbidden',403);
  const db=env.CONTROL_DB,at=date(now);
  if(isTemplates)return reply({
   version:INDUSTRY_DRAFT_VERSION,
   templates:INDUSTRY_TEMPLATES,
   noticeContracts:INDUSTRY_NOTICE_CONTRACTS,
   modes:['announcement','interactive','hybrid'],
   notice:'Draft setup only. These templates cannot place calls, publish agents or change existing Real Estate calling.'
  });
  if(isProfile){
   if(method==='GET'){
    const p=await db.prepare('SELECT industry_code,revision,updated_at FROM tenant_industry_profiles WHERE tenant_id=?').bind(tenantId).first();
    return reply({profile:p?{industryCode:p.industry_code,revision:p.revision,updatedAt:p.updated_at}:null,
      availableIndustries:INDUSTRY_CODES,callable:false});
   }
   if(!exactKeys(data,['tenantId','industryCode','baseRevision'])||!INDUSTRY_CODES.includes(data.industryCode)||
       !Number.isSafeInteger(data.baseRevision)||data.baseRevision<0)return bad('invalid_industry_profile');
   let result;
   if(data.baseRevision===0){
    result=await db.prepare('INSERT INTO tenant_industry_profiles(tenant_id,industry_code,revision,updated_by,updated_at) SELECT ?,?,1,?,? WHERE NOT EXISTS(SELECT 1 FROM tenant_industry_profiles WHERE tenant_id=?)')
     .bind(tenantId,data.industryCode,user.id,at,tenantId).run();
   }else result=await db.prepare('UPDATE tenant_industry_profiles SET industry_code=?,revision=revision+1,updated_by=?,updated_at=? WHERE tenant_id=? AND revision=?')
     .bind(data.industryCode,user.id,at,tenantId,data.baseRevision).run();
   if(Number(result?.meta?.changes)!==1)return bad('draft_changed_refresh_first',409);
   await db.prepare("INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,detail_json,created_at) VALUES(?,?,?,'industry.profile_draft_saved',?,'{}',?)")
    .bind(crypto.randomUUID(),tenantId,'human:'+user.id,tenantId,at).run();
   return reply({saved:true,revision:data.baseRevision+1,callable:false});
  }
  if(isList&&method==='GET'){
   const rows=await db.prepare('SELECT * FROM ai_flow_definitions WHERE tenant_id=? ORDER BY updated_at DESC,id DESC LIMIT 25')
    .bind(tenantId).all();
   return reply({drafts:rows.results.map(rowConfig),callable:false,notice:'AI agents here are drafts only; the live Real Estate calling engine is unchanged.'});
  }
  if(isList&&method==='POST'){
   if(!exactKeys(data,['tenantId','config']))return bad('invalid_agent_draft_fields');
   const c=validateIndustryAgentDraft(data.config),t=getIndustryTemplate(c.templateId);
   const id=crypto.randomUUID(),config=JSON.stringify(c);
   const statements=[
    db.prepare('INSERT INTO ai_flow_definitions(tenant_id,id,template_id,industry_code,name,config_json,status,revision,created_by,created_at,updated_by,updated_at) SELECT ?,?,?,?,?,?,\'draft\',1,?,?,?,? WHERE (SELECT COUNT(*) FROM ai_flow_definitions WHERE tenant_id=?)<25')
     .bind(tenantId,id,t.id,t.industry,c.name,config,user.id,at,user.id,at,tenantId),
    db.prepare("INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,detail_json,created_at) SELECT ?,?,?,'ai_agent.draft_created',?,'{}',? WHERE changes()=1")
     .bind(crypto.randomUUID(),tenantId,'human:'+user.id,id,at)
   ];
   const changed=await db.batch(statements);
   if(Number(changed[0]?.meta?.changes)!==1)return bad('draft_limit_reached',409);
   return reply({created:true,draft:{id,revision:1,industry:t.industry,status:'draft',config:c,callable:false,published:false}},201);
  }
  if(matched){
   if(!uuid.test(matched[1]))return bad('not_found',404);
   const row=await db.prepare('SELECT * FROM ai_flow_definitions WHERE tenant_id=? AND id=?')
    .bind(tenantId,matched[1]).first();
   if(!row)return bad('draft_not_found',404);
   if(method==='GET')return reply({draft:rowConfig(row),preview:draftOnlyPreview(JSON.parse(row.config_json))});
   if(!exactKeys(data,['tenantId','baseRevision','config'])||
      !Number.isSafeInteger(data.baseRevision)||data.baseRevision<1)return bad('invalid_draft_update');
   const c=validateIndustryAgentDraft(data.config,{existingTemplateId:row.template_id});
   const statements=[
    db.prepare("UPDATE ai_flow_definitions SET name=?,config_json=?,revision=revision+1,updated_by=?,updated_at=? WHERE tenant_id=? AND id=? AND status='draft' AND revision=?")
     .bind(c.name,JSON.stringify(c),user.id,at,tenantId,row.id,data.baseRevision),
    db.prepare("INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,detail_json,created_at) SELECT ?,?,?,'ai_agent.draft_updated',?,'{}',? WHERE changes()=1")
     .bind(crypto.randomUUID(),tenantId,'human:'+user.id,row.id,at)
   ];
   const changed=await db.batch(statements);
   if(Number(changed[0]?.meta?.changes)!==1)return bad('draft_changed_refresh_first',409);
   return reply({saved:true,id:row.id,revision:data.baseRevision+1,status:'draft',callable:false});
  }
  return bad('not_found',404);
 }catch(e){
  if(/^(?:invalid_|body_too_large|json_required)/.test(e?.message||''))return bad(e.message);
  console.error('AR3D industry draft request failed (no customer data)',String(e?.name||'error'));
  return bad('industry_drafts_temporarily_unavailable',503);
 }
}
