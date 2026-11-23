// Consent evidence intake is NOT consent verification or DND clearance.
// Every lead must remain ineligible for live calling until an approved
// telecom provider, consent verifier and caller-number compliance are wired in.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb,parseJsonBody} from './core.mjs';

const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200)=>Response.json(data,{status,headers});
const fail=(error,status=400)=>json({error},status);
const sources=['website_form','signed_form','in_person','other'];
const purposes=['property_information','site_visit'];
const reviewQueuePath='/v1/human/consent-review-queue';
const paths=/^\/v1\/human\/leads\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/(consent-evidence|call-readiness)$/i;

async function boundedPayload(req){
  if(Number(req.headers.get('content-length'))>4096)throw Error('request body too large');
  if(!req.body)throw Error('request body required');
  const reader=req.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let size=0,value='';
  try{
    while(true){
      const {done,value:part}=await reader.read();if(done)break;
      size+=part.byteLength;
      if(size>4096){await reader.cancel();throw Error('request body too large')}
      value+=decoder.decode(part,{stream:true});
    }
    value+=decoder.decode();
  }finally{reader.releaseLock()}
  return parseJsonBody(value,4096);
}
function validateIntake(body){
  if(Object.keys(body).some(k=>!['tenantId','source','purpose','reference','capturedAt'].includes(k)))
    throw Error('invalid evidence field');
  if(!sources.includes(body.source))throw Error('invalid evidence source');
  if(!purposes.includes(body.purpose))throw Error('invalid evidence purpose');
  if(typeof body.reference!=='string'||body.reference.trim().length<4||
     body.reference.trim().length>160||/[\u0000-\u001f]/u.test(body.reference))
    throw Error('invalid evidence reference');
  if(typeof body.capturedAt!=='string'||
     !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(body.capturedAt)||
     !Number.isFinite(Date.parse(body.capturedAt)))
    throw Error('invalid evidence timestamp');
  const capturedAt=new Date(body.capturedAt).toISOString();
  if(Date.parse(capturedAt)>Date.now()+60000)throw Error('evidence timestamp cannot be in the future');
  return {source:body.source,purpose:body.purpose,reference:body.reference.trim(),capturedAt};
}

// Tenant-admin-only pre-KYC evidence queue. No mutation, DND lookup, lead
// permission update or dial. A submitted reference is NOT verified consent.
async function pendingEvidenceQueue(req,env,user,url){
 if(req.method!=='GET')return fail('method not allowed',405);
 const allowed=new Set(['tenantId','purpose','limit','offset']);
 if([...url.searchParams.keys()].some(key=>!allowed.has(key)||
    url.searchParams.getAll(key).length!==1))
  return fail('invalid review queue query',400);
 const tenantId=url.searchParams.get('tenantId');
 const member=await requireMembership(env.CONTROL_DB,user,tenantId,true);
 if(!member)return fail('forbidden',403);
 const purpose=url.searchParams.get('purpose')||'all';
 const rawLimit=url.searchParams.get('limit')||'25';
 const rawOffset=url.searchParams.get('offset')||'0';
 if(!['all',...purposes].includes(purpose)||!/^\d{1,3}$/.test(rawLimit)||
    !/^\d{1,5}$/.test(rawOffset))return fail('invalid review queue pagination or purpose',400);
 const limit=Number(rawLimit),offset=Number(rawOffset);
 if(limit<1||limit>100||offset>10000)
  return fail('invalid review queue pagination or purpose',400);
 const db=resolveCrmDb(env,member),tid=member.tenant_id;
 const filter="e.tenant_id=? AND e.review_status='pending' AND (?='all' OR e.purpose=?)";
 const join=' FROM lead_consent_evidence e JOIN leads l ON l.tenant_id=e.tenant_id AND l.id=e.lead_id WHERE ';
 const [records,total]=await Promise.all([
  db.prepare('SELECT e.id,e.lead_id AS leadId,e.source,e.purpose,e.reference,'+
    'e.captured_at AS capturedAt,e.received_at AS receivedAt,'+
    'l.name AS leadName,l.consent_status AS consentStatus,'+
    'l.dnd_status AS dndStatus,l.customer_segment AS customerSegment,'+
    'EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=e.tenant_id AND o.lead_id=e.lead_id) AS optedOut'+
    join+filter+' ORDER BY e.received_at DESC,e.id DESC LIMIT ? OFFSET ?')
   .bind(tid,purpose,purpose,limit,offset).all(),
  db.prepare('SELECT COUNT(*) AS total'+join+filter).bind(tid,purpose,purpose).first()
 ]);
 return json({tenantId:tid,purpose,limit,offset,total:Number(total?.total||0),
  items:records.results.map(row=>({...row,optedOut:!!row.optedOut,
   verificationStatus:'not_verified',executionAllowed:false})),
  verificationPerformed:false,executionAllowed:false,
  notice:'Pending evidence is only an unverified customer-supplied reference. This review queue cannot grant consent, clear DND or authorize dialing.'});
}

