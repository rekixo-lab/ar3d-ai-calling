// Production cutover diagnostic: a permanent NO-GO until independently
// reviewed telecom, consent/DND, vendor source, lead correlation and DR gates
// exist. All checks are read-only. A configured key is NEVER approval.
// Do not add a call/campaign activation switch to this module.
const PATH='/v1/human/engineering/production-cutover';
const HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
const respond=(value,status=200)=>Response.json(value,{status,headers:HEADERS});
const fail=(code,status=400)=>respond({error:code},status);
const REQUIRED=Object.freeze({
  control:Object.freeze({
    tables:['human_sessions','human_mfa_settings',
      'exotel_voicebot_event_receipts','exotel_operator_test_calls',
      'exotel_operator_status_checks'],
    triggers:['trg_exotel_voicebot_receipt_immutable',
      'trg_operator_test_no_delete','trg_operator_test_terminal',
      'trg_exotel_status_check_no_delete',
      'trg_exotel_status_check_one_finalization']
  }),
  crm:Object.freeze({
    tables:['leads','calls','lead_opt_out_events','lead_consent_evidence',
      'voicebot_qualification_reviews'],
    triggers:['trg_no_call_launch','trg_block_unverified_consent_update',
      'trg_block_unverified_consent_insert','trg_prevent_lead_opt_out_reversal',
      'trg_agents_block_active_insert','trg_agents_block_active_update',
      'trg_voicebot_review_terminal','trg_voicebot_review_immutable']
  })
});
const gate=(id,title,owner,status,action,requiredForPilot=true)=>
  Object.freeze({id,title,owner,status,action,requiredForPilot,
    independentlyVerified:false});
// External approval and unimplemented features cannot be self-attested by
// browser input, environment "READY" flags or even successful provider GETs.
const UNMET=Object.freeze([
  gate('telecom_contract','Approved commercial outbound Exotel agreement',
    'Exotel / business','external_approval_missing',
    'Obtain written Managed Voicebot outbound entitlement, concurrency and commercial terms'),
  gate('caller_traffic','Approved commercial caller identity and traffic class',
    'Telecom / compliance','external_approval_missing',
    'Confirm current 140 promotional / applicable 160x service numbering with licensed provider'),
  gate('purpose_consent','Verified purpose-specific recipient consent',
    'Business / compliance','integration_missing',
    'Create independently verifiable per-recipient consent proofs and revocation checks'),
  gate('dnd_suppression','Independent DND/opt-out verification',
    'Provider / compliance','integration_missing',
    'Validate DND preferences; make customer opt-out immediately suppress future dispatch'),
  gate('authorized_call_registry','Tenant and lead-bound authorized call registry',
    'Engineering','integration_missing',
    'Record immutable permitted intents and provider CallSid only after verified consent and policy'),
  gate('source_attestation','Independent Exotel webhook source attestation',
    'Exotel / engineering','integration_missing',
    'Obtain provider-supported source verification; Bearer token and CallSid are insufficient'),
  gate('call_leg_identity','Verified account, call leg, destination and lead mapping',
    'Engineering / Exotel','integration_missing',
    'Verify Exotel Call Details and its documented leg mapping to registered intent'),
  gate('transcript_ingestion','Secure completed-turn transcript retention and review',
    'Engineering / privacy','integration_missing',
    'Implement access-controlled encryption, retention, replay ordering, deletion and staff review'),
  gate('customer_dispatch','Consent-gated customer dispatch, concurrency and spending caps',
    'Engineering / Exotel','integration_missing',
    'Add reviewed dispatch only after policy, hours, opt-out, quotas, budget and stop switch'),
  gate('provider_reconciliation','Provider-aware terminal status and usage metering',
    'Engineering / Exotel','integration_missing',
    'Reconcile completed customer calls, provider minute costs and unknown submissions'),
  gate('real_production_backup','Real D1/R2 encrypted backup and isolated restore drill',
    'Operations','external_verification_missing',
    'Run verified remote backup and restore with access controls and retention'),
  gate('live_acceptance','Approved controlled human pilot and legal/security sign-off',
    'Business / security','external_verification_missing',
    'Document voicebot accuracy, recording notice, PII handling, escalation and a supervised pilot'),
  gate('alerting_incident','On-call alerts, cost anomaly detection and incident rollback',
    'Operations','external_verification_missing',
    'Configure real paging and test incident, outage and provider failure drills'),
  gate('billing_fulfillment','Paid billing, taxes, invoices and refunds',
    'Finance / engineering','integration_missing',
    'Reconcile signed usage and payment fulfillment before offering paid subscriptions',false),
  gate('knowledge_authorization','Approved tenant-scoped AR3D project knowledge',
    'Platform owner / engineering','integration_missing',
    'Provide signed scoped property facts with freshness and human handoff',false)
]);
const SQ=(names)=>'SELECT name,type,sql FROM sqlite_master WHERE type IN '+
  "('table','trigger') AND name IN ("+names.map(()=>'?').join(',')+") LIMIT 50";

