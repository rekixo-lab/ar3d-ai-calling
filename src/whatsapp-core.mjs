import {requireMembership,currentSuperAdminMfa} from './human-auth.mjs';
import {resolveCrmDb,normalizeIndianPhone,sha256hex} from './core.mjs';

export const WHATSAPP_CRON='*/2 * * * *';
export const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const GRAPH_VERSION='v27.0';
// The connection alias is c. Pending signed inbound groups block this sender
// before the corresponding customer's CRM spool has been drained.
export const PENDING_INBOUND_SQL="EXISTS(SELECT 1 FROM whatsapp_webhook_batches b,json_each(b.pending_phone_ids_json) p WHERE b.processed_at IS NULL AND CAST(p.key AS INTEGER)>=b.next_group AND p.value=c.phone_number_id)";
const encoder=new TextEncoder(),decoder=new TextDecoder();
export const iso=n=>new Date(n).toISOString();
export const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export const hex=a=>Array.from(new Uint8Array(a),b=>b.toString(16).padStart(2,'0')).join('');
export const constantEqual=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;};
export function text(value,max=500){return String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);}
export function validId(v){return typeof v==='string'&&/^\d{5,30}$/.test(v);}
export function validTemplateName(v){return typeof v==='string'&&/^[a-z0-9_]{1,512}$/.test(v);}
export function validLanguage(v){return typeof v==='string'&&/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(v);}
export function phone(v){try{const s=String(v||'');return normalizeIndianPhone(/^91\d{10}$/.test(s)?'+'+s:s);}catch{return null;}}
export function json(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}
export const fail=(error,status=400)=>json({error},status);
export async function boundedText(req,max=65536){
 if(Number(req.headers.get('content-length'))>max||!req.body)throw Error('invalid request body');
 const reader=req.body.getReader();let size=0,value='';const dec=new TextDecoder('utf-8',{fatal:true});
 try{while(true){const {done,value:part}=await reader.read();if(done)break;size+=part.byteLength;if(size>max){await reader.cancel();throw Error('request body too large');}value+=dec.decode(part,{stream:true});}value+=dec.decode();}finally{reader.releaseLock();}
 return value;
}
export async function memberFor(env,user,tid,write=false,{now=Date.now()}={}){
 if(!UUID.test(tid||''))return null;
 if(user?.globalRole!=='super_admin')return requireMembership(env.CONTROL_DB,user,tid,write);
 if(!await currentSuperAdminMfa(env.CONTROL_DB,user,now))return null;
 return env.CONTROL_DB.prepare("SELECT id AS tenant_id,display_name,storage_mode,dedicated_binding,status,'client_admin' AS role FROM tenants WHERE id=? AND status IN('trial','active') LIMIT 1").bind(tid).first();
}
async function credentialKey(env,tid){
 const material=String(env.MFA_ENCRYPTION_KEY||'');
 if(material.length<32)throw Error('credential storage unavailable');
 const base=await crypto.subtle.importKey('raw',encoder.encode(material),'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode(tid),info:encoder.encode('ar3d:whatsapp:credentials:v1')},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function encryptCredentials(env,tid,value){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const out=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(tid)},await credentialKey(env,tid),encoder.encode(JSON.stringify(value)));
 return 'v1.'+hex(iv)+'.'+hex(out);
}
export async function decryptCredentials(env,tid,ciphertext){
 const match=String(ciphertext||'').match(/^v1\.([a-f0-9]{24})\.([a-f0-9]{40,24000})$/);if(!match)throw Error('credential storage unavailable');
 const bytes=s=>Uint8Array.from(s.match(/../g),x=>parseInt(x,16));
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(match[1]),additionalData:encoder.encode(tid)},await credentialKey(env,tid),bytes(match[2]));
 return JSON.parse(decoder.decode(plain));
}
export async function verifySignature(raw,signature,secret){
 if(!/^sha256=[a-f0-9]{64}$/.test(signature||'')||!secret)return false;
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return constantEqual(signature,'sha256='+hex(await crypto.subtle.sign('HMAC',key,encoder.encode(raw))));
}
export async function graphRequest(path,token,{fetcher=fetch,method='GET',body}={}){
 // Only the three internal endpoints and their intended HTTP method.
 // Never forward bearer credentials through a redirect or consume an
 // unbounded body. A malformed acknowledgement is not proof of rejection.
 const match=typeof path==='string'&&path.match(/^\/\d{5,30}\/(phone_numbers|message_templates|messages)(\?[A-Za-z0-9_,=&%.-]{1,500})?$/);
 if(!match||(match[1]==='messages'?(method!=='POST'||!!match[2]||!body):(method!=='GET'||body!==undefined)))throw Error('invalid Meta endpoint');
 const response=await fetcher('https://graph.facebook.com/'+GRAPH_VERSION+path,{method,redirect:'manual',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 const type=(response.headers.get('content-type')||'').split(';')[0].trim();
 if(response.status>=300&&response.status<400||!/^application\/(?:json|[a-z0-9!# if(!/^\/[\d]+\/(?:phone_numbers|message_templates|messages)(?:\?|$)/.test(path))throw Error('invalid Meta endpoint');
 const response=await fetcher('https://graph.facebook.com/'+GRAPH_VERSION+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 const raw=await response.text();if(raw.length>1048576)throw Error('Meta response too large');
 let data;try{data=JSON.parse(raw);}catch{throw Error('Meta returned an invalid response');}
 if(!response.ok){const e=Error('Meta request rejected');e.providerCode=Number(data?.error?.code)||response.status;e.definitive=response.status>=400&&response.status<500;throw e;}
 return data;^_.+-]+\+json)$/i.test(type)){
  try{await response.body?.cancel()}catch{}
  throw Error('Meta returned an invalid response');
 }
 let data;try{data=JSON.parse(await boundedText(response,1048576));}catch{throw Error('Meta returned an invalid response');}
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Meta returned an invalid response');
 if(!response.ok){
  const code=data.error?.code;
  const e=Error('Meta request rejected');e.providerCode=Number.isSafeInteger(code)&&code>0?code:response.status;
  // A timeout or generic/malformed 4xx may conceal an accepted POST.
  e.definitive=response.status>=400&&response.status<500&&response.status!==408&&Number.isSafeInteger(code)&&code>0;
  throw e;
 }
 return data;
}
export function normalizeTemplate(t){
 const components=Array.isArray(t.components)?t.components:[];
 const body=components.find(x=>x.type==='BODY')?.text||'';
 const header=components.find(x=>x.type==='HEADER');
 const placeholders=[...body.matchAll(/\{\{(.*?)\}\}/g)].map(x=>x[1]);
 const exact=new Set(placeholders);
 let reason='';
 if(t.status!=='APPROVED')reason='Template is not approved by Meta';
 else if(!['MARKETING','UTILITY'].includes(t.category))reason='Use a marketing or utility template';
 else if(exact.size!==6||!['1','2','3','4','5','6'].every(x=>exact.has(x)))reason='Use exactly six numbered body parameters';
 else if(header&&!['DOCUMENT','TEXT'].includes(header.format))reason='Use a document header or no media header';
 else if(header?.format==='TEXT'&&/\{\{/.test(header.text||''))reason='Dynamic text headers are not supported';
 else if(components.some(c=>c.type==='BUTTONS'&&(c.buttons||[]).some(b=>/\{\{/.test(b.url||'')||!['URL','PHONE_NUMBER','QUICK_REPLY'].includes(b.type))))reason='Dynamic or unsupported buttons are not supported';
 return {id:String(t.id||''),name:t.name,language:t.language,status:t.status,category:t.category,body,supported:!reason,reason,hasDocument:header?.format==='DOCUMENT'};
}
export async function fetchTemplates(accountId,token,fetcher){
 const out=await graphRequest('/'+accountId+'/message_templates?fields=id,name,status,language,category,components&limit=100',token,{fetcher});
 return (out.data||[]).map(normalizeTemplate);
}
export function templatesFor(connection){try{return JSON.parse(connection?.templates_json||'[]');}catch{return [];}}
export function selectedTemplate(connection,name,language,{visit=false}={}){
 const t=templatesFor(connection).find(x=>x.name===name&&x.language===language);
 return t?.supported&&t.status==='APPROVED'&&(!visit||t.category==='UTILITY')?t:null;
}
export const defaultRules=()=>({enabled:false,enabledAt:null,firstDelayMinutes:10,secondEnabled:false,secondDelayHours:48,visitReminderEnabled:false,templateName:'',templateLanguage:'hi',followupTemplateName:'',followupTemplateLanguage:'hi',visitTemplateName:'',visitTemplateLanguage:'hi',dailyLimit:100,revision:0});
export function publicRules(row){return row?{enabled:!!row.enabled,enabledAt:row.enabled_at,firstDelayMinutes:row.first_delay_minutes,secondEnabled:!!row.second_enabled,secondDelayHours:row.second_delay_hours,visitReminderEnabled:!!row.visit_reminder_enabled,templateName:row.template_name,templateLanguage:row.template_language,followupTemplateName:row.followup_template_name,followupTemplateLanguage:row.followup_template_language,visitTemplateName:row.visit_template_name,visitTemplateLanguage:row.visit_template_language,dailyLimit:row.daily_limit,revision:row.revision}:defaultRules();}
export function publicConnection(row){return row?{status:row.status,messagingAccountId:row.messaging_account_id,phoneNumberId:row.phone_number_id,displayPhone:row.display_phone,verifiedName:row.verified_name,webhookVerified:!!row.webhook_verified_at,incomingProcessing:!!row.pending_inbound,connectedAt:row.connected_at,revision:row.revision}:{status:'not_connected',webhookVerified:false,incomingProcessing:false,revision:0};}
export async function leadEligibility(db,tid,leadId,{ignoreThread=false}={}){
 const row=await db.prepare(`SELECT l.*,p.status AS whatsapp_permission,t.paused AS thread_paused,t.last_inbound_at,
 EXISTS(SELECT 1 FROM whatsapp_event_receipts r,json_each(r.payload_json) e WHERE r.tenant_id=l.tenant_id AND r.event_key LIKE 'batch:%' AND r.processed_at IS NULL AND CAST(e.key AS INTEGER)>=r.cursor AND json_extract(e.value,'$.kind')='message' AND json_extract(e.value,'$.value.from') IN(l.mobile_e164,replace(l.mobile_e164,'+',''))) AS pending_whatsapp_inbound,
 EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id) AS opted_out
 FROM leads l LEFT JOIN whatsapp_permissions p ON p.tenant_id=l.tenant_id AND p.lead_id=l.id
 LEFT JOIN whatsapp_threads t ON t.tenant_id=l.tenant_id AND t.lead_id=l.id WHERE l.tenant_id=? AND l.id=? LIMIT 1`).bind(tid,leadId).first();
 if(!row)return {reason:'Customer not found'};
 if(row.opted_out||row.consent_status==='denied'||row.dnd_status==='blocked')return {lead:row,reason:'Customer has opted out'};
 if(row.pending_whatsapp_inbound)return {lead:row,reason:'Customer reply is awaiting webhook processing'};
 if(row.whatsapp_permission!=='granted')return {lead:row,reason:'WhatsApp permission record is missing'};
 if(!ignoreThread&&row.thread_paused)return {lead:row,reason:'Conversation is paused for salesperson follow-up'};
 return {lead:row,reason:null};
}
export function leadPreferences(lead,answers={}){
 let requirements={};try{requirements=JSON.parse(lead.requirements_json||'{}');}catch{}
 return {...answers,...requirements,propertyType:requirements.propertyType||answers.propertyType,location:lead.preferred_location||requirements.location||answers.location,preferredLocation:lead.preferred_location,budgetMinInr:lead.budget_min_inr,budgetMaxInr:lead.budget_max_inr,budgetInr:lead.budget_max_inr??requirements.budgetInr??answers.budgetInr};
}
export function audit(db,tid,actor,action,target,now){return db.prepare('INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) VALUES(?,?,?,?,?,?)').bind(tid,crypto.randomUUID(),actor,action,target,iso(now));}
export {resolveCrmDb,sha256hex};
