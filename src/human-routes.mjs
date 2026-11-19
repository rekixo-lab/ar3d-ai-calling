import {handleCrmRequest} from './crm-routes.mjs';
import {handlePropertyQualificationRequest} from './property-qualification-routes.mjs';
import {handleFixedVoicePreviewRequest} from './fixed-voice-preview-routes.mjs';
import {handleEngineeringRequest} from './engineering-routes.mjs';
import {handleTenantLifecycleRequest} from './tenant-lifecycle-routes.mjs';
import {handleDataPortabilityRequest} from './data-portability-routes.mjs';
import {handleAgentSettingsRequest} from './agent-settings-routes.mjs';
import {handleAuditRequest} from './audit-routes.mjs';
import {handleVisitStatusRequest} from './visit-status-routes.mjs';
import {handleCampaignRequest} from './campaign-routes.mjs';
import {handleProjectLinkRequest} from './project-link-routes.mjs';
import {handleConsentRequest} from './consent-routes.mjs';
import {reserveLoginAttempt} from './login-guard.mjs';
import {challengeAfterPassword,finishMfaLogin,handleMfaSettings} from './mfa.mjs';
import {handleConversationRequest} from './conversation-routes.mjs';
import {simulatorHtml,simulatorCss,simulatorJs} from './simulator-ui.mjs';
import {checkSlug,checkName,checkStorageMode,normalizeIndianPhone,resolveCrmDb,sha256hex,parseJsonBody,SOURCES} from './core.mjs';
import {html,css,js} from './app-assets.mjs';
import {COOKIE,validEmail,validPassword,makePassword,checkPassword,randomSecret,cookieFor,readCookie,mutationOriginAllowed,getSession,newSession,requireMembership,userSummary} from './human-auth.mjs';