export async function handleConsentRequest(req,env,user){
  const url=new URL(req.url),match=url.pathname.match(paths);
  if(!match&&url.pathname!==reviewQueuePath)return null;
  if(!env.CONTROL_DB)return fail('control database unavailable',503);
  if(url.pathname===reviewQueuePath){
   try{return await pendingEvidenceQueue(req,env,user,url)}
   catch(e){
    console.error('AR3D consent-review queue unavailable',e);
    return fail('service unavailable',503);
   }
  }
  const leadId=match[1],route=match[2],method=req.method;
  try{
    let data=null;
    if(method==='POST'){
      if(route!=='consent-evidence')return fail('method not allowed',405);
      data=await boundedPayload(req);
    }else if(method!=='GET')return fail('method not allowed',405);
    const tenantId=method==='GET'?url.searchParams.get('tenantId'):data.tenantId;
    const member=await requireMembership(env.CONTROL_DB,user,tenantId,method==='POST');
    if(!member)return fail('forbidden',403);
    const db=resolveCrmDb(env,member),tid=member.tenant_id;
    const lead=await db.prepare('SELECT id,consent_status,dnd_status,customer_segment FROM leads WHERE tenant_id=? AND id=?')
      .bind(tid,leadId).first();
    if(!lead)return fail('lead not found',404);
    if(route==='call-readiness'){
      // Read-only facts from this authenticated tenant's CRM. Even a previously
      // enquired customer or submitted evidence NEVER authorizes a call.
      const [optOut,evidence]=await Promise.all([
        db.prepare('SELECT COUNT(*) AS total FROM lead_opt_out_events WHERE tenant_id=? AND lead_id=?')
          .bind(tid,leadId).first(),
        db.prepare("SELECT COUNT(*) AS total FROM lead_consent_evidence WHERE tenant_id=? AND lead_id=? AND review_status='pending'")
          .bind(tid,leadId).first()
      ]);
      const optOutRecorded=Number(optOut?.total||0)>0;
      const pendingEvidence=Math.max(0,Number(evidence?.total||0));
      const reasons=[];
      if(optOutRecorded)reasons.push('Customer opt-out is recorded. No further calls.');
      if(lead.consent_status==='denied')reasons.push('Lead has denied contact permission.');
      else if(lead.consent_status!=='granted')
        reasons.push('Purpose-specific customer consent has not been independently verified.');
      if(lead.dnd_status==='blocked')reasons.push('Lead is blocked by DND/contact preference.');
      else if(lead.dnd_status!=='allowed')
        reasons.push('Independent DND/customer preference verification is unavailable.');
      if(pendingEvidence>0)
        reasons.push('Submitted consent evidence is pending review; this does not grant permission.');
      else reasons.push('No pending consent evidence reference is recorded.');
      if(!['prior_inquiry','unknown_contact'].includes(lead.customer_segment))
        reasons.push('Customer segment is not classified.');
      reasons.push('Approved caller ID, traffic classification and calling window have not been verified.');
      reasons.push('Provider launch entitlement, AI disclosure and opt-out escalation remain unverified.');
      // This is a preparation report, not a client-supplied compliance switch.
      return json({eligible:false,executionAllowed:false,leadId,tenantId:tid,
        consentStatus:lead.consent_status,dndStatus:lead.dnd_status,
        optOutRecorded,pendingEvidenceCount:pendingEvidence,
        customerSegment:lead.customer_segment||'unclassified',
        reasons,notice:'Read-only compliance preparation: no outgoing calls allowed.'});
    }
    if(method==='GET'){
      const rows=await db.prepare('SELECT id,source,purpose,reference,captured_at AS capturedAt,received_at AS receivedAt,review_status AS reviewStatus FROM lead_consent_evidence WHERE tenant_id=? AND lead_id=? ORDER BY received_at DESC,id DESC LIMIT 50')
        .bind(tid,leadId).all();
      return json({items:rows.results,notice:'Evidence is unverified; no calling authorization has been granted.'});
    }
    const ev=validateIntake(data),id=crypto.randomUUID(),at=new Date().toISOString();
    await db.batch([
      db.prepare('INSERT INTO lead_consent_evidence(tenant_id,id,lead_id,source,purpose,reference,captured_at,received_at,submitted_by,review_status) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .bind(tid,id,leadId,ev.source,ev.purpose,ev.reference,ev.capturedAt,at,user.id,'pending'),
      db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) VALUES(?,?,'human:'||?,'consent_evidence.submitted',?,?)")
        .bind(tid,crypto.randomUUID(),user.id,leadId,at)
    ]);
    return json({id,reviewStatus:'pending',notice:'Reference saved for review; consent and DND status were NOT changed.'},201);
  }catch(e){
    const msg=String(e?.message||'');
    if(/invalid|request body|timestamp|future|too large|JSON/i.test(msg))return fail(msg,400);
    if(/not provisioned|not configured/i.test(msg))return fail('database not provisioned',503);
    console.error('AR3D consent-intake request failed',e);
    return fail('internal server error',500);
  }
}
