// User-visible accounting and data portability only. NEVER charges money,
// authorizes calls, changes consent, or transfers data to external providers.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb} from './core.mjs';

const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(value,status=200)=>Response.json(value,{status,headers});
const fail=(reason,status=400)=>json({error:reason},status);
function pagination(url,defaultLimit=50,maxLimit=200){
  const rawLimit=url.searchParams.get('limit')||String(defaultLimit);
  const rawOffset=url.searchParams.get('offset')||'0';
  if(!/^\d{1,3}$/.test(rawLimit)||!/^\d{1,7}$/.test(rawOffset))throw Error('invalid pagination');
  const limit=Number(rawLimit),offset=Number(rawOffset);
  if(limit<1||limit>maxLimit||offset>100000)throw Error('invalid pagination');
  return {limit,offset};
}
export async function handleDataPortabilityRequest(req,env,user){
  const url=new URL(req.url),path=url.pathname;
  if(!['/v1/human/exports/leads','/v1/human/usage'].includes(path))return null;
  if(req.method!=='GET')return fail('method not allowed',405);
  try{
    const isExport=path==='/v1/human/exports/leads';
    const member=await requireMembership(env.CONTROL_DB,user,url.searchParams.get('tenantId'),isExport);
    if(!member)return fail('forbidden',403);
    const tid=member.tenant_id,db=resolveCrmDb(env,member);
    if(isExport){
      const {limit,offset}=pagination(url);
      const [data,count]=await Promise.all([
        db.prepare(`SELECT id,name,mobile_e164 AS mobile,source_type AS sourceType,
           consent_status AS consentStatus,dnd_status AS dndStatus,
           preferred_location AS preferredLocation,budget_min_inr AS budgetMinInr,
           budget_max_inr AS budgetMaxInr,interest_status AS interestStatus,
           followup_at AS followupAt,requirements_json AS requirementsJson,
           created_at AS createdAt,updated_at AS updatedAt
           FROM leads WHERE tenant_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`)
          .bind(tid,limit,offset).all(),
        db.prepare('SELECT COUNT(*) AS total FROM leads WHERE tenant_id=?').bind(tid).first()
      ]);
      // Audit before returning private leads. A write failure blocks export.
      await db.prepare(`INSERT INTO crm_audit_events
        (tenant_id,id,actor,action,target_id,created_at) VALUES(?,?,'human:'||?,
        'leads.exported',?,?)`).bind(tid,crypto.randomUUID(),user.id,
          String(offset)+':'+String(data.results.length),new Date().toISOString()).run();
      return json({format:'ar3d-crm-leads-v1',tenantId:tid,limit,offset,
        total:Number(count?.total||0),leads:data.results,
        warning:'Contains personal contact data. Handle privately and securely. This is lead export only; notes/recordings are not included.'});
    }
    // Counts represent current CRM records and synthetic demos. They are
    // NOT paid usage, monthly quotas, phone minutes, invoices or transactions.
    const metrics=await db.prepare(`SELECT
      (SELECT COUNT(*) FROM leads WHERE tenant_id=?) AS leadCount,
      (SELECT COUNT(*) FROM agents WHERE tenant_id=?) AS agentCount,
      (SELECT COUNT(*) FROM call_campaign_drafts WHERE tenant_id=?) AS draftCampaignCount,
      (SELECT COUNT(*) FROM site_visits WHERE tenant_id=?) AS visitCount,
      (SELECT COUNT(*) FROM conversation_simulations WHERE tenant_id=?) AS syntheticDemoCount`)
      .bind(tid,tid,tid,tid,tid).first();
    return json({tenantId:tid,planCode:member.plan_code,
      crmStats:{leads:Number(metrics?.leadCount||0),agents:Number(metrics?.agentCount||0),
        draftCampaigns:Number(metrics?.draftCampaignCount||0),
        siteVisits:Number(metrics?.visitCount||0),syntheticDemos:Number(metrics?.syntheticDemoCount||0)},
      billingEnabled:false,paidMinutes:null,amountDueInr:null,
      notice:'Read-only CRM record counts; no metered telecom minutes, invoice or payment provider is connected.'});
  }catch(e){
    if(/invalid pagination/i.test(String(e?.message||'')))return fail('invalid pagination');
    if(/not provisioned|not configured/i.test(String(e?.message||'')))return fail('database not provisioned',503);
    console.error('AR3D CRM data portability request failed',e);
    return fail('service unavailable',503);
  }
}
