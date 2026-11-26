import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {encryptCredentials,decryptCredentials,verifySignature,normalizeTemplate,publicRules,iso,hex,graphRequest,leadPreferences} from '../src/whatsapp-core.mjs';
import {handleWhatsAppRequest,handleWhatsAppWebhook,runWhatsAppCron} from '../src/whatsapp-routes.mjs';
import {enqueueMessage,dispatchMessage,reconcileAcceptedCalls,reconcileVisits} from '../src/whatsapp-dispatch.mjs';
import {statusTransition,applyPendingStatusEvents} from '../src/whatsapp-webhook.mjs';

const T='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',L='33333333-3333-4333-8333-333333333333',C='44444444-4444-4444-8444-444444444444',P='55555555-5555-4555-8555-555555555555',V='66666666-6666-4666-8666-666666666666';
const NOW=Date.parse('2026-11-26T12:00:00.000Z'),AT=iso(NOW),user={id:'client-a',globalRole:'user'};
function d1(kind){
 const sqlite=new DatabaseSync(':memory:');let queries=0;
 for(const file of readdirSync(new URL('../migrations/'+kind+'/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+kind+'/'+file,import.meta.url),'utf8'));
 return {
  sqlite,get queries(){return queries;},reset(){queries=0;},
  prepare(sql){
   const stmt=sqlite.prepare(sql);
   return {bind(...params){return {
    async first(){queries++;return stmt.get(...params)||null;},
    async all(){queries++;return {results:stmt.all(...params)};},
    async run(){queries++;const r=stmt.run(...params);return {meta:{changes:Number(r.changes)}};},
    _run(){queries++;const r=stmt.run(...params);return {meta:{changes:Number(r.changes)}};}
   };}};
  },
  async batch(items){sqlite.exec('BEGIN');try{const r=items.map(i=>i._run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}
 };
}
function fixture(){
 const CONTROL_DB=d1('control'),CRM_DB=d1('crm'),env={CONTROL_DB,CRM_DB,MFA_ENCRYPTION_KEY:'k'.repeat(64)};
 for(const [id,slug]of [[T,'client-a'],[OTHER,'client-b']])CONTROL_DB.sqlite.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,?,?,'starter','shared','active',?,?)").run(id,slug,slug,AT,AT);
 CONTROL_DB.sqlite.prepare("INSERT INTO human_users(id,email,password_salt,password_hash,password_iterations,created_at,updated_at) VALUES('client-a','test@example.test','salt','hash',300000,?,?)").run(AT,AT);
 CONTROL_DB.sqlite.prepare("INSERT INTO tenant_memberships(tenant_id,user_id,role,created_at) VALUES(?,'client-a','client_admin',?)").run(T,AT);
 CRM_DB.sqlite.prepare("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,interest_status,preferred_location,budget_max_inr,created_at,updated_at,requirements_json) VALUES(?,?,'Test Customer','+919876543210','website','interested','Raipur',3000000,?,?,?)").run(T,L,AT,AT,JSON.stringify({propertyType:'plot',location:'Raipur'}));
 CRM_DB.sqlite.prepare("INSERT INTO call_campaign_drafts(tenant_id,id,name,language_mode,purpose,created_by,created_at,updated_at) VALUES(?,?,'Property campaign','hi','property_information','client-a',?,?)").run(T,C,AT,AT);
 CRM_DB.sqlite.prepare('INSERT INTO call_campaign_candidates(tenant_id,campaign_id,lead_id,created_at) VALUES(?,?,?,?)').run(T,C,L,AT);
 CRM_DB.sqlite.prepare("INSERT INTO properties(tenant_id,id,name,property_type,city,price_min_inr,price_max_inr,price_basis,revision,last_write_id,created_by,updated_by,created_at,updated_at,map_url) VALUES(?,?,'Green Estate','plot','Raipur',2000000,2500000,'total',1,'write','client-a','client-a',?,?,'https://maps.google.com/?q=Raipur')").run(T,P,AT,AT);
 CRM_DB.sqlite.prepare("INSERT INTO campaign_property_settings(tenant_id,campaign_id,revision,last_write_id,updated_by,updated_at) VALUES(?,?,1,'write','client-a',?)").run(T,C,AT);
 CRM_DB.sqlite.prepare('INSERT INTO campaign_properties(tenant_id,campaign_id,property_id,position) VALUES(?,?,?,0)').run(T,C,P);
 return {env,db:CRM_DB,control:CONTROL_DB,member:{tenant_id:T,storage_mode:'shared',display_name:'Client A'}};
}
const template=()=>normalizeTemplate({id:'123',name:'property_details',status:'APPROVED',language:'hi',category:'MARKETING',components:[{type:'BODY',text:'Hello {{1}}. {{2}}: {{3}}. {{4}}. {{5}}. {{6}}.'}]});
const templateResponse=()=>Response.json({data:[{id:'123',name:'property_details',status:'APPROVED',language:'hi',category:'MARKETING',components:[{type:'BODY',text:template().body}]}]});
async function ready(f,{enabled=true}={}){
 f.db.sqlite.prepare("INSERT INTO whatsapp_permissions(tenant_id,lead_id,status,source,reference,captured_at,actor,updated_at) VALUES(?,?,'granted','website_form','enquiry-form-123',?,'client-a',?)").run(T,L,AT,AT);
 f.db.sqlite.prepare("INSERT INTO whatsapp_rules(tenant_id,enabled,enabled_at,template_name,updated_at,cursor_at) VALUES(?,?,?,'property_details',?,?)").run(T,+enabled,iso(NOW-60000),AT,iso(NOW-60000));
 const credentials=await encryptCredentials(f.env,T,{accessToken:'test-token-'.repeat(8),appSecret:'a'.repeat(32)});
 f.control.sqlite.prepare("INSERT INTO whatsapp_connections(tenant_id,messaging_account_id,phone_number_id,display_phone,verified_name,status,credentials_ciphertext,verify_token_hash,templates_json,webhook_verified_at,connected_at,updated_at) VALUES(?,'123456789','987654321','+919000000000','Client A','connected',?,'hash',?,?,?,?)").run(T,credentials,JSON.stringify([template()]),AT,AT,AT);
 return f.control.sqlite.prepare('SELECT * FROM whatsapp_connections WHERE tenant_id=?').get(T);
}
const request=(data,method='POST')=>new Request('https://aicalling.ar3dstudio.in/v1/human/whatsapp'+(method==='GET'?'?tenantId='+data.tenantId:''),{method,headers:{origin:'https://aicalling.ar3dstudio.in','content-type':'application/json'},body:method==='POST'?JSON.stringify(data):undefined});
async function job(f,opts={}){const id=await enqueueMessage(f.db,{tenantId:T,leadId:L,campaignId:C,propertyId:P,kind:'property_details',dueAt:AT,sourceAt:AT,sourceKey:'manual:'+crypto.randomUUID(),templateName:'property_details',templateLanguage:'hi',now:NOW,...opts});return f.db.sqlite.prepare('SELECT * FROM whatsapp_messages WHERE tenant_id=? AND id=?').get(T,id);}
async function signedWebhook(f,value,{secret='a'.repeat(32),now=NOW}={}){
 const raw=JSON.stringify({object:'whatsapp_business_account',entry:[{id:'123456789',changes:[{field:'messages',value:{metadata:{phone_number_id:'987654321'},...value}}]}]});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature='sha256='+hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw)));
 return handleWhatsAppWebhook(new Request('https://aicalling.ar3dstudio.in/v1/provider/whatsapp',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signature},body:raw}),f.env,{now});
}
test('credentials are domain separated, authenticated and never portable across tenants',async()=>{
 const env={MFA_ENCRYPTION_KEY:'x'.repeat(64)},secret={accessToken:'private-token',appSecret:'secret'};
 const a=await encryptCredentials(env,T,secret),b=await encryptCredentials(env,T,secret);
 assert.notEqual(a,b);assert.ok(!a.includes('private-token'));assert.deepEqual(await decryptCredentials(env,T,a),secret);
 await assert.rejects(decryptCredentials(env,OTHER,a));await assert.rejects(decryptCredentials({...env,MFA_ENCRYPTION_KEY:'y'.repeat(64)},T,a));
});
test('template compatibility rejects unsafe dynamic layouts and never assumes category approval',()=>{
 assert.equal(template().supported,true);
 assert.equal(normalizeTemplate({name:'x',status:'PENDING',category:'MARKETING',components:[]}).supported,false);
 assert.equal(normalizeTemplate({name:'x',status:'APPROVED',category:'MARKETING',components:[{type:'BODY',text:'{{named}}'}]}).supported,false);
});
test('HTTP 5xx and transport errors are ambiguous; only 4xx are definite rejections',async()=>{
 await assert.rejects(graphRequest('/123456789/messages','secret',{method:'POST',body:{},fetcher:async()=>Response.json({error:{code:1}},{status:500})}),e=>e.definitive===false);
 await assert.rejects(graphRequest('/123456789/messages','secret',{method:'POST',body:{},fetcher:async()=>Response.json({error:{code:190}},{status:401})}),e=>e.definitive===true);
});
test('tenant access is isolated and only Super Admin can connect provider credentials',async()=>{
 const f=fixture();
 assert.equal((await handleWhatsAppRequest(request({tenantId:OTHER},'GET'),f.env,user,{now:NOW})).status,403);
 assert.equal((await handleWhatsAppRequest(request({tenantId:T,action:'connect'}),f.env,user,{now:NOW})).status,403);
 const overview=await handleWhatsAppRequest(request({tenantId:T},'GET'),f.env,user,{now:NOW});assert.equal(overview.status,200);
 const data=await overview.json();assert.equal(data.connection.status,'not_connected');assert.equal(data.canEdit,true);assert.equal(data.canConnect,false);
});
test('permission evidence does not mutate voice consent; revoked permission cancels queued WhatsApp',async()=>{
 const f=fixture();
 let r=await handleWhatsAppRequest(request({tenantId:T,action:'permission',leadId:L,status:'granted',source:'website_form',reference:'real-form-123',capturedAt:AT}),f.env,user,{now:NOW});assert.equal(r.status,200);
 assert.equal(f.db.sqlite.prepare('SELECT consent_status FROM leads').get().consent_status,'unknown');
 await job(f);
 r=await handleWhatsAppRequest(request({tenantId:T,action:'permission',leadId:L,status:'revoked',source:'website_form',reference:'real-form-123',capturedAt:AT}),f.env,user,{now:NOW});assert.equal(r.status,200);
 assert.equal(f.db.sqlite.prepare('SELECT status FROM whatsapp_messages').get().status,'cancelled');
});
test('no credentials and no connected numbers perform no outbound network operation',async()=>{
 const f=fixture();let requests=0;
 const result=await runWhatsAppCron(f.env,{now:NOW,fetcher:async()=>{requests++;throw Error('unexpected');}});
 assert.equal(requests,0);assert.equal(result.whatsapp.submitted,0);
});
test('manual schedule verifies campaign ownership and persists truthful pending setup',async()=>{
 const f=fixture();await ready(f);
 f.control.sqlite.prepare('DELETE FROM whatsapp_connections').run();
 const r=await handleWhatsAppRequest(request({tenantId:T,action:'schedule',leadId:L,campaignId:C,propertyId:P,kind:'property_details',dueAt:AT}),f.env,user,{now:NOW});
 assert.equal(r.status,201);assert.equal((await r.json()).status,'pending_setup');
 assert.equal(f.db.sqlite.prepare('SELECT provider_message_id FROM whatsapp_messages').get().provider_message_id,null);
});
test('current changed property is checked at dispatch and current price is used',async()=>{
 const f=fixture(),connection=await ready(f),m=await job(f),rules=publicRules(f.db.sqlite.prepare('SELECT * FROM whatsapp_rules').get());
 f.db.sqlite.prepare('UPDATE properties SET price_min_inr=2100000,price_max_inr=2600000,revision=2').run();
 let payload;const result=await dispatchMessage(f.env,f.member,f.db,connection,rules,m,{now:NOW,fetcher:async(url,init)=>{if(init.method==='GET')return templateResponse();payload=JSON.parse(init.body);return Response.json({messages:[{id:'wamid.test'}]});}});
 assert.equal(result.sent,true);assert.match(payload.template.components[0].parameters[3].text,/21,00,000/);
 assert.equal(f.db.sqlite.prepare('SELECT status FROM whatsapp_messages').get().status,'submitted');
 assert.equal(f.db.sqlite.prepare('SELECT delivered_at FROM whatsapp_messages').get().delivered_at,null);
});
test('paused/sold property and customer opt-out prevent provider submission',async()=>{
 for(const variant of ['sold','optout']){
  const f=fixture(),connection=await ready(f),m=await job(f);let calls=0;
  if(variant==='sold')f.db.sqlite.prepare("UPDATE properties SET status='sold'").run();else f.db.sqlite.prepare("UPDATE leads SET consent_status='denied',dnd_status='blocked'").run();
  const result=await dispatchMessage(f.env,f.member,f.db,connection,publicRules(f.db.sqlite.prepare('SELECT * FROM whatsapp_rules').get()),m,{now:NOW,fetcher:async()=>{calls++;}});
  assert.equal(result.sent,false);assert.equal(calls,0);
 }
});
test('ambiguous send remains unknown and a repeated tick never sends it twice',async()=>{
 const f=fixture(),connection=await ready(f),m=await job(f);let calls=0;
 const fetcher=async(url,init)=>{if(init.method==='GET')return templateResponse();calls++;return Response.json({error:{code:1}},{status:500});};
 await dispatchMessage(f.env,f.member,f.db,connection,publicRules(f.db.sqlite.prepare('SELECT * FROM whatsapp_rules').get()),m,{now:NOW,fetcher});
 assert.equal(f.db.sqlite.prepare('SELECT status FROM whatsapp_messages').get().status,'unknown');
 await runWhatsAppCron(f.env,{now:NOW,fetcher});assert.equal(calls,1);
});
test('signed replies pause generic follow-up; duplicate webhook is idempotent; STOP suppresses contact',async()=>{
 const f=fixture();await ready(f);await job(f);
 const inbound={messages:[{id:'inbound-1',from:'919876543210',timestamp:String(NOW/1000),type:'text',text:{body:'Please send details'}}]};
 assert.equal((await signedWebhook(f,inbound,{secret:'b'.repeat(32)})).status,403);
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM whatsapp_inbound_messages').get().n,0);
 assert.equal((await signedWebhook(f,inbound)).status,200);assert.equal((await signedWebhook(f,inbound)).status,200);
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM whatsapp_inbound_messages').get().n,1);
 assert.equal(f.db.sqlite.prepare('SELECT status FROM whatsapp_messages').get().status,'cancelled');
 const stop={messages:[{id:'inbound-2',from:'919876543210',timestamp:String(NOW/1000),type:'text',text:{body:'बंद करें'}}]};
 assert.equal((await signedWebhook(f,stop)).status,200);assert.equal((await signedWebhook(f,stop)).status,200);
 assert.equal(f.db.sqlite.prepare('SELECT consent_status FROM leads').get().consent_status,'denied');
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM lead_opt_out_events').get().n,1);
});
test('statuses received before send acknowledgement are durable and do not regress read to sent',async()=>{
 const f=fixture();await ready(f);const m=await job(f);
 await signedWebhook(f,{statuses:[{id:'wamid.early',status:'read',timestamp:String(NOW/1000),recipient_id:'919876543210'}]});
 assert.equal(f.db.sqlite.prepare('SELECT processed_at FROM whatsapp_event_receipts').get().processed_at,null);
 f.db.sqlite.prepare("UPDATE whatsapp_messages SET status='submitted',provider_message_id='wamid.early' WHERE id=?").run(m.id);
 await applyPendingStatusEvents(f.db,T,{now:NOW});assert.equal(f.db.sqlite.prepare('SELECT status FROM whatsapp_messages').get().status,'read');
 await signedWebhook(f,{statuses:[{id:'wamid.early',status:'sent',timestamp:String((NOW+1000)/1000),recipient_id:'919876543210'}]});
 assert.equal(f.db.sqlite.prepare('SELECT status FROM whatsapp_messages').get().status,'read');
 assert.equal(statusTransition('read','failed'),'read');
});
test('future-only call reconciliation is idempotent and joins campaign through run',async()=>{
 const f=fixture();await ready(f);
 const run='77777777-7777-4777-8777-777777777777',jobId='88888888-8888-4888-8888-888888888888';
 f.db.sqlite.prepare("INSERT INTO calling_runs(tenant_id,id,campaign_id,state,created_by,created_at,updated_at) VALUES(?,?,?,'completed','client-a',?,?)").run(T,run,C,AT,AT);
 f.db.sqlite.prepare("INSERT INTO calling_jobs(tenant_id,id,run_id,lead_id,state,created_at,updated_at) VALUES(?,?,?,?,'completed',?,?)").run(T,jobId,run,L,AT,AT);
 f.db.sqlite.prepare("INSERT INTO scripted_call_results(tenant_id,job_id,session_id,answers_json,saved_to_lead,captured_at) VALUES(?,?,'session',?,1,?)").run(T,jobId,JSON.stringify({propertyType:'plot',location:'Raipur',budgetInr:3000000}),AT);
 const rules=publicRules(f.db.sqlite.prepare('SELECT * FROM whatsapp_rules').get());
 assert.equal(await reconcileAcceptedCalls(f.env,f.member,f.db,rules,{now:NOW}),1);
 assert.equal(await reconcileAcceptedCalls(f.env,f.member,f.db,rules,{now:NOW}),0);
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM whatsapp_messages').get().n,1);
 const m=f.db.sqlite.prepare('SELECT * FROM whatsapp_messages').get();f.db.sqlite.prepare('UPDATE leads SET budget_max_inr=1000000,updated_at=?').run(iso(NOW+1));let network=0;
 const result=await dispatchMessage(f.env,f.member,f.db,f.control.sqlite.prepare('SELECT * FROM whatsapp_connections').get(),rules,m,{now:NOW+600000,fetcher:async()=>{network++;}});
 assert.equal(result.sent,false);assert.equal(network,0);assert.equal(f.db.sqlite.prepare('SELECT status FROM whatsapp_messages').get().status,'review_required');
});
test('newly enabled rules never sweep historical calls and unbound visits never invent project',async()=>{
 const f=fixture();await ready(f);
 f.db.sqlite.prepare("INSERT INTO site_visits(tenant_id,id,lead_id,scheduled_at,status,created_at) VALUES(?,?,?,?,'confirmed',?)").run(T,V,L,iso(NOW+3600000),AT);
 await job(f); // A lead's property message is NOT a visit property assignment.
 const rules={...publicRules(f.db.sqlite.prepare('SELECT * FROM whatsapp_rules').get()),visitReminderEnabled:true};
 assert.equal(await reconcileVisits(f.env,f.member,f.db,rules,{now:NOW}),0);
 assert.equal(leadPreferences({budget_max_inr:1000000,preferred_location:'Durg'},{budgetInr:3000000,location:'Raipur'}).budgetInr,1000000);
});
test('one cron invocation remains below the 50-query budget and sends at most one message',async()=>{
 const f=fixture();await ready(f);await job(f);await job(f);
 f.db.reset();f.control.reset();let sent=0;
 await runWhatsAppCron(f.env,{now:NOW,maxSends:100,maxTenants:100,fetcher:async(url,init)=>{if(init.method==='GET')return templateResponse();sent++;return Response.json({messages:[{id:'wamid.bounded'}]});}});
 assert.equal(sent,1);assert.ok(f.db.queries+f.control.queries<=50,`queries=${f.db.queries+f.control.queries}`);
});
test('a signed STOP racing with manual reply prevents the final paid-send claim',async()=>{
 const f=fixture();await ready(f);
 await signedWebhook(f,{messages:[{id:'question-before-reply',from:'919876543210',timestamp:String(NOW/1000),type:'text',text:{body:'What is the location?'}}]});
 const original=f.control.prepare.bind(f.control);let injected=false,network=0;
 f.control.prepare=sql=>{
  const statement=original(sql);
  if(sql==='SELECT * FROM whatsapp_connections WHERE tenant_id=?')return {bind(...args){const bound=statement.bind(...args);return {...bound,async first(){const row=await bound.first();if(!injected){injected=true;await signedWebhook(f,{messages:[{id:'race-stop',from:'919876543210',timestamp:String(NOW/1000),type:'text',text:{body:'STOP'}}]});}return row;}};}};
  return statement;
 };
 const response=await handleWhatsAppRequest(request({tenantId:T,action:'reply',leadId:L,text:'Here are the property details.'}),f.env,user,{now:NOW,fetcher:async()=>{network++;return Response.json({messages:[{id:'must-not-send'}]});}});
 assert.equal(response.status,409);assert.equal(network,0);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM whatsapp_messages WHERE kind='reply'").get().n,0);
});
test('manual reply is submitted inside the window, with a durable idempotency key',async()=>{
 const f=fixture();await ready(f);await signedWebhook(f,{messages:[{id:'reply-window',from:'919876543210',timestamp:String(NOW/1000),type:'text',text:{body:'Please help'}}]});
 const data={tenantId:T,action:'reply',leadId:L,text:'Our salesperson will help you.',requestId:crypto.randomUUID()};let calls=0;
 const opts={now:NOW,fetcher:async()=>{calls++;return Response.json({messages:[{id:'wamid.human-reply'}]});}};
 assert.equal((await handleWhatsAppRequest(request(data),f.env,user,opts)).status,200);
 assert.equal((await handleWhatsAppRequest(request(data),f.env,user,opts)).status,409);assert.equal(calls,1);
});
test('visit time changes during template verification prevent stale reminder delivery',async()=>{
 const f=fixture(),connection=await ready(f),visitAt=iso(NOW+3600000);
 f.db.sqlite.prepare("INSERT INTO site_visits(tenant_id,id,lead_id,scheduled_at,status,created_at) VALUES(?,?,?,?,'confirmed',?)").run(T,V,L,visitAt,AT);
 const m=await job(f,{kind:'visit_reminder',visitId:V,payload:{visitAt}});let posts=0;
 const result=await dispatchMessage(f.env,f.member,f.db,connection,publicRules(f.db.sqlite.prepare('SELECT * FROM whatsapp_rules').get()),m,{now:NOW,fetcher:async(url,init)=>{
  if(init.method==='GET'){f.db.sqlite.prepare('UPDATE site_visits SET scheduled_at=?').run(iso(NOW+7200000));return Response.json({data:[{id:'123',name:'property_details',status:'APPROVED',language:'hi',category:'UTILITY',components:[{type:'BODY',text:template().body}]}]});}
  posts++;return Response.json({messages:[{id:'never'}]});
 }});
 assert.equal(result.sent,false);assert.equal(posts,0);
});
test('manual reminder and cancellation prevent duplicate automatic reminders for same visit time',async()=>{
 const f=fixture();await ready(f);const visitAt=iso(NOW+3600000);
 f.db.sqlite.prepare("INSERT INTO site_visits(tenant_id,id,lead_id,scheduled_at,status,created_at) VALUES(?,?,?,?,'confirmed',?)").run(T,V,L,visitAt,AT);
 const m=await job(f,{kind:'visit_reminder',visitId:V,payload:{visitAt}}),rules={...publicRules(f.db.sqlite.prepare('SELECT * FROM whatsapp_rules').get()),visitReminderEnabled:true};
 assert.equal(await reconcileVisits(f.env,f.member,f.db,rules,{now:NOW}),0);
 f.db.sqlite.prepare("UPDATE whatsapp_messages SET status='cancelled' WHERE id=?").run(m.id);
 assert.equal(await reconcileVisits(f.env,f.member,f.db,rules,{now:NOW}),0);
});
test('Meta-paused templates are checked before submission, not trusted from cached approval',async()=>{
 const f=fixture(),connection=await ready(f),m=await job(f);let posts=0;
 const result=await dispatchMessage(f.env,f.member,f.db,connection,publicRules(f.db.sqlite.prepare('SELECT * FROM whatsapp_rules').get()),m,{now:NOW,fetcher:async(url,init)=>{
  if(init.method==='GET')return Response.json({data:[{id:'123',name:'property_details',status:'PAUSED',language:'hi',category:'MARKETING',components:[{type:'BODY',text:template().body}]}]});
  posts++;return Response.json({messages:[{id:'never'}]});
 }});
 assert.equal(result.sent,false);assert.equal(posts,0);assert.equal(f.db.sqlite.prepare('SELECT status FROM whatsapp_messages').get().status,'pending_setup');
});
