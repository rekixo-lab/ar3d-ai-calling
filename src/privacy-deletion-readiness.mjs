// Operator-only dry-run inventory of a single lead's deletion dependencies.
// NEVER removes customer data, revokes consent, clears DND or places a call.
// A complete, policy-approved retention/deletion workflow is still required.
import {resolveCrmDb} from './core.mjs';

const path=/^\/v1\/human\/leads\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/deletion-readiness$/i;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(body,status=200)=>Response.json(body,{status,headers});
const fail=(error,status)=>json({error},status);
const sources=[
 ['calls','calls'],
 ['callingJobs','calling_jobs'],
 ['campaignCandidates','call_campaign_candidates'],
 ['callingClearances','calling_clearances'],
 ['industryCampaignCandidates','industry_campaign_candidates'],
 ['industryRecipientReviews','industry_recipient_reviews'],
 ['industryCallJobs','industry_call_jobs'],
 ['siteVisits','site_visits'],
 ['consentReferences','lead_consent_evidence'],
 ['optOutEvents','lead_opt_out_events'],
 ['leadNotes','lead_notes'],
 ['staffAssignments','lead_staff_assignments'],
 ['callIntentProposals','call_intent_proposals'],
 ['whatsAppPermissions','whatsapp_permissions'],
 ['whatsAppThreads','whatsapp_threads'],
 ['whatsAppMessages','whatsapp_messages'],
 ['whatsAppInboundMessages','whatsapp_inbound_messages']
];

export async function handleDeletionReadiness(req,env,user){
 const url=new URL(req.url),match=url.pathname.match(path);
 if(!match)return null;
 if(req.method!=='GET')return fail('method not allowed',405);
 if([...url.searchParams.keys()].some(key=>key!=='tenantId')||
    url.searchParams.getAll('tenantId').length!==1||
    !uuid.test(url.searchParams.get('tenantId')||''))
  return fail('valid tenantId required',400);
 if(user?.globalRole!=='super_admin')
  return fail('forbidden',403);
 if(!/^[a-f0-9]{64}$/i.test(user.token_hash||''))return fail('current MFA Super Admin required',403);
 try{
  const control=env.CONTROL_DB,tid=url.searchParams.get('tenantId'),now=Date.now();
  const mfa=await control.prepare(
   'SELECT 1 AS verified FROM human_mfa_settings m JOIN human_sessions s ON s.user_id=m.user_id '+
   'WHERE m.user_id=? AND s.token_hash=? AND m.enabled_at IS NOT NULL '+
   'AND s.created_at>=m.enabled_at AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1')
   .bind(user.id,user.token_hash,now).first();
  if(!mfa)return fail('current MFA Super Admin required',403);
  const tenant=await control.prepare(
   'SELECT id AS tenant_id,storage_mode,dedicated_binding FROM tenants WHERE id=? LIMIT 1')
   .bind(tid).first();
  if(!tenant)return fail('tenant not found',404);
  const db=resolveCrmDb(env,tenant),leadId=match[1];
  const lead=await db.prepare(
   'SELECT id,consent_status,dnd_status FROM leads WHERE tenant_id=? AND id=?')
   .bind(tid,leadId).first();
  if(!lead)return fail('lead not found',404);
  const counts=await Promise.all(sources.map(async([,table])=>{
   const row=await db.prepare('SELECT COUNT(*) AS n FROM '+table+
    ' WHERE tenant_id=? AND lead_id=?').bind(tid,leadId).first();
   return Number(row?.n||0);
  }));
  const dependentRecords=Object.fromEntries(sources.map(([name],i)=>[name,counts[i]]));
  // Results and costs reference jobs rather than leads; phone sessions live in
  // the separate Control DB. Return counts only, scoped on both join keys.
  const related=await Promise.all([
   db.prepare('SELECT COUNT(*) AS n FROM scripted_call_results r JOIN calling_jobs j ON j.tenant_id=r.tenant_id AND j.id=r.job_id WHERE j.tenant_id=? AND j.lead_id=?').bind(tid,leadId).first(),
   db.prepare('SELECT COUNT(*) AS n FROM verified_provider_call_costs r JOIN calling_jobs j ON j.tenant_id=r.tenant_id AND j.id=r.job_id WHERE j.tenant_id=? AND j.lead_id=?').bind(tid,leadId).first(),
   db.prepare('SELECT COUNT(*) AS n FROM crm_audit_events WHERE tenant_id=? AND target_id=?').bind(tid,leadId).first(),
   control.prepare('SELECT COUNT(*) AS n FROM scripted_phone_pilots WHERE tenant_id=? AND lead_id=?').bind(tid,leadId).first()
  ]);
  for(const [i,name] of ['scriptedCallResults','verifiedProviderCosts','directLeadAuditEvents','phoneSessions'].entries())dependentRecords[name]=Number(related[i]?.n||0);
  if(tenant.storage_mode==='shared'){
   const [admissions,receipts,closures]=await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM industry_funded_admissions WHERE tenant_id=? AND lead_id=?').bind(tid,leadId).first(),
    db.prepare('SELECT COUNT(*) AS n FROM verified_industry_call_costs r JOIN industry_call_jobs j ON j.tenant_id=r.tenant_id AND j.id=r.job_id WHERE j.tenant_id=? AND j.lead_id=?').bind(tid,leadId).first(),
    db.prepare('SELECT COUNT(*) AS n FROM industry_terminal_closures r JOIN industry_call_jobs j ON j.tenant_id=r.tenant_id AND j.id=r.job_id WHERE j.tenant_id=? AND j.lead_id=?').bind(tid,leadId).first()
   ]);
   dependentRecords.industryFundedAdmissions=Number(admissions?.n||0);
   dependentRecords.verifiedIndustryCosts=Number(receipts?.n||0);
   dependentRecords.industryTerminalClosures=Number(closures?.n||0);
  }
  return json({
   tenantId:tid,leadId,
   mode:'read_only_deletion_dry_run',executionAllowed:false,
   piiDeleted:false,providerRecordingsDeleted:false,
   contactSuppressionPreserved:dependentRecords.optOutEvents>0||
    lead.consent_status==='denied'||lead.dnd_status==='blocked',
   dependentRecords,
   checksRequired:[
    'approved_retention_and_legal_hold_policy',
    'verified_production_backup_and_isolated_restore',
    'recording_and_export_inventory',
    'preserve_do_not_call_suppression_after_erasure',
    'cancel_or_reconcile_in_flight_calling',
    'tenant_scoped_authenticated_delete_approval'
   ],
   notice:'No records were deleted. This is a dependency inventory, not a complete privacy erasure or authorization to dial.'
  });
 }catch(e){
  console.error('AR3D private deletion dry-run unavailable',e);
  return fail('read-only deletion check unavailable',503);
 }
}
