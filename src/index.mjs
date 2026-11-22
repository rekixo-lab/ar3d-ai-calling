import {handleScriptedPhoneCallback} from './scripted-phone-pilot.mjs';
import {handleHumanRequest} from './human-routes.mjs';
import {handleCallingCron} from './calling-schedule.mjs';
import {
  checkSlug,checkName,checkStorageMode,normalizeIndianPhone,
  resolveCrmDb,newApiKey,sha256hex,parseJsonBody,SOURCES
} from './core.mjs';

const json=(body,status=200)=>Response.json(body,{status,headers:{
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'
}});
const fail=(message,status=400)=>json({error:message},status);
const now=()=>new Date().toISOString();
const bearer=(req)=>(req.headers.get('authorization')||'').match(/^Bearer (.+)$/i)?.[1]||'';
const isPost=(r)=>r.method==='POST';
const isGet=(r)=>r.method==='GET';
const allowedOrigin=(r)=>{
  // Machine API Bearer requests may omit Origin, but malformed or cross-site
  // Origin headers must fail closed rather than throwing outside fetch's catch.
  if(!r.headers.has('origin'))return true;
  try{
    const raw=r.headers.get('origin');
    return raw!=='null'&&new URL(raw).origin===new URL(r.url).origin;
  }catch{return false}
};
async function body(req){
  const max=16384;
  if(Number(req.headers.get('content-length'))>max)throw Error('request body too large');
  const reader=req.body?.getReader();
  if(!reader)throw Error('request body required');
  const dec=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>max){await reader.cancel();throw Error('request body too large')}
      text+=dec.decode(value,{stream:true});
    }
    text+=dec.decode();
  }finally{reader.releaseLock()}
  return parseJsonBody(text,max);
}
async function adminAuth(req,env){
  if (!env.ADMIN_API_TOKEN || String(env.ADMIN_API_TOKEN).length < 32) return false;
  const token=bearer(req);
  if (!token || token.length>256) return false;
  const expected=await sha256hex(env.ADMIN_API_TOKEN), actual=await sha256hex(token);
  return expected===actual;
}
async function tenantAuth(req,env){
  const key=bearer(req);
  if(!/^ar3dca_[a-f0-9]{64}$/.test(key))return null;
  const digest=await sha256hex(key);
  const row=await env.CONTROL_DB.prepare(`
    SELECT k.id AS key_id,k.role,t.id AS tenant_id,t.slug,t.display_name,
           t.plan_code,t.storage_mode,t.dedicated_binding,t.status
    FROM tenant_keys k JOIN tenants t ON t.id=k.tenant_id
    WHERE k.token_hash=? AND k.active=1 AND t.status IN ('trial','active')
    LIMIT 1`).bind(digest).first();
  return row||null;
}
async function createTenant(req,env){
  const data=await body(req);
  const slug=checkSlug(data.slug),name=checkName(data.displayName);
  const plan=data.plan||'starter',mode=data.storageMode||'shared';
  checkStorageMode(plan,mode);
  // Creating an enterprise plan does not silently provision Cloudflare D1.
  if(mode==='dedicated' && data.dedicatedBinding)
    throw new Error('dedicated D1 bindings require separate audited provisioning');
  const id=crypto.randomUUID(),date=now();
  await env.CONTROL_DB.prepare(`INSERT INTO tenants
    (id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at)
    VALUES(?,?,?,?,?,'trial',?,?)`).bind(id,slug,name,plan,mode,date,date).run();
  return json({id,slug,displayName:name,plan,storageMode:mode,status:'trial',
    ...(mode==='dedicated'?{provisioning:'pending'}:{})},201);
}
async function createKey(req,env,tenantId){
  const tenant=await env.CONTROL_DB.prepare('SELECT id,status FROM tenants WHERE id=?').bind(tenantId).first();
  if(!tenant || !['trial','active'].includes(tenant.status))return fail('tenant unavailable',404);
  const data=await body(req);
  const name=checkName(data.name||'Client API key',80),role=data.role||'client_admin';
  if(!['client_admin','integrator'].includes(role))return fail('invalid key role');
  const key=newApiKey(),digest=await sha256hex(key),id=crypto.randomUUID();
  await env.CONTROL_DB.prepare(`INSERT INTO tenant_keys
    (id,tenant_id,token_hash,name,role,active,created_at) VALUES(?,?,?,?,?,1,?)`)
    .bind(id,tenantId,digest,name,role,now()).run();
  // Backend integration ONLY: do not put this token in a browser/mobile client.
  return json({id,tenantId,name,role,apiKey:key,notice:'shown only once; store server-side'},201);
}

