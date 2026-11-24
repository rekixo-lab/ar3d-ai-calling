// Opt-in auto-save for the browser's seven-question, typed-answer AI test.
// Unlike the standalone preview, this route is explicitly tied to one
// authorized CRM customer. Each server-generated step is HMAC authenticated:
// forged browser state cannot silently rewrite a real lead.
//
// No provider/telephony/STT calls; no consent, DND, phone or booking mutations.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb,parseJsonBody} from './core.mjs';
import {beginFixedVoicePreview,advanceInternalVoice} from './fixed-voice-turns.mjs';
import {normalizePropertySurvey,surveyToCrm} from './fixed-property-survey.mjs';

const PATH='/v1/human/ai-test-crm',MAX_BODY=8192;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const REPLIES={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200)=>Response.json(data,{status,headers:REPLIES});
const fail=(error,status=400)=>json({error},status);
const encoder=new TextEncoder();
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
function exactKeys(value,allowed){
 return value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).every(k=>allowed.includes(k));
}
async function bounded(req){
 if(!req.body||Number(req.headers.get('content-length'))>MAX_BODY)throw Error('invalid request body');
 const reader=req.body.getReader(),dec=new TextDecoder('utf-8',{fatal:true});
 let size=0,s='';
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;
   if(size>MAX_BODY){await reader.cancel();throw Error('request body too large')}
   s+=dec.decode(value,{stream:true});
  }
  s+=dec.decode();
 }finally{reader.releaseLock()}
 return parseJsonBody(s,MAX_BODY);
}
async function signer(env,user){
 // Password digest never leaves CONTROL_DB. Coupled with this server-side
 // login session hash, a fabricated JSON state cannot be authenticated.
 if(!user?.token_hash)return null;
 const row=await env.CONTROL_DB.prepare(
  "SELECT password_hash AS secret FROM human_users WHERE id=? AND status='active' LIMIT 1"
 ).bind(user.id).first();
 if(typeof row?.secret!=='string'||!row.secret)return null;
 return crypto.subtle.importKey('raw',encoder.encode(
  'AR3D_AI_TEST_CRM_V1|'+row.secret+'|'+user.token_hash
 ),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
function message(user,context,state){
 return encoder.encode(JSON.stringify([1,user.id,context,state]));
}
async function sign(key,user,context,state){
 return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,message(user,context,state))));
}
async function check(key,user,context,state,proof){
 if(typeof proof!=='string'||!/^[a-f0-9]{64}$/.test(proof))return false;
 return crypto.subtle.verify('HMAC',key,
  Uint8Array.from(proof.match(/../g),p=>parseInt(p,16)),message(user,context,state));
}
function validContext(c){
 return exactKeys(c,['tenantId','leadId','expectedUpdatedAt','nonce'])&&
  Object.keys(c).length===4&&UUID.test(c.tenantId)&&UUID.test(c.leadId)&&UUID.test(c.nonce)&&
  typeof c.expectedUpdatedAt==='string'&&c.expectedUpdatedAt.length<=40&&
  Number.isFinite(Date.parse(c.expectedUpdatedAt));
}
async function load(env,user,context){
 const member=await requireMembership(env.CONTROL_DB,user,context.tenantId,true);
 if(!member)return null;
 return {tid:member.tenant_id,db:resolveCrmDb(env,member)};
}
async function save(env,user,context,result,access){
 const {tid,db}=access;
 // Never create actual visit requests from a simulation; a date is a preference.
 const a=result.state.answers;
 const survey=normalizePropertySurvey({
  propertyType:a.propertyType,location:a.location,area:a.area||null,
  size:a.size,budgetInr:a.budgetInr??null,...(a.budgetMinInr!==undefined?{budgetMinInr:a.budgetMinInr}:{}),interest:a.interest,
  visitDate:a.visitDate||null,visitAt:a.visitAt??null
 });
 const crm=surveyToCrm(survey);
 const original=await db.prepare(
  'SELECT updated_at AS updatedAt, requirements_json AS requirements, budget_min_inr AS budgetMinInr, interest_status AS interestStatus, consent_status AS consentStatus, dnd_status AS dndStatus FROM leads WHERE tenant_id=? AND id=?'
 ).bind(tid,context.leadId).first();
 if(!original)return fail('customer not found',404);
 if(original.updatedAt!==context.expectedUpdatedAt)
  return fail('Customer changed during this test. Answers were not saved. Refresh and restart.',409);
 // Simulation may update an ordinary lead, but must never downgrade a completed
 // sale or rewrite suppressed customer preferences.
 if(original.interestStatus==='converted')
  return fail('Converted customer records cannot be changed by a simulated AI test.',409);
 if(original.consentStatus==='denied'||original.dndStatus==='blocked')
  return fail('Suppressed customer requires manual CRM review; test answers were not saved.',409);
 let prior;
 try{prior=JSON.parse(original.requirements||'{}')}catch{return fail('Customer notes need manual review; no changes saved.',409)}
 if(!prior||typeof prior!=='object'||Array.isArray(prior))
  return fail('Customer notes need manual review; no changes saved.',409);
 // A browser-typed demo is not verified customer testimony. Do not replace
 // an earlier staff-reviewed or provider-verified property survey, or an
 // actual recorded scripted call qualification.
 if((prior.propertySurvey&&
    (typeof prior.propertySurvey!=='object'||
     prior.propertySurvey.simulated!==true||
     prior.propertySurvey.channel!=='auto_ai_test_browser'))||
    prior.scriptedCallPilot)
  return fail('Verified customer qualification exists. Review and update manually; simulation was not saved.',409);
 if(crm.budgetMinInr===undefined&&original.budgetMinInr!==null&&original.budgetMinInr!==undefined&&
    crm.budgetMaxInr!==null&&Number(original.budgetMinInr)>crm.budgetMaxInr)
  return fail('Test budget conflicts with the customer minimum. Review manually; no changes saved.',409);
 const at=new Date(Math.max(Date.now(),Date.parse(original.updatedAt)+1)).toISOString();
 const next={...prior,propertySurvey:{
  ...survey,channel:'auto_ai_test_browser',simulated:true,
  recordedAt:at,verifiedByUser:user.id,previewSessionId:context.nonce,
  phoneCallPlaced:false,transcriptVerified:false
 }};
 const serial=JSON.stringify(next);
 if(serial.length>8000)return fail('Customer notes too large; no changes saved.',409);
 // Both statements execute atomically in D1. A replay or staff edit makes
 // the compare-and-set UPDATE return zero, without adding any audit event.
 const rows=await db.batch([
  db.prepare(`UPDATE leads SET preferred_location=?,plot_size_preference=?,
     budget_min_inr=COALESCE(?,budget_min_inr),budget_max_inr=?,interest_status=?,visit_date_preference=?,
     requirements_json=?,updated_at=?
     WHERE tenant_id=? AND id=? AND updated_at=?
       AND interest_status!='converted' AND consent_status!='denied' AND dnd_status!='blocked'
       AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=leads.tenant_id AND o.lead_id=leads.id)`).bind(
    crm.preferredLocation,crm.plotSizePreference,crm.budgetMinInr??null,crm.budgetMaxInr,
    crm.interestStatus,crm.visitDatePreference,serial,at,
    tid,context.leadId,context.expectedUpdatedAt),
  db.prepare(`INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)
     SELECT tenant_id,?,'human:'||?,'lead.ai_test_auto_saved',id,?
     FROM leads WHERE tenant_id=? AND id=? AND updated_at=?`)
   .bind(crypto.randomUUID(),user.id,at,tid,context.leadId,at)
 ]);
 if(Number(rows[0]?.meta?.changes)!==1||Number(rows[1]?.meta?.changes)!==1)
  return fail('Customer changed during this test. Answers were not saved.',409);
 return json({...result,crmWrites:1,savedToCrm:true,leadId:context.leadId,
  notice:'Test answers auto-saved to the selected CRM customer. No call, consent or site visit was created.'});
}

