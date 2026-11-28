/**
 * AR3D AI Calling — guarded main Cloudflare D1 preflight.
 * Pure checks below can be tested without credentials. Never prints tokens.
 * This script does not write to Cloudflare; the guarded main-only GitHub
 * workflow separately performs one-time fresh initialization and deployment.
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const D1_NAME = Object.freeze({
  CONTROL_DB: 'ar3d-calling-control',
  CRM_DB: 'ar3d-calling-shared-crm',
});
export const PROPERTY_TABLES=Object.freeze([
  'properties','property_assets','campaign_property_settings','campaign_properties','property_media_shares',
]);
export const WHATSAPP_TABLES=Object.freeze([
  'whatsapp_rules','whatsapp_permissions','whatsapp_threads','whatsapp_messages','whatsapp_inbound_messages','whatsapp_event_receipts',
]);
export const CONTROL_WHATSAPP_TABLES=Object.freeze(['whatsapp_connections','whatsapp_webhook_batches','whatsapp_dispatch_ticks']);
export const INDUSTRY_DRAFT_TABLES=Object.freeze(['tenant_industry_profiles','ai_flow_definitions']);
export const INDUSTRY_SNAPSHOT_TABLES=Object.freeze(['ai_flow_snapshots','ai_flow_preview_reviews']);
export const INDUSTRY_CAMPAIGN_TABLES=Object.freeze(['industry_campaigns','industry_campaign_candidates','industry_recipient_reviews']);
const messagingUpgradeStates=['control_whatsapp_upgrade','control_whatsapp_queue_upgrade','crm_property_upgrade','crm_whatsapp_upgrade','crm_property_whatsapp_upgrade'];
const messagingMissingTables=state=>state==='control_whatsapp_upgrade'?CONTROL_WHATSAPP_TABLES:
  state==='control_whatsapp_queue_upgrade'?['whatsapp_dispatch_ticks']:
  state==='crm_property_upgrade'?PROPERTY_TABLES:state==='crm_whatsapp_upgrade'?WHATSAPP_TABLES:
  state==='crm_property_whatsapp_upgrade'?[...PROPERTY_TABLES,...WHATSAPP_TABLES]:[];
export const REQUIRED_TABLES = Object.freeze({
  CONTROL_DB: Object.freeze([
    ...CONTROL_WHATSAPP_TABLES,...INDUSTRY_DRAFT_TABLES,...INDUSTRY_SNAPSHOT_TABLES,'industry_launch_requests','calling_dispatch_pause_events','school_audio_preparations',
    'tenants','tenant_keys','project_links','tenant_numbers','tenant_audit_events',
    'human_users','tenant_memberships','human_sessions','human_invitations',
    'human_login_limits','human_bootstrap_claim','human_ip_login_limits','human_mfa_settings','human_mfa_challenges','human_mfa_recovery_codes','provider_event_inbox','calling_script_bindings','calling_script_versions','company_profile_versions','calling_agent_publications','shared_voice_gateway','voice_call_routes','client_account_contacts','company_change_requests','scripted_phone_pilots','tenant_credit_budgets','tenant_credit_audit','tenant_minute_ledger','tenant_minute_holds','provider_financial_journal','tenant_credit_purchases','provider_safety_events','provider_cost_reservations','provider_cost_reconciliations','calling_dispatch_settings','calling_company_settings','calling_capacity_signals','calling_funding_settings','provider_balance_snapshots','provider_balance_covered_calls','provider_manual_funding_control'
  ]),
  CRM_DB: Object.freeze([
    ...PROPERTY_TABLES,...WHATSAPP_TABLES,...INDUSTRY_CAMPAIGN_TABLES,'industry_call_jobs','industry_funded_admissions','verified_industry_call_costs','industry_terminal_closures','industry_dispatch_releases',
    'leads','agents','calls','site_visits','crm_audit_events',
    'lead_notes','conversation_simulations','lead_opt_out_events','lead_consent_evidence','call_campaign_drafts','call_campaign_candidates','call_intent_proposals','calling_policies','calling_clearances','calling_runs','calling_jobs','scripted_call_results','lead_staff_assignments','verified_provider_call_costs',
  ]),
});
export const REQUIRED_COLUMNS = Object.freeze({
  CONTROL_DB: Object.freeze({
    whatsapp_connections: Object.freeze(['tenant_id','messaging_account_id','phone_number_id','display_phone','verified_name','status','credentials_ciphertext','verify_token_hash','templates_json','webhook_verified_at','connected_at','updated_at','last_polled_at','revision']),
    whatsapp_webhook_batches: Object.freeze(['batch_hash','signature_hash','next_group','group_count','pending_phone_ids_json','received_at','updated_at','processed_at']),
    whatsapp_dispatch_ticks: Object.freeze(['slot_start_ms','claimed_at','finished_at','outcome']),
    tenant_industry_profiles: Object.freeze(['tenant_id','industry_code','revision','updated_by','updated_at']),
    ai_flow_definitions: Object.freeze(['tenant_id','id','template_id','industry_code','name','config_json','status','revision','created_by','created_at','updated_by','updated_at']),
    ai_flow_snapshots: Object.freeze(['tenant_id','id','flow_id','source_revision','template_id','config_json','graph_json','graph_sha256','compiler_version','status','created_by','created_at']),
    ai_flow_preview_reviews: Object.freeze(['tenant_id','snapshot_id','decision','review_note','reviewed_by','reviewed_at']),
    industry_launch_requests: Object.freeze(['tenant_id','id','snapshot_id','graph_sha256','purpose','requested_by','requested_at','state','decided_by','decided_at','review_reference']),
    tenants: Object.freeze(['id','plan_code','storage_mode','suspended_from_status']),
    human_users: Object.freeze(['id','global_role','password_hash']),
    human_sessions: Object.freeze(['token_hash','expires_at']),
    human_mfa_settings: Object.freeze(['user_id','recovery_generation_id','enabled_at']),
    human_mfa_recovery_codes: Object.freeze(['user_id','code_hash','used_at']),
    provider_event_inbox: Object.freeze(['tenant_id','provider','event_id','status']),
    company_profile_versions: Object.freeze(['tenant_id','revision','config_json','created_by','created_at']),
    calling_agent_publications: Object.freeze(['tenant_id','id','script_revision','profile_revision','prompt','greeting','provider_state','provider_version','provider_bot_id','provider_assistant_id']),
    shared_voice_gateway: Object.freeze(['id','bot_id','flow_id','template_assistant_id','template_version','guard_assistant_id','gateway_version','state','last_verified_at']),
    voice_call_routes: Object.freeze(['call_key','tenant_id','publication_id','job_id','operator_request_id','created_at','expires_at']),
    client_account_contacts: Object.freeze(['tenant_id','email','mobile_e164','created_by','created_at','updated_at']),
    scripted_phone_pilots: Object.freeze(['id','tenant_id','lead_id','lead_updated_at','actor_id','language','destination','caller','rate_slot','expires_at','phase','provider_call_id','provider_request_id','turn','survey_json','created_at','provider_account_id','job_id','hangup_at','duration_seconds']),
    company_change_requests: Object.freeze(['tenant_id','id','message','status','created_by','created_at','handled_by','handled_at','resolution_note']),
    tenant_credit_budgets: Object.freeze(['tenant_id','planned_paise','updated_by','updated_at']),
    tenant_credit_audit: Object.freeze(['id','tenant_id','actor','previous_paise','new_paise','reason','created_at']),
    tenant_minute_ledger: Object.freeze(['sequence','id','tenant_id','kind','delta_seconds','previous_seconds','balance_seconds','actor','reason','created_at']),
    provider_cost_reconciliations: Object.freeze(['tenant_id','job_id','provider','currency','actual_micros','journal_id','evidence_ref','actor','created_at']),
    provider_cost_reservations: Object.freeze(['tenant_id','job_id','reserved_seconds','plivo_currency','plivo_micros','sarvam_currency','sarvam_micros','created_at']),
    provider_safety_events: Object.freeze(['sequence','provider','kind','code','evidence_ref','actor','created_at']),
    tenant_credit_purchases: Object.freeze(['sequence','id','tenant_id','receipt_ref','paid_paise','purchased_seconds','previous_seconds','actor','created_at']),
    provider_financial_journal: Object.freeze(['sequence','id','provider','currency','kind','amount_micros','evidence_ref','reason','actor','created_at']),
    tenant_minute_holds: Object.freeze(['tenant_id','job_id','reserved_seconds','created_at','state','charged_seconds','evidence_ref','closed_at']),
    calling_script_bindings: Object.freeze(['tenant_id','bot_id','assistant_id','source_version']),
    calling_script_versions: Object.freeze(['tenant_id','id','revision','config_json','prompt','provider_state','provider_version']),
    human_ip_login_limits: Object.freeze(['ip_hash','attempt_count','blocked_until']),
    school_audio_preparations: Object.freeze(['tenant_id','launch_id','snapshot_id','graph_sha256','state','char_count','node_count','reserved_micros','rate_micros','funding_reference','attempted_nodes','claimed_by','claimed_at','deadline','manifest_json','manifest_sha256','reviewed_by','reviewed_at','review_reference']),
    calling_dispatch_pause_events: Object.freeze(['revision','paused','reason','actor','created_at']),
    calling_dispatch_settings: Object.freeze(['id','max_concurrent_calls','max_calls_per_company','updated_by','updated_at']),
    calling_company_settings: Object.freeze(['tenant_id','consent_mode','updated_by','updated_at']),
    calling_capacity_signals: Object.freeze(['provider','throttled_until','updated_at']),
    calling_funding_settings: Object.freeze(['id','mode','plivo_currency','plivo_pulse_micros','sarvam_currency','sarvam_pulse_micros','revision','evidence_ref','updated_by','updated_at']),
    provider_balance_snapshots: Object.freeze(['sequence','id','provider','currency','balance_micros','actor','created_at']),
    provider_balance_covered_calls: Object.freeze(['provider','tenant_id','job_id','snapshot_sequence']),
    provider_manual_funding_control: Object.freeze(['id','enabled','revision','updated_by','updated_at']),
  }),
  CRM_DB: Object.freeze({
    industry_dispatch_releases:Object.freeze(['tenant_id','job_id','approved_by','approval_reference','approved_at','expires_at','state','session_id','claimed_at','updated_at']),
    industry_terminal_closures:Object.freeze(['tenant_id','job_id','session_id','provider_call_uuid','hangup_at','billed_seconds','settled_at','closed_at']),
    verified_industry_call_costs:Object.freeze(['tenant_id','job_id','session_id','provider_request_id','provider_call_uuid','reported_amount','billed_seconds','call_seconds','currency_status','hangup_at','verified_at']),
    industry_funded_admissions:Object.freeze(['tenant_id','job_id','lead_id','manifest_sha256','max_seconds','approved_by','approval_reference','approved_at','expires_at','state','claimed_at','finished_at','outcome']),
    industry_call_jobs:Object.freeze(['tenant_id','id','campaign_id','lead_id','review_revision','snapshot_id','graph_sha256','manifest_sha256','purpose','review_expires_at','state','created_by','created_at','cancelled_by','cancelled_at','cancel_reason']),
    industry_campaigns:Object.freeze(['tenant_id','id','launch_request_id','snapshot_id','graph_sha256','purpose','name','created_by','created_at','archived_by','archived_at']),
    industry_campaign_candidates:Object.freeze(['tenant_id','campaign_id','lead_id','added_by','added_at']),
    industry_recipient_reviews:Object.freeze(['tenant_id','campaign_id','lead_id','revision','decision','destination','lead_updated_at','consent_ref','dnd_ref','expires_at','reason','reviewed_by','reviewed_at']),
    properties: Object.freeze(['tenant_id','id','name','property_type','city','city_aliases_json','locality','locality_aliases_json','address','map_url','price_min_inr','price_max_inr','price_basis','size_min','size_max','size_unit','bhk','description','amenities','contact_name','contact_phone','website_url','status','revision','last_write_id','created_by','updated_by','created_at','updated_at']),
    property_assets: Object.freeze(['tenant_id','id','property_id','kind','file_name','content_type','size_bytes','object_key','active','created_by','created_at']),
    campaign_property_settings: Object.freeze(['tenant_id','campaign_id','revision','last_write_id','updated_by','updated_at']),
    campaign_properties: Object.freeze(['tenant_id','campaign_id','property_id','position']),
    property_media_shares: Object.freeze(['tenant_id','token_hash','asset_id','expires_at','created_at']),
    whatsapp_rules: Object.freeze(['tenant_id','enabled','enabled_at','first_delay_minutes','second_enabled','second_delay_hours','visit_reminder_enabled','template_name','template_language','followup_template_name','followup_template_language','visit_template_name','visit_template_language','daily_limit','cursor_at','cursor_job_id','updated_at','revision']),
    whatsapp_permissions: Object.freeze(['tenant_id','lead_id','status','source','reference','captured_at','actor','updated_at']),
    whatsapp_threads: Object.freeze(['tenant_id','lead_id','paused','last_inbound_at','updated_at']),
    whatsapp_messages: Object.freeze(['tenant_id','id','source_key','lead_id','campaign_id','property_id','visit_id','kind','due_at','status','reason','template_name','template_language','provider_message_id','source_at','payload_json','created_at','updated_at','submitted_at','delivered_at','read_at']),
    whatsapp_inbound_messages: Object.freeze(['tenant_id','id','lead_id','text','message_type','received_at']),
    whatsapp_event_receipts: Object.freeze(['tenant_id','event_key','payload_json','processed_at','received_at','cursor']),
    leads: Object.freeze(['tenant_id','consent_status','dnd_status','interest_status','followup_at',
      'customer_segment','plot_size_preference','visit_date_preference']),
    conversation_simulations: Object.freeze(['tenant_id','state_json','expires_at']),
    lead_opt_out_events: Object.freeze(['tenant_id','lead_id','source','created_at']),
    lead_consent_evidence: Object.freeze(['tenant_id','lead_id','review_status','submitted_by']),
    call_campaign_drafts: Object.freeze(['tenant_id','status','language_mode']),
    call_campaign_candidates: Object.freeze(['tenant_id','campaign_id','lead_id']),
    agents: Object.freeze(['tenant_id','status','questions_json']),
    calling_policies: Object.freeze(['tenant_id','enabled','flow_id','expires_at','daily_limit','max_seconds']),
    calling_clearances: Object.freeze(['tenant_id','lead_id','purpose','expires_at']),
    calling_runs: Object.freeze(['tenant_id','id','campaign_id','state']),
    scripted_call_results: Object.freeze(['tenant_id','job_id','session_id','answers_json','saved_to_lead','captured_at']),
    calling_jobs: Object.freeze(['tenant_id','id','run_id','lead_id','state','provider_call_sid','reserved_at']),
    call_intent_proposals: Object.freeze(['tenant_id','id','campaign_id','lead_id','purpose','state','created_by','created_at']),
    lead_staff_assignments: Object.freeze(['tenant_id','lead_id','user_id','assigned_by','assigned_at']),
    verified_provider_call_costs: Object.freeze(['tenant_id','job_id','provider_call_uuid','reported_amount','billed_seconds','call_seconds','currency_status','verified_by','verified_at']),
  }),
});
const accountPattern = /^[a-f0-9]{32}$/i;
const databasePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function getCredentials(input) {
  const credentials = {
    token: String(input.CLOUDFLARE_API_TOKEN || ''),
    account: String(input.CLOUDFLARE_ACCOUNT_ID || ''),
    control: String(input.CONTROL_DB_ID || ''),
    crm: String(input.CRM_DB_ID || ''),
  };
  if (credentials.token.length < 20 || !accountPattern.test(credentials.account) ||
      !databasePattern.test(credentials.control) || !databasePattern.test(credentials.crm) ||
      credentials.control.toLowerCase() === credentials.crm.toLowerCase()) {
    throw Error('Missing/invalid Cloudflare environment secrets. Account ID: 32 hex; D1 IDs: two distinct UUIDs.');
  }
  return credentials;
}

export function makeMainConfig(template, credentials) {
  // Lock this Worker to its one explicitly approved custom hostname only.
  // Never accept wildcard routes or another AR3D project's hostname.
  const domainRoutes = template?.routes;
  const onlyCallingDomain = Array.isArray(domainRoutes) && domainRoutes.length === 1 &&
    domainRoutes[0]?.pattern === 'aicalling.ar3dstudio.in' &&
    domainRoutes[0]?.custom_domain === true &&
    Object.keys(domainRoutes[0]).length === 2;
  // Enable the deployed School product switch per owner direction.
  // This does not supply carrier, funding or recipient authorization.
  // The shared persistent emergency pause remains effective.
  // Reject any other variable before a remote write.
  const onlyApprovedCaller = template?.vars &&
    Object.keys(template.vars).length === 2 &&
    template.vars.AR3D_PLIVO_CALLER_NUMBER === '+918065491333' &&
    template.vars.AR3D_INDUSTRY_SCHOOL_DISPATCH_ENABLED === 'enabled';
  // Reuse the existing minute schedule. WhatsApp runs through one dedicated
  // queue consumer, keeping its D1 budget separate without another cron slot.
  const onlyCallingCrons = template?.triggers &&
    Object.keys(template.triggers).length === 1 &&
    Array.isArray(template.triggers.crons) &&
    template.triggers.crons.length === 1 &&
    template.triggers.crons[0] === '* * * * *';
  const exactRow=(row,expected)=>row&&Object.keys(row).length===Object.keys(expected).length&&
    Object.entries(expected).every(([key,value])=>row[key]===value);
  const onlyWhatsAppQueue=template?.queues&&Object.keys(template.queues).length===2&&
    Array.isArray(template.queues.producers)&&template.queues.producers.length===1&&
    exactRow(template.queues.producers[0],{binding:'WHATSAPP_TICKS',queue:'ar3d-calling-whatsapp'})&&
    Array.isArray(template.queues.consumers)&&template.queues.consumers.length===1&&
    exactRow(template.queues.consumers[0],{queue:'ar3d-calling-whatsapp',max_batch_size:1,max_batch_timeout:1,max_retries:2,max_concurrency:1,retry_delay:60});
  if (template?.name !== 'ar3d-ai-calling' || template.main !== './src/index.mjs' ||
      template.route || !onlyCallingDomain || !onlyCallingCrons || !onlyWhatsAppQueue || !onlyApprovedCaller || template.services ||
      !Array.isArray(template.d1_databases) || template.d1_databases.length !== 2 ||
      !Array.isArray(template.r2_buckets) || template.r2_buckets.length !== 1) {
    throw Error('Unsafe Worker template: wrong project, routes, resources or entry point.');
  }
  for (const [key, name] of Object.entries(D1_NAME)) {
    const row = template.d1_databases.find(item => item.binding === key);
    if (!row || row.database_name !== name) throw Error('Unexpected D1 binding: ' + key);
  }
  const bucket = template.r2_buckets[0];
  if (bucket.binding !== 'RECORDINGS' || bucket.bucket_name !== 'ar3d-calling-recordings')
    throw Error('Wrong main R2 bucket name');
  return {
    ...template,
    workers_dev: true,
    d1_databases: template.d1_databases.map(row => ({
      ...row,
      database_id: row.binding === 'CONTROL_DB' ? credentials.control : credentials.crm,
    })),
  };
}


/**
 * Check the safety-critical CRM triggers, not merely tables with expected
 * names. An incomplete migration must never be treated as deploy-ready.
 * This is not a substitute for manual data integrity and security review.
 */
