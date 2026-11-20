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
    'human_login_limits','human_bootstrap_claim','human_ip_login_limits','human_mfa_settings','human_mfa_challenges','human_mfa_recovery_codes','provider_event_inbox','exotel_voicebot_event_receipts','exotel_operator_test_calls','exotel_operator_status_checks',
  ]),
  CRM_DB: Object.freeze([
    'leads','agents','calls','site_visits','crm_audit_events',
    'lead_notes','conversation_simulations','lead_opt_out_events','lead_consent_evidence','call_campaign_drafts','call_campaign_candidates','voicebot_qualification_reviews','call_intent_proposals','calling_policies','calling_clearances','calling_runs','calling_jobs',
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
    exotel_voicebot_event_receipts: Object.freeze(['receipt_key','account_fingerprint','session_fingerprint','call_fingerprint','conversation_fingerprint','event_fingerprint','payload_digest','event_kind','turn_status','possible_opt_out','status','received_at','expires_at']),
    human_ip_login_limits: Object.freeze(['ip_hash','attempt_count','blocked_until']),
    exotel_operator_test_calls: Object.freeze(['id','actor_user_id','rate_slot','provider_call_sid','state','error_code','created_at','updated_at']),
    exotel_operator_status_checks: Object.freeze(['id','call_request_id','actor_user_id','check_slot','state','provider_status','duration_seconds','error_code','created_at','finished_at']),
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
    voicebot_qualification_reviews: Object.freeze(['tenant_id','lead_id','provider','status','survey_json','source_verified','mapping_verified','possible_opt_out']),
    calling_policies: Object.freeze(['tenant_id','enabled','flow_id','expires_at','daily_limit','max_seconds']),
    calling_clearances: Object.freeze(['tenant_id','lead_id','purpose','expires_at']),
    calling_runs: Object.freeze(['tenant_id','id','campaign_id','state']),
    calling_jobs: Object.freeze(['tenant_id','id','run_id','lead_id','state','provider_call_sid','reserved_at']),
    call_intent_proposals: Object.freeze(['tenant_id','id','campaign_id','lead_id','purpose','state','created_by','created_at']),
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
  // Only auth cleanup and the bounded, operator-approved campaign scheduler may run.
  // Reject arbitrary schedules or queue/event consumers targeting other services.
  const onlyAuthCron = template?.triggers &&
    Object.keys(template.triggers).length === 1 &&
    Array.isArray(template.triggers.crons) &&
    template.triggers.crons.length === 2 &&
    template.triggers.crons[0] === '0 */6 * * *' &&
    template.triggers.crons[1] === '* * * * *';
  if (template?.name !== 'ar3d-ai-calling' || template.main !== './src/index.mjs' ||
      template.route || !onlyCallingDomain || !onlyAuthCron || template.services ||
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
  trg_voicebot_review_terminal: ['before update of status on voicebot_qualification_reviews','raise(abort'],
  trg_voicebot_review_immutable: ['before update of tenant_id','voicebot_qualification_reviews','raise(abort'],
  trg_call_intent_proposal_immutable: ['before update on call_intent_proposals','raise(abort'],
  trg_call_intent_proposal_no_provider: ['before insert on call_intent_proposals','raise(abort'],
});
export function checkSafetyTriggers(records,{allowAdditiveUpgrade=false,allowCallIntentUpgrade=false}={}) {
  if (!Array.isArray(records)) throw Error('Invalid CRM trigger inspection result.');
  const triggers = new Map(records.map(row => [row?.name, String(row?.sql || '')
    .toLowerCase().replace(/\s+/g, ' ').trim()]));
  for (const [name, signatures] of Object.entries(REQUIRED_SAFETY_TRIGGERS)) {
    if (allowAdditiveUpgrade && name.startsWith('trg_voicebot_review_')) continue;
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
  const dispatchTables=['calling_policies','calling_clearances','calling_runs','calling_jobs'];
  if(mode==='preflight'&&binding==='CRM_DB'&&missing.length===4&&dispatchTables.every(x=>missing.includes(x)))return 'crm_dispatch_upgrade';
  if (mode === 'ready') {
    if (missing.length) throw Error(D1_NAME[binding] + ' missing tables: ' + missing.join(', '));
    return 'ready';
  }
  if (mode === 'preflight') {
    if (present.size === 0) return 'fresh';
    // Only one specifically reviewed ADDITIVE table may be absent on an
    // existing CRM D1. Every original table and calling safety trigger must
    // already exist; unknown partial schemas still fail closed.
    if (binding === 'CONTROL_DB' && missing.length === 1 &&
        missing[0] === 'exotel_voicebot_event_receipts')
      return 'control_additive_upgrade';
    if (binding === 'CONTROL_DB' && missing.length === 1 &&
        missing[0] === 'exotel_operator_test_calls')
      return 'control_operator_test_upgrade';
    if (binding === 'CONTROL_DB' && missing.length === 1 &&
        missing[0] === 'exotel_operator_status_checks')
      return 'control_operator_status_upgrade';
    if (binding === 'CRM_DB' && missing.length === 1 &&
        missing[0] === 'voicebot_qualification_reviews')
      return 'crm_additive_upgrade';
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
    if (state === 'crm_dispatch_upgrade' || state === 'ready' || state === 'crm_additive_upgrade' ||
        state === 'crm_call_intent_upgrade' ||
        state === 'control_additive_upgrade' ||
        state === 'control_operator_test_upgrade' ||
        state === 'control_operator_status_upgrade') {
      if (binding === 'CRM_DB') {
        const triggers = await query(id, "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_%'");
        checkSafetyTriggers(triggers,{
          allowAdditiveUpgrade:state === 'crm_additive_upgrade',
          allowCallIntentUpgrade:state === 'crm_call_intent_upgrade'
        });
      }
      for (const table of Object.keys(REQUIRED_COLUMNS[binding])) {
        if(state==='crm_dispatch_upgrade'&&table.startsWith('calling_'))continue;
        if (state === 'crm_additive_upgrade' && table === 'voicebot_qualification_reviews')continue;
        if (state === 'crm_call_intent_upgrade' && table === 'call_intent_proposals')continue;
        if (state === 'control_additive_upgrade' && table === 'exotel_voicebot_event_receipts')continue;
        if (state === 'control_operator_test_upgrade' && table === 'exotel_operator_test_calls')continue;
        if (state === 'control_operator_status_upgrade' && table === 'exotel_operator_status_checks')continue;
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
  // Preflight rejects a mixed state. This stops accidental double-initialize.
  if (mode === 'preflight' && modes.CONTROL_DB !== modes.CRM_DB &&
      !(modes.CONTROL_DB === 'ready' && modes.CRM_DB === 'crm_dispatch_upgrade') &&
      !(modes.CONTROL_DB === 'ready' && modes.CRM_DB === 'crm_additive_upgrade') &&
      !(modes.CONTROL_DB === 'ready' && modes.CRM_DB === 'crm_call_intent_upgrade') &&
      !(modes.CONTROL_DB === 'control_additive_upgrade' && modes.CRM_DB === 'ready') &&
      !(modes.CONTROL_DB === 'control_operator_test_upgrade' && modes.CRM_DB === 'ready') &&
      !(modes.CONTROL_DB === 'control_operator_status_upgrade' && modes.CRM_DB === 'ready'))
    throw Error('D1 databases have mixed initialized/empty states; manual reconciliation required.');
  return { config, modes };
}

// A single clean state is mandatory for unattended deployment. Mixed/partial
// schemas are NEVER safe to automatically initialize or deploy.
export function verifiedSchemaState(modes) {
  if(modes?.CONTROL_DB==='ready'&&modes?.CRM_DB==='crm_dispatch_upgrade')return 'crm_dispatch_upgrade';
  if (modes?.CONTROL_DB === 'ready' && modes?.CRM_DB === 'crm_additive_upgrade')
    return 'crm_additive_upgrade';
  if (modes?.CONTROL_DB === 'ready' && modes?.CRM_DB === 'crm_call_intent_upgrade')
    return 'crm_call_intent_upgrade';
  if (modes?.CONTROL_DB === 'control_additive_upgrade' && modes?.CRM_DB === 'ready')
    return 'control_additive_upgrade';
  if (modes?.CONTROL_DB === 'control_operator_test_upgrade' && modes?.CRM_DB === 'ready')
    return 'control_operator_test_upgrade';
  if (modes?.CONTROL_DB === 'control_operator_status_upgrade' && modes?.CRM_DB === 'ready')
    return 'control_operator_status_upgrade';
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
