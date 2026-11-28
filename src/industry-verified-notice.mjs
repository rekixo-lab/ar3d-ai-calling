// Internal typed notice renderer. NOT a dispatch route, identity issuer,
// or source of real business records. Both issuers must be independently
// authenticated and configured by a future server-side integration.
const definitions={
 appointment_reminder_v1:{purpose:'appointment_reminder',fields:['customerName','appointmentAt'],source:'appointment_system'},
 finance_due_notice_v1:{purpose:'finance_due_notice',fields:['customerName','amountPaise','dueDate'],source:'loan_servicing_system'},
 banking_service_v1:{purpose:'banking_service_notice',fields:['customerName','serviceCode'],source:'bank_service_system'},
 insurance_renewal_v1:{purpose:'insurance_renewal',fields:['customerName','renewalDate'],source:'policy_administration_system'}
};
export const INDUSTRY_NOTICE_CONTRACTS=Object.freeze(Object.entries(definitions).map(([templateId,x])=>Object.freeze({
 templateId,purpose:x.purpose,source:x.source,fields:Object.freeze([...x.fields]),recipientProof:'authenticated_customer_portal',
 runtime:'verified_text_renderer',dispatchReady:false,blockers:Object.freeze([
 'trusted_recipient_identity_connector','approved_current_business_record_connector','purpose_specific_consent_and_release','production_voice_and_billing_integration'
 ])
})));
const contracts=new Map(INDUSTRY_NOTICE_CONTRACTS.map(x=>[x.templateId,x]));
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const hex=x=>Uint8Array.from(x.match(/../g),v=>parseInt(v,16));
const utf8=new TextEncoder();
const MAX_RECORD_AGE=900000,MAX_PROOF_AGE=120000,MAX_BODY=4096;
const bindKeys=['tenantId','leadId','sessionId','callUuid','templateId','graphSha256','recipientReviewSha256'];
const validTime=x=>Number.isSafeInteger(x)&&x>=0&&x<=8640000000000000;
const timestamp=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&timestamp(x+'T00:00:00.000Z');
const name=x=>typeof x==='string'&&x.length>=1&&x.length<=80&&x===x.normalize('NFC').trim()&&/^[\p{L}\p{M}][\p{L}\p{M} .’'-]*$/u.test(x);
const equalScope=(x,scope)=>bindKeys.every(k=>x[k]===scope[k]);
function liveInterval(x,now,maxAge){
 return validTime(x.issuedAt)&&validTime(x.expiresAt)&&x.issuedAt<=now&&now<x.expiresAt&&
 now-x.issuedAt<=maxAge&&x.expiresAt-x.issuedAt<=maxAge;
}
export function validIndustryNoticeScope(s){
 return exact(s,[...bindKeys,'language'])&&['tenantId','leadId','sessionId','callUuid'].every(k=>uuid(s[k]))&&
 hash(s.graphSha256)&&hash(s.recipientReviewSha256)&&['hi','en'].includes(s.language)&&contracts.has(s.templateId);
}
async function sha(text){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
}
async function verifiedEnvelope(envelope,keyHex,domain){
 if(!exact(envelope,['payload','signature'])||typeof envelope.payload!=='string'||!envelope.payload.length||
  utf8.encode(envelope.payload).length>MAX_BODY||!hash(envelope.signature)||!hash(keyHex))return null;
 const key=await crypto.subtle.importKey('raw',hex(keyHex),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('HMAC',key,hex(envelope.signature),utf8.encode(domain+'\n'+envelope.payload)))return null;
 const value=JSON.parse(envelope.payload);
 return JSON.stringify(value)===envelope.payload?value:null;
}
const services=Object.freeze({
 statement_available:['Your requested statement is available through the official banking channel.','आपका अनुरोधित स्टेटमेंट बैंक के आधिकारिक माध्यम पर उपलब्ध है।'],
 branch_callback_ready:['The bank can arrange your requested branch callback through its official channel.','बैंक आपके अनुरोधित शाखा कॉलबैक की व्यवस्था अपने आधिकारिक माध्यम से कर सकता है।'],
 service_request_update:['There is an update to your service request. Please use the official banking channel.','आपके सेवा अनुरोध पर नई जानकारी है। कृपया बैंक के आधिकारिक माध्यम का उपयोग करें।']
});
function validateFields(t,f,now){
 if(!exact(f,t.fields)||!name(f.customerName))return false;
 switch(t.templateId){
 case 'appointment_reminder_v1':return timestamp(f.appointmentAt)&&Date.parse(f.appointmentAt)>=now&&Date.parse(f.appointmentAt)-now<=90*86400000;
 case 'finance_due_notice_v1':return Number.isSafeInteger(f.amountPaise)&&f.amountPaise>0&&f.amountPaise<=100000000000&&date(f.dueDate);
 case 'banking_service_v1':return typeof f.serviceCode==='string'&&Object.hasOwn(services,f.serviceCode);
 case 'insurance_renewal_v1':return date(f.renewalDate);
 default:return false;
 }
}
const day=(x,lang)=>new Intl.DateTimeFormat(lang==='hi'?'hi-IN':'en-IN',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(x+'T00:00:00.000Z'));
const appointment=(x,lang)=>new Intl.DateTimeFormat(lang==='hi'?'hi-IN':'en-IN',{day:'numeric',month:'long',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true,timeZone:'Asia/Kolkata'}).format(new Date(x));
const amount=x=>new Intl.NumberFormat('en-IN',{minimumFractionDigits:x%100?2:0,maximumFractionDigits:2}).format(x/100);
function render(t,f,lang){
 const hi=lang==='hi',hello=hi?'नमस्ते '+f.customerName+'। ':'Hello '+f.customerName+'. ';
 const end=hi?' कृपया किसी बदलाव या सहायता के लिए संस्था के आधिकारिक माध्यम का उपयोग करें।':' Please use the organisation’s official channel for changes or assistance.';
 let body;
 switch(t.templateId){
 case 'appointment_reminder_v1':body=hi?'आपका अपॉइंटमेंट '+appointment(f.appointmentAt,lang)+' भारतीय समय पर निर्धारित है।':'Your appointment is scheduled for '+appointment(f.appointmentAt,lang)+' India time.';break;
 case 'finance_due_notice_v1':body=hi?'आपकी सत्यापित वर्तमान देय राशि '+amount(f.amountPaise)+' रुपये है। देय तारीख '+day(f.dueDate,lang)+' है।':'Your verified current amount due is '+amount(f.amountPaise)+' rupees. The due date is '+day(f.dueDate,lang)+'.';break;
 case 'banking_service_v1':body=services[f.serviceCode][hi?1:0];break;
 case 'insurance_renewal_v1':body=hi?'आपकी पॉलिसी के नवीनीकरण की तारीख '+day(f.renewalDate,lang)+' है।':'Your policy renewal date is '+day(f.renewalDate,lang)+'.';break;
 default:throw Error('unsupported_notice');
 }
 return hello+body+end;
}
const blocked=()=>({ok:false,state:'verified_notice_unavailable',speech:null,dispatchReady:false});
async function checkedRecord(scope,record,trusted,now){
  if(!validIndustryNoticeScope(scope)||!validTime(now)||!exact(trusted,['tenantId','identityKeyHex','recordKeyHex'])||
   trusted.tenantId!==scope.tenantId||!hash(trusted.identityKeyHex)||!hash(trusted.recordKeyHex)||
   trusted.identityKeyHex===trusted.recordKeyHex)return null;
  const t=contracts.get(scope.templateId);
  const r=await verifiedEnvelope(record,trusted.recordKeyHex,'ar3d:approved-industry-record:v1');
  if(!exact(r,['version','audience','purpose','source',...bindKeys,'issuedAt','expiresAt','asOf','recordRevision','fields'])||
   r.version!==1||r.audience!=='ar3d_notice_record'||r.purpose!==t.purpose||r.source!==t.source||
   !equalScope(r,scope)||!liveInterval(r,now,MAX_RECORD_AGE)||!validTime(r.asOf)||r.asOf>r.issuedAt||
   now-r.asOf>=MAX_RECORD_AGE||!Number.isSafeInteger(r.recordRevision)||r.recordRevision<1||
   !validateFields(t,r.fields,now))return null;
  return {t,r,recordSha256:await sha(record.payload)};
}
export async function verifyIndustryNoticeRecord({scope,record,trusted,now=Date.now()}={}){
 try{const c=await checkedRecord(scope,record,trusted,now);return c?{recordSha256:c.recordSha256,validUntil:Math.min(c.r.expiresAt,c.r.asOf+MAX_RECORD_AGE)}:null}catch{return null}
}
// Trusted configuration and active-call scope must come from a privileged
// server adapter, never an HTTP body. Future speech integration must claim
// a one-use utterance, recheck live consent, and avoid sensitive audio/logs.
export async function buildVerifiedIndustryNotice({scope,identity,record,trusted,now=Date.now()}={}){
 try{
  const checked=await checkedRecord(scope,record,trusted,now);
  if(!checked)return blocked();
  const {t,r,recordSha256}=checked;
  const proof=await verifiedEnvelope(identity,trusted.identityKeyHex,'ar3d:recipient-proof:v1');
  if(!exact(proof,['version','audience','purpose','method',...bindKeys,'issuedAt','expiresAt','recordSha256'])||
   proof.version!==1||proof.audience!=='ar3d_notice_identity'||proof.purpose!==t.purpose||
   proof.method!=='authenticated_customer_portal'||!equalScope(proof,scope)||!liveInterval(proof,now,MAX_PROOF_AGE)||
   proof.issuedAt<r.issuedAt||proof.recordSha256!==recordSha256)return blocked();
  return {ok:true,state:'verified_text_ready',speech:render(t,r.fields,scope.language),
   validUntil:Math.min(proof.expiresAt,r.expiresAt,r.asOf+MAX_RECORD_AGE),dispatchReady:false};
 }catch{return blocked()}
}
