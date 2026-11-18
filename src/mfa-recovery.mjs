// One-time Super Admin backup codes. A code is a 128-bit random secret;
// only a user-scoped, key-dependent HMAC digest is saved in Control D1.
// Recovery does NOT reset a password or grant MFA enrollment permissions.
const prefix='AR3D-';
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
export const RECOVERY_CODE_COUNT=8;

export function validRecoveryCode(raw){
  return typeof raw==='string' && /^AR3D-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/i.test(raw.trim());
}
export function normalizeRecoveryCode(raw){
  return validRecoveryCode(raw)?raw.trim().toUpperCase():null;
}
export function createRecoveryCodes(count=RECOVERY_CODE_COUNT){
  if(!Number.isSafeInteger(count)||count<1||count>16)throw Error('invalid recovery code count');
  const codes=[];
  for(let i=0;i<count;i++){
    const raw=hex(crypto.getRandomValues(new Uint8Array(16)));
    codes.push(prefix+raw.match(/.{4}/g).join('-'));
  }
  if(new Set(codes).size!==codes.length)throw Error('duplicate random recovery code');
  return codes;
}
export async function recoveryHash(env,userId,code){
  const canonical=normalizeRecoveryCode(code);
  if(typeof env?.MFA_ENCRYPTION_KEY!=='string'||env.MFA_ENCRYPTION_KEY.length<32||!canonical||typeof userId!=='string'||!userId)
    throw Error('invalid MFA recovery configuration');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.MFA_ENCRYPTION_KEY),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const message=new TextEncoder().encode('ar3d:mfa:recovery:v1:'+userId+':'+canonical);
  const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,message));
  return Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
}
export async function codeStatements(db,env,userId,codeList,generationId,createdAt){
  // Each INSERT is conditional on this unique generation ID. If MFA enable or
  // rotation lost a race, it cannot insert codes for another generation.
  const hashes=await Promise.all(codeList.map(code=>recoveryHash(env,userId,code)));
  return hashes.map(hash=>db.prepare(`INSERT INTO human_mfa_recovery_codes(user_id,code_hash,created_at)
    SELECT user_id,?,? FROM human_mfa_settings WHERE user_id=? AND recovery_generation_id=?`)
    .bind(hash,createdAt,userId,generationId));
}
