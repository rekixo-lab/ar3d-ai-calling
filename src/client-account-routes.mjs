// One-screen client onboarding: does not create a password, send mail or dial anyone.
import {checkName,normalizeIndianPhone,sha256hex,parseJsonBody} from './core.mjs';
import {validEmail,randomSecret} from './human-auth.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
const fail=(error,status=400)=>json({error},status);

async function readBody(req){
  if(Number(req.headers.get('content-length'))>2048||!req.body)throw Error('invalid request body');
  const reader=req.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});
  let value='',size=0;
  try{
    while(true){
      const {done,value:chunk}=await reader.read();if(done)break;
      size+=chunk.byteLength;
      if(size>2048){await reader.cancel();throw Error('request body too large')}
      value+=decoder.decode(chunk,{stream:true});
    }
    value+=decoder.decode();
  }finally{reader.releaseLock()}
  return parseJsonBody(value,2048);
}
export async function clientSlug(name){
  let slug=name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60).replace(/-$/,'');
  if(!/^[a-z][a-z0-9-]{2,62}$/.test(slug))slug='client-'+(await sha256hex(name.toLowerCase())).slice(0,16);
  return slug;
}
export async function handleClientAccountRequest(req,env,user){
  if(new URL(req.url).pathname!=='/v1/human/client-accounts')return null;
  if(user?.globalRole!=='super_admin')return fail('forbidden',403);
  if(req.method!=='POST')return fail('method not allowed',405);
  try{
    const d=await readBody(req);
    if(Object.keys(d).some(k=>!['displayName','email','mobile','tenantId'].includes(k)))return fail('unexpected account field');
    const displayName=checkName(d.displayName),email=validEmail(d.email),mobile=normalizeIndianPhone(d.mobile);
    if(!/^\+91[6-9][0-9]{9}$/.test(mobile))return fail('Indian mobile number required');
    if(d.tenantId!==undefined&&(!/^[a-f0-9-]{36}$/i.test(d.tenantId)||typeof d.tenantId!=='string'))
      return fail('invalid existing client');
    const db=env.CONTROL_DB,at=new Date().toISOString(),stamp=Date.now();
    // Explicitly bind existing tenants, never create a second Ajay/client company.
    const matches=await db.prepare('SELECT id,slug,display_name,storage_mode,status FROM tenants WHERE lower(display_name)=lower(?)')
      .bind(displayName).all();
    if(matches.results.length>1)return fail('Multiple matching clients; select one explicitly',409);
    let tenant=matches.results[0]||null;
    if(d.tenantId){
      const selected=await db.prepare('SELECT id,slug,display_name,storage_mode,status FROM tenants WHERE id=?').bind(d.tenantId).first();
      if(!selected)return fail('existing client not found',404);
      if(selected.display_name.toLowerCase()!==displayName.toLowerCase())return fail('company name differs from selected client',409);
      tenant=selected;
    }else if(!tenant){
      const slug=await clientSlug(displayName);
      const collision=await db.prepare('SELECT id FROM tenants WHERE slug=?').bind(slug).first();
      if(collision)return fail('company slug collision; select existing company',409);
      tenant={id:crypto.randomUUID(),slug,display_name:displayName,status:'trial',storage_mode:'shared',isNew:true};
    }
    if(!['trial','active'].includes(tenant.status)||tenant.storage_mode!=='shared')
      return fail('existing client is unavailable or uses advanced storage',409);
    const contact=await db.prepare('SELECT email FROM client_account_contacts WHERE tenant_id=?').bind(tenant.id).first();
    if(contact)return fail('client primary contact is already registered; use the existing invitation/access manager',409);
    const member=await db.prepare('SELECT m.user_id FROM tenant_memberships m JOIN human_users u ON u.id=m.user_id WHERE m.tenant_id=? AND u.email=? AND m.status=?')
      .bind(tenant.id,email,'active').first();
    if(member)return fail('client already has login access',409);
    const pending=await db.prepare('SELECT token_hash FROM human_invitations WHERE tenant_id=? AND email=? AND role=? AND redeemed_at IS NULL AND expires_at>?')
      .bind(tenant.id,email,'client_admin',stamp).first();
    if(pending)return fail('an active invitation already exists for this client; use it or wait until expiry',409);
    const token=randomSecret(),digest=await sha256hex(token),expiry=stamp+24*60*60*1000;
    const actions=[];
    if(tenant.isNew){
      actions.push(db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,?,?,'starter','shared','trial',?,?)")
        .bind(tenant.id,tenant.slug,displayName,at,at));
    }
    actions.push(db.prepare(`INSERT INTO client_account_contacts(tenant_id,email,mobile_e164,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?)`)
      .bind(tenant.id,email,mobile,user.id,at,at));
    actions.push(db.prepare('INSERT INTO human_invitations(token_hash,tenant_id,email,role,expires_at,created_by,created_at) VALUES(?,?,?,\'client_admin\',?,?,?)')
      .bind(digest,tenant.id,email,expiry,user.id,at));
    actions.push(db.prepare('INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,detail_json,created_at) VALUES(?,?,?,\'client.account_invited\',?,?,?)')
      .bind(crypto.randomUUID(),tenant.id,user.id,tenant.id,JSON.stringify({email,existing:!tenant.isNew}),at));
    const out=await db.batch(actions);
    if(out.some(x=>Number(x.meta?.changes)!==1))return fail('account was not changed; review existing access',409);
    return json({ok:true,id:tenant.id,slug:tenant.slug,displayName:tenant.display_name,email,
      existingTenant:!tenant.isNew,access:'invitation_pending',
      inviteUrl:new URL(req.url).origin+'/app#invite='+token,
      expiresAt:new Date(expiry).toISOString(),
      notice:'Invitation link shown once. No password or email was sent.'},201);
  }catch(e){
    const message=String(e?.message||'');
    if(/UNIQUE|PRIMARY KEY|FOREIGN KEY|constraint failed/i.test(message))return fail('record already exists or client changed; refresh',409);
    if(/invalid|must|too large|required|expected JSON|name|mobile|email|request body/i.test(message))return fail(message,400);
    console.error('client account onboarding failed',e);
    return fail('internal server error',500);
  }
}
