import {requireMembership} from './human-auth.mjs';
import {parseJsonBody} from './core.mjs';
// Pending metadata only. Never claims ownership verification or reads other services.
const json=(x,s=200)=>Response.json(x,{status:s,headers:{'Cache-Control':'no-store'}});
const fail=(e,s=400)=>json({error:e},s);
async function body(req){
  if(Number(req.headers.get('content-length'))>2048)throw Error('request too large');
  const reader=req.body?.getReader();if(!reader)throw Error('request required');
  const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,s='';
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
    if(size>2048){await reader.cancel();throw Error('request too large')}s+=decoder.decode(value,{stream:true})}
    s+=decoder.decode();
  }finally{reader.releaseLock()}
  return parseJsonBody(s,2048);
}
export async function handleProjectLinkRequest(req,env,user){
  const url=new URL(req.url),method=req.method;
  if(url.pathname!=='/v1/human/project-links')return null;
  try{
    const data=method==='POST'?await body(req):null;
    const tenantId=method==='POST'?data.tenantId:url.searchParams.get('tenantId');
    const membership=await requireMembership(env.CONTROL_DB,user,tenantId,method==='POST');
    if(!membership)return fail('forbidden',403);
    const tid=membership.tenant_id,db=env.CONTROL_DB;
    if(method==='GET'){
      const result=await db.prepare("SELECT id,source,external_project_id AS externalProjectId,external_slug AS externalSlug,status,created_at AS createdAt FROM project_links WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100").bind(tid).all();
      return json({links:result.results,verified:false});
    }
    if(method==='POST'){
      if(Object.keys(data).some(k=>!['tenantId','source','externalProjectId','externalSlug'].includes(k))||
         !['ar3d-platform','ar3d-engine'].includes(data.source)||
         typeof data.externalProjectId!=='string'||!/^[A-Za-z0-9_-]{3,120}$/.test(data.externalProjectId)||
         typeof data.externalSlug!=='string'||!/^[A-Za-z0-9_-]{3,120}$/.test(data.externalSlug))
        return fail('invalid project link');
      const id=crypto.randomUUID(),at=new Date().toISOString();
      await db.batch([
        db.prepare("INSERT INTO project_links(id,tenant_id,source,external_project_id,external_slug,status,created_at) VALUES(?,?,?,?,?,'pending',?)").bind(id,tid,data.source,data.externalProjectId,data.externalSlug,at),
        db.prepare("INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,created_at) VALUES(?,?,?,'project_link.pending_created',?,?)").bind(crypto.randomUUID(),tid,'human:'+user.id,id,at)
      ]);
      return json({id,status:'pending',verified:false},201);
    }
    return fail('method not allowed',405);
  }catch(e){
    const message=String(e?.message||'');
    if(/UNIQUE|PRIMARY KEY/i.test(message))return fail('project link exists',409);
    if(/invalid|request|JSON|too large/i.test(message))return fail(message);
    console.error('AR3D link registration failed',e);return fail('internal server error',500);
  }
}
