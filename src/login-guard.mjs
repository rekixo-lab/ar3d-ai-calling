// Enforces a bounded login-attempt budget per Cloudflare-verified client IP.
// Stores only a keyed HMAC digest, never the original IP address.
// An application-level safeguard, not a replacement for an edge WAF/rate limiter.
export const LOGIN_WINDOW_MS=15*60*1000;
export const LOGIN_MAX_ATTEMPTS=60;
export const LOGIN_BLOCK_MS=15*60*1000;

export function validCloudflareIp(ip){
  if(typeof ip!=='string'||ip.length<3||ip.length>45||ip.includes('%'))return false;
  if(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip))
    return ip.split('.').every(v=>Number(v)<=255);
  // Cloudflare sets CF-Connecting-IP; never trust user-supplied X-Forwarded-For.
  return ip.includes(':') && /^[0-9a-fA-F:.]+$/.test(ip) &&
    [...ip].filter(v=>v===':').length>=2;
}

export async function anonymizeIp(ip,secret){
  if(!validCloudflareIp(ip)||typeof secret!=='string'||secret.length<32)
    throw Error('login rate limit configuration unavailable');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const raw=new Uint8Array(await crypto.subtle.sign('HMAC',key,
    new TextEncoder().encode('ar3d-login-ip-v1:'+ip)));
  return Array.from(raw,b=>b.toString(16).padStart(2,'0')).join('');
}

export async function reserveLoginAttempt(req,env,timestamp=Date.now()){
  const secret=env.LOGIN_RATE_LIMIT_SECRET,ip=req.headers.get('cf-connecting-ip');
  // Fail closed rather than silently disabling throttling after a misdeployment.
  if(typeof secret!=='string'||secret.length<32||!validCloudflareIp(ip))
    return {allowed:false,status:503,error:'login security unavailable'};
  const hash=await anonymizeIp(ip,secret);
  const cutoff=timestamp-LOGIN_WINDOW_MS;
  // Atomic SQLite UPSERT, including concurrent attempts to the same hashed IP.
  const sql=[
    'INSERT INTO human_ip_login_limits(ip_hash,attempt_count,window_start,blocked_until)',
    'VALUES(?,1,?,0)',
    'ON CONFLICT(ip_hash) DO UPDATE SET',
    'attempt_count=CASE WHEN human_ip_login_limits.window_start<=? THEN 1 ELSE human_ip_login_limits.attempt_count+1 END,',
    'window_start=CASE WHEN human_ip_login_limits.window_start<=? THEN ? ELSE human_ip_login_limits.window_start END,',
    'blocked_until=CASE WHEN human_ip_login_limits.blocked_until>? THEN human_ip_login_limits.blocked_until',
    'WHEN human_ip_login_limits.window_start<=? THEN 0',
    'WHEN human_ip_login_limits.attempt_count>=? THEN ? ELSE 0 END',
    'RETURNING attempt_count,blocked_until'
  ].join(' ');
  const state=await env.CONTROL_DB.prepare(sql).bind(
    hash,timestamp,cutoff,cutoff,timestamp,timestamp,cutoff,LOGIN_MAX_ATTEMPTS,timestamp+LOGIN_BLOCK_MS
  ).first();
  if(!state||!Number.isSafeInteger(state.attempt_count)||!Number.isFinite(state.blocked_until))
    throw Error('invalid login rate limit state');
  if(state.blocked_until>timestamp)
    return {allowed:false,status:429,error:'too many login attempts; try later'};
  return {allowed:true};
}
