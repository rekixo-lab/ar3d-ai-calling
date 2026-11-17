import {sha256hex} from './core.mjs';

export const SESSION_MS=8*60*60*1000;
export const ITERATIONS=240000;
export const COOKIE='ar3d_calling_session';
const encoder=new TextEncoder();
export function validEmail(value){
  const v=String(value||'').trim().toLowerCase();
  if(v.length>254||!/^[^\s@<>]{1,64}@[^\s@<>]{1,180}\.[^\s@<>]{2,}$/.test(v))throw Error('invalid email');
  return v;
}
export function validPassword(value){
  if(typeof value!=='string'||value.length<12||value.length>128)throw Error('password must be 12–128 characters');
  return value;
}
export function randomSecret(){
  return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
}
function hex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}
export async function passwordDigest(password,saltHex,iterations=ITERATIONS){
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const salt=Uint8Array.from(saltHex.match(/.{2}/g).map(x=>parseInt(x,16)));
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations},key,256);
  return hex(new Uint8Array(bits));
}
export async function makePassword(password){
  validPassword(password);
  const salt=hex(crypto.getRandomValues(new Uint8Array(16)));
  return {salt,hash:await passwordDigest(password,salt),iterations:ITERATIONS};
}
export async function checkPassword(password,user){
  if(typeof password!=='string'||password.length>128||!user)return false;
  const expected=String(user.password_hash||'');
  if(!/^[a-f0-9]{64}$/.test(expected)||!/^[a-f0-9]{32}$/.test(user.password_salt)||user.password_iterations<200000)return false;
  const hash=await passwordDigest(password,user.password_salt,user.password_iterations);
  let delta=0;for(let i=0;i<64;i++)delta|=hash.charCodeAt(i)^expected.charCodeAt(i);
  return delta===0;
}
export function cookieFor(value,maxAge=SESSION_MS/1000){
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(maxAge)}`;
}
export function readCookie(req){
  const row=(req.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='));
  return row?.slice(COOKIE.length+1)||'';
}
export function mutationOriginAllowed(req){
  if(!['POST','PATCH','PUT','DELETE'].includes(req.method))return true;
  try{return Boolean(req.headers.get('origin'))&&new URL(req.headers.get('origin')).origin===new URL(req.url).origin}
  catch{return false}
}
export async function getSession(req,db){
  const token=readCookie(req);
  if(!/^[a-f0-9]{64}$/.test(token))return null;
  const digest=await sha256hex(token);
  return db.prepare(`SELECT s.token_hash,u.id,u.email,u.global_role AS globalRole
    FROM human_sessions s JOIN human_users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?
      AND u.status='active' LIMIT 1`).bind(digest,Date.now()).first();
}
export async function newSession(db,userId){
  const token=randomSecret(),digest=await sha256hex(token),createdAt=new Date().toISOString();
  await db.prepare('INSERT INTO human_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
    .bind(digest,userId,createdAt,Date.now()+SESSION_MS).run();
  return token;
}
export async function requireMembership(db,user,tenantId,write=false){
  if(!user||typeof tenantId!=='string'||!/^[a-f0-9-]{36}$/i.test(tenantId))return null;
  const row=await db.prepare(`SELECT m.role,t.id AS tenant_id,t.slug,t.display_name,t.plan_code,
    t.storage_mode,t.dedicated_binding,t.status
    FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id
    WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status IN ('trial','active') LIMIT 1`)
    .bind(tenantId,user.id).first();
  if(!row||(write&&row.role!=='client_admin'))return null;
  return row;
}
export async function userSummary(db,user){
  const rows=await db.prepare(`SELECT t.id,t.slug,t.display_name AS name,t.plan_code AS plan,
    t.storage_mode AS storageMode,m.role
    FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id
    WHERE m.user_id=? AND m.status='active' AND t.status IN ('trial','active') ORDER BY t.display_name`)
    .bind(user.id).all();
  return {id:user.id,email:user.email,superAdmin:user.globalRole==='super_admin',tenants:rows.results};
}
