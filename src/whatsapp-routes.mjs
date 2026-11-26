import {mutationOriginAllowed} from './human-auth.mjs';
import {getCampaignProperties,getProperty,matchCampaignProperties} from './property-catalog.mjs';
import {UUID,iso,text,validId,validLanguage,validTemplateName,json,fail,boundedText,memberFor,encryptCredentials,decryptCredentials,graphRequest,fetchTemplates,templatesFor,selectedTemplate,publicRules,publicConnection,leadEligibility,leadPreferences,audit,resolveCrmDb,sha256hex,randomToken,PENDING_INBOUND_SQL} from './whatsapp-core.mjs';
import {enqueueMessage,sendReply} from './whatsapp-dispatch.mjs';
export {WHATSAPP_CRON} from './whatsapp-core.mjs';
export {handleWhatsAppWebhook} from './whatsapp-webhook.mjs';
export {runWhatsAppCron} from './whatsapp-dispatch.mjs';

const PATH='/v1/human/whatsapp';
const accountNotice='Connect the client business number, configure the webhook, and send a test inbound WhatsApp message before enabling follow-ups. Billing and number registration remain in Meta.';
function validRuleInput(r){
 if(!r||typeof r!=='object'||Array.isArray(r))throw Error('invalid rules');
 const bool=['enabled','secondEnabled','visitReminderEnabled'];
 for(const k of bool)if(typeof r[k]!=='boolean')throw Error('invalid '+k);
 for(const [k,min,max] of [['firstDelayMinutes',5,1440],['secondDelayHours',24,168],['dailyLimit',1,10000]])if(!Number.isSafeInteger(r[k])||r[k]<min||r[k]>max)throw Error('invalid '+k);
 for(const k of ['templateName','followupTemplateName','visitTemplateName'])if(r[k]!==''&&!validTemplateName(r[k]))throw Error('invalid template name');
 for(const k of ['templateLanguage','followupTemplateLanguage','visitTemplateLanguage'])if(!validLanguage(r[k]))throw Error('invalid template language');
 return r;
}
async function overview(req,env,user,member,db,tid,{now}){
 const q=text(new URL(req.url).searchParams.get('q'),80);
 const [connection,rules,messages,inbox,permissions,leads,campaigns,visits,threads]=await Promise.all([
  env.CONTROL_DB.prepare('SELECT c.*,'+PENDING_INBOUND_SQL+' AS pending_inbound FROM whatsapp_connections c WHERE tenant_id=?').bind(tid).first(),
  db.prepare('SELECT * FROM whatsapp_rules WHERE tenant_id=?').bind(tid).first(),
  db.prepare(`SELECT m.id,m.lead_id AS leadId,l.name AS leadName,m.kind,m.status,m.due_at AS dueAt,m.reason,m.property_id AS propertyId,m.campaign_id AS campaignId,m.provider_message_id AS providerMessageId,m.created_at AS createdAt,m.delivered_at AS deliveredAt,m.read_at AS readAt FROM whatsapp_messages m JOIN leads l ON l.tenant_id=m.tenant_id AND l.id=m.lead_id WHERE m.tenant_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 50`).bind(tid).all(),
  db.prepare('SELECT i.id,i.lead_id AS leadId,l.name AS leadName,i.text,i.message_type AS messageType,i.received_at AS receivedAt FROM whatsapp_inbound_messages i JOIN leads l ON l.tenant_id=i.tenant_id AND l.id=i.lead_id WHERE i.tenant_id=? ORDER BY i.received_at DESC,i.id DESC LIMIT 50').bind(tid).all(),
  db.prepare('SELECT lead_id AS leadId,status,source,reference,captured_at AS capturedAt FROM whatsapp_permissions WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 100').bind(tid).all(),
  db.prepare('SELECT id,name,mobile_e164 AS mobile,interest_status AS interestStatus FROM leads WHERE tenant_id=? AND (?=\'\' OR instr(lower(name),lower(?))>0 OR instr(mobile_e164,?)>0) ORDER BY updated_at DESC,id DESC LIMIT 50').bind(tid,q,q,q).all(),
  db.prepare('SELECT id,name FROM call_campaign_drafts WHERE tenant_id=? ORDER BY updated_at DESC,id DESC LIMIT 100').bind(tid).all(),
  db.prepare("SELECT id,lead_id AS leadId,scheduled_at AS scheduledAt,status FROM site_visits WHERE tenant_id=? AND status='confirmed' AND scheduled_at>? ORDER BY scheduled_at LIMIT 100").bind(tid,iso(now)).all(),
  db.prepare('SELECT lead_id AS leadId,paused,last_inbound_at AS lastInboundAt FROM whatsapp_threads WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 100').bind(tid).all()
 ]);
 const canEdit=member.role==='client_admin';
 return json({tenantId:tid,canEdit,canConnect:user.globalRole==='super_admin',connection:publicConnection(connection),rules:publicRules(rules),templates:templatesFor(connection),messages:messages.results||[],inbox:inbox.results||[],permissions:permissions.results||[],leads:leads.results||[],campaigns:campaigns.results||[],visits:visits.results||[],threads:(threads.results||[]).map(t=>({...t,paused:!!t.paused})),setup:{canConnect:user.globalRole==='super_admin',credentialStorageReady:String(env.MFA_ENCRYPTION_KEY||'').length>=32,webhookUrl:new URL('/v1/provider/whatsapp',req.url).href,requirements:[accountNotice,'Automatic messages use six numbered body parameters. Property: customer, business, property, price, location, details link. Visit: customer, business, property, visit time, location, details link.','Customer permission is recorded from existing forms or CRM evidence. The calling script is unchanged.']}});
}
async function connect(req,env,tid,data,{now,fetcher}){
 if(!validId(data.messagingAccountId)||!validId(data.phoneNumberId))return fail('invalid Meta account or phone ID');
 const accessToken=String(data.accessToken||''),appSecret=String(data.appSecret||'');
 if(accessToken.length<20||accessToken.length>4096||/\s/.test(accessToken)||!/^[a-fA-F0-9]{32,128}$/.test(appSecret))return fail('invalid Meta token or app secret');
 const verifyToken=data.verifyToken?String(data.verifyToken):randomToken();
 if(!/^[a-zA-Z0-9_-]{32,256}$/.test(verifyToken))return fail('verification token must have 32 to 256 letters, numbers, underscores or hyphens');
 // The account->number relationship is checked with Meta, never asserted by the browser.
 const numbers=await graphRequest('/'+data.messagingAccountId+'/phone_numbers?fields=id,display_phone_number,verified_name,status,code_verification_status&limit=100',accessToken,{fetcher});
 const number=(numbers.data||[]).find(x=>String(x.id)===data.phoneNumberId);
 if(!number)return fail('This number does not belong to the supplied Meta messaging account',409);
 if(number.status&&number.status!=='CONNECTED')return fail('Complete phone number registration in Meta before connecting',409);
 if(number.code_verification_status&&number.code_verification_status!=='VERIFIED')return fail('Complete phone ownership verification in Meta first',409);
 const templates=await fetchTemplates(data.messagingAccountId,accessToken,fetcher);
 const encrypted=await encryptCredentials(env,tid,{accessToken,appSecret});
 const date=iso(now),hash=await sha256hex(verifyToken);
 await env.CONTROL_DB.prepare(`INSERT INTO whatsapp_connections(tenant_id,messaging_account_id,phone_number_id,display_phone,verified_name,status,credentials_ciphertext,verify_token_hash,templates_json,connected_at,updated_at,revision)
 VALUES(?,?,?,?,?,'connected',?,?,?,?,?,1) ON CONFLICT(tenant_id) DO UPDATE SET messaging_account_id=excluded.messaging_account_id,phone_number_id=excluded.phone_number_id,display_phone=excluded.display_phone,verified_name=excluded.verified_name,status='connected',credentials_ciphertext=excluded.credentials_ciphertext,verify_token_hash=excluded.verify_token_hash,templates_json=excluded.templates_json,webhook_verified_at=NULL,connected_at=excluded.connected_at,updated_at=excluded.updated_at,revision=whatsapp_connections.revision+1`).bind(tid,data.messagingAccountId,data.phoneNumberId,text(number.display_phone_number,50),text(number.verified_name,160),encrypted,hash,JSON.stringify(templates),date,date).run();
 return json({saved:true,verifyToken,webhookUrl:new URL('/v1/provider/whatsapp',req.url).href,webhookVerified:false,notice:accountNotice});
}
async function saveRules(env,db,tid,data,user,{now}){
 const old=await db.prepare('SELECT * FROM whatsapp_rules WHERE tenant_id=?').bind(tid).first();
 if(!Number.isSafeInteger(data.baseRevision)||data.baseRevision!==(old?.revision||0))return fail('Rules changed. Refresh and try again.',409);
 const base=publicRules(old),r=validRuleInput({...base,...data.rules});
 const connection=await env.CONTROL_DB.prepare('SELECT * FROM whatsapp_connections WHERE tenant_id=?').bind(tid).first();
 if(r.enabled){
  if(connection?.status!=='connected'||!connection.webhook_verified_at)return fail('Connect WhatsApp and verify its incoming webhook before enabling automatic messages',409);
  if(!selectedTemplate(connection,r.templateName,r.templateLanguage))return fail('Select a compatible approved property template',409);
  if(r.secondEnabled&&!selectedTemplate(connection,r.followupTemplateName||r.templateName,r.followupTemplateName?r.followupTemplateLanguage:r.templateLanguage))return fail('Select a compatible approved follow-up template',409);
  if(r.visitReminderEnabled&&!selectedTemplate(connection,r.visitTemplateName,r.visitTemplateLanguage,{visit:true}))return fail('Select a compatible approved utility visit template',409);
 }
 const date=iso(now),start=r.enabled&&!old?.enabled?date:old?.enabled_at||null;
 const row=await db.prepare(`INSERT INTO whatsapp_rules(tenant_id,enabled,enabled_at,first_delay_minutes,second_enabled,second_delay_hours,visit_reminder_enabled,template_name,template_language,followup_template_name,followup_template_language,visit_template_name,visit_template_language,daily_limit,cursor_at,cursor_job_id,updated_at,revision)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'',?,1)
 ON CONFLICT(tenant_id) DO UPDATE SET enabled=excluded.enabled,enabled_at=excluded.enabled_at,first_delay_minutes=excluded.first_delay_minutes,second_enabled=excluded.second_enabled,second_delay_hours=excluded.second_delay_hours,visit_reminder_enabled=excluded.visit_reminder_enabled,template_name=excluded.template_name,template_language=excluded.template_language,followup_template_name=excluded.followup_template_name,followup_template_language=excluded.followup_template_language,visit_template_name=excluded.visit_template_name,visit_template_language=excluded.visit_template_language,daily_limit=excluded.daily_limit,cursor_at=CASE WHEN whatsapp_rules.enabled=0 AND excluded.enabled=1 THEN excluded.enabled_at ELSE whatsapp_rules.cursor_at END,cursor_job_id=CASE WHEN whatsapp_rules.enabled=0 AND excluded.enabled=1 THEN '' ELSE whatsapp_rules.cursor_job_id END,updated_at=excluded.updated_at,revision=whatsapp_rules.revision+1 WHERE whatsapp_rules.revision=? RETURNING revision`).bind(tid,+r.enabled,start,r.firstDelayMinutes,+r.secondEnabled,r.secondDelayHours,+r.visitReminderEnabled,r.templateName,r.templateLanguage,r.followupTemplateName,r.followupTemplateLanguage,r.visitTemplateName,r.visitTemplateLanguage,r.dailyLimit,start,date,data.baseRevision).first();
 if(!row)return fail('Rules changed. Refresh and try again.',409);
 if(!r.enabled)await db.prepare("UPDATE whatsapp_messages SET status='cancelled',reason='Automatic follow-ups paused',updated_at=? WHERE tenant_id=? AND kind!='reply' AND status IN('scheduled','pending_setup')").bind(date,tid).run();
 await audit(db,tid,user.id,'whatsapp.rules_updated',tid,now).run();
 return json({saved:true,revision:row.revision,notice:r.enabled?'Automatic follow-ups apply only to new accepted call results after activation.':'Rules saved. Automatic follow-ups are paused.'});
}
async function permission(db,tid,data,user,{now}){
 if(!UUID.test(data.leadId||'')||!['granted','revoked'].includes(data.status)||!['website_form','ad_form','existing_crm','customer_message','other'].includes(data.source))return fail('invalid customer permission');
 const reference=text(data.reference,500),stamp=Date.parse(data.capturedAt);
 if(reference.length<4||!Number.isFinite(stamp)||stamp>now+60000||stamp<0)return fail('Provide the real permission reference and capture time');
 const lead=await leadEligibility(db,tid,data.leadId,{ignoreThread:true});
 if(!lead.lead)return fail('Customer not found',404);
 if(data.status==='granted'&&(lead.lead.opted_out||lead.lead.consent_status==='denied'||lead.lead.dnd_status==='blocked'))return fail('Customer has opted out',409);
 const date=iso(now);
 const operations=[db.prepare(`INSERT INTO whatsapp_permissions(tenant_id,lead_id,status,source,reference,captured_at,actor,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,lead_id) DO UPDATE SET status=excluded.status,source=excluded.source,reference=excluded.reference,captured_at=excluded.captured_at,actor=excluded.actor,updated_at=excluded.updated_at`).bind(tid,data.leadId,data.status,data.source,reference,iso(stamp),user.id,date),audit(db,tid,user.id,'whatsapp.permission_'+data.status,data.leadId,now)];
 if(data.status==='revoked')operations.push(db.prepare("UPDATE whatsapp_messages SET status='cancelled',reason='WhatsApp permission revoked',updated_at=? WHERE tenant_id=? AND lead_id=? AND status IN('scheduled','pending_setup')").bind(date,tid,data.leadId));
 await db.batch(operations);return json({saved:true,notice:'Permission evidence saved. No message was sent.'});
}
async function schedule(env,db,tid,data,user,{now}){
 if(!UUID.test(data.leadId||'')||!UUID.test(data.campaignId||'')||!UUID.test(data.propertyId||'')||!['property_details','followup','visit_reminder'].includes(data.kind))return fail('Select a customer, campaign and its property');
 if(data.requestId!==undefined&&!UUID.test(data.requestId))return fail('invalid scheduling request ID');
 const due=Date.parse(data.dueAt);if(!Number.isFinite(due))return fail('invalid schedule time');
 const sourceKey='manual:'+(data.requestId||crypto.randomUUID());
 const existing=await db.prepare('SELECT id,lead_id,campaign_id,property_id,visit_id,kind,due_at,status FROM whatsapp_messages WHERE tenant_id=? AND source_key=?').bind(tid,sourceKey).first();
 if(existing){
  if(existing.lead_id!==data.leadId||existing.campaign_id!==data.campaignId||existing.property_id!==data.propertyId||existing.kind!==data.kind||existing.due_at!==iso(due)||(existing.visit_id||null)!==(data.visitId||null))return fail('This request ID was already used for a different schedule',409);
  return json({saved:true,id:existing.id,status:existing.status,alreadyScheduled:true,notice:'This schedule was already saved. Its current status is shown.'});
 }
 if(due<now-60000||due>now+30*86400000)return fail('Schedule within the next 30 days');
 const eligibility=await leadEligibility(db,tid,data.leadId,{ignoreThread:data.kind==='visit_reminder'});if(eligibility.reason)return fail(eligibility.reason,409);
 if(['not_interested','converted'].includes(eligibility.lead.interest_status))return fail('This customer is not eligible for prospect follow-ups',409);
 const selected=await getCampaignProperties(db,tid,data.campaignId,{availableOnly:true});
 const property=selected.find(x=>x.id===data.propertyId);if(!property)return fail('Choose an available property selected for this campaign',409);
 const candidate=await db.prepare('SELECT 1 AS found FROM call_campaign_candidates WHERE tenant_id=? AND campaign_id=? AND lead_id=?').bind(tid,data.campaignId,data.leadId).first();if(!candidate)return fail('Customer does not belong to this campaign',409);
 const rules=publicRules(await db.prepare('SELECT * FROM whatsapp_rules WHERE tenant_id=?').bind(tid).first());
 const connection=await env.CONTROL_DB.prepare('SELECT * FROM whatsapp_connections WHERE tenant_id=?').bind(tid).first();
 let visit=null;
 if(data.kind==='visit_reminder'){
  if(!UUID.test(data.visitId||''))return fail('Choose a confirmed site visit');
  visit=await db.prepare("SELECT * FROM site_visits WHERE tenant_id=? AND id=? AND lead_id=? AND status='confirmed' AND scheduled_at>?").bind(tid,data.visitId,data.leadId,iso(now)).first();
  if(!visit||due>=Date.parse(visit.scheduled_at))return fail('The reminder must be before a confirmed upcoming visit',409);
 }
 const templateName=data.kind==='visit_reminder'?rules.visitTemplateName:data.kind==='followup'?(rules.followupTemplateName||rules.templateName):rules.templateName;
 const templateLanguage=data.kind==='visit_reminder'?rules.visitTemplateLanguage:data.kind==='followup'&&rules.followupTemplateName?rules.followupTemplateLanguage:rules.templateLanguage;
 const ready=connection?.status==='connected'&&connection.webhook_verified_at&&selectedTemplate(connection,templateName,templateLanguage,{visit:!!visit});
 const id=await enqueueMessage(db,{tenantId:tid,leadId:data.leadId,campaignId:data.campaignId,propertyId:property.id,visitId:visit?.id,kind:data.kind,dueAt:iso(due),sourceAt:iso(now),sourceKey,templateName,templateLanguage,status:ready?'scheduled':'pending_setup',reason:ready?'':'Complete WhatsApp connection and template setup',payload:visit?{visitAt:visit.scheduled_at}:{},now});
 if(!id){
  const raced=await db.prepare('SELECT id,lead_id,campaign_id,property_id,visit_id,kind,due_at,status FROM whatsapp_messages WHERE tenant_id=? AND source_key=?').bind(tid,sourceKey).first();
  if(!raced||raced.lead_id!==data.leadId||raced.campaign_id!==data.campaignId||raced.property_id!==data.propertyId||raced.kind!==data.kind||raced.due_at!==iso(due)||(raced.visit_id||null)!==(data.visitId||null))return fail('This request ID was already used for a different schedule',409);
  return json({saved:true,id:raced.id,status:raced.status,alreadyScheduled:true,notice:'This schedule was already saved.'});
 }
 await audit(db,tid,user.id,'whatsapp.message_scheduled',id,now).run();return json({saved:true,id,status:ready?'scheduled':'pending_setup',notice:ready?'Message scheduled. Delivery is checked at send time.':'Schedule saved; waiting for WhatsApp setup. No message was sent.'},201);
}
export async function handleWhatsAppRequest(req,env,user,{now=Date.now(),fetcher=fetch}={}){
 const url=new URL(req.url);if(url.pathname!==PATH)return null;
 if(!['GET','POST'].includes(req.method))return fail('method not allowed',405);
 if(!mutationOriginAllowed(req))return fail('same-origin request required',403);
 try{
  let data;
  if(req.method==='GET')data=Object.fromEntries(url.searchParams);
  else{if(!req.headers.get('content-type')?.startsWith('application/json'))return fail('JSON required');data=JSON.parse(await boundedText(req));}
  if(!data||typeof data!=='object'||Array.isArray(data)||!UUID.test(data.tenantId||''))return fail('invalid tenant');
  const tid=data.tenantId,member=await memberFor(env,user,tid,req.method==='POST',{now});if(!member)return fail('forbidden',403);
  const db=resolveCrmDb(env,member);
  if(req.method==='GET')return await overview(req,env,user,member,db,tid,{now});
  const action=data.action;
  if(['connect','sync_templates','pause_connection','resume_connection'].includes(action)&&user.globalRole!=='super_admin')return fail('Super Admin connects the Meta account',403);
  if(action==='connect')return await connect(req,env,tid,data,{now,fetcher});
  if(action==='sync_templates'){
   const connection=await env.CONTROL_DB.prepare('SELECT * FROM whatsapp_connections WHERE tenant_id=?').bind(tid).first();if(!connection)return fail('WhatsApp is not connected',409);
   const credentials=await decryptCredentials(env,tid,connection.credentials_ciphertext),templates=await fetchTemplates(connection.messaging_account_id,credentials.accessToken,fetcher);
   await env.CONTROL_DB.prepare('UPDATE whatsapp_connections SET templates_json=?,updated_at=?,revision=revision+1 WHERE tenant_id=?').bind(JSON.stringify(templates),iso(now),tid).run();return json({saved:true,templates});
  }
  if(action==='pause_connection'){await env.CONTROL_DB.prepare("UPDATE whatsapp_connections SET status='paused',updated_at=?,revision=revision+1 WHERE tenant_id=?").bind(iso(now),tid).run();return json({saved:true});}
  if(action==='resume_connection'){
   const connection=await env.CONTROL_DB.prepare('SELECT * FROM whatsapp_connections WHERE tenant_id=?').bind(tid).first();if(!connection)return fail('WhatsApp is not connected',409);
   const credentials=await decryptCredentials(env,tid,connection.credentials_ciphertext);
   const numbers=await graphRequest('/'+connection.messaging_account_id+'/phone_numbers?fields=id,status&limit=100',credentials.accessToken,{fetcher});
   const number=(numbers.data||[]).find(n=>String(n.id)===connection.phone_number_id);
   if(!number||(number.status&&number.status!=='CONNECTED'))return fail('Verify the number registration in Meta first',409);
   const templates=await fetchTemplates(connection.messaging_account_id,credentials.accessToken,fetcher);
   await env.CONTROL_DB.prepare("UPDATE whatsapp_connections SET status='connected',templates_json=?,updated_at=?,revision=revision+1 WHERE tenant_id=?").bind(JSON.stringify(templates),iso(now),tid).run();return json({saved:true});
  }
  if(action==='save_rules')return await saveRules(env,db,tid,data,user,{now});
  if(action==='permission')return await permission(db,tid,data,user,{now});
  if(action==='schedule')return await schedule(env,db,tid,data,user,{now});
  if(action==='reply')return await sendReply(env,member,db,data,user,{now,fetcher});
  if(action==='cancel'){
   if(!UUID.test(data.messageId||''))return fail('invalid message');
   const row=await db.prepare("UPDATE whatsapp_messages SET status='cancelled',reason='Cancelled by staff',updated_at=? WHERE tenant_id=? AND id=? AND status IN('scheduled','pending_setup') RETURNING id").bind(iso(now),tid,data.messageId).first();
   if(!row)return fail('Message cannot be cancelled in its current state',409);await audit(db,tid,user.id,'whatsapp.message_cancelled',row.id,now).run();return json({saved:true});
  }
  if(['pause_lead','resume_lead'].includes(action)){
   if(!UUID.test(data.leadId||''))return fail('invalid customer');
   const lead=await db.prepare('SELECT id FROM leads WHERE tenant_id=? AND id=?').bind(tid,data.leadId).first();if(!lead)return fail('Customer not found',404);
   const paused=action==='pause_lead'?1:0;
   const ops=[db.prepare('INSERT INTO whatsapp_threads(tenant_id,lead_id,paused,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,lead_id) DO UPDATE SET paused=excluded.paused,updated_at=excluded.updated_at').bind(tid,data.leadId,paused,iso(now)),audit(db,tid,user.id,'whatsapp.'+action,data.leadId,now)];
   if(paused)ops.push(db.prepare("UPDATE whatsapp_messages SET status='cancelled',reason='Paused by staff',updated_at=? WHERE tenant_id=? AND lead_id=? AND status IN('scheduled','pending_setup')").bind(iso(now),tid,data.leadId));await db.batch(ops);return json({saved:true});
  }
  return fail('unknown WhatsApp action');
 }catch(e){
  if(e?.definitive)return fail('Meta rejected the connection or request. Check the account, number, token permissions and billing. Code '+e.providerCode,409);
  if(/UNIQUE constraint/.test(String(e?.message)))return fail('This WhatsApp number is already connected to a client',409);
  if(/invalid|Provide|storage unavailable|too large/.test(String(e?.message)))return fail(e.message,400);
  console.error('AR3D WhatsApp operation unavailable');return fail('WhatsApp operation temporarily unavailable',503);
 }
}
