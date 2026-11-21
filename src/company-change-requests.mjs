// Minimal tenant-scoped change-request inbox. A request never edits company
// facts, script versions, publication, consent or calling policy by itself.
import {requireMembership,mutationOriginAllowed} from './human-auth.mjs';
import {parseJsonBody} from './core.mjs';
const ROOT='/v1/human/company-change-requests';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const json=(x,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(error,status=400)=>json({error},status);

async function read(req){
 if(!req.body||!req.headers.get('content-type')?.startsWith('application/json'))throw Error('invalid_json');
 if(Number(req.headers.get('content-length'))>3000)throw Error('body_too_large');
 const reader=req.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 let text='',size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
  if(size>3000){await reader.cancel();throw Error('body_too_large')}
  text+=decoder.decode(value,{stream:true})}text+=decoder.decode()}
 finally{reader.releaseLock()}
 return parseJsonBody(text,3000);
}
async function freshAdmin(db,user,now){
 if(user?.globalRole!=='super_admin')return false;
 return !!await db.prepare('SELECT m.enabled_at FROM human_mfa_settings m JOIN human_sessions s ON s.user_id=m.user_id WHERE m.user_id=? AND s.token_hash=? AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1')
  .bind(user.id,user.token_hash,now).first();
}
const printable=x=>typeof x==='string'&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(x);
export async function handleCompanyChangeRequests(req,env,user,{now=Date.now()}={}){
 const path=new URL(req.url).pathname,action=path.match(/^\/v1\/human\/company-change-requests\/([a-f0-9-]{36})\/resolve$/i);
 if(path!==ROOT&&!action)return null;
 if(!['GET','POST'].includes(req.method)||action&&req.method!=='POST'||!action&&req.method==='GET'&&path!==ROOT)return fail('method_not_allowed',405);
 if(req.method==='POST'&&!mutationOriginAllowed(req))return fail('same_origin_required',403);
 try{
  const d=req.method==='GET'?Object.fromEntries(new URL(req.url).searchParams):await read(req);
  if(!d||typeof d!=='object'||Array.isArray(d)||!UUID.test(d.tenantId||''))return fail('invalid_tenant');
  const db=env.CONTROL_DB,admin=user?.globalRole==='super_admin',at=new Date(now).toISOString();
  if(admin){
   if(!await freshAdmin(db,user,now))return fail('current_super_admin_mfa_required',403);
   if(!await db.prepare("SELECT id FROM tenants WHERE id=? AND status IN('trial','active')").bind(d.tenantId).first())
    return fail('tenant_unavailable',404);
  }else{
   const member=await requireMembership(db,user,d.tenantId,req.method==='POST');
   if(!member)return fail('forbidden',403);
  }
  if(req.method==='GET'){
   if(Object.keys(d).some(k=>k!=='tenantId'))return fail('invalid_query');
   const records=await db.prepare(
    'SELECT id,message,status,created_at AS createdAt,handled_at AS handledAt,resolution_note AS resolutionNote '+
    'FROM company_change_requests WHERE tenant_id=? ORDER BY created_at DESC,id DESC LIMIT 50'
   ).bind(d.tenantId).all();
   return json({requests:records.results,canResolve:admin,
     notice:'Requests do not change approved facts or the published AI agent.'});
  }
  if(action){
   if(!admin)return fail('super_admin_required',403);
   if(!UUID.test(action[1])||Object.keys(d).some(k=>!['tenantId','status','resolutionNote'].includes(k))||
      !['handled','dismissed'].includes(d.status)||
      d.resolutionNote!==undefined&&(!printable(d.resolutionNote)||d.resolutionNote.length>500))
    return fail('invalid_resolution');
   const note=String(d.resolutionNote||'').trim();
   const result=await db.batch([
    db.prepare("UPDATE company_change_requests SET status=?,handled_by=?,handled_at=?,resolution_note=? WHERE tenant_id=? AND id=? AND status='pending'")
     .bind(d.status,user.id,at,note||null,d.tenantId,action[1]),
    db.prepare("INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,detail_json,created_at) SELECT ?,?,'human:'||?,'company.request_'||?,id,?,? FROM company_change_requests WHERE tenant_id=? AND id=? AND handled_at=? AND handled_by=?")
     .bind(crypto.randomUUID(),d.tenantId,user.id,d.status,JSON.stringify({note:note.slice(0,150)}),at,d.tenantId,action[1],at,user.id)
   ]);
   return Number(result[0]?.meta?.changes)===1&&Number(result[1]?.meta?.changes)===1?
    json({ok:true,status:d.status,notice:'Request closed; company/AI changes must be saved and published separately.'}):
    fail('request_already_handled_or_changed',409);
  }
  if(admin)return fail('client_request_only',403);
  if(Object.keys(d).some(k=>!['tenantId','message'].includes(k))||
    !printable(d.message)||d.message.trim().length<15||d.message.trim().length>1200)return fail('message_must_be_15_to_1200_characters');
  const message=d.message.trim(),id=crypto.randomUUID(),since=new Date(now-60_000).toISOString();
  const result=await db.batch([
   db.prepare("INSERT INTO company_change_requests(tenant_id,id,message,created_by,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM company_change_requests WHERE tenant_id=? AND status='pending')<3 AND NOT EXISTS(SELECT 1 FROM company_change_requests WHERE tenant_id=? AND created_by=? AND created_at>=?)")
    .bind(d.tenantId,id,message,user.id,at,d.tenantId,d.tenantId,user.id,since),
   db.prepare("INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,created_at) SELECT ?,?,'human:'||?,'company.change_requested',id,? FROM company_change_requests WHERE tenant_id=? AND id=?")
    .bind(crypto.randomUUID(),d.tenantId,user.id,at,d.tenantId,id)
  ]);
  return Number(result[0]?.meta?.changes)===1&&Number(result[1]?.meta?.changes)===1?
   json({id,status:'pending',notice:'Request sent to Super Admin; current AI information has not changed.'},201):
   fail('request_limit_or_retry_later',429);
 }catch(e){
  const error=String(e?.message||'');
  if(/invalid|too_large|JSON|body/i.test(error))return fail(error);
  return fail('company_request_unavailable',503);
 }
}
