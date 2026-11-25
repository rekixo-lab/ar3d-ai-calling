import qr from 'qrcode-generator';
import {sha256hex} from './core.mjs';
import {validEmail,checkPassword,makePassword,randomSecret} from './human-auth.mjs';
import {base32,decryptSecret,encryptSecret,verifyTotp} from './mfa.mjs';
import {codeStatements,createRecoveryCodes} from './mfa-recovery.mjs';
import {reserveLoginAttempt} from './login-guard.mjs';

const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const fail=(error,status)=>json({error},status);
const activeInvite=`i.revoked_at IS NULL AND i.expires_at>?
  AND NOT EXISTS (SELECT 1 FROM team_acceptances a WHERE a.invite_id=i.id)
  AND EXISTS (SELECT 1 FROM human_users u WHERE u.id=i.created_by AND u.global_role='super_admin' AND u.status='active')`;
const audit=(db,actor,action,target,at)=>db.prepare(
  'INSERT INTO tenant_audit_events(id,actor,action,target_id,created_at) VALUES(?,?,?,?,?)'
).bind(crypto.randomUUID(),actor,'team.'+action,target,at);

async function consumeCode(db,env,user,code){
  const row=await db.prepare('SELECT * FROM human_mfa_settings WHERE user_id=? AND enabled_at IS NOT NULL').bind(user.id).first();
  if(!row)return false;
  const step=await verifyTotp(await decryptSecret(row,env),code,row.last_used_step);
  if(step===null)return false;
  const result=await db.prepare('UPDATE human_mfa_settings SET last_used_step=? WHERE user_id=? AND last_used_step<?')
    .bind(step,user.id,step).run();
  return result.meta.changes===1;
}

