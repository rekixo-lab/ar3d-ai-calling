import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb,parseJsonBody} from './core.mjs';
// Manual CRM visit status updates only: no calendar booking, SMS or calls.
const route=/^\/v1\/human\/visits\/([a-f0-9-]{36})$/i;
const transitions={requested:['confirmed','cancelled'],confirmed:['completed','cancelled']};
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function read(req){
  if(Number(req.headers.get('content-length'))>2048)throw Error('request too large');
  const reader=req.body?.getReader();if(!reader)throw Error('request required');
  let size=0,str='';const dec=new TextDecoder('utf-8',{fatal:true});
  try{while(true){const {done,value}=await reader.read();if(done)break;
    size+=value.length;if(size>2048){await reader.cancel();throw Error('request too large')}
    str+=dec.decode(value,{stream:true});
  }str+=dec.decode()}finally{reader.releaseLock()}
  return parseJsonBody(str,2048);
}
export async function handleVisitStatusRequest(req,env,user){
  const match=new URL(req.url).pathname.match(route);
  if(!match)return null;
  if(req.method!=='PATCH')return reply({error:'method not allowed'},405);
  try{
    const d=await read(req);
    if(Object.keys(d).some(k=>!['tenantId','status'].includes(k))||
      !['confirmed','completed','cancelled'].includes(d.status))return reply({error:'invalid status'},400);
    const member=await requireMembership(env.CONTROL_DB,user,d.tenantId,true);
    if(!member)return reply({error:'forbidden'},403);
    const tid=member.tenant_id,db=resolveCrmDb(env,member),id=match[1];
    const row=await db.prepare('SELECT id,status FROM site_visits WHERE tenant_id=? AND id=?').bind(tid,id).first();
    if(!row)return reply({error:'visit not found'},404);
    if(!(transitions[row.status]||[]).includes(d.status))
      return reply({error:'invalid status transition'},409);
    const at=new Date().toISOString();
    const res=await db.batch([
      db.prepare('UPDATE site_visits SET status=? WHERE tenant_id=? AND id=? AND status=?').bind(d.status,tid,id,row.status),
      db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) SELECT ?,?,'human:'||?,'visit.status_changed',id,? FROM site_visits WHERE tenant_id=? AND id=? AND status=?")
        .bind(tid,crypto.randomUUID(),user.id,at,tid,id,d.status)
    ]);
    if(Number(res[0]?.meta?.changes||0)!==1)return reply({error:'visit changed; refresh'},409);
    return reply({id,status:d.status,notice:'CRM status only; no external notifications.'});
  }catch(e){
    const message=String(e?.message||'');
    if(/invalid|request|JSON|too large/i.test(message))return reply({error:message},400);
    console.error('AR3D visit update failed',e);
    return reply({error:'internal server error'},500);
  }
}
