// Human Super Admin-only tenant access suspension; not payment or billing.
import {parseJsonBody,resolveCrmDb} from './core.mjs';
import {currentSuperAdminMfa,mutationOriginAllowed} from './human-auth.mjs';
const path=/^\/v1\/human\/tenants\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/(suspend|resume)$/i;
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message,status=400)=>json({error:message},status);
async function payload(req){
  if(Number(req.headers.get('content-length'))>2048)throw Error('request too large');
  const reader=req.body?.getReader();if(!reader)throw Error('request required');
  const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,value='';
  try{
    while(true){
      const {done,value:part}=await reader.read();if(done)break;
      size+=part.byteLength;if(size>2048){await reader.cancel();throw Error('request too large')}
      value+=decoder.decode(part,{stream:true});
    }value+=decoder.decode();
  }finally{reader.releaseLock()}
  return parseJsonBody(value,2048);
}
export async function handleTenantLifecycleRequest(req,env,user){
  const match=new URL(req.url).pathname.match(path);
  if(!match)return null;
  if(user?.globalRole!=='super_admin')return fail('forbidden',403);
  if(req.method!=='POST')return fail('method not allowed',405);
  if(new URL(req.url).search||!mutationOriginAllowed(req))return fail('same-origin request required',403);
  try{
    if(!await currentSuperAdminMfa(env.CONTROL_DB,user))return fail('current_super_admin_mfa_required',403);
    const body=await payload(req);
    if(Object.keys(body).some(k=>k!=='reason')||
       typeof body.reason!=='string'||body.reason.trim().length<10||
       body.reason.trim().length>240||/[\u0000-\u001f]/u.test(body.reason))
      return fail('reason must be 10-240 printable characters');
    const tid=match[1],verb=match[2],db=env.CONTROL_DB;
    const tenant=await db.prepare('SELECT id,status,storage_mode,dedicated_binding,suspended_from_status FROM tenants WHERE id=?')
      .bind(tid).first();
    if(!tenant)return fail('tenant not found',404);
    if(verb==='suspend'&&!['trial','active'].includes(tenant.status))
      return fail('only trial/active tenants can be suspended',409);
    if(verb==='resume'){
      if(tenant.status!=='suspended'||!['trial','active'].includes(tenant.suspended_from_status))
        return fail('no safely recoverable prior tenant status',409);
      // Never resume an enterprise dedicated tenant without its own D1 binding.
      try{resolveCrmDb(env,{storage_mode:tenant.storage_mode,dedicated_binding:tenant.dedicated_binding})}
      catch{return fail('CRM database not provisioned; resume refused',409)}
    }
    const from=tenant.status,to=verb==='suspend'?'suspended':tenant.suspended_from_status;
    const at=new Date().toISOString(),detail=JSON.stringify({from,to,reason:body.reason.trim()});
    const changes=await db.batch([
      verb==='suspend'?
        db.prepare("UPDATE tenants SET status='suspended',suspended_from_status=status,updated_at=? WHERE id=? AND status=?")
          .bind(at,tid,from):
        db.prepare("UPDATE tenants SET status=suspended_from_status,suspended_from_status=NULL,updated_at=? WHERE id=? AND status='suspended' AND suspended_from_status=?")
          .bind(at,tid,to),
      db.prepare("INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,detail_json,created_at) SELECT ?,?,'human:'||?,?,?, ?,? FROM tenants WHERE id=? AND status=? AND changes()=1")
        .bind(crypto.randomUUID(),tid,user.id,verb==='suspend'?'tenant.suspended':'tenant.resumed',tid,detail,at,tid,to)
    ]);
    if(Number(changes[0]?.meta?.changes||0)!==1||Number(changes[1]?.meta?.changes||0)!==1)
      return fail('tenant changed; refresh',409);
    return json({id:tid,status:to,accessEnabled:to!=='suspended',
      notice:to==='suspended'?'Tenant access is disabled until a Super Admin resumes it.':
        'Tenant access restored to its previous trial/active status; no payment was charged.'});
  }catch(e){
    const message=String(e?.message||'');
    if(/invalid|request|JSON|too large/i.test(message))return fail(message);
    console.error('AR3D tenant lifecycle error',e);return fail('internal server error',500);
  }
}