export async function teamRoute(req,env,user,body){
  const db=env.CONTROL_DB,path=new URL(req.url).pathname.slice('/v1/human/team'.length);
  const at=new Date().toISOString();
  if(req.method==='POST'){
    const gate=await reserveLoginAttempt(req,env);
    if(!gate.allowed)return fail(gate.error,gate.status);
    if(path==='/setup'||path==='/accept')return enroll(env,path,body,at);
  }
  if(user?.globalRole!=='super_admin')return fail('Super Admin access required',403);
  if(req.method==='GET'&&path===''){
    const members=await db.prepare(`SELECT u.id,u.email,
      (SELECT MAX(s.created_at) FROM human_sessions s WHERE s.user_id=u.id) AS lastSignIn,
      (SELECT inviter.email FROM team_acceptances a JOIN team_invitations i ON i.id=a.invite_id
        JOIN human_users inviter ON inviter.id=i.created_by WHERE a.user_id=u.id ORDER BY a.accepted_at DESC LIMIT 1) AS invitedBy
      FROM human_users u WHERE u.global_role='super_admin' AND u.status='active' ORDER BY u.email`).all();
    const pending=await db.prepare('SELECT i.id,i.email,i.expires_at AS expiresAt,u.email AS invitedBy FROM team_invitations i JOIN human_users u ON u.id=i.created_by WHERE '+activeInvite+' ORDER BY i.created_at DESC').bind(Date.now()).all();
    return json({members:members.results,pending:pending.results});
  }
  if(req.method!=='POST'||!['/invite','/cancel','/remove'].includes(path))return fail('Unknown team action',404);
  if(!await consumeCode(db,env,user,body.code))return fail('Enter a new code from your authenticator.',403);
  if(path==='/invite'){
    const email=validEmail(body.email);
    const account=await db.prepare('SELECT global_role,status FROM human_users WHERE email=?').bind(email).first();
    if(account&&(account.global_role==='super_admin'||account.status!=='active'))return fail('Account already has access or is disabled.',409);
    const token=randomSecret(),id=crypto.randomUUID();
    const secret=await encryptSecret(crypto.getRandomValues(new Uint8Array(20)),env);
    const inserted=await db.batch([
      db.prepare(`INSERT INTO team_invitations(id,email,token_hash,created_by,created_at,expires_at,secret_iv,secret_ciphertext)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM human_users WHERE id=? AND global_role='super_admin' AND status='active')
        AND NOT EXISTS (SELECT 1 FROM human_users WHERE email=? AND (global_role='super_admin' OR status<>'active'))`)
        .bind(id,email,await sha256hex(token),user.id,at,Date.now()+86400000,secret.secret_iv,secret.secret_ciphertext,user.id,email),
      db.prepare(`UPDATE team_invitations SET revoked_at=?,secret_iv=NULL,secret_ciphertext=NULL
        WHERE email=? AND id<>? AND secret_iv IS NOT NULL AND EXISTS (SELECT 1 FROM team_invitations WHERE id=?)`).bind(at,email,id,id),
      db.prepare("INSERT INTO tenant_audit_events(id,actor,action,target_id,created_at) SELECT ?,created_by,'team.invited',email,created_at FROM team_invitations WHERE id=?").bind(crypto.randomUUID(),id)
    ]);
    if(!inserted[0].meta.changes)return fail('Account or team access changed. Refresh the list.',409);
    return json({inviteUrl:new URL(req.url).origin+'/app#team-invite='+token},201);
  }
  if(typeof body.id!=='string')return fail('Select a team member or invitation.',400);
  const eventId=crypto.randomUUID();
  const activeActor="EXISTS (SELECT 1 FROM human_users WHERE id=? AND status='active' AND global_role='super_admin')";
  const recorded='EXISTS (SELECT 1 FROM tenant_audit_events WHERE id=?)';
  if(path==='/cancel'){
    const result=await db.batch([
      db.prepare(`INSERT INTO tenant_audit_events(id,actor,action,target_id,created_at)
        SELECT ?,?,'team.cancelled',email,? FROM team_invitations WHERE id=? AND secret_iv IS NOT NULL AND `+activeActor)
        .bind(eventId,user.id,at,body.id,user.id),
      db.prepare('UPDATE team_invitations SET revoked_at=?,secret_iv=NULL,secret_ciphertext=NULL WHERE id=? AND '+recorded)
        .bind(at,body.id,eventId)
    ]);
    return result[0].meta.changes?json({ok:true}):fail('Invitation is no longer pending.',409);
  }
  // Recheck both accounts in the transaction. Two admins removing each other cannot lock everyone out.
  if(body.id===user.id)return fail('Another active Super Admin must remove your access.',409);
  const removed=await db.batch([
    db.prepare(`INSERT INTO tenant_audit_events(id,actor,action,target_id,created_at)
      SELECT ?,?,'team.removed',email,? FROM human_users WHERE id=? AND global_role='super_admin' AND status='active' AND `+activeActor)
      .bind(eventId,user.id,at,body.id,user.id),
    db.prepare("UPDATE human_users SET global_role='user',updated_at=? WHERE id=? AND "+recorded).bind(at,body.id,eventId),
    db.prepare('UPDATE human_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND '+recorded).bind(at,body.id,eventId),
    db.prepare('DELETE FROM human_mfa_challenges WHERE user_id=? AND '+recorded).bind(body.id,eventId),
    db.prepare('UPDATE team_invitations SET revoked_at=?,secret_iv=NULL,secret_ciphertext=NULL WHERE created_by=? AND secret_iv IS NOT NULL AND '+recorded)
      .bind(at,body.id,eventId)
  ]);
  return removed[0].meta.changes?json({ok:true}):fail('Team membership changed. Refresh the list.',409);
}