async function inspectSchema(db,required){
  if(!db?.prepare)return null;
  const names=[...required.tables,...required.triggers];
  const result=await db.prepare(SQ(names)).bind(...names).all();
  if(!Array.isArray(result?.results)||result.results.length>names.length)
    throw Error('unexpected schema metadata');
  const records=new Map();
  for(const row of result.results){
    if(!names.includes(row.name)||records.has(row.name)||
       typeof row.sql!=='string')throw Error('untrusted schema metadata');
    records.set(row.name,row);
  }
  const missing=[];
  for(const name of required.tables){
    if(records.get(name)?.type!=='table')missing.push(name);
  }
  for(const name of required.triggers){
    const row=records.get(name);
    // A trigger by name without an ABORT guard is not sufficient.
    if(row?.type!=='trigger'||!/RAISE\s*\(\s*ABORT\s*,/i.test(row.sql))
      missing.push(name);
  }
  return Object.freeze({protected:missing.length===0,missing,checked:names.length});
}

export async function handleProductionCutover(req,env,user,{now=Date.now()}={}){
  const url=new URL(req.url);
  if(url.pathname!==PATH)return null;
  if(req.method!=='GET')return fail('method_not_allowed',405);
  if(url.search)return fail('query_not_supported',400);
  if(user?.globalRole!=='super_admin')return fail('forbidden',403);
  if(!Number.isSafeInteger(now)||now<1||!env?.CONTROL_DB?.prepare||
     !env?.CRM_DB?.prepare)return fail('isolated_databases_unavailable',503);
  try{
    const mfa=await env.CONTROL_DB.prepare(
      'SELECT m.enabled_at FROM human_mfa_settings m JOIN human_sessions s '+
      'ON s.user_id=m.user_id WHERE m.user_id=? AND s.token_hash=? '+
      'AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at '+
      'AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1'
    ).bind(user.id,user.token_hash,now).first();
    if(!mfa?.enabled_at)return fail('current_mfa_session_required',403);
    const [control,crm]=await Promise.all([
      inspectSchema(env.CONTROL_DB,REQUIRED.control),
      inspectSchema(env.CRM_DB,REQUIRED.crm)
    ]);
    if(!control||!crm)return fail('isolated_databases_unavailable',503);
    return respond({
      verdict:'NO_GO',
      customerCampaignLaunchAuthorized:false,
      hundredCustomerCallPilotAuthorized:false,
      paidSubscriptionsAuthorized:false,
      productionVerified:false,
      verifiedForCommercialUse:false,
      allowedNextStep:'engineering_and_manually_authorized_self_test_only',
      databaseSafety:{
        control:control.protected?'guarded':'incomplete',
        crm:crm.protected?'guarded':'incomplete',
        controlMissing:control.missing,crmMissing:crm.missing
      },
      readOnly:true,providerNetworkRequests:0,customerCallsPlaced:0,
      crmMutations:0,
      blockers:UNMET.map(x=>({...x})),
      note:'Code, MFA, schema guards and existing test calls are NOT authorization for promotional/service calling. Exotel and telecom approvals, consent/DND and provider-authenticated call-to-lead integration remain unverified. No approval toggle is accepted by this API.'
    });
  }catch{
    // Failed preflight is NOT a clean bill of health. Never echo SQL/PII.
    return fail('production_preflight_unavailable',503);
  }
}
