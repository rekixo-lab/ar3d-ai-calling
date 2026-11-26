import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb,normalizeIndianPhone,sha256hex} from './core.mjs';

export const WHATSAPP_CRON='*/2 * * * *';
export const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const GRAPH_VERSION='v27.0';
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
 if(!/^[a-f0-9]{64}$/.test(user.token_hash||''))return null;
 const session=await env.CONTROL_DB.prepare('SELECT 1 AS verified FROM human_mfa_settings m JOIN human_sessions s ON s.user_id=m.user_id WHERE m.user_id=? AND s.token_hash=? AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1').bind(user.id,user.token_hash,now).first();
 if(!session)return null;
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
 if(!/^\/[\d]+\/(?:phone_numbers|message_templates|messages)(?:\?|$)/.test(path))throw Error('invalid Meta endpoint');
 const response=await fetcher('https://graph.facebook.com/'+GRAPH_VERSION+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 const raw=await response.text();if(raw.length>1048576)throw Error('Meta response too large');
 let data;try{data=JSON.parse(raw);}catch{throw Error('Meta returned an invalid response');}
 if(!response.ok){const e=Error('Meta request rejected');e.providerCode=Number(data?.error?.code)||response.status;e.definitive=response.status>=400&&response.status<500;throw e;}
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
export function publicConnection(row){return row?{status:row.status,messagingAccountId:row.messaging_account_id,phoneNumberId:row.phone_number_id,displayPhone:row.display_phone,verifiedName:row.verified_name,webhookVerified:!!row.webhook_verified_at,connectedAt:row.connected_at,revision:row.revision}:{status:'not_connected',webhookVerified:false,revision:0};}
export async function leadEligibility(db,tid,leadId,{ignoreThread=false}={}){
 const row=await db.prepare(`SELECT l.*,p.status AS whatsapp_permission,t.paused AS thread_paused,t.last_inbound_at,
 EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id) AS opted_out
 FROM leads l LEFT JOIN whatsapp_permissions p ON p.tenant_id=l.tenant_id AND p.lead_id=l.id
 LEFT JOIN whatsapp_threads t ON t.tenant_id=l.tenant_id AND t.lead_id=l.id WHERE l.tenant_id=? AND l.id=? LIMIT 1`).bind(tid,leadId).first();
 if(!row)return {reason:'Customer not found'};
 if(row.opted_out||row.consent_status==='denied'||row.dnd_status==='blocked')return {lead:row,reason:'Customer has opted out'};
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