export async function handleAiTestCrmRequest(req,env,user){
 if(new URL(req.url).pathname!==PATH)return null;
 if(req.method!=='POST')return fail('method not allowed',405);
 try{
  const data=await bounded(req);
  const key=await signer(env,user);
  if(!key)return fail('session verification unavailable',403);
  if(data.action==='start'){
   if(!exactKeys(data,['action','tenantId','leadId','language'])||
      Object.keys(data).length!==4||!UUID.test(data.tenantId)||
      !UUID.test(data.leadId)||!['hi','en'].includes(data.language))
     return fail('invalid AI test customer selection');
   const context={tenantId:data.tenantId,leadId:data.leadId};
   const access=await load(env,user,context);
   if(!access)return fail('forbidden',403);
   const lead=await access.db.prepare(
    'SELECT name,updated_at AS updatedAt FROM leads WHERE tenant_id=? AND id=?'
   ).bind(access.tid,data.leadId).first();
   if(!lead)return fail('customer not found',404);
   const signedContext={...context,expectedUpdatedAt:lead.updatedAt,nonce:crypto.randomUUID()};
   const result=beginFixedVoicePreview({language:data.language});
   return json({...result,context:signedContext,proof:await sign(key,user,signedContext,result.state),
    selectedCustomer:lead.name,savedToCrm:false});
  }
  if(data.action==='turn'){
   if(!exactKeys(data,['action','context','state','proof','transcript','confidence'])||
      Object.keys(data).length<5||Object.keys(data).length>6||!validContext(data.context))
     return fail('invalid AI test session');
   const access=await load(env,user,data.context);
   if(!access)return fail('forbidden',403);
   if(!await check(key,user,data.context,data.state,data.proof))
     return fail('invalid or forged AI test state',403);
   const {result}=await advanceInternalVoice(null,data.state,{
    transcript:data.transcript,confidence:data.confidence??1
   });
   if(result.state.status==='completed'){
    // Server-completed, HMAC-authorized seven-turn result is the ONLY save path.
    return save(env,user,data.context,result,access);
   }
   return json({...result,context:data.context,
    proof:await sign(key,user,data.context,result.state),savedToCrm:false});
  }
  return fail('invalid AI test action');
 }catch(e){
  const m=String(e?.message||'');
  if(/invalid|expired|already finished|unclear|voice preview|budget|visit date|size/i.test(m))
   return fail('Invalid or expired AI test. Restart without saving.',400);
  if(/not provisioned|not configured/i.test(m))return fail('CRM database unavailable',503);
  console.error('AR3D AI test CRM failed',e);
  return fail('AI test CRM temporarily unavailable',503);
 }
}