export const REQUIRED_SAFETY_TRIGGERS = Object.freeze({
  trg_prevent_lead_opt_out_reversal: ['before update','on leads','lead_opt_out_events','raise(abort'],
  trg_block_unverified_consent_update: ['before update','on leads','raise(abort'],
  trg_block_unverified_consent_insert: ['before insert on leads','raise(abort'],
  trg_no_call_launch: ['before insert on calls','raise(abort'],
  trg_agents_block_active_insert: ['before insert on agents','raise(abort'],
  trg_agents_block_active_update: ['before update of status on agents','raise(abort'],
  trg_call_intent_proposal_immutable: ['before update on call_intent_proposals','raise(abort'],
  trg_call_intent_proposal_no_provider: ['before insert on call_intent_proposals','raise(abort'],
});
export const REQUIRED_MINUTE_LEDGER_TRIGGERS=Object.freeze({
 trg_minute_ledger_no_update:['before update on tenant_minute_ledger','raise(abort'],
 trg_minute_ledger_no_delete:['before delete on tenant_minute_ledger','raise(abort'],
 trg_minute_ledger_chain:['before insert on tenant_minute_ledger','new.previous_seconds','new.tenant_id','order by sequence desc','raise(abort']
});
export const REQUIRED_HOLD_TRIGGERS=Object.freeze({
 trg_minute_hold_insert:['before insert on tenant_minute_holds','new.reserved_seconds','raise(abort'],
 trg_minute_hold_close:['before update on tenant_minute_holds','old.state','raise(abort'],
 trg_minute_hold_delete:['before delete on tenant_minute_holds','raise(abort'],
 trg_minute_ledger_commitments:['before insert on tenant_minute_ledger','new.balance_seconds','tenant_minute_holds','raise(abort']
});
export const REQUIRED_PROVIDER_JOURNAL_TRIGGERS=Object.freeze({
 trg_provider_journal_no_update:['before update on provider_financial_journal','raise(abort'],
 trg_provider_journal_no_delete:['before delete on provider_financial_journal','raise(abort'],
 trg_provider_journal_opening_first:['before insert on provider_financial_journal','new.kind','raise(abort']
});
export const REQUIRED_PURCHASE_TRIGGERS=Object.freeze({
 trg_credit_purchase_no_update:['before update on tenant_credit_purchases','raise(abort'],
 trg_credit_purchase_no_delete:['before delete on tenant_credit_purchases','raise(abort'],
 trg_credit_purchase_allocate:['after insert on tenant_credit_purchases','insert into tenant_minute_ledger','new.purchased_seconds','new.previous_seconds','raise(abort']
});
export const REQUIRED_PROVIDER_SAFETY_TRIGGERS=Object.freeze({
 trg_provider_safety_no_update:['before update on provider_safety_events','raise(abort'],
 trg_provider_safety_no_delete:['before delete on provider_safety_events','raise(abort']
});
export const REQUIRED_PROVIDER_RESERVE_TRIGGERS=Object.freeze({
 trg_provider_reserve_hold:['after insert on provider_cost_reservations','insert into tenant_minute_holds','new.reserved_seconds'],
 trg_provider_reserve_no_update:['before update on provider_cost_reservations','raise(abort'],
 trg_provider_reserve_no_delete:['before delete on provider_cost_reservations','raise(abort']
});
export const REQUIRED_PROVIDER_RECONCILE_TRIGGERS=Object.freeze({
 trg_provider_cost_reconcile_validate:['before insert on provider_cost_reconciliations','tenant_minute_holds','provider_financial_journal','raise(abort'],
 trg_provider_cost_reconcile_overrun:['after insert on provider_cost_reconciliations','insert into provider_safety_events','cost_over_reserve'],
 trg_provider_cost_reconcile_no_update:['before update on provider_cost_reconciliations','raise(abort'],
 trg_provider_cost_reconcile_no_delete:['before delete on provider_cost_reconciliations','raise(abort'],
 trg_provider_cost_zero_evidence_guard:['before insert on provider_financial_journal','provider_cost_reconciliations','raise(abort']
});
export const REQUIRED_FUNDING_SETTINGS_TRIGGERS=Object.freeze({
 trg_calling_funding_no_delete:['before delete on calling_funding_settings','raise(abort'],
 trg_calling_funding_revision:['before update on calling_funding_settings','new.revision<>old.revision+1','raise(abort']
});
export const REQUIRED_MANUAL_BALANCE_TRIGGERS=Object.freeze({
 trg_provider_balance_no_update:['before update on provider_balance_snapshots','raise(abort'],
 trg_provider_balance_no_delete:['before delete on provider_balance_snapshots','raise(abort'],
 trg_provider_balance_cover_validate:['before insert on provider_balance_covered_calls','provider_balance_snapshots','tenant_minute_holds',"h.state='settled'","'-60 seconds'",'raise(abort'],
 trg_provider_balance_cover_no_update:['before update on provider_balance_covered_calls','raise(abort'],
 trg_provider_balance_cover_no_delete:['before delete on provider_balance_covered_calls','raise(abort'],
 trg_provider_manual_control_no_delete:['before delete on provider_manual_funding_control','raise(abort'],
 trg_provider_manual_control_revision:['before update on provider_manual_funding_control','new.revision<>old.revision+1','raise(abort']
});
export function checkManualBalanceTriggers(records){
 const map=new Map(records.map(r=>[r.name,String(r.sql||'').toLowerCase().replace(/\s+/g,' ')]));
 for(const [name,parts] of Object.entries(REQUIRED_MANUAL_BALANCE_TRIGGERS))if(parts.some(p=>!map.get(name)?.includes(p)))throw Error('Manual balance safety trigger missing or invalid: '+name);
}
export function checkFundingSettingsTriggers(records){
 const map=new Map(records.map(r=>[r.name,String(r.sql||'').toLowerCase().replace(/\s+/g,' ')]));
 for(const [name,parts] of Object.entries(REQUIRED_FUNDING_SETTINGS_TRIGGERS))if(parts.some(p=>!map.get(name)?.includes(p)))throw Error('Calling funding settings safety trigger missing or invalid: '+name);
}
export function checkProviderReconcileTriggers(records){
 const map=new Map(records.map(r=>[r.name,String(r.sql||'').toLowerCase().replace(/\s+/g,' ')]));
 for(const [name,parts] of Object.entries(REQUIRED_PROVIDER_RECONCILE_TRIGGERS))if(parts.some(p=>!map.get(name)?.includes(p)))throw Error('Provider reconciliation safety trigger missing or invalid: '+name);
}
export function checkProviderReserveTriggers(records){
 const map=new Map(records.map(r=>[r.name,String(r.sql||'').toLowerCase().replace(/\s+/g,' ')]));
 for(const [name,parts] of Object.entries(REQUIRED_PROVIDER_RESERVE_TRIGGERS))if(parts.some(p=>!map.get(name)?.includes(p)))throw Error('Provider reservation safety trigger missing or invalid: '+name);
}
export function checkProviderSafetyTriggers(records){
 const map=new Map(records.map(r=>[r.name,String(r.sql||'').toLowerCase().replace(/\s+/g,' ')]));
 for(const [name,parts] of Object.entries(REQUIRED_PROVIDER_SAFETY_TRIGGERS))if(parts.some(p=>!map.get(name)?.includes(p)))throw Error('Provider safety trigger missing or invalid: '+name);
}
export function checkPurchaseTriggers(records){
 const map=new Map(records.map(r=>[r.name,String(r.sql||'').toLowerCase().replace(/\s+/g,' ')]));
 for(const [name,parts] of Object.entries(REQUIRED_PURCHASE_TRIGGERS))if(parts.some(p=>!map.get(name)?.includes(p)))throw Error('Credit purchase safety trigger missing or invalid: '+name);
}
export function checkProviderJournalTriggers(records){
 const map=new Map(records.map(r=>[r.name,String(r.sql||'').toLowerCase().replace(/\s+/g,' ')]));
 for(const [name,parts] of Object.entries(REQUIRED_PROVIDER_JOURNAL_TRIGGERS))if(parts.some(p=>!map.get(name)?.includes(p)))throw Error('Provider journal safety trigger missing or invalid: '+name);
}
export function checkHoldTriggers(records){
 const map=new Map(records.map(r=>[r.name,String(r.sql||'').toLowerCase().replace(/\s+/g,' ')]));
 for(const [name,parts] of Object.entries(REQUIRED_HOLD_TRIGGERS))if(parts.some(p=>!map.get(name)?.includes(p)))throw Error('Minute hold safety trigger missing or invalid: '+name);
}
export function checkMinuteLedgerTriggers(records){
 if(!Array.isArray(records))throw Error('Invalid minute ledger trigger inspection');
 const rows=new Map(records.map(r=>[r?.name,String(r?.sql||'').toLowerCase().replace(/\s+/g,' ')]));
 for(const [name,parts] of Object.entries(REQUIRED_MINUTE_LEDGER_TRIGGERS)){
  if(parts.some(p=>!rows.get(name)?.includes(p)))throw Error('Minute ledger safety trigger missing or invalid: '+name);
 }
}
export const REQUIRED_INDUSTRY_SNAPSHOT_TRIGGERS=Object.freeze({
  trg_ai_flow_snapshot_immutable:Object.freeze(['before update','on ai_flow_snapshots','raise(abort']),
  trg_ai_flow_snapshot_no_delete:Object.freeze(['before delete','on ai_flow_snapshots','raise(abort']),
  trg_ai_flow_review_immutable:Object.freeze(['before update','on ai_flow_preview_reviews','raise(abort']),
  trg_ai_flow_review_no_delete:Object.freeze(['before delete','on ai_flow_preview_reviews','raise(abort'])
});
export function checkIndustrySnapshotTriggers(records){
 if(!Array.isArray(records))throw Error('Invalid simulation snapshot trigger inspection.');
 const triggers=new Map(records.map(r=>[r?.name,String(r?.sql||'').toLowerCase().replace(/\s+/g,' ').trim()]));
 for(const [name,parts] of Object.entries(REQUIRED_INDUSTRY_SNAPSHOT_TRIGGERS)){
  const sql=triggers.get(name);
  if(!sql||parts.some(x=>!sql.includes(x)))
   throw Error('Control simulation snapshot immutability trigger missing or invalid: '+name+'. Deployment refused.');
 }
}
export const REQUIRED_SCHOOL_AUDIO_TRIGGERS=Object.freeze({
 trg_school_audio_insert:Object.freeze(['before insert','on school_audio_preparations',"new.state<>'claimed'",'raise(abort']),
 trg_school_audio_update:Object.freeze(['before update','on school_audio_preparations','new.reserved_micros<>old.reserved_micros','new.attempted_nodes=old.attempted_nodes+1','raise(abort']),
 trg_school_audio_delete:Object.freeze(['before delete','on school_audio_preparations','raise(abort'])
});
export function checkSchoolAudioTriggers(records){
 if(!Array.isArray(records))throw Error('Invalid School audio trigger inspection.');
 const rows=new Map(records.map(r=>[r?.name,String(r?.sql||'').toLowerCase().replace(/\s+/g,' ').trim()]));
 for(const [name,parts] of Object.entries(REQUIRED_SCHOOL_AUDIO_TRIGGERS)){
  if(parts.some(part=>!rows.get(name)?.includes(part)))throw Error('School audio safety trigger missing or invalid: '+name);
 }
}
export const REQUIRED_DISPATCH_PAUSE_TRIGGERS=Object.freeze({
 trg_dispatch_pause_sequence:Object.freeze(['before insert','on calling_dispatch_pause_events','max(revision)','new.paused=coalesce','raise(abort']),
 trg_dispatch_pause_no_update:Object.freeze(['before update','on calling_dispatch_pause_events','raise(abort']),
 trg_dispatch_pause_no_delete:Object.freeze(['before delete','on calling_dispatch_pause_events','raise(abort'])
});
export function checkDispatchPauseTriggers(records){
 if(!Array.isArray(records))throw Error('Invalid dispatch pause trigger inspection.');
 const rows=new Map(records.map(r=>[r?.name,String(r?.sql||'').toLowerCase().replace(/\s+/g,' ').trim()]));
 for(const [name,parts] of Object.entries(REQUIRED_DISPATCH_PAUSE_TRIGGERS)){
  if(parts.some(part=>!rows.get(name)?.includes(part)))throw Error('Dispatch pause safety trigger missing or invalid: '+name);
 }
}
export const REQUIRED_INDUSTRY_LAUNCH_TRIGGERS=Object.freeze({
 trg_industry_launch_request_guard:Object.freeze(['before update','on industry_launch_requests',"old.state<>'requested'",'raise(abort']),
 trg_industry_launch_request_no_delete:Object.freeze(['before delete','on industry_launch_requests','raise(abort'])
});
export function checkIndustryLaunchTriggers(records){
 if(!Array.isArray(records))throw Error('Invalid industry launch trigger inspection.');
 const rows=new Map(records.map(r=>[r?.name,String(r?.sql||'').toLowerCase().replace(/\s+/g,' ').trim()]));
 for(const [name,parts] of Object.entries(REQUIRED_INDUSTRY_LAUNCH_TRIGGERS)){
  if(parts.some(part=>!rows.get(name)?.includes(part)))throw Error('Industry launch request safety trigger missing or invalid: '+name);
 }
}
export const REQUIRED_INDUSTRY_DISPATCH_TRIGGERS=Object.freeze({
 trg_industry_dispatch_insert:Object.freeze(['before insert','on industry_dispatch_releases',"new.state<>'authorized'",'from industry_funded_admissions','raise(abort']),
 trg_industry_dispatch_update:Object.freeze(['before update','on industry_dispatch_releases',"old.state='claimed'","old.state='posting'",'new.session_id is old.session_id','raise(abort']),
 trg_industry_dispatch_delete:Object.freeze(['before delete','on industry_dispatch_releases','raise(abort'])
});
export function checkIndustryDispatchTriggers(records){
 if(!Array.isArray(records))throw Error('Invalid industry dispatch trigger inspection.');
 const rows=new Map(records.map(r=>[r?.name,String(r?.sql||'').toLowerCase().replace(/\s+/g,' ').trim()]));
 for(const [name,parts] of Object.entries(REQUIRED_INDUSTRY_DISPATCH_TRIGGERS)){
  if(parts.some(part=>!rows.get(name)?.includes(part)))throw Error('Industry dispatch safety trigger missing or invalid: '+name);
 }
}
export const REQUIRED_INDUSTRY_TERMINAL_TRIGGERS=Object.freeze({
 trg_industry_terminal_insert:Object.freeze(['before insert','on industry_terminal_closures','from verified_industry_call_costs','c.billed_seconds=new.billed_seconds',"a.state='funded'",'raise(abort']),
 trg_industry_terminal_update:Object.freeze(['before update','on industry_terminal_closures','raise(abort']),
 trg_industry_terminal_delete:Object.freeze(['before delete','on industry_terminal_closures','raise(abort'])
});
export function checkIndustryTerminalTriggers(records){
 if(!Array.isArray(records))throw Error('Invalid industry terminal trigger inspection.');
 const rows=new Map(records.map(r=>[r?.name,String(r?.sql||'').toLowerCase().replace(/\s+/g,' ').trim()]));
 for(const [name,parts] of Object.entries(REQUIRED_INDUSTRY_TERMINAL_TRIGGERS)){
  if(parts.some(part=>!rows.get(name)?.includes(part)))throw Error('Industry terminal safety trigger missing or invalid: '+name);
 }
}
export const REQUIRED_INDUSTRY_CDR_TRIGGERS=Object.freeze({
 trg_industry_cdr_insert:Object.freeze(['before insert','on verified_industry_call_costs',"a.state='funded'",'from calling_jobs','from verified_provider_call_costs','raise(abort']),
 trg_industry_cdr_update:Object.freeze(['before update','on verified_industry_call_costs','raise(abort']),
 trg_industry_cdr_delete:Object.freeze(['before delete','on verified_industry_call_costs','raise(abort'])
});
export function checkIndustryCdrTriggers(records){
 if(!Array.isArray(records))throw Error('Invalid industry CDR trigger inspection.');
 const rows=new Map(records.map(r=>[r?.name,String(r?.sql||'').toLowerCase().replace(/\s+/g,' ').trim()]));
 for(const [name,parts] of Object.entries(REQUIRED_INDUSTRY_CDR_TRIGGERS)){
  if(parts.some(part=>!rows.get(name)?.includes(part)))throw Error('Industry CDR safety trigger missing or invalid: '+name);
 }
}
export const REQUIRED_INDUSTRY_ADMISSION_TRIGGERS=Object.freeze({
 trg_industry_admission_insert:Object.freeze(['before insert','on industry_funded_admissions',"new.state<>'released'",'raise(abort']),
 trg_industry_admission_update:Object.freeze(['before update','on industry_funded_admissions','new.max_seconds<>old.max_seconds',"old.state='claiming'",'raise(abort']),
 trg_industry_admission_delete:Object.freeze(['before delete','on industry_funded_admissions','raise(abort']),
 trg_industry_admission_cancel_guard:Object.freeze(['before update','on industry_call_jobs',"a.state in('claiming','funded','unknown')",'raise(abort'])
});
export function checkIndustryAdmissionTriggers(records){
 if(!Array.isArray(records))throw Error('Invalid industry admission trigger inspection.');
 const rows=new Map(records.map(r=>[r?.name,String(r?.sql||'').toLowerCase().replace(/\s+/g,' ').trim()]));
 for(const [name,parts] of Object.entries(REQUIRED_INDUSTRY_ADMISSION_TRIGGERS)){
  if(parts.some(part=>!rows.get(name)?.includes(part)))throw Error('Industry admission safety trigger missing or invalid: '+name);
 }
}
export const REQUIRED_INDUSTRY_JOB_TRIGGERS=Object.freeze({
 trg_industry_job_insert:Object.freeze(['before insert','on industry_call_jobs',"new.state<>'prepared'","v.decision='cleared'",'raise(abort']),
 trg_industry_job_update:Object.freeze(['before update','on industry_call_jobs','new.manifest_sha256<>old.manifest_sha256',"new.state<>'cancelled'",'raise(abort']),
 trg_industry_job_delete:Object.freeze(['before delete','on industry_call_jobs','raise(abort'])
});
export function checkIndustryJobTriggers(records){
 if(!Array.isArray(records))throw Error('Invalid industry job trigger inspection.');
 const rows=new Map(records.map(r=>[r?.name,String(r?.sql||'').toLowerCase().replace(/\s+/g,' ').trim()]));
 for(const [name,parts] of Object.entries(REQUIRED_INDUSTRY_JOB_TRIGGERS)){
  if(parts.some(part=>!rows.get(name)?.includes(part)))throw Error('Industry job safety trigger missing or invalid: '+name);
 }
}
export const REQUIRED_INDUSTRY_CAMPAIGN_TRIGGERS=Object.freeze({
 trg_industry_campaign_guard:Object.freeze(['before update','on industry_campaigns','old.archived_at is not null','raise(abort']),
 trg_industry_campaign_no_delete:Object.freeze(['before delete','on industry_campaigns','raise(abort']),
 trg_industry_candidate_no_update:Object.freeze(['before update','on industry_campaign_candidates','raise(abort']),
 trg_industry_candidate_no_delete:Object.freeze(['before delete','on industry_campaign_candidates','raise(abort']),
 trg_industry_review_no_update:Object.freeze(['before update','on industry_recipient_reviews','raise(abort']),
 trg_industry_review_no_delete:Object.freeze(['before delete','on industry_recipient_reviews','raise(abort']),
 trg_industry_review_sequence:Object.freeze(['before insert','on industry_recipient_reviews','max(r.revision)','raise(abort'])
});
export function checkIndustryCampaignTriggers(records){
 if(!Array.isArray(records))throw Error('Invalid industry campaign trigger inspection.');
 const rows=new Map(records.map(r=>[r?.name,String(r?.sql||'').toLowerCase().replace(/\s+/g,' ').trim()]));
 for(const [name,parts] of Object.entries(REQUIRED_INDUSTRY_CAMPAIGN_TRIGGERS)){
  if(parts.some(p=>!rows.get(name)?.includes(p)))throw Error('Industry campaign safety trigger missing or invalid: '+name);
 }
}
export function checkSafetyTriggers(records,{allowCallIntentUpgrade=false}={}) {
  if (!Array.isArray(records)) throw Error('Invalid CRM trigger inspection result.');
  const triggers = new Map(records.map(row => [row?.name, String(row?.sql || '')
    .toLowerCase().replace(/\s+/g, ' ').trim()]));
  for (const [name, signatures] of Object.entries(REQUIRED_SAFETY_TRIGGERS)) {
    if (allowCallIntentUpgrade && name.startsWith('trg_call_intent_')) continue;
    const sql = triggers.get(name);
    if (!sql || signatures.some(signature => !sql.includes(signature)))
      throw Error('CRM safety trigger missing or invalid: ' + name + '. Deployment refused.');
  }
}