const now=()=>new Date().toISOString();
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Permissions-Policy':'camera=(),microphone=(self)'};
const response=(body,status=200,extra={})=>Response.json(body,{status,headers:{...headers,...extra}});
const fail=(error,status=400)=>response({error},status);
async function payload(req){
  // Cap raw bytes before decoding JSON; the old req.text() buffered unlimited
  // input and allowed a memory-exhaustion request even though JSON was bounded.
  const max=16384;
  if(Number(req.headers.get('content-length'))>max)throw Error('request body too large');
  if(!req.body)throw Error('request body required');
  const reader=req.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let text='',size=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>max){await reader.cancel();throw Error('request body too large')}
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
  }finally{reader.releaseLock()}
  return parseJsonBody(text,max);
}
const bearer=req=>(req.headers.get('authorization')||'').match(/^Bearer (.+)$/i)?.[1]||'';
const allowedStatus=['trial','active'];
function validTenantId(v){return typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v)}
async function allowBootstrap(req,env){
  // Bootstrap credentials are generated as ASCII base64 and should have no
  // whitespace. Dashboard paste can accidentally store a trailing newline.
  // Normalize at both sides, then still compare the full digest in constant time.
  // Never log the presented or configured credential.
  const expected=String(env.ADMIN_BOOTSTRAP_TOKEN||'').trim();
  if(expected.length<32||expected.length>256)return false;
  const got=bearer(req).trim();if(!got||got.length>256)return false;
  const [a,b]=await Promise.all([sha256hex(got),sha256hex(expected)]);
  let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);
  return mismatch===0;
}
async function bootstrap(req,env){
  if(!await allowBootstrap(req,env))return fail('unauthorized',401);
  const d=await payload(req),email=validEmail(d.email),pw=await makePassword(d.password),date=now(),id=crypto.randomUUID();
  const existing=await env.CONTROL_DB.prepare("SELECT COUNT(*) AS n FROM human_users WHERE global_role='super_admin'").first();
  if(Number(existing?.n||0)!==0)return fail('super admin already exists',409);
  // The singleton claim and user insert are one transaction: concurrent bootstrap fails closed.
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare('INSERT INTO human_bootstrap_claim(id,created_at) VALUES(1,?)').bind(date),
    env.CONTROL_DB.prepare("INSERT INTO human_users(id,email,password_salt,password_hash,password_iterations,global_role,created_at,updated_at) VALUES(?,?,?,?,?,'super_admin',?,?)")
      .bind(id,email,pw.salt,pw.hash,pw.iterations,date,date)
  ]);
  return response({ok:true,email,notice:'Super Admin created; sign in at /app'},201);
}
async function login(req,env){
  const d=await payload(req),email=validEmail(d.email),password=String(d.password||'');
  if(password.length>128)return fail('invalid credentials',401);
  const db=env.CONTROL_DB,key=await sha256hex(email),timestamp=Date.now();
  const limit=await db.prepare('SELECT failed_count,window_start,blocked_until FROM human_login_limits WHERE email_hash=?').bind(key).first();
  if(Number(limit?.blocked_until||0)>timestamp)return fail('temporarily locked; retry later',429);
  const row=await db.prepare("SELECT * FROM human_users WHERE email=? AND status='active' LIMIT 1").bind(email).first();
  const valid=await checkPassword(password,row);
  if(!valid){
    // Account-scoped lockout supplements the independent verified-IP budget.
    const windowStart=Number(limit?.window_start||0),fresh=timestamp-windowStart>15*60*1000;
    const fails=fresh?1:Number(limit?.failed_count||0)+1;
    await db.prepare(`INSERT INTO human_login_limits(email_hash,failed_count,window_start,blocked_until)
      VALUES(?,?,?,?) ON CONFLICT(email_hash) DO UPDATE SET failed_count=excluded.failed_count,
      window_start=excluded.window_start,blocked_until=excluded.blocked_until`)
      .bind(key,fails,fresh?timestamp:windowStart,fails>=8?timestamp+15*60*1000:0).run();
    return fail('invalid credentials',401);
  }
  await db.prepare('DELETE FROM human_login_limits WHERE email_hash=?').bind(key).run();
  const mfa=await db.prepare('SELECT enabled_at FROM human_mfa_settings WHERE user_id=? AND enabled_at IS NOT NULL').bind(row.id).first();
  if(mfa?.enabled_at)return challengeAfterPassword(db,row,env);
  const token=await newSession(db,row.id);
  return response({ok:true},200,{'Set-Cookie':cookieFor(token)});
}
async function acceptInvitation(req,env){
  const d=await payload(req),email=validEmail(d.email),token=String(d.token||'');
  if(!/^[a-f0-9]{64}$/.test(token))return fail('invalid or expired invitation',401);
  validPassword(d.password);
  const db=env.CONTROL_DB,digest=await sha256hex(token),timestamp=Date.now();
  const invite=await db.prepare(`SELECT i.tenant_id,i.email,i.role FROM human_invitations i
    JOIN tenants t ON t.id=i.tenant_id WHERE i.token_hash=? AND i.redeemed_at IS NULL
      AND i.expires_at>? AND t.status IN ('trial','active') LIMIT 1`).bind(digest,timestamp).first();
  if(!invite||invite.email!==email)return fail('invalid or expired invitation',401);
  let user=await db.prepare('SELECT * FROM human_users WHERE email=? LIMIT 1').bind(email).first();
  if(user&&!(await checkPassword(d.password,user)))return fail('invalid credentials for existing account',401);
  if(user&&user.status!=='active')return fail('account unavailable',403);
  const id=user?.id||crypto.randomUUID(),date=now();
  const statements=[];
  if(!user){const p=await makePassword(d.password);
    statements.push(db.prepare('INSERT INTO human_users(id,email,password_salt,password_hash,password_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,email,p.salt,p.hash,p.iterations,date,date));
  }
  statements.push(db.prepare(`UPDATE human_invitations SET redeemed_at=? WHERE token_hash=? AND redeemed_at IS NULL AND expires_at>?`).bind(date,digest,timestamp));
  statements.push(db.prepare(`INSERT INTO tenant_memberships(tenant_id,user_id,role,created_at)
    SELECT tenant_id,?,role,? FROM human_invitations WHERE token_hash=? AND redeemed_at=?
    ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=excluded.role,status='active'`)
    .bind(id,date,digest,date));
  const out=await db.batch(statements);
  const claim=out[user?0:1],membership=out[user?1:2];
  if(claim?.meta?.changes!==1||membership?.meta?.changes!==1)return fail('invitation has already been used',409);
  if(user){
    const enabled=await db.prepare('SELECT enabled_at FROM human_mfa_settings WHERE user_id=? AND enabled_at IS NOT NULL').bind(id).first();
    if(enabled?.enabled_at)return challengeAfterPassword(db,user,env);
  }
  const session=await newSession(db,id);
  return response({ok:true},200,{'Set-Cookie':cookieFor(session)});
}
async function logout(req,env){
  const token=readCookie(req);
  if(/^[a-f0-9]{64}$/.test(token))await env.CONTROL_DB.prepare('UPDATE human_sessions SET revoked_at=? WHERE token_hash=?').bind(now(),await sha256hex(token)).run();
  return response({ok:true},200,{'Set-Cookie':cookieFor('',0)});
}
async function listTenants(db){
  const rows=await db.prepare(`SELECT t.id,t.slug,t.display_name,t.plan_code,t.storage_mode,t.status,
    (SELECT COUNT(*) FROM tenant_memberships m WHERE m.tenant_id=t.id AND m.status='active') AS member_count
    FROM tenants t ORDER BY t.created_at DESC LIMIT 100`).all();
  return response({tenants:rows.results});
}
async function createTenant(req,db,user){
  const d=await payload(req),slug=checkSlug(d.slug),name=checkName(d.displayName);
  const plan=d.plan||'starter',mode=d.storageMode||'shared';checkStorageMode(plan,mode);
  const id=crypto.randomUUID(),date=now();
  await db.batch([
    db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,?,?,?,?,'trial',?,?)")
      .bind(id,slug,name,plan,mode,date,date),
    db.prepare("INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,created_at) VALUES(?,?,?,'tenant.created',?,?)")
      .bind(crypto.randomUUID(),id,user.id,id,date)
  ]);
  return response({id,slug,displayName:name,plan,storageMode:mode,status:'trial',provisioning:mode==='dedicated'?'pending':'ready'},201);
}
async function invite(req,db,user){
  const d=await payload(req),tenantId=d.tenantId,email=validEmail(d.email),role=d.role||'client_admin';
  if(!validTenantId(tenantId)||!['client_admin','viewer'].includes(role))return fail('invalid tenant or role',400);
  const owner=await db.prepare('SELECT id FROM tenants WHERE id=? AND status IN (\'trial\',\'active\')').bind(tenantId).first();
  if(!owner)return fail('tenant unavailable',404);
  if(user.globalRole!=='super_admin'&&!(await requireMembership(db,user,tenantId,true)))return fail('forbidden',403);
  const token=randomSecret(),digest=await sha256hex(token),expiry=Date.now()+24*60*60*1000;
  await db.prepare(`INSERT INTO human_invitations(token_hash,tenant_id,email,role,expires_at,created_by,created_at)
    VALUES(?,?,?,?,?,?,?)`).bind(digest,tenantId,email,role,expiry,user.id,now()).run();
  return response({ok:true,expiresAt:new Date(expiry).toISOString(),
    inviteUrl:new URL(req.url).origin+'/app#invite='+token,notice:'Share only with the intended client; token shown once'},201);
}
async function overview(req,env,user){
  const tenantId=new URL(req.url).searchParams.get('tenantId');
  const tenant=await requireMembership(env.CONTROL_DB,user,tenantId);
  if(!tenant)return fail('forbidden',403);
  const db=resolveCrmDb(env,tenant),tid=tenant.tenant_id;
  const [leads,agents,calls,visits,leadRows,agentRows]=await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM leads WHERE tenant_id=?').bind(tid).first(),
    db.prepare('SELECT COUNT(*) AS n FROM agents WHERE tenant_id=?').bind(tid).first(),
    db.prepare('SELECT COUNT(*) AS n FROM calls WHERE tenant_id=?').bind(tid).first(),
    db.prepare('SELECT COUNT(*) AS n FROM site_visits WHERE tenant_id=?').bind(tid).first(),
    db.prepare('SELECT name,mobile_e164 AS mobile,source_type AS sourceType,consent_status AS consentStatus FROM leads WHERE tenant_id=? ORDER BY created_at DESC LIMIT 30').bind(tid).all(),
    db.prepare('SELECT display_name AS displayName,language_mode AS languageMode,status FROM agents WHERE tenant_id=? ORDER BY created_at DESC LIMIT 30').bind(tid).all()
  ]);
  return response({tenant:{id:tid,name:tenant.display_name,plan:tenant.plan_code,storageMode:tenant.storage_mode},role:tenant.role,
    metrics:{leads:leads?.n||0,agents:agents?.n||0,calls:calls?.n||0,siteVisits:visits?.n||0},
    leads:leadRows.results,agents:agentRows.results});
}
async function addLead(req,env,user){
  const d=await payload(req),tenant=await requireMembership(env.CONTROL_DB,user,d.tenantId,true);
  if(!tenant)return fail('forbidden',403);
  const mobile=normalizeIndianPhone(d.mobile),name=String(d.name||'').trim(),source=d.sourceType||'other';
  if(name.length>120||!SOURCES.includes(source))return fail('invalid name or source',400);
  const db=resolveCrmDb(env,tenant),id=crypto.randomUUID(),date=now();
  await db.prepare(`INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,consent_status,dnd_status,created_at,updated_at)
    VALUES(?,?,?,?,?,'unknown','unknown',?,?)`).bind(tenant.tenant_id,id,name,mobile,source,date,date).run();
  return response({id,notice:'Lead saved, calling consent not assumed'},201);
}
async function addAgent(req,env,user){
  const d=await payload(req),tenant=await requireMembership(env.CONTROL_DB,user,d.tenantId,true);
  if(!tenant)return fail('forbidden',403);
  const name=checkName(d.displayName),language=d.languageMode||'hi-en';
  if(!['hi','en','hi-en'].includes(language)||!Array.isArray(d.questions)||d.questions.length>25||d.questions.some(q=>typeof q!=='string'||!q.trim()||q.length>300))return fail('invalid questions or language',400);
  const db=resolveCrmDb(env,tenant),id=crypto.randomUUID(),date=now();
  await db.prepare("INSERT INTO agents(tenant_id,id,display_name,language_mode,questions_json,status,created_at,updated_at) VALUES(?,?,?,?,?,'draft',?,?)")
    .bind(tenant.tenant_id,id,name,language,JSON.stringify(d.questions),date,date).run();
  return response({id,status:'draft'},201);
}
export async function handleHumanRequest(req,env){
  const u=new URL(req.url),path=u.pathname,method=req.method;
  if(path==='/app'&&method==='GET')return new Response(html,{headers:{...headers,'Content-Type':'text/html;charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
  if(path==='/app/simulator'&&method==='GET')return new Response(simulatorHtml,{headers:{...headers,'Permissions-Policy':'camera=(),microphone=(self)','Content-Type':'text/html;charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
  if(path==='/app/assets/simulator.js'&&method==='GET')return new Response(simulatorJs,{headers:{...headers,'Content-Type':'text/javascript;charset=utf-8'}});
  if(path==='/app/assets/simulator.css'&&method==='GET')return new Response(simulatorCss,{headers:{...headers,'Content-Type':'text/css;charset=utf-8'}});
  if(path==='/app/assets/app.js'&&method==='GET')return new Response(js,{headers:{...headers,'Content-Type':'text/javascript;charset=utf-8'}});
  if(path==='/app/assets/style.css'&&method==='GET')return new Response(css,{headers:{...headers,'Content-Type':'text/css;charset=utf-8'}});
  if(!path.startsWith('/v1/human/'))return null;
  if(!env.CONTROL_DB)return fail('control database unavailable',503);
  // Only initial machine-to-machine bootstrap may omit Origin and use a server secret.
  if(['POST','PUT','PATCH','DELETE'].includes(method)&&path!=='/v1/human/bootstrap'&&!mutationOriginAllowed(req))return fail('same-origin request required',403);
  try{
    if(path==='/v1/human/bootstrap'&&method==='POST')return await bootstrap(req,env);
    if(path==='/v1/human/login'&&method==='POST'){
      const gate=await reserveLoginAttempt(req,env);
      if(!gate.allowed)return fail(gate.error,gate.status);
      return await login(req,env);
    }
    if(path==='/v1/human/accept-invite'&&method==='POST'){
      const gate=await reserveLoginAttempt(req,env);
      if(!gate.allowed)return fail(gate.error,gate.status);
      return await acceptInvitation(req,env);
    }
    if(path==='/v1/human/login/mfa'&&method==='POST')return await finishMfaLogin(req,env,await payload(req));
    if(path==='/v1/human/logout'&&method==='POST')return await logout(req,env);
    const user=await getSession(req,env.CONTROL_DB);
    if(!user)return fail('sign in required',401);
    if(path==='/v1/human/mfa'||path==='/v1/human/mfa/setup'||path==='/v1/human/mfa/enable'||path==='/v1/human/mfa/recovery/regenerate')
      return await handleMfaSettings(req,env,user,method==='POST'?await payload(req):null);
    const engineeringResponse=await handleEngineeringRequest(req,user,env);
    if(engineeringResponse)return engineeringResponse;
    const consentResponse=await handleConsentRequest(req,env,user);
    if(consentResponse)return consentResponse;
    const projectResponse=await handleProjectLinkRequest(req,env,user);
    if(projectResponse)return projectResponse;
    const campaignResponse=await handleCampaignRequest(req,env,user);
    if(campaignResponse)return campaignResponse;
    const visitResponse=await handleVisitStatusRequest(req,env,user);
    if(visitResponse)return visitResponse;
    const agentResponse=await handleAgentSettingsRequest(req,env,user);
    if(agentResponse)return agentResponse;
    const auditResponse=await handleAuditRequest(req,env,user);
    if(auditResponse)return auditResponse;
    const dataResponse=await handleDataPortabilityRequest(req,env,user);
    if(dataResponse)return dataResponse;
    const voicePreviewResponse=await handleFixedVoicePreviewRequest(req);
    if(voicePreviewResponse)return voicePreviewResponse;
    const qualificationResponse=await handlePropertyQualificationRequest(req,env,user);
    if(qualificationResponse)return qualificationResponse;
    const crmResponse=await handleCrmRequest(req,env,user);
    if(crmResponse)return crmResponse;
    const simulationResponse=await handleConversationRequest(req,env,user);
    if(simulationResponse)return simulationResponse;
    if(path==='/v1/human/me'&&method==='GET')return response(await userSummary(env.CONTROL_DB,user));
    const lifecycle=await handleTenantLifecycleRequest(req,env,user);
    if(lifecycle)return lifecycle;
    if(path==='/v1/human/tenants'){
      if(user.globalRole!=='super_admin')return fail('forbidden',403);
      if(method==='GET')return await listTenants(env.CONTROL_DB);
      if(method==='POST')return await createTenant(req,env.CONTROL_DB,user);
    }
    if(path==='/v1/human/invitations'&&method==='POST')return await invite(req,env.CONTROL_DB,user);
    if(path==='/v1/human/overview'&&method==='GET')return await overview(req,env,user);
    if(path==='/v1/human/leads'&&method==='POST')return await addLead(req,env,user);
    if(path==='/v1/human/agents'&&method==='POST')return await addAgent(req,env,user);
    return fail('not found',404);
  }catch(e){
    const message=String(e?.message||'');
    if(/UNIQUE constraint|PRIMARY KEY constraint/i.test(message))return fail('record already exists',409);
    if(/FOREIGN KEY constraint/i.test(message))return fail('invalid reference',400);
    if(/not provisioned|not configured/i.test(message))return fail('database not provisioned',503);
    if(/invalid|must be|required|unsupported|slug|too large|password|expected JSON|questions|name/i.test(message))return fail(message,400);
    console.error('AR3D human admin request failed',e);return fail('internal server error',500);
  }
}
