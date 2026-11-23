// Super Admin client-access review and audited revocation.
// No credentials or invitation tokens are returned; no CRM or telecom writes.
import {mutationOriginAllowed} from './human-auth.mjs';
import {parseJsonBody} from './core.mjs';

const UUID='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const overview=new RegExp('^/v1/human/tenants/('+UUID+')/access$','i');
const member=new RegExp('^/v1/human/tenants/('+UUID+')/members/([a-zA-Z0-9-]{1,64})/disable$','i');
const invite=new RegExp('^/v1/human/tenants/('+UUID+')/invitations/([1-9][0-9]{0,15})/revoke$','i');
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(error,status=400)=>json({error},status);

async function reasonFrom(req){
  if(Number(req.headers.get('content-length'))>1024||!req.body)throw Error('invalid request body');
  const reader=req.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,value='';
  try{
    while(true){
      const {done,value:part}=await reader.read();
      if(done)break;
      bytes+=part.byteLength;
      if(bytes>1024){await reader.cancel();throw Error('invalid request body')}
      value+=decoder.decode(part,{stream:true});
    }
    value+=decoder.decode();
  }finally{reader.releaseLock()}
  const body=parseJsonBody(value,1024);
  const reason=body?.reason;
  if(Object.keys(body).length!==1||typeof reason!=='string'||
     reason.trim().length<10||reason.trim().length>240||/[\u0000-\u001f\u007f]/u.test(reason))
    throw Error('reason must be 10-240 printable characters');
  return reason.trim();
}

async function currentMfa(db,user){
  if(!/^[a-f0-9]{64}$/.test(user?.token_hash||''))return false;
  return Boolean(await db.prepare(`SELECT m.user_id FROM human_mfa_settings m
    JOIN human_sessions s ON s.user_id=m.user_id
    WHERE m.user_id=? AND m.enabled_at IS NOT NULL AND s.token_hash=?
    AND s.created_at>=m.enabled_at AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1`)
    .bind(user.id,user.token_hash,Date.now()).first());
}

export async function handleClientAccessRequest(req,env,user){
  const path=new URL(req.url).pathname;
  const view=path.match(overview),disable=path.match(member),revoke=path.match(invite);
  if(!view&&!disable&&!revoke)return null;
  if(user?.globalRole!=='super_admin')return fail('forbidden',403);
  if((view&&req.method!=='GET')||(!view&&req.method!=='POST'))return fail('method not allowed',405);
  if(!view&&!mutationOriginAllowed(req))return fail('same-origin request required',403);
  const db=env.CONTROL_DB,tid=(view||disable||revoke)[1];
  const tenant=await db.prepare('SELECT id,display_name,status FROM tenants WHERE id=?')
    .bind(tid).first();
  if(!tenant)return fail('client not found',404);

  if(view){
    const members=await db.prepare(`SELECT m.user_id AS id,u.email,m.role,m.status,m.created_at AS createdAt
      FROM tenant_memberships m JOIN human_users u ON u.id=m.user_id
      WHERE m.tenant_id=? ORDER BY u.email`).bind(tid).all();
    const pending=await db.prepare(`SELECT rowid AS id,email,role,expires_at AS expiresAt
      FROM human_invitations WHERE tenant_id=? AND redeemed_at IS NULL
      AND expires_at>? ORDER BY created_at DESC`).bind(tid,Date.now()).all();
    return json({client:{id:tenant.id,name:tenant.display_name,status:tenant.status},
      members:members.results, pendingInvitations:pending.results});
  }

  if(!await currentMfa(db,user))return fail('current_super_admin_mfa_required',403);
  let reason;
  try{reason=await reasonFrom(req)}catch{return fail('reason must be 10-240 printable characters',400)}
  const at=new Date().toISOString(),detail=JSON.stringify({reason});
  if(disable){
    const id=disable[2];
    const target=await db.prepare(`SELECT u.email FROM tenant_memberships m
      JOIN human_users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='active'`)
      .bind(tid,id).first();
    if(!target)return fail('active member not found; refresh',409);
    const result=await db.batch([
      db.prepare("UPDATE tenant_memberships SET status='disabled' WHERE tenant_id=? AND user_id=? AND status='active'").bind(tid,id),
      // Prevent an already-issued invitation from instantly undoing this revocation.
      db.prepare('UPDATE human_invitations SET expires_at=0 WHERE tenant_id=? AND email=? AND redeemed_at IS NULL AND expires_at>?')
        .bind(tid,target.email,Date.now()),
      db.prepare(`INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,detail_json,created_at)
        VALUES(?,?,?,'client.member_disabled',?,?,?)`)
        .bind(crypto.randomUUID(),tid,user.id,id,detail,at)
    ]);
    if(Number(result[0]?.meta?.changes)!==1)return fail('member changed; refresh',409);
    return json({ok:true,status:'disabled',notice:'Company access removed for this member; other clients are unchanged.'});
  }
  const invitationId=Number(revoke[2]);
  if(!Number.isSafeInteger(invitationId))return fail('invalid invitation',400);
  const result=await db.batch([
    db.prepare(`UPDATE human_invitations SET expires_at=0
      WHERE rowid=? AND tenant_id=? AND redeemed_at IS NULL AND expires_at>?`)
      .bind(invitationId,tid,Date.now()),
    db.prepare(`INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,detail_json,created_at)
      SELECT ?,? ,?,'client.invitation_revoked',token_hash,?,?
      FROM human_invitations WHERE rowid=? AND tenant_id=? AND expires_at=0 AND redeemed_at IS NULL`)
      .bind(crypto.randomUUID(),tid,user.id,detail,at,invitationId,tid)
  ]);
  if(Number(result[0]?.meta?.changes)!==1)return fail('pending invitation not found; refresh',409);
  return json({ok:true,status:'revoked',notice:'Invitation revoked; the private link can no longer activate access.'});
}
