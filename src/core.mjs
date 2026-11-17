export const PLANS = Object.freeze(['starter','growth','enterprise']);
export const SOURCES = Object.freeze(['excel','website','ads','referral','existing','other']);

export function checkSlug(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{2,62}$/.test(value))
    throw new Error('slug must use 3–63 lowercase letters, numbers and hyphens');
  return value;
}
export function checkName(value, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new Error(`name required (1–${max} characters)`);
  return value.trim();
}
export function normalizeIndianPhone(raw) {
  const cleaned=String(raw ?? '').replace(/[\s\-()]/g,'');
  if (/^[6-9][0-9]{9}$/.test(cleaned)) return '+91'+cleaned;
  if (/^\+91[6-9][0-9]{9}$/.test(cleaned)) return cleaned;
  if (/^\+[1-9][0-9]{7,14}$/.test(cleaned)) return cleaned;
  throw new Error('invalid E.164 mobile number');
}
export function checkStorageMode(plan, mode) {
  if (!PLANS.includes(plan)) throw new Error('unsupported plan');
  if (!['shared','dedicated'].includes(mode)) throw new Error('unsupported storage mode');
  if (plan === 'starter' && mode !== 'shared') throw new Error('starter plans use shared database');
  return { plan, mode };
}
export function safeDedicatedBinding(raw) {
  if (typeof raw !== 'string' || !/^DEDICATED_DB_[A-Z0-9_]{3,60}$/.test(raw))
    throw new Error('dedicated D1 binding missing or invalid');
  return raw;
}
export function resolveCrmDb(env, tenant) {
  if (tenant.storage_mode === 'shared') {
    if (!env.CRM_DB) throw new Error('shared CRM database is not configured');
    return env.CRM_DB;
  }
  if (tenant.storage_mode === 'dedicated') {
    const binding=safeDedicatedBinding(tenant.dedicated_binding);
    if (!env[binding]) throw new Error('dedicated CRM database is not provisioned');
    return env[binding];
  }
  throw new Error('invalid tenant storage mode');
}
// This is a conservative engineering precheck, NOT a legal authorization.
// Telecom-provider permission, subscription status, lawful call time and specific
// campaign rules must ALSO be checked before any real outgoing call is enabled.
export function inspectLeadDialEligibility(lead, number) {
  const reasons=[];
  if (lead.consent_status !== 'granted' || !lead.consent_proof || !lead.consent_at)
    reasons.push('verified consent missing');
  if (lead.dnd_status !== 'allowed') reasons.push('DND status not cleared');
  if (!number || number.status !== 'active' || number.compliance_state !== 'approved')
    reasons.push('approved caller number missing');
  return {passedPrecheck:reasons.length===0,reasons};
}
export async function sha256hex(text) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
  return Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
}
export function newApiKey() {
  const data=crypto.getRandomValues(new Uint8Array(32));
  return 'ar3dca_'+Array.from(data,b=>b.toString(16).padStart(2,'0')).join('');
}
export function parseJsonBody(raw, maxLength=65536) {
  if (raw.length>maxLength) throw new Error('request body too large');
  let obj;try{obj=JSON.parse(raw);}catch{throw new Error('invalid JSON body')}
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('expected JSON object');
  return obj;
}
