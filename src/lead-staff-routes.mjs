// Optional tenant-scoped CRM staff assignment, never initiates a call or sends
// any message. Only existing active tenant members can be assigned.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb,parseJsonBody} from './core.mjs';
const PATH='/v1/human/lead-staff';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ID=/^[a-zA-Z0-9_-]{1,64}$/;
const HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(body,status=200)=>Response.json(body,{status,headers:HEADERS});
const fail=(error,status=400)=>json({error},status);
function validUser(value){return value===null||typeof value==='string'&&ID.test(value)}
async function read(req){
 if(!req.body||!req.headers.get('content-type')?.startsWith('application/json')||
    Number(req.headers.get('content-length'))>2048)throw Error('invalid body');
 let text='',size=0,decoder=new TextDecoder('utf-8',{fatal:true});
 const reader=req.body.getReader();
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;if(size>2048){await reader.cancel();throw Error('too large')}
   text+=decoder.decode(value,{stream:true});
  }
  text+=decoder.decode();
 }finally{reader.releaseLock()}
 return parseJsonBody(text,2048);
}
export async function handleLeadStaffRequest(req,env,user){
 const url=new URL(req.url);
 if(url.pathname!==PATH)return null;
 if(!['GET','POST'].includes(req.method))return fail('method not allowed',405);
 try{
  const d=req.method==='GET'?
   Object.fromEntries(url.searchParams.entries()):await read(req);
  if(req.method==='GET'&&([...url.searchParams.keys()].some(k=>
     !['tenantId','leadId'].includes(k)||url.searchParams.getAll(k).length!==1)))return fail('invalid query');
  if(!d||typeof d!=='object'||Array.isArray(d)||
     Object.keys(d).some(k=>!['tenantId','leadId',...(req.method==='POST'?['userId','expectedUserId']:[])].includes(k))||
     !UUID.test(d.tenantId||'')||!UUID.test(d.leadId||''))
   return fail('invalid lead staff request');
  if(req.method==='POST'&&(!Object.hasOwn(d,'userId')||!Object.hasOwn(d,'expectedUserId')||
    !validUser(d.userId)||!validUser(d.expectedUserId)))
   return fail('invalid staff member');
  // Viewing available staff emails and changing assignments is reserved for
  // the tenant's own Client Admin, not viewers or unrelated staff.
  const member=await requireMembership(env.CONTROL_DB,user,d.tenantId,true);
  if(!member)return fail('forbidden',403);
  const tid=member.tenant_id,db=resolveCrmDb(env,member);
  const lead=await db.prepare('SELECT id FROM leads WHERE tenant_id=? AND id=?')
   .bind(tid,d.leadId).first();
  if(!lead)return fail('lead not found',404);
  const [assignment,members]=await Promise.all([
   db.prepare('SELECT user_id AS userId,assigned_at AS assignedAt FROM lead_staff_assignments WHERE tenant_id=? AND lead_id=?')
    .bind(tid,d.leadId).first(),
   env.CONTROL_DB.prepare(
    'SELECT m.user_id AS id,u.email AS email,m.role AS role FROM tenant_memberships m '+
    'JOIN human_users u ON u.id=m.user_id '+
    "WHERE m.tenant_id=? AND m.status='active' AND u.status='active' "+
    'ORDER BY u.email LIMIT 100'
   ).bind(tid).all()
  ]);
  if(req.method==='GET')return json({
   tenantId:tid,leadId:d.leadId,assignedUserId:assignment?.userId??null,
   assignedAt:assignment?.assignedAt??null,members:members.results,
   notice:'Staff assignment does not send calls, messages or change consent/DND.'
  });
  const original=assignment?.userId??null;
  if(original!==d.expectedUserId)return fail('assignment changed; refresh',409);
  if(d.userId!==null&&!members.results.some(x=>x.id===d.userId))
   return fail('select an active member of this company',400);
  if(d.userId===original)return json({updated:false,assignedUserId:original});
  if(d.userId===null&&!assignment)return json({updated:false,assignedUserId:null});
  const at=new Date().toISOString();
  // D1 serializes a single write and its audit in one batch; the assignment
  // can only change when it still matches the expected previous assignee.
  const rows=await db.batch([
   db.prepare(
    'INSERT INTO lead_staff_assignments(tenant_id,lead_id,user_id,assigned_by,assigned_at) '+
    'VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,lead_id) DO UPDATE SET '+
    'user_id=excluded.user_id,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at '+
    'WHERE lead_staff_assignments.user_id IS ?'
   ).bind(tid,d.leadId,d.userId,user.id,at,original),
   db.prepare(
    "INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) "+
    "SELECT ?,?,'human:'||?,'lead.staff_assigned',?,? WHERE changes()=1"
   ).bind(tid,crypto.randomUUID(),user.id,d.leadId,at)
  ]);
  if(Number(rows[0]?.meta?.changes)!==1||Number(rows[1]?.meta?.changes)!==1)
   return fail('assignment changed; refresh',409);
  return json({updated:true,assignedUserId:d.userId,
   notice:'CRM assignment saved. No notifications, messages or calls sent.'});
 }catch(e){
  if(/invalid|too large|JSON/i.test(String(e?.message||'')))return fail('invalid staff assignment',400);
  console.error('AR3D staff assignment unavailable');
  return fail('staff assignment temporarily unavailable',503);
 }
}