async function enroll(env,path,body,at){
  const db=env.CONTROL_DB,email=validEmail(body.email);
  if(!/^[a-f0-9]{64}$/.test(body.token)||typeof body.password!=='string'||body.password.length>128)return fail('Invalid invitation details.',400);
  const invite=await db.prepare('SELECT i.* FROM team_invitations i WHERE i.token_hash=? AND i.email=? AND '+activeInvite)
    .bind(await sha256hex(body.token),email,Date.now()).first();
  if(!invite)return fail('Invitation is unavailable or expired.',409);
  const account=await db.prepare('SELECT * FROM human_users WHERE email=?').bind(email).first();
  if(account&&(account.status!=='active'||account.global_role!=='user'||!await checkPassword(body.password,account)))return fail('Existing account credentials required.',403);
  if(!account&&body.password.length<12)return fail('Use a password of at least 12 characters.',400);
  const existing=account&&await db.prepare('SELECT * FROM human_mfa_settings WHERE user_id=? AND enabled_at IS NOT NULL').bind(account.id).first();
  const secret=await decryptSecret(existing||invite,env);
  if(path==='/setup'){
    if(existing)return json({existingAuthenticator:true});
    const key=base32(secret),uri='otpauth://totp/'+encodeURIComponent('AR3D AI Calling:'+email)+'?secret='+key+'&issuer=AR3D%20AI%20Calling';
    const image=qr(0,'M');image.addData(uri);image.make();
    const matrix=Array.from({length:image.getModuleCount()},(_,r)=>Array.from({length:image.getModuleCount()},(_,c)=>image.isDark(r,c)?'1':'0').join(''));
    return json({key,matrix});
  }
  const step=await verifyTotp(secret,body.code,existing?.last_used_step??-1);
  if(step===null)return fail('Enter a new code from your authenticator.',403);
  const id=account?.id||crypto.randomUUID(),generation=crypto.randomUUID();
  const codes=existing?[]:createRecoveryCodes();
  // A NULL/duplicate claim aborts the whole D1 batch, including any role/session changes.
  const accountGuard=account?"EXISTS (SELECT 1 FROM human_users WHERE id=? AND email=i.email AND password_hash=? AND global_role='user' AND status='active')":"NOT EXISTS (SELECT 1 FROM human_users WHERE email=i.email)";
  const mfaGuard=existing?' AND EXISTS (SELECT 1 FROM human_mfa_settings WHERE user_id=? AND secret_ciphertext=? AND last_used_step<?)':'';
  const claim=db.prepare('INSERT INTO team_acceptances(invite_id,user_id,accepted_at) VALUES((SELECT i.id FROM team_invitations i WHERE i.id=? AND '+activeInvite+' AND '+accountGuard+mfaGuard+'),?,?)')
    .bind(invite.id,Date.now(),...(account?[id,account.password_hash]:[]),...(existing?[id,existing.secret_ciphertext,step]:[]),id,at);
  const writes=[claim];
  if(account)writes.push(db.prepare("UPDATE human_users SET global_role='super_admin',updated_at=? WHERE id=?").bind(at,id));
  else{
    const pw=await makePassword(body.password);
    writes.push(db.prepare("INSERT INTO human_users(id,email,password_salt,password_hash,password_iterations,global_role,created_at,updated_at) VALUES(?,?,?,?,?,'super_admin',?,?)").bind(id,email,pw.salt,pw.hash,pw.iterations,at,at));
  }
  if(existing)writes.push(db.prepare('UPDATE human_mfa_settings SET last_used_step=? WHERE user_id=?').bind(step,id));
  else writes.push(db.prepare('INSERT INTO human_mfa_settings(user_id,secret_iv,secret_ciphertext,enabled_at,last_used_step,created_at,updated_at,recovery_generation_id) VALUES(?,?,?,?,?,?,?,?)')
    .bind(id,invite.secret_iv,invite.secret_ciphertext,at,step,at,at,generation),...await codeStatements(db,env,id,codes,generation,at));
  writes.push(db.prepare('DELETE FROM human_sessions WHERE user_id=?').bind(id),
    db.prepare('UPDATE team_invitations SET secret_ciphertext=NULL,secret_iv=NULL WHERE id=?').bind(invite.id),
    audit(db,id,'accepted',email,at));
  try{await db.batch(writes)}catch(err){
    if(/constraint/i.test(String(err)))return fail('Invitation or account changed. Request a fresh invitation.',409);
    throw err;
  }
  return json({ok:true,recoveryCodes:codes});
}