const presentMinuteLedger=names=>names.includes('tenant_minute_ledger');
export function checkTables(tables, binding, mode) {
  const expected = REQUIRED_TABLES[binding];
  if (!expected || !Array.isArray(tables)) throw Error('Invalid schema inspection input.');
  const present = new Set(tables);
  if (mode === 'fresh') {
    if (present.size !== 0) throw Error(D1_NAME[binding] + ' is not empty: manual inspection required; no migrations run.');
    return 'fresh';
  }
  const missing = expected.filter(name => !present.has(name));
  if(mode==='preflight'){
    const exact=names=>missing.length===names.length&&names.every(name=>missing.includes(name));
    if(binding==='CONTROL_DB'&&exact(['school_audio_preparations']))return 'control_school_audio_upgrade';
    if(binding==='CONTROL_DB'&&exact(['calling_dispatch_pause_events']))return 'control_dispatch_pause_upgrade';
    if(binding==='CONTROL_DB'&&exact(['industry_launch_requests']))return 'control_industry_launch_upgrade';
    if(binding==='CONTROL_DB'&&exact(INDUSTRY_SNAPSHOT_TABLES))return 'control_industry_snapshots_upgrade';
    if(binding==='CONTROL_DB'&&exact(INDUSTRY_DRAFT_TABLES))return 'control_industry_drafts_upgrade';
    if(binding==='CONTROL_DB'&&exact(CONTROL_WHATSAPP_TABLES))return 'control_whatsapp_upgrade';
    if(binding==='CONTROL_DB'&&exact(['whatsapp_dispatch_ticks']))return 'control_whatsapp_queue_upgrade';
    if(binding==='CRM_DB'){
      if(exact(['industry_dispatch_releases']))return 'crm_industry_dispatch_upgrade';
      if(exact(['industry_terminal_closures']))return 'crm_industry_terminal_upgrade';
      if(exact(['verified_industry_call_costs']))return 'crm_industry_cdr_upgrade';
      if(exact(['industry_funded_admissions']))return 'crm_industry_admission_upgrade';
      if(exact(['industry_call_jobs']))return 'crm_industry_jobs_upgrade';
      if(exact(INDUSTRY_CAMPAIGN_TABLES))return 'crm_industry_campaign_upgrade';
      if(exact([...PROPERTY_TABLES,...WHATSAPP_TABLES]))return 'crm_property_whatsapp_upgrade';
      if(exact(PROPERTY_TABLES))return 'crm_property_upgrade';
      if(exact(WHATSAPP_TABLES))return 'crm_whatsapp_upgrade';
    }
  }
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===3&&['provider_balance_snapshots','provider_balance_covered_calls','provider_manual_funding_control'].every(t=>missing.includes(t)))return 'control_manual_balances_upgrade';
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===1&&missing[0]==='calling_funding_settings')return 'control_funding_settings_upgrade';
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===3&&['calling_dispatch_settings','calling_company_settings','calling_capacity_signals'].every(t=>missing.includes(t)))return 'control_dispatch_settings_upgrade';
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===1&&missing[0]==='provider_cost_reconciliations')return 'control_provider_reconcile_upgrade';
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===1&&missing[0]==='provider_cost_reservations')return 'control_provider_reserve_upgrade';
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===1&&missing[0]==='provider_safety_events')return 'control_provider_safety_upgrade';
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===1&&missing[0]==='tenant_credit_purchases')return 'control_credit_purchase_upgrade';
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===1&&missing[0]==='provider_financial_journal')return 'control_provider_journal_upgrade';
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===1&&missing[0]==='tenant_minute_holds')return 'control_minute_holds_upgrade';
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===1&&missing[0]==='tenant_minute_ledger')return 'control_minute_ledger_upgrade';
  // Exact additive credit/staff tables are safe for the isolated Calling D1.
  // Any missing unrelated table still fails closed rather than deploying.
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===2&&
     ['tenant_credit_budgets','tenant_credit_audit'].every(t=>missing.includes(t)))return 'control_credit_upgrade';
  if(mode==='preflight'&&binding==='CRM_DB'&&missing.length===2&&
     ['lead_staff_assignments','verified_provider_call_costs'].every(t=>missing.includes(t)))return 'crm_staff_cdr_upgrade';
  if(mode==='preflight'&&binding==='CRM_DB'&&missing.length===1&&missing[0]==='verified_provider_call_costs')return 'crm_cdr_upgrade';
  if(mode==='preflight'&&binding==='CRM_DB'&&missing.length===1&&missing[0]==='lead_staff_assignments')return 'crm_staff_upgrade';
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===1&&missing[0]==='scripted_phone_pilots')return 'control_scripted_pilot_upgrade';
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===1&&missing[0]==='company_change_requests')return 'control_company_change_upgrade';
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===1&&missing[0]==='client_account_contacts')return 'control_client_accounts_upgrade';
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===1&&missing[0]==='company_profile_versions')return 'control_profile_upgrade';
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===3&&['calling_agent_publications','shared_voice_gateway','voice_call_routes'].every(t=>missing.includes(t)))return 'control_publication_upgrade';
  const dispatchTables=['calling_policies','calling_clearances','calling_runs','calling_jobs'];
  if(mode==='preflight'&&binding==='CRM_DB'&&missing.length===1&&missing[0]==='scripted_call_results')return 'crm_scripted_results_upgrade';
  if(mode==='preflight'&&binding==='CRM_DB'&&missing.length===4&&dispatchTables.every(x=>missing.includes(x)))return 'crm_dispatch_upgrade';
  if(mode==='preflight'&&binding==='CONTROL_DB'&&missing.length===2&&['calling_script_bindings','calling_script_versions'].every(t=>missing.includes(t)))return 'control_script_upgrade';
  if (mode === 'ready') {
    if (missing.length) throw Error(D1_NAME[binding] + ' missing tables: ' + missing.join(', '));
    return 'ready';
  }
  if (mode === 'preflight') {
    if (present.size === 0) return 'fresh';
    // Only one specifically reviewed ADDITIVE table may be absent on an
    // existing CRM D1. Every original table and calling safety trigger must
    // already exist; unknown partial schemas still fail closed.
    if (binding === 'CRM_DB' && missing.length === 1 &&
        missing[0] === 'call_intent_proposals')
      return 'crm_call_intent_upgrade';
    if (missing.length) throw Error(D1_NAME[binding] + ' has partial schema; inspect manually: ' + missing.join(', '));
    return 'ready';
  }
  throw Error('Invalid verification mode');
}

