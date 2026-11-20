// Future internal handoff for independently authenticated Exotel Voicebot
// results. No HTTP callback, real dial endpoint or client-visible import route.
// A trusted vendor adapter must obtain independent evidence before calling.
import {normalizePropertySurvey} from './fixed-property-survey.mjs';
import {sha256hex} from './core.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CALL=/^CA[A-Za-z0-9_-]{10,78}$/;
const ACCOUNT=/^[a-zA-Z0-9_-]{4,128}$/;
const SHA=/^[a-f0-9]{64}$/i;
function need(ok,reason){if(!ok)throw Error('invalid verified Voicebot staging: '+reason)}
export function sanitizeProvisionalSurvey(raw,{possibleOptOut=false,now=Date.now()}={}){
  if(possibleOptOut){
    need(raw===null||raw===undefined,'opt-out must have no answers');
    return JSON.stringify({optOutReviewRequired:true});
  }
  need(raw&&typeof raw==='object'&&!Array.isArray(raw),'survey');
  // Never confirm a site visit from an unreviewed transcript.
  const survey=normalizePropertySurvey({...raw,visitAt:null},{now});
  const value=JSON.stringify(survey);
  need(value.length>=2&&value.length<=2048,'survey size');
  return value;
}
export async function stageVerifiedVoicebotReview(db,{
  tenantId,leadId,callReference,accountSid,deliveryDigest,
  provisionalSurvey,possibleOptOut=false,attestation,now=Date.now()
}={}){
  need(db?.prepare&&db?.batch,'database');
  need(UUID.test(tenantId)&&UUID.test(leadId)&&CALL.test(callReference)&&
    ACCOUNT.test(accountSid)&&SHA.test(deliveryDigest),'identifiers');
  need(typeof possibleOptOut==='boolean'&&Number.isSafeInteger(now)&&now>0,'options');
  // These attestations are meaningful ONLY from an independently verified
  // vendor transport; no public route accepts them from callers or browsers.
  const required=['vendorAuthenticationVerified','exotelDetailsLookupVerified',
    'approvedCallerMatched','registeredCallToLeadMatched','dataUseAuthorized'];
  need(attestation&&typeof attestation==='object'&&!Array.isArray(attestation)&&
    required.every(k=>attestation[k]===true),'independent proof');
  const surveyJson=sanitizeProvisionalSurvey(provisionalSurvey,{possibleOptOut,now});
  const accountHash=await sha256hex('ar3d-exotel-account-v1:'+accountSid);
  const id=crypto.randomUUID(),at=new Date(now).toISOString();
  const insert=[
    'INSERT INTO voicebot_qualification_reviews',
    '(tenant_id,id,lead_id,provider,call_reference,provider_account_hash,',
    'delivery_digest,survey_json,source_verified,mapping_verified,',
    'possible_opt_out,status,created_at)',
    "SELECT ?,?,?,'exotel',?,?,?,?,1,1,?,'pending',?",
    'WHERE EXISTS(SELECT 1 FROM leads WHERE tenant_id=? AND id=?)',
    'ON CONFLICT(tenant_id,provider,call_reference) DO NOTHING'
  ].join(' ');
  const audit=[
    'INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)',
    "SELECT ?,?,'verified_provider_adapter','voicebot.review_staged',id,?",
    'FROM voicebot_qualification_reviews WHERE tenant_id=? AND id=?'
  ].join(' ');
  const rows=await db.batch([
    db.prepare(insert).bind(tenantId,id,leadId,callReference,accountHash,
      deliveryDigest,surveyJson,possibleOptOut?1:0,at,tenantId,leadId),
    db.prepare(audit).bind(tenantId,crypto.randomUUID(),at,tenantId,id)
  ]);
  const inserted=Number(rows[0]?.meta?.changes||0)===1;
  const row=await db.prepare([
    'SELECT id,lead_id AS leadId,delivery_digest AS digest,',
    'survey_json AS surveyJson,possible_opt_out AS possibleOptOut,status',
    'FROM voicebot_qualification_reviews',
    "WHERE tenant_id=? AND provider='exotel' AND call_reference=? LIMIT 1"
  ].join(' ')).bind(tenantId,callReference).first();
  need(row&&row.leadId===leadId&&row.digest===deliveryDigest&&
    row.surveyJson===surveyJson&&Number(row.possibleOptOut)===(possibleOptOut?1:0),
    'conflicting delivery or missing registered lead');
  if(!inserted)need(row.status==='pending','event already finalized');
  return Object.freeze({id:row.id,status:'pending',duplicate:!inserted,
    provider:'exotel',humanReviewRequired:true,crmLeadChanged:false,
    callingConsentChanged:false,visitConfirmed:false,realCallsCreated:0});
}
