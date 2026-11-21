// Tenant-scoped HUMAN REVIEW of independently attested Exotel survey records.
// No public provider webhook, caller ID verification, dialing or direct vendor
// import is exposed here. Call data enters only via a private server adapter.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb,parseJsonBody} from './core.mjs';
import {normalizePropertySurvey,surveyToCrm} from './fixed-property-survey.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ACTION=/^\/v1\/human\/voicebot-reviews\/([a-f0-9-]{36})\/(apply|dismiss)$/i;
const LIST='/v1/human/voicebot-reviews';
const json=(body,status=200)=>Response.json(body,{status,headers:{
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'
}});
const fail=(message,status=400)=>json({error:message},status);
async function body(req){
  if(!req.body||Number(req.headers.get('content-length'))>2048)
    throw Error('invalid or missing request body');
  const reader=req.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let raw='',size=0;
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>2048){await reader.cancel();throw Error('request too large')}
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
  }finally{reader.releaseLock()}
  return parseJsonBody(raw,2048);
}
function surveyFromReview(row){
  let survey;
  try{survey=JSON.parse(row.survey_json)}
  catch{throw Error('invalid stored review')}
  if(row.possible_opt_out)return null;
  return normalizePropertySurvey(survey);
}
export async function handleVoicebotReviewRequest(req,env,user){
  const url=new URL(req.url),path=url.pathname,match=path.match(ACTION);
  if(path!==LIST&&!match)return null;
  if((path===LIST&&req.method!=='GET')||
     (match&&req.method!=='POST'))return fail('method not allowed',405);
  try{
    let input=null;
    if(req.method==='POST'){
      try{input=await body(req)}
      catch{return fail('invalid or oversized review JSON',400)}
      if(!input||typeof input!=='object'||Array.isArray(input)||
         Object.keys(input).some(k=>!['tenantId','expectedUpdatedAt','acknowledged'].includes(k))||
         typeof input.tenantId!=='string')
        return fail('invalid review request');
    }
    const tenantId=req.method==='POST'?input.tenantId:url.searchParams.get('tenantId');
    if(!UUID.test(tenantId))return fail('invalid tenant id');
    // Viewing a provider-derived property survey requires Client Admin rights.
    const member=await requireMembership(env.CONTROL_DB,user,tenantId,true);
    if(!member)return fail('forbidden',403);
    const db=resolveCrmDb(env,member),tid=member.tenant_id;
    if(path===LIST){
      const limit=Number(url.searchParams.get('limit')||25);
      const offset=Number(url.searchParams.get('offset')||0);
      if(!Number.isSafeInteger(limit)||limit<1||limit>50||
         !Number.isSafeInteger(offset)||offset<0||offset>100000)
        return fail('invalid pagination');
      const rows=await db.prepare([
        'SELECT r.id,r.lead_id AS leadId,r.status,r.possible_opt_out AS possibleOptOut,',
        'r.survey_json AS surveyJson,r.created_at AS createdAt,',
        'l.updated_at AS leadUpdatedAt,l.consent_status AS consentStatus,',
        'l.dnd_status AS dndStatus',
        'FROM voicebot_qualification_reviews r JOIN leads l',
        'ON l.tenant_id=r.tenant_id AND l.id=r.lead_id',
        'WHERE r.tenant_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?'
      ].join(' ')).bind(tid,limit,offset).all();
      const results=rows.results.map(x=>{
        let parsed=null;
        if(Number(x.possibleOptOut)!==1){
          try{parsed=normalizePropertySurvey(JSON.parse(x.surveyJson))}
          catch{parsed=null}
        }
        return {id:x.id,leadId:x.leadId,status:x.status,
          possibleOptOut:Number(x.possibleOptOut)===1,
          suppressionConfirmed:x.consentStatus==='denied'&&x.dndStatus==='blocked',
          provisionalSurvey:parsed,leadUpdatedAt:x.leadUpdatedAt,
          createdAt:x.createdAt};
      });
      return json({reviews:results,limit,offset,source:'verified_provider_review_queue',
        liveProviderWebhookConfigured:true,
        notice:'Private Exotel human-review queue. Only registered, provider-verified answers are staged; staff approval is required before CRM fields change.'});
    }
    if(!UUID.test(match[1]))return fail('invalid review id');
    const id=match[1],action=match[2];
    if(action==='dismiss'&&(Object.keys(input).length!==1))
      return fail('dismiss accepts tenantId only');
    if(action==='apply'&&(
      Object.keys(input).some(k=>!['tenantId','expectedUpdatedAt','acknowledged'].includes(k))||
      input.acknowledged!==true||
      typeof input.expectedUpdatedAt!=='string'||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.expectedUpdatedAt)))
      return fail('staff acknowledgement and current lead revision required');
    const record=await db.prepare([
      'SELECT r.id,r.lead_id,r.survey_json,r.status,r.possible_opt_out,',
      'r.source_verified,r.mapping_verified,',
      'l.updated_at AS leadUpdatedAt,l.requirements_json AS requirementsJson,',
      'l.consent_status AS consentStatus,l.dnd_status AS dndStatus',
      'FROM voicebot_qualification_reviews r JOIN leads l',
      'ON r.tenant_id=l.tenant_id AND r.lead_id=l.id',
      'WHERE r.tenant_id=? AND r.id=? LIMIT 1'
    ].join(' ')).bind(tid,id).first();
    if(!record)return fail('review not found',404);
    if(record.status!=='pending')return fail('review already finalized',409);
    if(record.source_verified!==1||record.mapping_verified!==1)
      return fail('provider evidence is not independently verified',409);
    const at=new Date().toISOString();
    if(action==='dismiss'){
      if(Number(record.possible_opt_out)===1 &&
         !(record.consentStatus==='denied'&&record.dndStatus==='blocked'))
        return fail('verified Do Not Call suppression is required before dismissing possible opt-out',409);
      const updates=await db.batch([
        db.prepare([
          "UPDATE voicebot_qualification_reviews SET status='dismissed',reviewed_by=?,reviewed_at=?",
          "WHERE tenant_id=? AND id=? AND status='pending'",
          "AND (possible_opt_out=0 OR EXISTS(SELECT 1 FROM leads WHERE",
          "leads.tenant_id=voicebot_qualification_reviews.tenant_id",
          "AND leads.id=voicebot_qualification_reviews.lead_id",
          "AND leads.consent_status='denied' AND leads.dnd_status='blocked'))"
        ].join(' ')).bind(user.id,at,tid,id),
        db.prepare([
          'INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)',
          "SELECT ?,?,'human:'||?,'voicebot.review_dismissed',id,?",
          "FROM voicebot_qualification_reviews WHERE tenant_id=? AND id=? AND status='dismissed' AND reviewed_by=? AND reviewed_at=?"
        ].join(' ')).bind(tid,crypto.randomUUID(),user.id,at,tid,id,user.id,at)
      ]);
      if(Number(updates[0]?.meta?.changes)!==1)return fail('review changed; refresh',409);
      return json({id,status:'dismissed',leadChanged:false,
        warning:record.possible_opt_out?
          'A possible opt-out still requires separate verified Do Not Call handling.':
          'No CRM property fields or calling preferences changed.'});
    }
    if(Number(record.possible_opt_out)===1)
      return fail('possible opt-out requires verified suppression review, not property application',409);
    if(input.expectedUpdatedAt!==record.leadUpdatedAt)
      return fail('lead updated; refresh before applying',409);
    let prior;
    try{prior=JSON.parse(record.requirementsJson||'{}')}
    catch{return fail('lead requires manual data repair',409)}
    if(!prior||typeof prior!=='object'||Array.isArray(prior))
      return fail('lead requires manual data repair',409);
    const survey=surveyFromReview(record),fields=surveyToCrm(survey);
    // Require explicit staff acknowledgement; do not auto-create visits.
    const timestamp=new Date(Math.max(Date.now(),Date.parse(record.leadUpdatedAt)+1)).toISOString();
    const requirements=JSON.stringify({...prior,propertySurvey:{
      ...survey,channel:'reviewed_exotel_voicebot',
      providerReviewId:id,recordedAt:timestamp,reviewedByUser:user.id,
      voiceRecognitionIndependentlyConfirmed:false,
      visitNeedsSalesConfirmation:true
    }});
    if(requirements.length>8000)return fail('lead property requirements too large',409);
    const updates=await db.batch([
      db.prepare([
        "UPDATE voicebot_qualification_reviews SET status='applied',reviewed_by=?,reviewed_at=?",
        "WHERE tenant_id=? AND id=? AND status='pending' AND possible_opt_out=0",
        "AND EXISTS(SELECT 1 FROM leads WHERE tenant_id=? AND id=? AND updated_at=?)"
      ].join(' ')).bind(user.id,timestamp,tid,id,tid,record.lead_id,input.expectedUpdatedAt),
      db.prepare([
        'UPDATE leads SET preferred_location=?,plot_size_preference=?,',
        'budget_min_inr=NULL,budget_max_inr=?,interest_status=?,',
        'visit_date_preference=?,requirements_json=?,updated_at=?',
        'WHERE tenant_id=? AND id=? AND updated_at=?',
        'AND EXISTS(SELECT 1 FROM voicebot_qualification_reviews',
        "WHERE tenant_id=? AND id=? AND lead_id=? AND status='applied'",
        'AND reviewed_by=? AND reviewed_at=?)'
      ].join(' ')).bind(fields.preferredLocation,fields.plotSizePreference,
        fields.budgetMaxInr,fields.interestStatus,fields.visitDatePreference,
        requirements,timestamp,tid,record.lead_id,input.expectedUpdatedAt,
        tid,id,record.lead_id,user.id,timestamp),
      db.prepare([
        'INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)',
        "SELECT ?,?,'human:'||?,'voicebot.review_applied',id,?",
        "FROM voicebot_qualification_reviews WHERE tenant_id=? AND id=?",
        "AND status='applied' AND reviewed_by=? AND reviewed_at=?",
        'AND EXISTS(SELECT 1 FROM leads WHERE tenant_id=? AND id=? AND updated_at=?)'
      ].join(' ')).bind(tid,crypto.randomUUID(),user.id,timestamp,tid,id,user.id,
        timestamp,tid,record.lead_id,timestamp)
    ]);
    if(Number(updates[0]?.meta?.changes)!==1||
       Number(updates[1]?.meta?.changes)!==1)
      return fail('review or lead changed; refresh',409);
    return json({id,status:'applied',leadId:record.lead_id,
      leadUpdatedAt:timestamp,staffReviewed:true,visitConfirmed:false,
      consentChanged:false,dndChanged:false,realCallsPlaced:0,
      notice:'Staff reviewed Exotel proposal and updated CRM; a site visit remains unconfirmed.'});
  }catch{
    // Never include raw provider/lead data in response or server logs.
    return fail('review operation unavailable',503);
  }
}