export function checkColumns(columns, binding, tableName) {
  const expected = REQUIRED_COLUMNS[binding]?.[tableName];
  if (!expected || !Array.isArray(columns)) throw Error('Invalid column inspection input.');
  const missing = expected.filter(column => !columns.includes(column));
  if (missing.length) throw Error(D1_NAME[binding] + '.' + tableName + ' missing columns: ' + missing.join(', '));
}

export async function inspectCloudflare({ credentials, mode, apiFetch = fetch, template }) {
  if (!['preflight','fresh','ready'].includes(mode)) throw Error('Choose preflight, fresh or ready.');
  // Fail closed on unexpected Wrangler routing or database identity BEFORE all API calls.
  const config = makeMainConfig(template, credentials);
  const base = 'https://api.cloudflare.com/client/v4/accounts/' + credentials.account + '/d1/database/';
  const headers = { Authorization: 'Bearer ' + credentials.token, 'Content-Type': 'application/json' };
  async function call(url, options = {}) {
    const response = await apiFetch(url, { ...options, headers });
    let data;
    try { data = await response.json(); } catch { throw Error('Cloudflare API did not return JSON.'); }
    if (!response.ok || data.success !== true) throw Error('Cloudflare API rejected D1 access. Review account/token permissions.');
    return data.result;
  }
  async function query(id, sql) {
    const result = await call(base + id + '/query', { method:'POST', body:JSON.stringify({sql}) });
    if (!Array.isArray(result) || result[0]?.success === false || !Array.isArray(result[0]?.results))
      throw Error('Cloudflare D1 query returned an unexpected result.');
    return result[0].results;
  }
  const modes = {};
  for (const [binding, id] of [['CONTROL_DB', credentials.control], ['CRM_DB', credentials.crm]]) {
    const info = await call(base + id);
    if (info?.name !== D1_NAME[binding]) throw Error('D1 ID/name mismatch for ' + D1_NAME[binding]);
    const rows = await query(id, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'");
    const names = rows.map(x => x.name);
    const state = checkTables(names, binding, mode);
    modes[binding] = state;
    if ([...messagingUpgradeStates,'control_industry_drafts_upgrade','control_industry_snapshots_upgrade','control_industry_launch_upgrade','control_dispatch_pause_upgrade','control_school_audio_upgrade','control_client_accounts_upgrade','control_publication_upgrade','control_profile_upgrade',
         'control_script_upgrade','crm_dispatch_upgrade','ready','crm_call_intent_upgrade',
         'crm_scripted_results_upgrade','crm_industry_campaign_upgrade','crm_industry_jobs_upgrade','crm_industry_admission_upgrade','crm_industry_cdr_upgrade','crm_industry_terminal_upgrade','crm_industry_dispatch_upgrade','control_company_change_upgrade',
         'control_scripted_pilot_upgrade','control_dispatch_settings_upgrade','control_funding_settings_upgrade','control_manual_balances_upgrade','control_credit_upgrade','control_minute_ledger_upgrade','control_minute_holds_upgrade','control_provider_journal_upgrade','control_credit_purchase_upgrade','control_provider_safety_upgrade','control_provider_reserve_upgrade','control_provider_reconcile_upgrade','crm_staff_upgrade','crm_cdr_upgrade','crm_staff_cdr_upgrade'].includes(state)) {
      if (binding === 'CRM_DB') {
        const triggers = await query(id, "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_%'");
        checkSafetyTriggers(triggers,{allowCallIntentUpgrade:state === 'crm_call_intent_upgrade'});
        if(names.includes('industry_campaigns'))checkIndustryCampaignTriggers(triggers);
        if(names.includes('industry_call_jobs'))checkIndustryJobTriggers(triggers);
        if(names.includes('industry_funded_admissions'))checkIndustryAdmissionTriggers(triggers);
        if(names.includes('verified_industry_call_costs'))checkIndustryCdrTriggers(triggers);
        if(names.includes('industry_terminal_closures'))checkIndustryTerminalTriggers(triggers);
        if(names.includes('industry_dispatch_releases'))checkIndustryDispatchTriggers(triggers);
      }
      if(binding==='CONTROL_DB'&&presentMinuteLedger(names)){
        const triggers=await query(id,"SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_minute_ledger_%'");
        checkMinuteLedgerTriggers(triggers);
      }
      if(binding==='CONTROL_DB'&&names.includes('school_audio_preparations')){
        const triggers=await query(id,"SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_school_audio_%'");
        checkSchoolAudioTriggers(triggers);
      }
      if(binding==='CONTROL_DB'&&names.includes('calling_dispatch_pause_events')){
        const triggers=await query(id,"SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_dispatch_pause_%'");
        checkDispatchPauseTriggers(triggers);
      }
      if(binding==='CONTROL_DB'&&names.includes('industry_launch_requests')){
        const triggers=await query(id,"SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_industry_launch_%'");
        checkIndustryLaunchTriggers(triggers);
      }
      if(binding==='CONTROL_DB'&&names.includes('ai_flow_snapshots')){
        const immutable=await query(id,"SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_ai_flow_%'");
        checkIndustrySnapshotTriggers(immutable);
      }
      if(binding==='CONTROL_DB'&&names.includes('tenant_minute_holds')){
        const triggers=await query(id,"SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_minute_%'");
        checkHoldTriggers(triggers);
      }
      if(binding==='CONTROL_DB'&&names.includes('provider_financial_journal')){
        const triggers=await query(id,"SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_provider_journal_%'");
        checkProviderJournalTriggers(triggers);
      }
      if(binding==='CONTROL_DB'&&names.includes('tenant_credit_purchases')){
        const triggers=await query(id,"SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_credit_purchase_%'");
        checkPurchaseTriggers(triggers);
      }
      if(binding==='CONTROL_DB'&&names.includes('provider_safety_events')){
        const triggers=await query(id,"SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_provider_safety_%'");
        checkProviderSafetyTriggers(triggers);
      }
      if(binding==='CONTROL_DB'&&names.includes('provider_cost_reservations')){
        const triggers=await query(id,"SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_provider_reserve_%'");
        checkProviderReserveTriggers(triggers);
      }
      if(binding==='CONTROL_DB'&&names.includes('provider_cost_reconciliations')){
        const triggers=await query(id,"SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_provider_cost_%'");
        checkProviderReconcileTriggers(triggers);
      }
      if(binding==='CONTROL_DB'&&names.includes('calling_funding_settings')){
        const triggers=await query(id,"SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_calling_funding_%'");
        checkFundingSettingsTriggers(triggers);
      }
      if(binding==='CONTROL_DB'&&names.includes('provider_balance_snapshots')){
        const triggers=await query(id,"SELECT name,sql FROM sqlite_master WHERE type='trigger' AND (name LIKE 'trg_provider_balance_%' OR name LIKE 'trg_provider_manual_%')");
        checkManualBalanceTriggers(triggers);
      }
      for (const table of Object.keys(REQUIRED_COLUMNS[binding])) {
        if(messagingMissingTables(state).includes(table))continue;
        if(state==='crm_industry_dispatch_upgrade'&&table==='industry_dispatch_releases')continue;
        if(state==='crm_industry_terminal_upgrade'&&table==='industry_terminal_closures')continue;
        if(state==='crm_industry_cdr_upgrade'&&table==='verified_industry_call_costs')continue;
        if(state==='crm_industry_admission_upgrade'&&table==='industry_funded_admissions')continue;
        if(state==='crm_industry_jobs_upgrade'&&table==='industry_call_jobs')continue;
        if(state==='crm_industry_campaign_upgrade'&&INDUSTRY_CAMPAIGN_TABLES.includes(table))continue;
         if(state==='control_industry_drafts_upgrade'&&INDUSTRY_DRAFT_TABLES.includes(table))continue;
         if(state==='control_industry_snapshots_upgrade'&&INDUSTRY_SNAPSHOT_TABLES.includes(table))continue;
         if(state==='control_school_audio_upgrade'&&table==='school_audio_preparations')continue;
         if(state==='control_dispatch_pause_upgrade'&&table==='calling_dispatch_pause_events')continue;
         if(state==='control_industry_launch_upgrade'&&table==='industry_launch_requests')continue;
        if(state==='control_manual_balances_upgrade'&&['provider_balance_snapshots','provider_balance_covered_calls','provider_manual_funding_control'].includes(table))continue;
        if(state==='control_funding_settings_upgrade'&&table==='calling_funding_settings')continue;
        if(state==='control_dispatch_settings_upgrade'&&['calling_dispatch_settings','calling_company_settings','calling_capacity_signals'].includes(table))continue;
        if(state==='control_provider_reconcile_upgrade'&&table==='provider_cost_reconciliations')continue;
        if(state==='control_provider_reserve_upgrade'&&table==='provider_cost_reservations')continue;
        if(state==='control_provider_safety_upgrade'&&table==='provider_safety_events')continue;
        if(state==='control_credit_purchase_upgrade'&&table==='tenant_credit_purchases')continue;
        if(state==='control_provider_journal_upgrade'&&table==='provider_financial_journal')continue;
        if(state==='control_client_accounts_upgrade'&&table==='client_account_contacts')continue;
        if(state==='control_credit_upgrade'&&['tenant_credit_budgets','tenant_credit_audit'].includes(table))continue;
        if(state==='control_minute_ledger_upgrade'&&table==='tenant_minute_ledger')continue;
        if(state==='control_minute_holds_upgrade'&&table==='tenant_minute_holds')continue;
        if(['crm_staff_upgrade','crm_staff_cdr_upgrade'].includes(state)&&table==='lead_staff_assignments')continue;
        if(['crm_cdr_upgrade','crm_staff_cdr_upgrade'].includes(state)&&table==='verified_provider_call_costs')continue;
        if(state==='control_company_change_upgrade'&&table==='company_change_requests')continue;
        if(state==='control_scripted_pilot_upgrade'&&table==='scripted_phone_pilots')continue;
        if(state==='control_publication_upgrade'&&['calling_agent_publications','shared_voice_gateway','voice_call_routes'].includes(table))continue;
        if(state==='control_profile_upgrade'&&table==='company_profile_versions')continue;
        if(state==='control_script_upgrade'&&table.startsWith('calling_script_'))continue;
        if(state==='crm_dispatch_upgrade'&&table.startsWith('calling_'))continue;
        if (state === 'crm_call_intent_upgrade' && table === 'call_intent_proposals')continue;
        if (state === 'crm_scripted_results_upgrade' && table === 'scripted_call_results')continue;
        const columns = await query(id, 'PRAGMA table_info(' + table + ')');
        checkColumns(columns.map(x => x.name), binding, table);
      }
    }
  }
  // The separate private R2 bucket must exist in the same account. This is
  // read-only verification, never a bucket create/delete operation.
  const bucketResult = await call('https://api.cloudflare.com/client/v4/accounts/' +
    credentials.account + '/r2/buckets/ar3d-calling-recordings');
  if (bucketResult?.name !== 'ar3d-calling-recordings')
    throw Error('Main R2 bucket is missing or belongs to an unexpected resource.');
  // Use the same allowlist for inspection and the deployment decision.
  if (mode === 'preflight') verifiedSchemaState(modes);
  return { config, modes };
}

// A single clean state is mandatory for unattended deployment. Mixed/partial
// schemas are NEVER safe to automatically initialize or deploy.
export function verifiedSchemaState(modes) {
  // These are whole, explicitly reviewed additive groups on the complete
  // prior Calling schema. A completed group can be resumed after a failed
  // deployment; arbitrary partial tables or unrelated upgrades still fail.
  if(modes?.CONTROL_DB==='ready'&&modes?.CRM_DB==='crm_industry_dispatch_upgrade')return 'crm_industry_dispatch_upgrade';
  if(modes?.CONTROL_DB==='ready'&&modes?.CRM_DB==='crm_industry_terminal_upgrade')return 'crm_industry_terminal_upgrade';
  if(modes?.CONTROL_DB==='ready'&&modes?.CRM_DB==='crm_industry_cdr_upgrade')return 'crm_industry_cdr_upgrade';
  if(modes?.CONTROL_DB==='ready'&&modes?.CRM_DB==='crm_industry_admission_upgrade')return 'crm_industry_admission_upgrade';
  if(modes?.CONTROL_DB==='ready'&&modes?.CRM_DB==='crm_industry_jobs_upgrade')return 'crm_industry_jobs_upgrade';
  if(modes?.CONTROL_DB==='control_school_audio_upgrade'&&modes?.CRM_DB==='ready')return 'control_school_audio_upgrade';
  if(modes?.CONTROL_DB==='control_dispatch_pause_upgrade'&&modes?.CRM_DB==='ready')return 'control_dispatch_pause_upgrade';
  if(modes?.CONTROL_DB==='control_industry_launch_upgrade'&&modes?.CRM_DB==='crm_industry_campaign_upgrade')return 'industry_launch_campaign_upgrade';
  if(modes?.CONTROL_DB==='ready'&&modes?.CRM_DB==='crm_industry_campaign_upgrade')return 'crm_industry_campaign_upgrade';
  if(modes?.CONTROL_DB==='control_industry_launch_upgrade'&&modes?.CRM_DB==='ready')return 'control_industry_launch_upgrade';
  if(modes?.CONTROL_DB==='control_industry_snapshots_upgrade'&&modes?.CRM_DB==='ready')return 'control_industry_snapshots_upgrade';
  if(modes?.CONTROL_DB==='control_industry_drafts_upgrade'&&modes?.CRM_DB==='ready')return 'control_industry_drafts_upgrade';
   if(modes?.CONTROL_DB==='control_whatsapp_queue_upgrade'&&modes?.CRM_DB==='ready')return 'whatsapp_queue_upgrade';
  if(['ready','control_whatsapp_upgrade','control_whatsapp_queue_upgrade'].includes(modes?.CONTROL_DB)&&
     ['ready','crm_property_upgrade','crm_whatsapp_upgrade','crm_property_whatsapp_upgrade'].includes(modes?.CRM_DB)&&
     (modes.CONTROL_DB!=='ready'||modes.CRM_DB!=='ready'))return 'property_whatsapp_upgrade';
  if(modes?.CONTROL_DB==='control_credit_upgrade'&&modes?.CRM_DB==='crm_staff_cdr_upgrade')return 'credit_staff_cdr_upgrade';
  if(modes?.CONTROL_DB==='control_credit_upgrade'&&modes?.CRM_DB==='crm_cdr_upgrade')return 'credit_cdr_upgrade';
  if(modes?.CONTROL_DB==='ready'&&modes?.CRM_DB==='crm_staff_cdr_upgrade')return 'crm_staff_cdr_upgrade';
  if(modes?.CONTROL_DB==='ready'&&modes?.CRM_DB==='crm_cdr_upgrade')return 'crm_cdr_upgrade';
  if(modes?.CONTROL_DB==='control_credit_upgrade'&&modes?.CRM_DB==='crm_staff_upgrade')return 'credit_staff_upgrade';
  if(modes?.CONTROL_DB==='control_credit_upgrade'&&modes?.CRM_DB==='ready')return 'control_credit_upgrade';
  if(modes?.CONTROL_DB==='control_minute_ledger_upgrade'&&modes?.CRM_DB==='ready')return 'control_minute_ledger_upgrade';
  if(modes?.CONTROL_DB==='control_dispatch_settings_upgrade'&&modes?.CRM_DB==='ready')return 'control_dispatch_settings_upgrade';
  if(modes?.CONTROL_DB==='control_funding_settings_upgrade'&&modes?.CRM_DB==='ready')return 'control_funding_settings_upgrade';
  if(modes?.CONTROL_DB==='control_manual_balances_upgrade'&&modes?.CRM_DB==='ready')return 'control_manual_balances_upgrade';
  if(modes?.CONTROL_DB==='control_provider_reconcile_upgrade'&&modes?.CRM_DB==='ready')return 'control_provider_reconcile_upgrade';
  if(modes?.CONTROL_DB==='control_provider_reserve_upgrade'&&modes?.CRM_DB==='ready')return 'control_provider_reserve_upgrade';
  if(modes?.CONTROL_DB==='control_provider_safety_upgrade'&&modes?.CRM_DB==='ready')return 'control_provider_safety_upgrade';
  if(modes?.CONTROL_DB==='control_credit_purchase_upgrade'&&modes?.CRM_DB==='ready')return 'control_credit_purchase_upgrade';
  if(modes?.CONTROL_DB==='control_provider_journal_upgrade'&&modes?.CRM_DB==='ready')return 'control_provider_journal_upgrade';
  if(modes?.CONTROL_DB==='control_minute_holds_upgrade'&&modes?.CRM_DB==='ready')return 'control_minute_holds_upgrade';
  if(modes?.CONTROL_DB==='ready'&&modes?.CRM_DB==='crm_staff_upgrade')return 'crm_staff_upgrade';
  if(modes?.CONTROL_DB==='control_scripted_pilot_upgrade'&&modes?.CRM_DB==='ready')return 'control_scripted_pilot_upgrade';
  if(modes?.CONTROL_DB==='control_company_change_upgrade'&&modes?.CRM_DB==='ready')return 'control_company_change_upgrade';
  if(modes?.CONTROL_DB==='control_client_accounts_upgrade'&&modes?.CRM_DB==='ready')return 'control_client_accounts_upgrade';
  if(modes?.CONTROL_DB==='control_publication_upgrade'&&modes?.CRM_DB==='ready')return 'control_publication_upgrade';
  if(modes?.CONTROL_DB==='control_profile_upgrade'&&modes?.CRM_DB==='ready')return 'control_profile_upgrade';
  if(modes?.CONTROL_DB==='control_script_upgrade'&&modes?.CRM_DB==='ready')return 'control_script_upgrade';
  if(modes?.CONTROL_DB==='ready'&&modes?.CRM_DB==='crm_dispatch_upgrade')return 'crm_dispatch_upgrade';
  if (modes?.CONTROL_DB === 'ready' && modes?.CRM_DB === 'crm_scripted_results_upgrade')return 'crm_scripted_results_upgrade';
  if (modes?.CONTROL_DB === 'ready' && modes?.CRM_DB === 'crm_call_intent_upgrade')
    return 'crm_call_intent_upgrade';
  if (!modes || !['fresh','ready'].includes(modes.CONTROL_DB) ||
      modes.CONTROL_DB !== modes.CRM_DB)
    throw Error('Refusing automated deployment: D1 schema states are mixed or invalid.');
  return modes.CONTROL_DB;
}

async function run() {
  const mode = process.argv[2] || 'preflight';
  const credentials = getCredentials(process.env);
  const template = JSON.parse(readFileSync('wrangler.example.jsonc', 'utf8'));
  const { config, modes } = await inspectCloudflare({ credentials, mode, template });
  const state = verifiedSchemaState(modes);
  writeFileSync('wrangler.jsonc', JSON.stringify(config, null, 2));
  // Safe output for GitHub Actions step conditions: state only, never any
  // account ID, database UUID, token or credential-derived worker URL.
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'schema_state=' + state + '\n');
  console.log('AR3D main Cloudflare identity verified. CONTROL_DB=' + modes.CONTROL_DB + ', CRM_DB=' + modes.CRM_DB + '.');
  console.log('Only new ar3d-ai-calling Worker bindings were configured; no other AR3D services were touched.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch(err => {
    console.error('AR3D main setup check failed: ' + (err instanceof Error ? err.message : 'unknown error'));
    process.exitCode = 1;
  });
}
