// TOTP MFA for super admins: encrypted-at-rest RFC6238 credentials.
// This module does not provide account recovery. Only enable with a recovery plan.
import {sha256hex} from './core.mjs';
import {randomSecret,newSession,cookieFor,readCookie} from './human-auth.mjs';
import {reserveLoginAttempt} from './login-guard.mjs';
import {createRecoveryCodes,recoveryHash,codeStatements,validRecoveryCode} from './mfa-recovery.mjs';
import {checkPassword} from './human-auth.mjs';

const encoder=new TextEncoder();
const CHALLENGE_MS=5*60*1000;
const PENDING_MS=10*60*1000;
const A='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const toBytes=h=>Uint8Array.from(h.match(/../g)||[],x=>parseInt(x,16));
const json=(v,status=200,headers={})=>Response.json(v,{status,headers:{'Cache-Control':'no-store',...headers}});
const fail=(msg,status=400)=>json({error:msg},status);
export const mfaConfigured=env=>typeof env.MFA_ENCRYPTION_KEY==='string'&&env.MFA_ENCRYPTION_KEY.length>=32;
export function base32(value){let buf=0,bits=0,out='';for(const v of value){buf=(buf<<8)|v;bits+=8;while(bits>=5){bits-=5;out+=A[(buf>>bits)&31]}}if(bits)out+=A[(buf<<(5-bits))&31];return out}
async function encryptionKey(env){
  if(!mfaConfigured(env))throw Error('MFA encryption key missing');
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode('ar3d:mfa:v1:'+env.MFA_ENCRYPTION_KEY));
  return crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function encryptSecret(secret,env){
  if(!(secret instanceof Uint8Array)||secret.length!==20)throw Error('invalid TOTP secret');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(env),secret);
  return {secret_iv:hex(iv),secret_ciphertext:hex(new Uint8Array(ciphertext))};
}
export async function decryptSecret(row,env){
  if(!/^[a-f0-9]{24}$/i.test(row?.secret_iv)||!/^[a-f0-9]{72}$/i.test(row?.secret_ciphertext))
    throw Error('invalid encrypted TOTP secret');
  const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:toBytes(row.secret_iv)},await encryptionKey(env),toBytes(row.secret_ciphertext));
  const secret=new Uint8Array(decrypted);if(secret.length!==20)throw Error('invalid decrypted TOTP secret');return secret;
}
export async function totpAt(secret,step){
  if(!(secret instanceof Uint8Array)||secret.length<16||!Number.isSafeInteger(step)||step<0)throw Error('invalid TOTP input');
  const counter=new Uint8Array(8),dv=new DataView(counter.buffer);
  dv.setUint32(0,Math.floor(step/2**32));dv.setUint32(4,step>>>0);
  const key=await crypto.subtle.importKey('raw',secret,{name:'HMAC',hash:'SHA-1'},false,['sign']);
  const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,counter)),offset=mac[19]&15;
  const n=((mac[offset]&127)<<24)|(mac[offset+1]<<16)|(mac[offset+2]<<8)|mac[offset+3];
  return String((n>>>0)%1000000).padStart(6,'0');
}
export async function verifyTotp(secret,code,lastStep=-1,now=Date.now()){
  if(typeof code!=='string'||!/^[0-9]{6}$/.test(code)||!Number.isSafeInteger(lastStep))return null;
  const step=Math.floor(now/30000);
  for(const candidate of [step-1,step,step+1])
    if(candidate>=0&&candidate>lastStep&&await totpAt(secret,candidate)===code)return candidate;
  return null;
}
export async function challengeAfterPassword(db,user,env){
  if(!mfaConfigured(env))return fail('MFA security secret unavailable',503);
  const token=randomSecret(),hash=await sha256hex(token),now=Date.now();
  await db.prepare('INSERT INTO human_mfa_challenges(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
    .bind(hash,user.id,new Date(now).toISOString(),now+CHALLENGE_MS).run();
  return json({mfaRequired:true,challenge:token,expiresInSeconds:300});
}
export async function finishMfaLogin(req,env,body){
  const gate=await reserveLoginAttempt(req,env);if(!gate.allowed)return fail(gate.error,gate.status);
  const isTotp=typeof body?.code==='string'&&/^[0-9]{6}$/.test(body.code);
  const isRecovery=validRecoveryCode(body?.recoveryCode);
  if(typeof body?.challenge!=='string'||!/^[a-f0-9]{64}$/.test(body.challenge)||
     (isTotp===isRecovery)||Object.keys(body).some(k=>!['challenge','code','recoveryCode'].includes(k))||
     (isTotp&&body.recoveryCode!==undefined)||(isRecovery&&body.code!==undefined))
    return fail('invalid MFA challenge or code',400);
  if(!mfaConfigured(env))return fail('MFA security secret unavailable',503);
  const db=env.CONTROL_DB,now=Date.now(),hash=await sha256hex(body.challenge);
  const row=await db.prepare(`SELECT c.user_id,c.attempts,m.secret_ciphertext,m.secret_iv,m.last_used_step
    FROM human_mfa_challenges c JOIN human_mfa_settings m ON m.user_id=c.user_id AND m.enabled_at IS NOT NULL
    JOIN human_users u ON u.id=c.user_id AND u.status='active'
    WHERE c.token_hash=? AND c.consumed_at IS NULL AND c.expires_at>? AND c.attempts<5 LIMIT 1`)
    .bind(hash,now).first();
  if(!row)return fail('invalid or expired MFA challenge',401);
  const at=new Date(now).toISOString();
  let firstUpdate;
  if(isTotp){
    const codeStep=await verifyTotp(await decryptSecret(row,env),body.code,row.last_used_step,now);
    if(codeStep!==null)
      firstUpdate=db.prepare('UPDATE human_mfa_settings SET last_used_step=? WHERE user_id=? AND enabled_at IS NOT NULL AND last_used_step<?')
        .bind(codeStep,row.user_id,codeStep);
  }else{
    const codeHash=await recoveryHash(env,row.user_id,body.recoveryCode);
    firstUpdate=db.prepare(`UPDATE human_mfa_recovery_codes SET used_at=?
      WHERE user_id=? AND code_hash=? AND used_at IS NULL
      AND EXISTS (SELECT 1 FROM human_mfa_settings WHERE user_id=? AND enabled_at IS NOT NULL)`)
      .bind(at,row.user_id,codeHash,row.user_id);
  }
  if(!firstUpdate){
    await db.prepare('UPDATE human_mfa_challenges SET attempts=attempts+1 WHERE token_hash=? AND consumed_at IS NULL AND attempts<5')
      .bind(hash).run();
    return fail('invalid MFA code',401);
  }
  const updates=await db.batch([
    firstUpdate,
    db.prepare('UPDATE human_mfa_challenges SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND expires_at>? AND attempts<5')
      .bind(at,hash,now)
  ]);
  if(Number(updates[0]?.meta?.changes)!==1){
    await db.prepare('UPDATE human_mfa_challenges SET attempts=attempts+1 WHERE token_hash=? AND consumed_at IS NULL AND attempts<5')
      .bind(hash).run();
    return fail(isTotp?'MFA challenge already consumed':'invalid or used MFA code',isTotp?409:401);
  }
  if(Number(updates[1]?.meta?.changes)!==1)
    return fail('MFA challenge already consumed',409);
  const token=await newSession(db,row.user_id);
  return json({ok:true},200,{'Set-Cookie':cookieFor(token)});
}
export async function handleMfaSettings(req,env,user,body){
  if(user?.globalRole!=='super_admin')return fail('forbidden',403);
  const path=new URL(req.url).pathname,db=env.CONTROL_DB;
  if(path==='/v1/human/mfa'&&req.method==='GET'){
    const row=await db.prepare('SELECT enabled_at FROM human_mfa_settings WHERE user_id=?').bind(user.id).first();
    return json({enabled:Boolean(row?.enabled_at),configured:mfaConfigured(env)});
  }
  if(path==='/v1/human/mfa/setup'&&req.method==='POST'){
    if(!mfaConfigured(env))return fail('MFA security secret unavailable',503);
    const row=await db.prepare('SELECT enabled_at FROM human_mfa_settings WHERE user_id=?').bind(user.id).first();
    if(row?.enabled_at)return fail('MFA already enabled',409);
    const secret=crypto.getRandomValues(new Uint8Array(20)),encrypted=await encryptSecret(secret,env),at=new Date().toISOString();
    await db.prepare(`INSERT INTO human_mfa_settings
      (user_id,secret_ciphertext,secret_iv,pending_expires_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
      secret_ciphertext=excluded.secret_ciphertext,secret_iv=excluded.secret_iv,
      pending_expires_at=excluded.pending_expires_at,updated_at=excluded.updated_at
      WHERE human_mfa_settings.enabled_at IS NULL`)
      .bind(user.id,encrypted.secret_ciphertext,encrypted.secret_iv,Date.now()+PENDING_MS,at,at).run();
    const label=encodeURIComponent('AR3D AI Calling:'+user.email),base=base32(secret);
    const otpauthUri='otpauth://totp/'+label+'?secret='+base+'&issuer='+encodeURIComponent('AR3D AI Calling')+'&algorithm=SHA1&digits=6&period=30';
    return json({secret:base,otpauthUri,expiresInSeconds:600,
      notice:'Keep your authenticator secure; recovery codes will be shown once after confirming MFA.'});
  }
  if(path==='/v1/human/mfa/enable'&&req.method==='POST'){
    if(typeof body?.code!=='string'||!/^[0-9]{6}$/.test(body.code))return fail('invalid MFA code',400);
    if(!mfaConfigured(env))return fail('MFA security secret unavailable',503);
    const now=Date.now();
    const row=await db.prepare(`SELECT secret_ciphertext,secret_iv,last_used_step FROM human_mfa_settings
      WHERE user_id=? AND enabled_at IS NULL AND pending_expires_at>?`).bind(user.id,now).first();
    if(!row)return fail('MFA setup missing or expired',409);
    const step=await verifyTotp(await decryptSecret(row,env),body.code,row.last_used_step,now);
    if(step===null)return fail('invalid MFA code',401);
    const at=new Date(now).toISOString(),session=readCookie(req),keep=session?await sha256hex(session):'';
    const generation=crypto.randomUUID(),codes=createRecoveryCodes();
    const inserts=await codeStatements(db,env,user.id,codes,generation,at);
    const results=await db.batch([
      db.prepare(`UPDATE human_mfa_settings SET enabled_at=?,pending_expires_at=NULL,last_used_step=?,updated_at=?,recovery_generation_id=?
        WHERE user_id=? AND enabled_at IS NULL AND pending_expires_at>? AND last_used_step<?`)
        .bind(at,step,at,generation,user.id,now,step),
      ...inserts,
      db.prepare('UPDATE human_sessions SET revoked_at=? WHERE user_id=? AND token_hash<>? AND revoked_at IS NULL')
        .bind(at,user.id,keep)
    ]);
    if(Number(results[0]?.meta?.changes)!==1||results.slice(1,1+codes.length).some(r=>Number(r?.meta?.changes)!==1))
      return fail('MFA setup already finalized',409);
    return json({ok:true,enabled:true,recoveryCodes:codes,
      notice:'Save these one-time backup codes now; the server will never show them again.'});
  }
  if(path==='/v1/human/mfa/recovery/regenerate'&&req.method==='POST'){
    if(!mfaConfigured(env))return fail('MFA security secret unavailable',503);
    if(typeof body?.password!=='string'||body.password.length>128||
       typeof body?.code!=='string'||!/^[0-9]{6}$/.test(body.code)||
       Object.keys(body).some(k=>!['password','code'].includes(k)))
      return fail('invalid recovery rotation credentials',400);
    // A stolen session alone cannot replace recovery codes. Require both
    // the current password and an unused authenticator timestep.
    const gate=await reserveLoginAttempt(req,env);if(!gate.allowed)return fail(gate.error,gate.status);
    const account=await db.prepare("SELECT * FROM human_users WHERE id=? AND status='active'").bind(user.id).first();
    if(!await checkPassword(body.password,account))return fail('invalid credentials',401);
    const existing=await db.prepare(`SELECT secret_ciphertext,secret_iv,last_used_step FROM human_mfa_settings
      WHERE user_id=? AND enabled_at IS NOT NULL`).bind(user.id).first();
    if(!existing)return fail('MFA is not enabled',409);
    const step=await verifyTotp(await decryptSecret(existing,env),body.code,existing.last_used_step);
    if(step===null)return fail('invalid authenticator code',401);
    const at=new Date().toISOString(),generation=crypto.randomUUID(),codes=createRecoveryCodes();
    const inserts=await codeStatements(db,env,user.id,codes,generation,at);
    const results=await db.batch([
      db.prepare(`UPDATE human_mfa_settings SET recovery_generation_id=?,last_used_step=?,updated_at=?
        WHERE user_id=? AND enabled_at IS NOT NULL AND last_used_step<?`)
        .bind(generation,step,at,user.id,step),
      db.prepare(`DELETE FROM human_mfa_recovery_codes WHERE user_id=? AND EXISTS
        (SELECT 1 FROM human_mfa_settings WHERE user_id=? AND recovery_generation_id=?)`)
        .bind(user.id,user.id,generation),
      ...inserts
    ]);
    if(Number(results[0]?.meta?.changes)!==1||results.slice(2).some(r=>Number(r?.meta?.changes)!==1))
      return fail('MFA code already used; retry with a new code',409);
    return json({ok:true,recoveryCodes:codes,notice:'All previous recovery codes are invalidated.'});
  }
  return fail('method not allowed',405);
}
