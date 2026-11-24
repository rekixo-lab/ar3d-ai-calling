import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {handleScriptedCallingRequest} from '../../src/scripted-campaign-routes.mjs';
export const tid='11111111-1111-4111-8111-111111111111',cid='22222222-2222-4222-8222-222222222222';
export const lead='33333333-3333-4333-8333-333333333333';
export const now=Date.parse('2026-11-20T06:30:00Z'),at=new Date(now).toISOString(),until=new Date(now+86400000).toISOString();
export const admin={id:'admin',globalRole:'super_admin',token_hash:'a'.repeat(64)},client={id:'client',globalRole:'user'};
function database(kind){
 const db=new DatabaseSync(':memory:');
 for(const f of readdirSync('migrations/'+kind).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+kind+'/'+f,'utf8'));
 const wrap={
  prepare(sql){
   const q=db.prepare(sql);
   const bound=args=>({async first(){return q.get(...args)||null},async all(){return {results:q.all(...args)}},async run(){return {meta:{changes:Number(q.run(...args).changes)}}}});
   return {...bound([]),bind(...args){return bound(args)}};
  },
  async batch(queries){db.exec('BEGIN IMMEDIATE');try{const r=[];for(const q of queries)r.push(await q.run());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}
 };
 return {db,wrap};
}
export function fixture(){
 const c=database('control'),r=database('crm');
 c.db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?, 'demo','Demo','starter','shared','active',?,?)").run(tid,at,at);
 for(const u of ['admin','client','viewer'])c.db.prepare("INSERT INTO human_users(id,email,password_salt,password_hash,password_iterations,global_role,created_at,updated_at) VALUES(?,?,'salt','hash',200000,?,?,?)").run(u,u+'@example.invalid',u==='admin'?'super_admin':'user',at,at);
 c.db.prepare('INSERT INTO human_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(admin.token_hash,admin.id,at,now+86400000);
 c.db.prepare('INSERT INTO human_mfa_settings(user_id,secret_ciphertext,secret_iv,enabled_at,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(admin.id,'c'.repeat(72),'i'.repeat(24),at,at,at);
 for(const u of ['client','viewer'])c.db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,role,created_at) VALUES(?,?,?,?)').run(tid,u,u==='client'?'client_admin':'viewer',at);
 r.db.prepare("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES(?,?,'Fictional buyer','+919000000001','excel',?,?)").run(tid,lead,at,at);
 r.db.prepare("INSERT INTO call_campaign_drafts(tenant_id,id,name,language_mode,purpose,status,created_by,created_at,updated_at) VALUES(?,?,'Survey','hi','property_information','draft','client',?,?)").run(tid,cid,at,at);
 r.db.prepare('INSERT INTO call_campaign_candidates VALUES(?,?,?,?)').run(tid,cid,lead,at);
 const env={CONTROL_DB:c.wrap,CRM_DB:r.wrap};

 return {c,r,env,close(){c.db.close();r.db.close()}};
}
function request(action,data,method='POST'){
 return new Request('https://app.example.invalid/v1/human/calling/'+action+(method==='GET'?'?'+new URLSearchParams(data):''),{method,headers:{Origin:'https://app.example.invalid','Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(data)}:{})});
}
export const route=(f,action,data,user=client,method='POST')=>handleScriptedCallingRequest(request(action,data,method),f.env,user,{now});
export function configureScriptedCampaign(f){
 Object.assign(f.env,{
  AR3D_SCRIPTED_CAMPAIGNS_ENABLED:'enabled',AR3D_FUNDED_CAMPAIGN_DISPATCH:'approved',AR3D_FUNDED_CUMULATIVE_SECONDS:'600000',PLIVO_AUTH_ID:'SYNTHETIC123',
  PLIVO_AUTH_TOKEN:'synthetic-token-value'.replaceAll('-',''),
  AR3D_PLIVO_CALLER_NUMBER:'+918000000000',AR3D_PLIVO_RECORDING_AUTH:'confirmed',
  AR3D_SCRIPTED_PILOT_ENABLED:'enabled',AR3D_SCRIPTED_PILOT_ORIGIN:'https://app.example.invalid',
  AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER:'+919000000009',AR3D_SCRIPTED_PILOT_TENANT_ID:tid,
  AR3D_SCRIPTED_PILOT_LEAD_ID:'88888888-8888-4888-8888-888888888888',
  AI:{async run(){return {text:'test'}}},RECORDINGS:{async get(){return null},async head(){return {size:42}}}
 });
 f.c.db.prepare("INSERT INTO tenant_minute_ledger(id,tenant_id,kind,delta_seconds,previous_seconds,balance_seconds,actor,reason,created_at) VALUES('synthetic-funding',?,'allocation',6000,0,6000,'admin','Synthetic test allocation',?)").run(tid,at);
 f.c.db.prepare(`INSERT INTO scripted_phone_pilots(id,tenant_id,lead_id,lead_updated_at,actor_id,language,destination,caller,
  rate_slot,expires_at,phase,provider_account_id,survey_json,created_at,hangup_at)
  VALUES('synthetic-completed-pilot',?,?,?,'admin','hi',?,?,1,?,'completed',?,'{}',?,?)`)
  .run(tid,f.env.AR3D_SCRIPTED_PILOT_LEAD_ID,at,f.env.AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER,
   f.env.AR3D_PLIVO_CALLER_NUMBER,now+600000,f.env.PLIVO_AUTH_ID,at,now);
}
export async function setup(f){
 configureScriptedCampaign(f);
 let r=await route(f,'policy',{tenantId:tid,enabled:true,approvalReference:'provider-approval-ref',expiresAt:until,dailyLimit:10,maxSeconds:180},admin);assert.equal(r.status,200,await r.text());
 r=await route(f,'clearances',{tenantId:tid,leadIds:[lead],purpose:'property_information',consentReference:'consent-ref',dndReference:'dnd-ref',expiresAt:until},admin);assert.equal(r.status,200,await r.text());
 r=await route(f,'runs',{tenantId:tid,campaignId:cid,action:'start'});assert.equal(r.status,202,await r.text());
}
export function accepted(){return Response.json({request_uuid:'synthetic-plivo-request-123'},{status:202})}