async function listTenantKeys(env,tenantId){
  const tenant=await env.CONTROL_DB.prepare('SELECT id FROM tenants WHERE id=? LIMIT 1')
    .bind(tenantId).first();
  if(!tenant)return fail('tenant not found',404);
  const keys=await env.CONTROL_DB.prepare(`SELECT id,name,role,active,
    created_at AS createdAt,revoked_at AS revokedAt
    FROM tenant_keys WHERE tenant_id=? ORDER BY created_at DESC,id DESC LIMIT 100`)
    .bind(tenantId).all();
  // Never return token_hash, password material or a plaintext API key.
  return json({keys:keys.results});
}
async function revokeTenantKey(env,tenantId,keyId){
  const nowValue=now();
  // Both D1 statements are atomic. Only a currently-active key can be
  // revoked and logged; a subsequent revoke request is an idempotent no-op.
  const rows=await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(`INSERT INTO tenant_audit_events
      (id,tenant_id,actor,action,target_id,created_at)
      SELECT ?,?, 'machine_admin','tenant_key.revoked',id,?
      FROM tenant_keys WHERE tenant_id=? AND id=? AND active=1`)
      .bind(crypto.randomUUID(),tenantId,nowValue,tenantId,keyId),
    env.CONTROL_DB.prepare('UPDATE tenant_keys SET active=0,revoked_at=? WHERE tenant_id=? AND id=? AND active=1')
      .bind(nowValue,tenantId,keyId)
  ]);
  const revoked=Number(rows[1]?.meta?.changes||0)===1;
  return json({revoked,notice:revoked?
    'API key revoked. All subsequent token-authenticated requests are denied.':
    'API key not active or not found in this tenant.'});
}
async function addLead(req,env,tenant){
  const data=await body(req), mobile=normalizeIndianPhone(data.mobile),name=String(data.name||'').trim();
  if(name.length>120)return fail('lead name too long');
  const source=data.sourceType||'excel';if(!SOURCES.includes(source))return fail('invalid sourceType');
  const id=crypto.randomUUID(),date=now();
  const db=resolveCrmDb(env,tenant);
  // Deliberately NEVER interpret Excel/import as consent to call.
  await db.prepare(`INSERT INTO leads
    (tenant_id,id,name,mobile_e164,source_type,consent_status,dnd_status,created_at,updated_at)
    VALUES(?,?,?,?,?,'unknown','unknown',?,?)`)
    .bind(tenant.tenant_id,id,name,mobile,source,date,date).run();
  return json({id,mobile,name,sourceType:source,consentStatus:'unknown',dndStatus:'unknown'},201);
}
async function getLeads(req,env,tenant){
  const db=resolveCrmDb(env,tenant),url=new URL(req.url);
  const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit')||50)||50));
  const result=await db.prepare(`SELECT id,name,mobile_e164 AS mobile,source_type AS sourceType,
    consent_status AS consentStatus,dnd_status AS dndStatus,
    preferred_location AS preferredLocation,budget_min_inr AS budgetMinInr,
    budget_max_inr AS budgetMaxInr,created_at AS createdAt
    FROM leads WHERE tenant_id=? ORDER BY created_at DESC,id DESC LIMIT ?`)
    .bind(tenant.tenant_id,limit).all();
  return json({leads:result.results});
}
async function addAgent(req,env,tenant){
  if(tenant.role!=='client_admin')return fail('insufficient permission',403);
  const data=await body(req),name=checkName(data.displayName);
  const language=data.languageMode||'hi-en';
  if(!['hi','en','hi-en'].includes(language))return fail('invalid languageMode');
  if(!Array.isArray(data.questions)||data.questions.length>25||data.questions.some(q=>typeof q!=='string'||q.length>300))
    return fail('questions must be an array (up to 25 strings)');
  const id=crypto.randomUUID(),date=now();
  const db=resolveCrmDb(env,tenant);
  await db.prepare(`INSERT INTO agents
    (tenant_id,id,display_name,language_mode,questions_json,status,created_at,updated_at)
    VALUES(?,?,?,?,?,'draft',?,?)`).bind(tenant.tenant_id,id,name,language,JSON.stringify(data.questions),date,date).run();
  return json({id,displayName:name,languageMode:language,status:'draft'},201);
}
async function getAgents(req,env,tenant){
  const db=resolveCrmDb(env,tenant);
  const result=await db.prepare(`SELECT id,display_name AS displayName,language_mode AS languageMode,
    status,questions_json AS questionsJson FROM agents WHERE tenant_id=? ORDER BY created_at DESC`)
    .bind(tenant.tenant_id).all();
  return json({agents:result.results.map(a=>({id:a.id,displayName:a.displayName,
    languageMode:a.languageMode,status:a.status,questions:JSON.parse(a.questionsJson)}))});
}
export default {
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    if(path==='/health'&&isGet(req))return json({service:'AR3D AI Calling',status:'foundation'});
    const scriptedPhone=await handleScriptedPhoneCallback(req,env);
    if(scriptedPhone)return scriptedPhone;
    if(path==='/v1/provider/exotel'||path.startsWith('/v1/provider/exotel/'))return fail('provider_route_retired',410);
    const humanResponse=await handleHumanRequest(req,env);
    if(humanResponse)return humanResponse;
    if(!env.CONTROL_DB)return fail('control DB missing',503);
    if(!allowedOrigin(req))return fail('cross-origin request not allowed',403);
    try{
      if(path==='/v1/admin/tenants'&&isPost(req)){
        if(!await adminAuth(req,env))return fail('unauthorized',401);
        return await createTenant(req,env);
      }
      const match=path.match(/^\/v1\/admin\/tenants\/([a-f0-9-]{36})\/keys$/);
      if(match&&(isPost(req)||isGet(req))){
        if(!await adminAuth(req,env))return fail('unauthorized',401);
        return isGet(req)?await listTenantKeys(env,match[1]):await createKey(req,env,match[1]);
      }
      const keyMatch=path.match(/^\/v1\/admin\/tenants\/([a-f0-9-]{36})\/keys\/([a-f0-9-]{36})$/);
      if(keyMatch&&req.method==='DELETE'){
        if(!await adminAuth(req,env))return fail('unauthorized',401);
        return await revokeTenantKey(env,keyMatch[1],keyMatch[2]);
      }
      if(!path.startsWith('/v1/'))return fail('not found',404);
      const tenant=await tenantAuth(req,env);
      if(!tenant)return fail('unauthorized',401);
      if(path==='/v1/me'&&isGet(req))return json({tenant:{id:tenant.tenant_id,
        slug:tenant.slug,name:tenant.display_name,plan:tenant.plan_code,
        storageMode:tenant.storage_mode},role:tenant.role});
      if(path==='/v1/leads'&&isPost(req)){
        if(tenant.role!=='client_admin')return fail('insufficient permission',403);
        return await addLead(req,env,tenant);
      }
      if(path==='/v1/leads'&&isGet(req))return getLeads(req,env,tenant);
      if(path==='/v1/agents'&&isPost(req))return await addAgent(req,env,tenant);
      if(path==='/v1/agents'&&isGet(req))return getAgents(req,env,tenant);
      return fail('not found',404);
    }catch(e){
      const message=e instanceof Error?e.message:'unexpected error';
      if(/unique constraint/i.test(message))return fail('record already exists',409);
      if(/not provisioned|not configured/i.test(message))return fail('database is not provisioned',503);
      if(/invalid|missing|required|unsupported|too long|must|unknown|body|slug|name|storage|plan/i.test(message))
        return fail(message,400);
      console.error('AR3D AI Calling request failed',e);
      return fail('internal server error',500);
    }
  },
  async scheduled(controller,env){
    return handleCallingCron(controller,env);
  }
};
