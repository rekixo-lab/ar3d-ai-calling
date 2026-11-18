// Read-only tenant-scoped operational audit trail. Never exports lead PII.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb} from './core.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function handleAuditRequest(req,env,user){
  const url=new URL(req.url);
  if(url.pathname!=='/v1/human/audit')return null;
  if(req.method!=='GET')return json({error:'method not allowed'},405);
  try{
    // Audit exposes operator actions; viewers are not authorized.
    const member=await requireMembership(env.CONTROL_DB,user,url.searchParams.get('tenantId'),true);
    if(!member)return json({error:'forbidden'},403);
    const limitValue=url.searchParams.get('limit')||'25',offsetValue=url.searchParams.get('offset')||'0';
    if(!/^\d{1,3}$/.test(limitValue)||!/^\d{1,6}$/.test(offsetValue)||
       Number(limitValue)<1||Number(limitValue)>100||Number(offsetValue)>100000)
      return json({error:'invalid pagination'},400);
    const db=resolveCrmDb(env,member);
    const [data,total]=await Promise.all([
      db.prepare('SELECT id,actor,action,target_id AS targetId,created_at AS createdAt FROM crm_audit_events WHERE tenant_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?')
        .bind(member.tenant_id,Number(limitValue),Number(offsetValue)).all(),
      db.prepare('SELECT COUNT(*) AS total FROM crm_audit_events WHERE tenant_id=?').bind(member.tenant_id).first()
    ]);
    return json({events:data.results,total:Number(total?.total||0),limit:Number(limitValue),offset:Number(offsetValue)});
  }catch(e){console.error('AR3D audit read failed',e);return json({error:'audit unavailable'},503)}
}
