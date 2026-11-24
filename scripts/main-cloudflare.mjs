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
export const REQUIRED_TABLES = Object.freeze({
  CONTROL_DB: Object.freeze([
    'tenants','tenant_keys','project_links','tenant_numbers','tenant_audit_events',
    'human_users','tenant_memberships','human_sessions','human_invitations',
    'human_login_limits','human_bootstrap_claim','human_ip_login_limits','human_mfa_settings','human_mfa_challenges','human_mfa_recovery_codes','provider_event_inbox','calling_script_bindings','calling_script_versions','company_profile_versions','calling_agent_publications','shared_voice_gateway','voice_call_routes','client_account_contacts','company_change_requests','scripted_phone_pilots','tenant_credit_budgets','tenant_credit_audit','tenant_minute_ledger',
  ]),
  CRM_DB: Object.freeze([
    'leads','agents','calls','site_visits','crm_audit_events',
    'lead_notes','conversation_simulations','lead_opt_out_events','lead_consent_evidence','call_campaign_drafts','call_campaign_candidates','call_intent_proposals','calling_policies','calling_clearances','calling_runs','calling_jobs','scripted_call_results','lead_staff_assignments','verified_provider_call_costs',
  ]),
});
export const REQUIRED_COLUMNS = Object.freeze({
  CONTROL_DB: Object.freeze({
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
    calling_script_bindings: Object.freeze(['tenant_id','bot_id','assistant_id','source_version']),
    calling_script_versions: Object.freeze(['tenant_id','id','revision','config_json','prompt','provider_state','provider_version']),
    human_ip_login_limits: Object.freeze(['ip_hash','attempt_count','blocked_until']),
  }),
  CRM_DB: Object.freeze({
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
  // The approved Bengaluru 080 landline is the sole configured AR3D outbound
  // caller. This non-secret identifier NEVER permits promotional calling,
  // initiates a call, or changes any independently gated campaign flags.
  // A wrong or additional template var fails before a remote write.
  const onlyApprovedCaller = template?.vars &&
    Object.keys(template.vars).length === 1 &&
    template.vars.AR3D_PLIVO_CALLER_NUMBER === '+918065491333';
  // Only auth cleanup and the bounded, operator-approved campaign scheduler may run.
  // Reject arbitrary schedules or queue/event consumers targeting other services.
  const onlyAuthCron = template?.triggers &&
    Object.keys(template.triggers).length === 1 &&
    Array.isArray(template.triggers.crons) &&
    template.triggers.crons.length === 1 &&
    template.triggers.crons[0] === '* * * * *';
  if (template?.name !== 'ar3d-ai-calling' || template.main !== './src/index.mjs' ||
      template.route || !onlyCallingDomain || !onlyAuthCron || !onlyApprovedCaller || template.services ||
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

export function checkTables(tables, binding, mode) {
  const expected = REQUIRED_TABLES[binding];
  if (!expected || !Array.isArray(tables)) throw Error('Invalid schema inspection input.');
  const present = new Set(tables);
  if (mode === 'fresh') {
    if (present.size !== 0) throw Error(D1_NAME[binding] + ' is not empty: manual inspection required; no migrations run.');
    return 'fresh';
  }
  const missing = expected.filter(name => !present.has(name));
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
    if (['control_client_accounts_upgrade','control_publication_upgrade','control_profile_upgrade',
         'control_script_upgrade','crm_dispatch_upgrade','ready','crm_call_intent_upgrade',
         'crm_scripted_results_upgrade','control_company_change_upgrade',
         'control_scripted_pilot_upgrade','control_credit_upgrade','control_minute_ledger_upgrade','crm_staff_upgrade','crm_cdr_upgrade','crm_staff_cdr_upgrade'].includes(state)) {
      if (binding === 'CRM_DB') {
        const triggers = await query(id, "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_%'");
        checkSafetyTriggers(triggers,{allowCallIntentUpgrade:state === 'crm_call_intent_upgrade'});
      }
      for (const table of Object.keys(REQUIRED_COLUMNS[binding])) {
        if(state==='control_client_accounts_upgrade'&&table==='client_account_contacts')continue;
        if(state==='control_credit_upgrade'&&['tenant_credit_budgets','tenant_credit_audit'].includes(table))continue;
        if(state==='control_minute_ledger_upgrade'&&table==='tenant_minute_ledger')continue;
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
  if(modes?.CONTROL_DB==='control_credit_upgrade'&&modes?.CRM_DB==='crm_staff_cdr_upgrade')return 'credit_staff_cdr_upgrade';
  if(modes?.CONTROL_DB==='control_credit_upgrade'&&modes?.CRM_DB==='crm_cdr_upgrade')return 'credit_cdr_upgrade';
  if(modes?.CONTROL_DB==='ready'&&modes?.CRM_DB==='crm_staff_cdr_upgrade')return 'crm_staff_cdr_upgrade';
  if(modes?.CONTROL_DB==='ready'&&modes?.CRM_DB==='crm_cdr_upgrade')return 'crm_cdr_upgrade';
  if(modes?.CONTROL_DB==='control_credit_upgrade'&&modes?.CRM_DB==='crm_staff_upgrade')return 'credit_staff_upgrade';
  if(modes?.CONTROL_DB==='control_credit_upgrade'&&modes?.CRM_DB==='ready')return 'control_credit_upgrade';
  if(modes?.CONTROL_DB==='control_minute_ledger_upgrade'&&modes?.CRM_DB==='ready')return 'control_minute_ledger_upgrade';
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
