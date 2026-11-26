import {getCampaignProperties,getProperty,matchCampaignProperties,createPropertyAssetShare} from './property-catalog.mjs';
import {UUID,iso,text,json,fail,publicRules,selectedTemplate,decryptCredentials,graphRequest,fetchTemplates,leadEligibility,leadPreferences,resolveCrmDb,audit,PENDING_INBOUND_SQL} from './whatsapp-core.mjs';
import {applyPendingStatusEvents} from './whatsapp-webhook.mjs';

export async function enqueueMessage(db,{tenantId,leadId,campaignId=null,propertyId=null,visitId=null,kind,dueAt,sourceAt,sourceKey,templateName='',templateLanguage='hi',status='scheduled',reason='',payload={},now=Date.now()}){
 const id=crypto.randomUUID(),date=iso(now);
 const row=await db.prepare(`INSERT INTO whatsapp_messages(tenant_id,id,source_key,lead_id,campaign_id,property_id,visit_id,kind,due_at,status,reason,template_name,template_language,source_at,payload_json,created_at,updated_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,source_key) DO NOTHING RETURNING id`).bind(tenantId,id,sourceKey,leadId,campaignId,propertyId,visitId,kind,dueAt,status,reason,templateName,templateLanguage,sourceAt,JSON.stringify(payload),date,date).first();
 return row?.id||null;
}
function parse(v){try{return JSON.parse(v||'{}');}catch{return {};}}
function templateForKind(rules,kind){
 if(kind==='visit_reminder')return {name:rules.visitTemplateName,language:rules.visitTemplateLanguage};
 if(kind==='followup'&&rules.followupTemplateName)return {name:rules.followupTemplateName,language:rules.followupTemplateLanguage};
 return {name:rules.templateName,language:rules.templateLanguage};
}
export async function reconcileAcceptedCalls(env,member,db,rules,{now=Date.now(),limit=2}={}){
 const tid=member.tenant_id;if(!rules.enabled||!rules.enabledAt)return 0;
 const row=await db.prepare('SELECT cursor_at,cursor_job_id FROM whatsapp_rules WHERE tenant_id=?').bind(tid).first();
 const cursor=row?.cursor_at||rules.enabledAt,job=row?.cursor_job_id||'';
 const results=await db.prepare(`SELECT r.job_id,r.session_id,r.answers_json,r.captured_at,j.lead_id,cr.campaign_id FROM scripted_call_results r JOIN calling_jobs j ON j.tenant_id=r.tenant_id AND j.id=r.job_id JOIN calling_runs cr ON cr.tenant_id=j.tenant_id AND cr.id=j.run_id
 WHERE r.tenant_id=? AND r.saved_to_lead=1 AND r.captured_at>=? AND (r.captured_at>? OR (r.captured_at=? AND r.job_id>?)) ORDER BY r.captured_at,r.job_id LIMIT ?`).bind(tid,rules.enabledAt,cursor,cursor,job,limit).all();
 let queued=0;
 for(const result of results.results||[]){
  const e=await leadEligibility(db,tid,result.lead_id),answers=parse(result.answers_json);
  const latestCall=parse(e.lead?.requirements_json).scriptedCallPilot;
  if(!e.reason&&e.lead&&(Date.parse(e.lead.updated_at)>Date.parse(result.captured_at)+1||(latestCall?.id&&latestCall.id!==result.session_id)))e.reason='Customer record changed after this call. Salesperson review is required.';
  if(!e.reason&&e.lead.interest_status==='interested'){
   const properties=await getCampaignProperties(db,tid,result.campaign_id,{availableOnly:true});
   const match=matchCampaignProperties(properties,leadPreferences(e.lead,answers));
   const selected=match[0];
   const due=Date.parse(result.captured_at)+rules.firstDelayMinutes*60000;
   const common={tenantId:tid,leadId:result.lead_id,campaignId:result.campaign_id,propertyId:selected?.id||null,sourceAt:result.captured_at,now};
   if(!selected){
    await enqueueMessage(db,{...common,kind:'property_details',dueAt:iso(due),sourceKey:'call:'+result.job_id+':first',status:'review_required',reason:'No matching available property in this campaign. Salesperson review needed.'});
   }else{
    const first=templateForKind(rules,'property_details');
    if(await enqueueMessage(db,{...common,kind:'property_details',dueAt:iso(due),sourceKey:'call:'+result.job_id+':first',templateName:first.name,templateLanguage:first.language,payload:{answers,leadUpdatedAt:e.lead.updated_at,propertyRevision:selected.revision}}))queued++;
    if(rules.secondEnabled){const second=templateForKind(rules,'followup');if(await enqueueMessage(db,{...common,kind:'followup',dueAt:iso(due+rules.secondDelayHours*3600000),sourceKey:'call:'+result.job_id+':second',templateName:second.name,templateLanguage:second.language,payload:{answers,leadUpdatedAt:e.lead.updated_at,propertyRevision:selected.revision,firstSourceKey:'call:'+result.job_id+':first'}}))queued++;}
   }
  }else if(e.lead?.interest_status==='interested'&&e.reason){
   await enqueueMessage(db,{tenantId:tid,leadId:result.lead_id,campaignId:result.campaign_id,kind:'property_details',dueAt:iso(Date.parse(result.captured_at)+rules.firstDelayMinutes*60000),sourceAt:result.captured_at,sourceKey:'call:'+result.job_id+':first',status:e.lead.opted_out?'cancelled':'review_required',reason:e.reason,now});
  }
  // The cursor advances only after idempotent enqueue. A crash cannot lose an accepted event.
  await db.prepare('UPDATE whatsapp_rules SET cursor_at=?,cursor_job_id=? WHERE tenant_id=? AND enabled=1 AND enabled_at=?').bind(result.captured_at,result.job_id,tid,rules.enabledAt).run();
 }
 return queued;
}
export async function reconcileVisits(env,member,db,rules,{now=Date.now(),limit=2}={}){
 if(!rules.enabled||!rules.visitReminderEnabled)return 0;
 const tid=member.tenant_id;
 // Existing confirmed visits are considered only while the client explicitly enables visit reminders.
 // Each reminder remains tied to its exact confirmed time; rescheduling invalidates the old row.
 const visits=await db.prepare(`SELECT v.id,v.lead_id,v.scheduled_at,(SELECT m.campaign_id FROM whatsapp_messages m WHERE m.tenant_id=v.tenant_id AND m.visit_id=v.id AND m.property_id IS NOT NULL ORDER BY m.created_at DESC LIMIT 1) AS campaign_id,
 (SELECT m.property_id FROM whatsapp_messages m WHERE m.tenant_id=v.tenant_id AND m.visit_id=v.id AND m.property_id IS NOT NULL ORDER BY m.created_at DESC LIMIT 1) AS property_id
 FROM site_visits v WHERE v.tenant_id=? AND v.status='confirmed' AND v.scheduled_at>? AND v.scheduled_at<=?
 AND NOT EXISTS(SELECT 1 FROM whatsapp_messages m WHERE m.tenant_id=v.tenant_id AND m.visit_id=v.id AND m.kind='visit_reminder' AND json_extract(m.payload_json,'$.visitAt')=v.scheduled_at) ORDER BY v.scheduled_at,v.id LIMIT ?`).bind(tid,iso(now),iso(now+3*3600000),limit).all();
 let queued=0;
 for(const v of visits.results||[]){
  const e=await leadEligibility(db,tid,v.lead_id,{ignoreThread:true});if(e.reason||!v.campaign_id||!v.property_id)continue;
  const name=templateForKind(rules,'visit_reminder');
  if(await enqueueMessage(db,{tenantId:tid,leadId:v.lead_id,campaignId:v.campaign_id,propertyId:v.property_id,visitId:v.id,kind:'visit_reminder',dueAt:iso(Math.max(now,Date.parse(v.scheduled_at)-2*3600000)),sourceAt:iso(now),sourceKey:'visit:'+v.id+':'+v.scheduled_at,templateName:name.name,templateLanguage:name.language,payload:{visitAt:v.scheduled_at},now}))queued++;
 }
 return queued;
}
export function priceText(property){
 if(property.priceBasis==='on_request'||property.priceMinInr==null)return 'Price available from the sales team';
 const f=n=>'₹'+Number(n).toLocaleString('en-IN');
 const range=f(property.priceMinInr)+(property.priceMaxInr!=null&&property.priceMaxInr!==property.priceMinInr?' – '+f(property.priceMaxInr):'');
 const suffix={total:' total',per_sqft:' / sq ft',per_sqyd:' / sq yd',per_sqm:' / sq m',per_acre:' / acre'}[property.priceBasis]||'';
 return range+suffix;
}
export async function buildTemplatePayload(env,member,lead,property,message,template,{now=Date.now(),origin}={}){
 const location=[property.address,property.locality,property.city].filter(Boolean).join(', ');
 const brochure=(property.assets||[]).find(a=>a.kind==='brochure');
 let brochureUrl=null;
 if(brochure&&origin){const share=await createPropertyAssetShare(env,{tenantId:member.tenant_id,assetId:brochure.id,origin,ttlSeconds:3600},{now});brochureUrl=share.url;}
 if(template.hasDocument&&!brochureUrl)throw Error('Approved template requires an uploaded property brochure');
 const links=[property.websiteUrl,property.mapUrl,brochureUrl].filter(Boolean).join(' ');
 const detail=links||[property.contactName,property.contactPhone].filter(Boolean).join(' ')||'Please reply to speak with our sales team';
 const snapshot=parse(message.payload_json);
 const fourth=message.kind==='visit_reminder'?new Intl.DateTimeFormat(template.language?.startsWith('hi')?'hi-IN':'en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(new Date(snapshot.visitAt)):priceText(property);
 const values=[lead.name||'Customer',member.display_name||'Our team',property.name,fourth,location||property.city,detail].map(x=>text(x,1000));
 const components=[];
 if(template.hasDocument)components.push({type:'header',parameters:[{type:'document',document:{link:brochureUrl,filename:text(brochure.fileName,100)}}]});
 components.push({type:'body',parameters:values.map(value=>({type:'text',text:value}))});
 return {body:{messaging_product:'whatsapp',recipient_type:'individual',to:lead.mobile_e164.replace(/^\+/,''),type:'template',template:{name:template.name,language:{code:template.language},components}},snapshot:{propertyId:property.id,propertyRevision:property.revision,templateName:template.name,templateLanguage:template.language,values,visitAt:snapshot.visitAt||null}};
}
async function setMessageState(db,tid,id,status,reason,now){
 await db.prepare("UPDATE whatsapp_messages SET status=?,reason=?,updated_at=? WHERE tenant_id=? AND id=? AND status IN('scheduled','pending_setup')").bind(status,text(reason,300),iso(now),tid,id).run();
}
function indiaDayStart(now){const d=new Date(now+19800000);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-19800000).toISOString();}
async function claimMessage(db,tid,message,lead,property,rules,now){
 const visitAt=parse(message.payload_json).visitAt||'';
 return db.prepare(`UPDATE whatsapp_messages SET status='unknown',reason='Send outcome not yet confirmed',submitted_at=?,updated_at=? WHERE tenant_id=? AND id=? AND status IN('scheduled','pending_setup') AND due_at<=?
 AND EXISTS(SELECT 1 FROM leads l JOIN whatsapp_permissions p ON p.tenant_id=l.tenant_id AND p.lead_id=l.id LEFT JOIN whatsapp_threads t ON t.tenant_id=l.tenant_id AND t.lead_id=l.id WHERE l.tenant_id=? AND l.id=? AND l.updated_at=? AND p.status='granted' AND l.consent_status!='denied' AND l.dnd_status!='blocked' AND l.interest_status NOT IN('not_interested','converted') AND (COALESCE(t.paused,0)=0 OR whatsapp_messages.kind='visit_reminder') AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id) AND NOT EXISTS(SELECT 1 FROM whatsapp_event_receipts r,json_each(r.payload_json) e WHERE r.tenant_id=l.tenant_id AND r.event_key LIKE 'batch:%' AND r.processed_at IS NULL AND CAST(e.key AS INTEGER)>=r.cursor AND json_extract(e.value,'$.kind')='message' AND json_extract(e.value,'$.value.from') IN(l.mobile_e164,replace(l.mobile_e164,'+',''))))
 AND EXISTS(SELECT 1 FROM properties p JOIN campaign_properties cp ON cp.tenant_id=p.tenant_id AND cp.property_id=p.id WHERE p.tenant_id=? AND p.id=? AND p.status='available' AND p.revision=? AND cp.campaign_id=?)
 AND (kind!='visit_reminder' OR EXISTS(SELECT 1 FROM site_visits v WHERE v.tenant_id=whatsapp_messages.tenant_id AND v.id=whatsapp_messages.visit_id AND v.lead_id=whatsapp_messages.lead_id AND v.status='confirmed' AND v.scheduled_at=? AND v.scheduled_at>?))
 AND (source_key LIKE 'manual:%' OR EXISTS(SELECT 1 FROM whatsapp_rules r WHERE r.tenant_id=whatsapp_messages.tenant_id AND r.enabled=1 AND r.revision=?))
 AND (SELECT COUNT(*) FROM whatsapp_messages d WHERE d.tenant_id=? AND d.submitted_at>=? AND d.status IN('unknown','submitted','delivered','read','replied'))<? RETURNING id`).bind(iso(now),iso(now),tid,message.id,iso(now),tid,message.lead_id,lead.updated_at,tid,property.id,property.revision,message.campaign_id,visitAt,iso(now),rules.revision,tid,indiaDayStart(now),rules.dailyLimit).first();
}
export async function dispatchMessage(env,member,db,connection,rules,message,{now=Date.now(),fetcher=fetch,origin}={}){
 const tid=member.tenant_id;
 if(!message.source_key.startsWith('manual:')&&!rules.enabled){await setMessageState(db,tid,message.id,'cancelled','Automatic follow-ups paused',now);return {sent:false};}
 if(connection?.status!=='connected'||!connection.webhook_verified_at){await setMessageState(db,tid,message.id,'pending_setup','Connect WhatsApp and verify its webhook',now);return {sent:false};}
 if(Date.parse(message.due_at)<now-24*3600000){await setMessageState(db,tid,message.id,'cancelled','Scheduled message expired without delivery',now);return {sent:false};}
 const eligible=await leadEligibility(db,tid,message.lead_id,{ignoreThread:message.kind==='visit_reminder'});
 if(eligible.reason||['not_interested','converted'].includes(eligible.lead?.interest_status)){await setMessageState(db,tid,message.id,'cancelled',eligible.reason||'Customer is no longer a prospect',now);return {sent:false};}
 if(eligible.lead.last_inbound_at&&eligible.lead.last_inbound_at>=message.source_at&&message.kind!=='visit_reminder'){await setMessageState(db,tid,message.id,'cancelled','Customer replied; salesperson follow-up required',now);return {sent:false};}
 const snapshot=parse(message.payload_json);
 if(message.source_key.startsWith('call:')&&snapshot.leadUpdatedAt&&snapshot.leadUpdatedAt!==eligible.lead.updated_at){await setMessageState(db,tid,message.id,'review_required','Customer requirements changed after the call. Review the property before messaging.',now);return {sent:false};}
 if(message.kind==='followup'&&snapshot.firstSourceKey){
  const first=await db.prepare('SELECT status FROM whatsapp_messages WHERE tenant_id=? AND source_key=?').bind(tid,snapshot.firstSourceKey).first();
  if(!['delivered','read'].includes(first?.status)){await setMessageState(db,tid,message.id,'cancelled','First property message was not confirmed delivered',now);return {sent:false};}
 }
 const properties=await getCampaignProperties(db,tid,message.campaign_id,{availableOnly:true}),property=properties.find(p=>p.id===message.property_id);
 if(!property){await setMessageState(db,tid,message.id,'review_required','Selected property is unavailable or removed from campaign',now);return {sent:false};}
 if(message.source_key.startsWith('call:')&&!matchCampaignProperties([property],leadPreferences(eligible.lead,snapshot.answers)).length){await setMessageState(db,tid,message.id,'review_required','Property no longer matches customer requirements',now);return {sent:false};}
 if(message.kind==='visit_reminder'){
  const visit=await db.prepare("SELECT scheduled_at FROM site_visits WHERE tenant_id=? AND id=? AND lead_id=? AND status='confirmed'").bind(tid,message.visit_id,message.lead_id).first();
  if(!visit||visit.scheduled_at!==snapshot.visitAt||Date.parse(visit.scheduled_at)<=now){await setMessageState(db,tid,message.id,'cancelled','Visit was changed, cancelled or is no longer upcoming',now);return {sent:false};}
 }
 let name=message.template_name,language=message.template_language;
 if(!name){const chosen=templateForKind(rules,message.kind);name=chosen.name;language=chosen.language;}
 const credentials=await decryptCredentials(env,tid,connection.credentials_ciphertext);
 // Approval can be paused/rejected after setup; re-read Meta immediately before dispatch.
 let currentTemplates;
 try{currentTemplates=await fetchTemplates(connection.messaging_account_id,credentials.accessToken,fetcher);}catch{await setMessageState(db,tid,message.id,'pending_setup','Meta template verification is unavailable; check connection and templates',now);return {sent:false};}
 const cached=JSON.stringify(currentTemplates);
 if(cached!==connection.templates_json){await env.CONTROL_DB.prepare('UPDATE whatsapp_connections SET templates_json=?,updated_at=? WHERE tenant_id=?').bind(cached,iso(now),tid).run();}
 const template=selectedTemplate({...connection,templates_json:cached},name,language,{visit:message.kind==='visit_reminder'});
 if(!template){await setMessageState(db,tid,message.id,'pending_setup','Select a compatible approved template',now);return {sent:false};}
 let payload;try{payload=await buildTemplatePayload(env,member,eligible.lead,property,message,template,{now,origin});}catch(e){await setMessageState(db,tid,message.id,'review_required',e.message==='Approved template requires an uploaded property brochure'?e.message:'Property media is not ready for this message',now);return {sent:false};}
 const currentConnection=await env.CONTROL_DB.prepare('SELECT c.status,c.revision,'+PENDING_INBOUND_SQL+' AS pending_inbound FROM whatsapp_connections c WHERE tenant_id=?').bind(tid).first();
 if(currentConnection?.status!=='connected'||currentConnection.revision!==connection.revision||currentConnection.pending_inbound){await setMessageState(db,tid,message.id,'pending_setup',currentConnection?.pending_inbound?'Incoming customer messages are being processed':'WhatsApp connection changed',now);return {sent:false};}
 const claimed=await claimMessage(db,tid,message,eligible.lead,property,rules,now);if(!claimed)return {sent:false,reason:'Customer, property, visit, rules or daily limit changed'};
 try{
  const result=await graphRequest('/'+connection.phone_number_id+'/messages',credentials.accessToken,{fetcher,method:'POST',body:payload.body});
  const providerId=result.messages?.[0]?.id;
  if(typeof providerId!=='string'||providerId.length>250)throw Error('No provider acknowledgement');
  await db.prepare("UPDATE whatsapp_messages SET status='submitted',provider_message_id=?,payload_json=?,reason='',updated_at=? WHERE tenant_id=? AND id=? AND status='unknown'").bind(providerId,JSON.stringify(payload.snapshot),iso(now),tid,message.id).run();
  await applyPendingStatusEvents(db,tid,{now,limit:1});
  return {sent:true,id:message.id};
 }catch(e){
  if(e?.definitive)await db.prepare("UPDATE whatsapp_messages SET status='failed',reason=?,updated_at=? WHERE tenant_id=? AND id=? AND status='unknown'").bind('Meta rejected message (code '+e.providerCode+')',iso(now),tid,message.id).run();
  // Timeout/invalid response/ack-persistence failure remain unknown and are never retried blindly.
  return {sent:false,unknown:!e?.definitive};
 }
}
export async function sendReply(env,member,db,data,user,{now=Date.now(),fetcher=fetch}={}){
 const tid=member.tenant_id;if(!UUID.test(data.leadId||''))return fail('invalid customer');
 const content=text(data.text,2000);if(!content)return fail('Enter a reply');
 if(data.requestId!==undefined&&!UUID.test(data.requestId))return fail('invalid reply request ID');
 const sourceKey='reply:'+(data.requestId||crypto.randomUUID());
 const existing=await db.prepare('SELECT id,lead_id,status,payload_json FROM whatsapp_messages WHERE tenant_id=? AND source_key=?').bind(tid,sourceKey).first();
 if(existing){
  if(existing.lead_id!==data.leadId||parse(existing.payload_json).text!==content)return fail('This request ID was already used for a different reply',409);
  return json({saved:true,id:existing.id,status:existing.status,alreadySubmitted:true,notice:'This reply was already saved. Current status: '+existing.status+'.'});
 }
 const e=await leadEligibility(db,tid,data.leadId,{ignoreThread:true});
 if(!e.lead||e.lead.opted_out||e.lead.pending_whatsapp_inbound||e.lead.consent_status==='denied'||e.lead.dnd_status==='blocked')return fail('Customer is unavailable or opted out',409);
 if(!e.lead.last_inbound_at||now-Date.parse(e.lead.last_inbound_at)>24*3600000)return fail('The customer service window is closed. Use an approved template.',409);
 const connection=await env.CONTROL_DB.prepare('SELECT * FROM whatsapp_connections WHERE tenant_id=?').bind(tid).first();
 if(connection?.status!=='connected'||!connection.webhook_verified_at)return fail('WhatsApp is not ready',409);
 const credentials=await decryptCredentials(env,tid,connection.credentials_ciphertext);
 const current=await env.CONTROL_DB.prepare('SELECT c.status,c.revision,'+PENDING_INBOUND_SQL+' AS pending_inbound FROM whatsapp_connections c WHERE tenant_id=?').bind(tid).first();
 if(current?.status!=='connected'||current.revision!==connection.revision||current.pending_inbound)return fail(current?.pending_inbound?'Incoming customer messages are being processed. Refresh before replying.':'WhatsApp connection changed. Refresh before replying.',409);
 const id=crypto.randomUUID(),date=iso(now);
 // Claim the paid send in the same SQLite statement as the final contact/window/limit check.
 // A STOP arriving during connection lookup or decryption must prevent this INSERT.
 const claimed=await db.prepare(`INSERT INTO whatsapp_messages(tenant_id,id,source_key,lead_id,kind,due_at,status,reason,source_at,payload_json,created_at,updated_at,submitted_at)
 SELECT ?,?,?,?,'reply',?,'unknown','Send outcome not yet confirmed',?,?,?,?,?
 WHERE EXISTS(SELECT 1 FROM leads l JOIN whatsapp_threads t ON t.tenant_id=l.tenant_id AND t.lead_id=l.id LEFT JOIN whatsapp_permissions p ON p.tenant_id=l.tenant_id AND p.lead_id=l.id WHERE l.tenant_id=? AND l.id=? AND l.mobile_e164=? AND l.updated_at=? AND l.consent_status!='denied' AND l.dnd_status!='blocked' AND COALESCE(p.status,'unknown')!='revoked' AND t.last_inbound_at>? AND t.last_inbound_at<=? AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id) AND NOT EXISTS(SELECT 1 FROM whatsapp_event_receipts r,json_each(r.payload_json) e WHERE r.tenant_id=l.tenant_id AND r.event_key LIKE 'batch:%' AND r.processed_at IS NULL AND CAST(e.key AS INTEGER)>=r.cursor AND json_extract(e.value,'$.kind')='message' AND json_extract(e.value,'$.value.from') IN(l.mobile_e164,replace(l.mobile_e164,'+',''))))
 AND (SELECT COUNT(*) FROM whatsapp_messages m WHERE m.tenant_id=? AND m.submitted_at>=? AND m.status IN('unknown','submitted','delivered','read','replied'))<COALESCE((SELECT daily_limit FROM whatsapp_rules WHERE tenant_id=?),100)
 ON CONFLICT(tenant_id,source_key) DO NOTHING RETURNING id`).bind(tid,id,sourceKey,data.leadId,date,date,JSON.stringify({text:content}),date,date,date,tid,data.leadId,e.lead.mobile_e164,e.lead.updated_at,iso(now-24*3600000),iso(now+60000),tid,indiaDayStart(now),tid).first();
 if(!claimed){
  const raced=await db.prepare('SELECT id,lead_id,status,payload_json FROM whatsapp_messages WHERE tenant_id=? AND source_key=?').bind(tid,sourceKey).first();
  if(raced&&raced.lead_id===data.leadId&&parse(raced.payload_json).text===content)return json({saved:true,id:raced.id,status:raced.status,alreadySubmitted:true,notice:'This reply was already saved. Current status: '+raced.status+'.'});
  return fail('Customer contact status, reply window or daily limit changed. Refresh before replying.',409);
 }
 try{
  const result=await graphRequest('/'+connection.phone_number_id+'/messages',credentials.accessToken,{fetcher,method:'POST',body:{messaging_product:'whatsapp',recipient_type:'individual',to:e.lead.mobile_e164.replace(/^\+/,''),type:'text',text:{preview_url:false,body:content}}});
  const providerId=result.messages?.[0]?.id;if(typeof providerId!=='string'||providerId.length>250)throw Error('No provider acknowledgement');
  await db.prepare("UPDATE whatsapp_messages SET status='submitted',provider_message_id=?,reason='',updated_at=? WHERE tenant_id=? AND id=? AND status='unknown'").bind(providerId,iso(now),tid,id).run();
  await audit(db,tid,user.id,'whatsapp.reply_submitted',id,now).run();return json({saved:true,id,status:'submitted',notice:'Reply submitted to Meta. Delivery will be updated by webhook.'});
 }catch(e){if(e?.definitive)await db.prepare("UPDATE whatsapp_messages SET status='failed',reason=?,updated_at=? WHERE tenant_id=? AND id=? AND status='unknown'").bind('Meta rejected reply (code '+e.providerCode+')',iso(now),tid,id).run();return json({saved:true,id,status:e?.definitive?'failed':'unknown',notice:e?.definitive?'Reply was rejected. Check the error in the message history.':'Delivery outcome is unknown. Do not resend automatically.'},202);}
}
export async function runWhatsAppCron(env,{now=Date.now(),fetcher=fetch,maxTenants=1,maxSends=1,origin='https://aicalling.ar3dstudio.in'}={}){
 if(!Number.isSafeInteger(now)||now<0)throw Error('invalid WhatsApp cron timestamp');
 // Keep this independent cron within a free-tier D1 invocation budget.
 maxTenants=1;maxSends=1;
 const rows=await env.CONTROL_DB.prepare("SELECT c.*,t.id AS tenant_id,t.display_name,t.storage_mode,t.dedicated_binding,t.status AS tenant_status FROM whatsapp_connections c JOIN tenants t ON t.id=c.tenant_id WHERE c.status='connected' AND c.webhook_verified_at IS NOT NULL AND t.status IN('trial','active') AND NOT("+PENDING_INBOUND_SQL+") ORDER BY COALESCE(c.last_polled_at,''),c.tenant_id LIMIT ?").bind(maxTenants).all();
 let sent=0,queued=0,checked=0;
 for(const connection of rows.results||[]){
  const tid=connection.tenant_id;
  await env.CONTROL_DB.prepare('UPDATE whatsapp_connections SET last_polled_at=? WHERE tenant_id=?').bind(iso(now),tid).run();
  const member={tenant_id:tid,display_name:connection.display_name,storage_mode:connection.storage_mode,dedicated_binding:connection.dedicated_binding};
  try{
   const db=resolveCrmDb(env,member),rules=publicRules(await db.prepare('SELECT * FROM whatsapp_rules WHERE tenant_id=?').bind(tid).first());
   await applyPendingStatusEvents(db,tid,{now,limit:1});
   queued+=await reconcileAcceptedCalls(env,member,db,rules,{now,limit:1});
   if(rules.visitReminderEnabled)queued+=await reconcileVisits(env,member,db,rules,{now,limit:1});
   const due=await db.prepare("SELECT * FROM whatsapp_messages WHERE tenant_id=? AND status IN('scheduled','pending_setup') AND kind!='reply' AND due_at<=? ORDER BY due_at,id LIMIT ?").bind(tid,iso(now),maxSends).all();
   for(const message of due.results||[]){const result=await dispatchMessage(env,member,db,connection,rules,message,{now,fetcher,origin});if(result.sent)sent++;}
   checked++;
  }catch{console.error('AR3D WhatsApp scheduled operation unavailable');}
 }
 return {whatsapp:{tenantsChecked:checked,queued,submitted:sent}};
}
