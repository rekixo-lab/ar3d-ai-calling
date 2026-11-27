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
    const reschedule=d.action==='reschedule';
    if(reschedule){
      if(Object.keys(d).some(k=>!['tenantId','action','scheduledAt','expectedScheduledAt'].includes(k))||
         typeof d.scheduledAt!=='string'||typeof d.expectedScheduledAt!=='string'||
         !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(d.scheduledAt)||
         !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(d.expectedScheduledAt))
        return reply({error:'invalid reschedule date'},400);
      const value=Date.parse(d.scheduledAt),now=Date.now();
      if(!Number.isFinite(value)||value<now+60000||value>now+366*86400000||
         new Date(value).toISOString()!==d.scheduledAt||
         !Number.isFinite(Date.parse(d.expectedScheduledAt)))
        return reply({error:'choose a future visit time'},400);
    }else if(Object.keys(d).some(k=>!['tenantId','status'].includes(k))||
      !['confirmed','completed','cancelled'].includes(d.status))
      return reply({error:'invalid status'},400);
    const member=await requireMembership(env.CONTROL_DB,user,d.tenantId,true);
    if(!member)return reply({error:'forbidden'},403);
    const tid=member.tenant_id,db=resolveCrmDb(env,member),id=match[1];
    const row=await db.prepare('SELECT id,status,scheduled_at FROM site_visits WHERE tenant_id=? AND id=?').bind(tid,id).first();
    if(!row)return reply({error:'visit not found'},404);
    if(reschedule){
      if(!['requested','confirmed'].includes(row.status)||
         row.scheduled_at!==d.expectedScheduledAt||
         d.scheduledAt===row.scheduled_at)
        return reply({error:'visit changed; refresh'},409);
      // A single tenant-scoped compare-and-swap avoids overwriting an updated
      // visit, including two browser tabs racing to reschedule.
      const at=new Date().toISOString();
      const changed=await db.batch([
       db.prepare("UPDATE site_visits SET scheduled_at=? WHERE tenant_id=? AND id=? AND status IN('requested','confirmed') AND scheduled_at=?")
        .bind(d.scheduledAt,tid,id,row.scheduled_at),
       db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) SELECT ?,?,'human:'||?,'visit.rescheduled',?,? WHERE changes()=1")
        .bind(tid,crypto.randomUUID(),user.id,id,at)
      ]);
      if(Number(changed[0]?.meta?.changes||0)!==1||
         Number(changed[1]?.meta?.changes||0)!==1)
        return reply({error:'visit changed; refresh'},409);
      return reply({id,status:row.status,scheduledAt:d.scheduledAt,
       reminderSent:false,notice:'Visit time changed in CRM. No SMS, WhatsApp or call was sent.'});
    }
    if(!(transitions[row.status]||[]).includes(d.status))
      return reply({error:'invalid status transition'},409);
    const at=new Date().toISOString();
    const res=await db.batch([
      db.prepare('UPDATE site_visits SET status=? WHERE tenant_id=? AND id=? AND status=?').bind(d.status,tid,id,row.status),
      db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) SELECT ?,?,'human:'||?,'visit.status_changed',id,? FROM site_visits WHERE tenant_id=? AND id=? AND status=? AND changes()=1")
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
