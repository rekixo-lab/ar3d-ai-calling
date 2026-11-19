// Staff-reviewed fixed-question survey for a lead already imported from Excel.
// This is CRM qualification, not a telephone call or live speech recognition.
// Never grants consent, clears DND, creates calls, or activates an AI agent.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb,parseJsonBody} from './core.mjs';
import {normalizePropertySurvey,surveyToCrm} from './fixed-property-survey.mjs';

const route=/^\/v1\/human\/leads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/qualification$/i;
const json=(v,s=200)=>Response.json(v,{status:s,headers:{
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>json({error:message},status);
const timestamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
async function boundedBody(req){
  if(Number(req.headers.get('content-length'))>4096)throw Error('request too large');
  const reader=req.body?.getReader();
  if(!reader)throw Error('request body required');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,raw='';
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;
      if(bytes>4096){await reader.cancel();throw Error('request too large')}
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
  }finally{reader.releaseLock()}
  return parseJsonBody(raw,4096);
}
function savedAnswers(row){
  try{
    const value=JSON.parse(row.requirements_json||'{}');
    return value&&typeof value==='object'&&!Array.isArray(value)&&
      value.propertySurvey&&typeof value.propertySurvey==='object'?
      value.propertySurvey:null;
  }catch{return null}
}
export async function handlePropertyQualificationRequest(req,env,user){
  const match=new URL(req.url).pathname.match(route);
  if(!match)return null;
  if(!['GET','POST'].includes(req.method))return fail('method not allowed',405);
  try{
    const body=req.method==='POST'?await boundedBody(req):null;
    const tenantId=req.method==='GET'?
      new URL(req.url).searchParams.get('tenantId'):body.tenantId;
    const member=await requireMembership(env.CONTROL_DB,user,tenantId,req.method==='POST');
    if(!member)return fail('forbidden',403);
    const db=resolveCrmDb(env,member),tid=member.tenant_id,id=match[1];
    const existing=await db.prepare(`SELECT updated_at AS updatedAt,
      requirements_json,consent_status AS consentStatus,dnd_status AS dndStatus
      FROM leads WHERE tenant_id=? AND id=? LIMIT 1`).bind(tid,id).first();
    if(!existing)return fail('lead not found',404);
    if(req.method==='GET'){
      return json({leadId:id,updatedAt:existing.updatedAt,
        survey:savedAnswers(existing),voiceConnected:false,
        notice:'Name/mobile remain from Excel. No phone call or speech service was used.'});
    }
    if(!body||typeof body!=='object'||Array.isArray(body)||
       Object.keys(body).some(k=>![
         'tenantId','expectedUpdatedAt','propertyType','location','area','size',
         'budgetInr','interest','visitDate','visitAt'
       ].includes(k))||
       typeof body.expectedUpdatedAt!=='string'||
       !timestamp.test(body.expectedUpdatedAt))
      return fail('invalid qualification request');
    if(body.expectedUpdatedAt!==existing.updatedAt)
      return fail('lead updated; refresh before saving qualification',409);
    const input={...body};delete input.tenantId;delete input.expectedUpdatedAt;
    const survey=normalizePropertySurvey(input),crm=surveyToCrm(survey);
    let prior;
    try{prior=JSON.parse(existing.requirements_json||'{}')}
    catch{return fail('lead requirements require manual review',409)}
    if(!prior||typeof prior!=='object'||Array.isArray(prior))
      return fail('lead requirements require manual review',409);
    const at=new Date(Math.max(Date.now(),Date.parse(existing.updatedAt)+1)).toISOString();
    const next={...prior,propertySurvey:{
      ...survey,channel:'staff_reviewed_browser',
      recordedAt:at,verifiedByUser:user.id,
      phoneCallPlaced:false,transcriptVerified:false
    }};
    const serialized=JSON.stringify(next);
    if(serialized.length>8000)return fail('lead requirements too large',409);
    const visitId=survey.visitAt?crypto.randomUUID():null;
    const rows=[
      db.prepare(`UPDATE leads SET preferred_location=?,plot_size_preference=?,
        budget_min_inr=NULL,budget_max_inr=?,interest_status=?,
        visit_date_preference=?,requirements_json=?,updated_at=?
        WHERE tenant_id=? AND id=? AND updated_at=?`).bind(
        crm.preferredLocation,crm.plotSizePreference,crm.budgetMaxInr,
        crm.interestStatus,crm.visitDatePreference,serialized,at,
        tid,id,existing.updatedAt),
      db.prepare(`INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)
        SELECT ?,?,'human:'||?,'lead.fixed_qualification_saved',id,?
        FROM leads WHERE tenant_id=? AND id=? AND updated_at=?`)
        .bind(tid,crypto.randomUUID(),user.id,at,tid,id,at)
    ];
    if(visitId){
      rows.push(db.prepare(`INSERT INTO site_visits
        (tenant_id,id,lead_id,scheduled_at,status,note,created_at)
        SELECT ?,?,id,?,'requested','Requested by staff-reviewed fixed-question survey',?
        FROM leads WHERE tenant_id=? AND id=? AND updated_at=?
        AND NOT EXISTS(SELECT 1 FROM site_visits
          WHERE tenant_id=? AND lead_id=? AND scheduled_at=?
          AND status IN ('requested','confirmed'))`)
        .bind(tid,visitId,survey.visitAt,at,tid,id,at,tid,id,survey.visitAt));
      rows.push(db.prepare(`INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)
        SELECT ?,?,'human:'||?,'visit.requested',?,?
        FROM site_visits WHERE tenant_id=? AND id=?`)
        .bind(tid,crypto.randomUUID(),user.id,visitId,at,tid,visitId));
    }
    const result=await db.batch(rows);
    if(Number(result[0]?.meta?.changes)!==1)
      return fail('lead updated; refresh before saving qualification',409);
    return json({ok:true,leadId:id,updatedAt:at,
      interestStatus:crm.interestStatus,
      visitRequested:Boolean(visitId&&Number(result[2]?.meta?.changes)===1),
      visitNeedsConfirmation:true,voiceConnected:false,
      callingConsentChanged:false,dndChanged:false,
      notice:'Qualification saved to CRM. Visit remains a request until sales confirms. No phone call placed.'});
  }catch(e){
    const message=String(e?.message||'');
    if(/invalid|too large|request|required|visit|qualification|property|BHK|budget|interest/i.test(message))
      return fail(message,400);
    if(/not provisioned|not configured/i.test(message))return fail('database not provisioned',503);
    console.error('AR3D fixed qualification failed',e);
    return fail('internal server error',500);
  }
}
