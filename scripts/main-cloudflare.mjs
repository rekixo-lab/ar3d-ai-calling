/**
 * AR3D AI Calling — guarded main Cloudflare D1 preflight.
 * Pure checks below can be tested without credentials. Never prints tokens.
 * This script does not write to Cloudflare; only the manual GitHub workflow's
 * explicit `initialize` and `deploy` operations perform remote writes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const D1_NAME = Object.freeze({
  CONTROL_DB: 'ar3d-calling-control',
  CRM_DB: 'ar3d-calling-shared-crm',
});
export const REQUIRED_TABLES = Object.freeze({
  CONTROL_DB: Object.freeze([
    'tenants','tenant_keys','project_links','tenant_numbers','tenant_audit_events',
    'human_users','tenant_memberships','human_sessions','human_invitations',
    'human_login_limits','human_bootstrap_claim','human_ip_login_limits',
  ]),
  CRM_DB: Object.freeze([
    'leads','agents','calls','site_visits','crm_audit_events',
    'lead_notes','conversation_simulations','lead_opt_out_events',
  ]),
});
export const REQUIRED_COLUMNS = Object.freeze({
  CONTROL_DB: Object.freeze({
    tenants: Object.freeze(['id','plan_code','storage_mode']),
    human_users: Object.freeze(['id','global_role','password_hash']),
    human_sessions: Object.freeze(['token_hash','expires_at']),
  }),
  CRM_DB: Object.freeze({
    leads: Object.freeze(['tenant_id','consent_status','dnd_status','interest_status','followup_at']),
    conversation_simulations: Object.freeze(['tenant_id','state_json','expires_at']),
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
  if (template?.name !== 'ar3d-ai-calling' || template.main !== './src/index.mjs' ||
      template.route || template.routes?.length || template.triggers || template.services ||
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

export function checkTables(tables, binding, mode) {
  const expected = REQUIRED_TABLES[binding];
  if (!expected || !Array.isArray(tables)) throw Error('Invalid schema inspection input.');
  const present = new Set(tables);
  if (mode === 'fresh') {
    if (present.size !== 0) throw Error(D1_NAME[binding] + ' is not empty: manual inspection required; no migrations run.');
    return 'fresh';
  }
  const missing = expected.filter(name => !present.has(name));
  if (mode === 'ready') {
    if (missing.length) throw Error(D1_NAME[binding] + ' missing tables: ' + missing.join(', '));
    return 'ready';
  }
  if (mode === 'preflight') {
    if (present.size === 0) return 'fresh';
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
    if (state === 'ready') {
      for (const table of Object.keys(REQUIRED_COLUMNS[binding])) {
        const columns = await query(id, 'PRAGMA table_info(' + table + ')');
        checkColumns(columns.map(x => x.name), binding, table);
      }
    }
  }
  // Preflight rejects a mixed state. This stops accidental double-initialize.
  if (mode === 'preflight' && modes.CONTROL_DB !== modes.CRM_DB)
    throw Error('D1 databases have mixed initialized/empty states; manual reconciliation required.');
  return { config, modes };
}

async function run() {
  const mode = process.argv[2] || 'preflight';
  const credentials = getCredentials(process.env);
  const template = JSON.parse(readFileSync('wrangler.example.jsonc', 'utf8'));
  const { config, modes } = await inspectCloudflare({ credentials, mode, template });
  writeFileSync('wrangler.jsonc', JSON.stringify(config, null, 2));
  console.log('AR3D main Cloudflare identity verified. CONTROL_DB=' + modes.CONTROL_DB + ', CRM_DB=' + modes.CRM_DB + '.');
  console.log('Only new ar3d-ai-calling Worker bindings were configured; no other AR3D services were touched.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch(err => {
    console.error('AR3D main setup check failed: ' + (err instanceof Error ? err.message : 'unknown error'));
    process.exitCode = 1;
  });
}
