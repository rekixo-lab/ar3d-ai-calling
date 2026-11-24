import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_COLUMNS, REQUIRED_TABLES, REQUIRED_SAFETY_TRIGGERS, REQUIRED_MINUTE_LEDGER_TRIGGERS, REQUIRED_HOLD_TRIGGERS, REQUIRED_PROVIDER_JOURNAL_TRIGGERS, REQUIRED_PURCHASE_TRIGGERS, REQUIRED_PROVIDER_SAFETY_TRIGGERS, checkProviderSafetyTriggers, checkPurchaseTriggers, checkProviderJournalTriggers, checkHoldTriggers, checkMinuteLedgerTriggers, getCredentials, makeMainConfig, checkTables, checkColumns, checkSafetyTriggers, inspectCloudflare, verifiedSchemaState,
} from '../scripts/main-cloudflare.mjs';

test('new CDR cost observation is additive only and guarded by exact Calling CRM state',async()=>{
 const missing=['verified_provider_call_costs'];
 const old=REQUIRED_TABLES.CRM_DB.filter(x=>!missing.includes(x));
 const prior=REQUIRED_TABLES.CRM_DB.filter(x=>!['lead_staff_assignments',...missing].includes(x));
 const controls=REQUIRED_TABLES.CONTROL_DB.filter(x=>!['tenant_credit_budgets','tenant_credit_audit'].includes(x));
 assert.equal(checkTables(old,'CRM_DB','preflight'),'crm_cdr_upgrade');
 assert.equal(checkTables(prior,'CRM_DB','preflight'),'crm_staff_cdr_upgrade');
 assert.equal(verifiedSchemaState({CONTROL_DB:'ready',CRM_DB:'crm_cdr_upgrade'}),'crm_cdr_upgrade');
 assert.equal(verifiedSchemaState({CONTROL_DB:'ready',CRM_DB:'crm_staff_cdr_upgrade'}),'crm_staff_cdr_upgrade');
 assert.equal(verifiedSchemaState({CONTROL_DB:'control_credit_upgrade',CRM_DB:'crm_cdr_upgrade'}),'credit_cdr_upgrade');
 assert.equal(verifiedSchemaState({CONTROL_DB:'control_credit_upgrade',CRM_DB:'crm_staff_cdr_upgrade'}),'credit_staff_cdr_upgrade');
 assert.throws(()=>checkTables(old,'CRM_DB','ready'),/missing tables/);
 assert.throws(()=>checkTables(prior.filter(x=>x!=='leads'),'CRM_DB','preflight'),/partial schema/);
 assert.throws(()=>checkTables(controls.filter(x=>x!=='human_sessions'),'CONTROL_DB','preflight'),/partial schema/);
 const inspection=await inspectCloudflare({
  credentials:getCredentials(env),mode:'preflight',template,
  apiFetch:cloudflareMock({controlTables:REQUIRED_TABLES.CONTROL_DB,crmTables:prior})
 });
 assert.equal(inspection.modes.CRM_DB,'crm_staff_cdr_upgrade');
 assert.equal(inspection.modes.CONTROL_DB,'ready');
 await assert.rejects(inspectCloudflare({
  credentials:getCredentials(env),mode:'ready',template,
  apiFetch:cloudflareMock({controlTables:REQUIRED_TABLES.CONTROL_DB,crmTables:prior})
 }),/missing tables/);
 assert.throws(()=>checkColumns(['tenant_id','job_id'],'CRM_DB','verified_provider_call_costs'),/missing columns/);
});

test('isolated credit wallet + staff CRM additions have exact fail-closed main deploy states',async()=>{
 const missingControl=['tenant_credit_budgets','tenant_credit_audit'];
 const oldControl=REQUIRED_TABLES.CONTROL_DB.filter(name=>!missingControl.includes(name));
 const oldCrm=REQUIRED_TABLES.CRM_DB.filter(name=>name!=='lead_staff_assignments');
 assert.equal(checkTables(oldControl,'CONTROL_DB','preflight'),'control_credit_upgrade');
 assert.equal(checkTables(oldCrm,'CRM_DB','preflight'),'crm_staff_upgrade');
 assert.equal(verifiedSchemaState({CONTROL_DB:'control_credit_upgrade',CRM_DB:'crm_staff_upgrade'}),'credit_staff_upgrade');
 assert.equal(verifiedSchemaState({CONTROL_DB:'control_credit_upgrade',CRM_DB:'ready'}),'control_credit_upgrade');
 assert.equal(verifiedSchemaState({CONTROL_DB:'ready',CRM_DB:'crm_staff_upgrade'}),'crm_staff_upgrade');
 assert.throws(()=>checkTables(oldControl,'CONTROL_DB','ready'),/missing tables/);
 assert.throws(()=>checkTables(oldCrm,'CRM_DB','ready'),/missing tables/);
 assert.throws(()=>checkTables(oldControl.filter(x=>x!=='human_sessions'),'CONTROL_DB','preflight'),/partial schema/);
 assert.throws(()=>checkTables(oldCrm.filter(x=>x!=='leads'),'CRM_DB','preflight'),/partial schema/);
 const state=await inspectCloudflare({credentials:getCredentials(env),mode:'preflight',template,
  apiFetch:cloudflareMock({controlTables:oldControl,crmTables:oldCrm})});
 assert.equal(state.modes.CONTROL_DB,'control_credit_upgrade');
 assert.equal(state.modes.CRM_DB,'crm_staff_upgrade');
 await assert.rejects(inspectCloudflare({credentials:getCredentials(env),mode:'ready',template,
  apiFetch:cloudflareMock({controlTables:oldControl,crmTables:oldCrm})}),/missing tables/);
});

test('Calling Control company change queue is a single additive isolated migration',async()=>{
 const old=REQUIRED_TABLES.CONTROL_DB.filter(x=>x!=='company_change_requests');
 assert.equal(checkTables(old,'CONTROL_DB','preflight'),'control_company_change_upgrade');
 assert.equal(verifiedSchemaState({CONTROL_DB:'control_company_change_upgrade',CRM_DB:'ready'}),'control_company_change_upgrade');
 assert.throws(()=>checkTables(old.filter(x=>x!=='human_sessions'),'CONTROL_DB','preflight'),/partial schema/);
 const state=await inspectCloudflare({credentials:getCredentials(env),mode:'preflight',template,
  apiFetch:cloudflareMock({controlTables:old,crmTables:REQUIRED_TABLES.CRM_DB})});
 assert.equal(state.modes.CONTROL_DB,'control_company_change_upgrade');
});
test('client account migration accepts only exact complete prior Calling Control schema',async()=>{
  const old=REQUIRED_TABLES.CONTROL_DB.filter(x=>x!=='client_account_contacts');
  assert.equal(checkTables(old,'CONTROL_DB','preflight'),'control_client_accounts_upgrade');
  assert.throws(()=>checkTables(old.filter(x=>x!=='human_invitations'),'CONTROL_DB','preflight'),/partial schema/);
  assert.equal(verifiedSchemaState({CONTROL_DB:'control_client_accounts_upgrade',CRM_DB:'ready'}),'control_client_accounts_upgrade');
  const checked=await inspectCloudflare({credentials:getCredentials(env),mode:'preflight',template,
    apiFetch:cloudflareMock({controlTables:old,crmTables:REQUIRED_TABLES.CRM_DB})});
  assert.equal(checked.modes.CONTROL_DB,'control_client_accounts_upgrade');
});
test('conversation script upgrade only accepts the complete previous control schema',async()=>{
 const old=REQUIRED_TABLES.CONTROL_DB.filter(t=>!t.startsWith('calling_script_'));
 assert.equal(checkTables(old,'CONTROL_DB','preflight'),'control_script_upgrade');
 assert.throws(()=>checkTables(old.filter(t=>t!=='human_sessions'),'CONTROL_DB','preflight'),/partial schema/);
 assert.throws(()=>checkTables([...old,'calling_script_versions'],'CONTROL_DB','preflight'),/partial schema/);
 assert.equal(verifiedSchemaState({CONTROL_DB:'control_script_upgrade',CRM_DB:'ready'}),'control_script_upgrade');
 const inspected=await inspectCloudflare({credentials:getCredentials(env),mode:'preflight',template,apiFetch:cloudflareMock({controlTables:old,crmTables:REQUIRED_TABLES.CRM_DB})});
 assert.equal(inspected.modes.CONTROL_DB,'control_script_upgrade');
});

const env = {
  CLOUDFLARE_API_TOKEN: 'top-secret-api-token-placeholder-1234',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CONTROL_DB_ID: '11111111-1111-4111-8111-111111111111',
  CRM_DB_ID: '22222222-2222-4222-8222-222222222222',
};
const template = {
  name:'ar3d-ai-calling', main:'./src/index.mjs', workers_dev:false,
  vars:{AR3D_PLIVO_CALLER_NUMBER:'+918065491333'},
  routes:[{pattern:'aicalling.ar3dstudio.in',custom_domain:true}],
  triggers:{crons:['* * * * *']},
  d1_databases:[
    {binding:'CONTROL_DB',database_name:'ar3d-calling-control',database_id:'PLACEHOLDER'},
    {binding:'CRM_DB',database_name:'ar3d-calling-shared-crm',database_id:'PLACEHOLDER'},
  ],
  r2_buckets:[{binding:'RECORDINGS',bucket_name:'ar3d-calling-recordings'}],
};

test('validates account and two independent D1 IDs', () => {
  const credentials = getCredentials(env);
  assert.equal(credentials.account, 'a'.repeat(32));
  assert.throws(() => getCredentials({...env, CLOUDFLARE_ACCOUNT_ID:env.CONTROL_DB_ID}), /invalid/);
  assert.throws(() => getCredentials({...env, CRM_DB_ID:env.CONTROL_DB_ID}), /invalid/);
});
test('config binds only main Calling resources and exact approved custom domain', () => {
  const config = makeMainConfig(template,getCredentials(env));
  assert.equal(config.name,'ar3d-ai-calling');
  assert.equal(config.workers_dev,true);
  assert.equal(config.d1_databases[0].database_id, env.CONTROL_DB_ID);
  assert.equal(config.r2_buckets[0].bucket_name,'ar3d-calling-recordings');
  assert.deepEqual(config.routes,[{pattern:'aicalling.ar3dstudio.in',custom_domain:true}]);
  assert.deepEqual(config.triggers,{crons:['* * * * *']});
  assert.deepEqual(config.vars,{AR3D_PLIVO_CALLER_NUMBER:'+918065491333'});
  assert.equal(config.vars.AR3D_SCRIPTED_CAMPAIGNS_ENABLED,undefined);
});
test('rejects existing production Cloudflare routes and wrong database/bucket names', () => {
  assert.throws(() => makeMainConfig({...template,routes:[{pattern:'admin.rekixo.com/*'}]},getCredentials(env)), /Unsafe/);
  assert.throws(() => makeMainConfig({...template,routes:[{pattern:'aicalling.ar3dstudio.in',custom_domain:false}]},getCredentials(env)), /Unsafe/);
  assert.throws(() => makeMainConfig({...template,routes:[{pattern:'aicalling.ar3dstudio.in',custom_domain:true},{pattern:'rekixo.com',custom_domain:true}]},getCredentials(env)), /Unsafe/);
  assert.throws(() => makeMainConfig({...template,routes:[{pattern:'aicalling.ar3dstudio.in',custom_domain:true,zone_name:'ar3dstudio.in'}]},getCredentials(env)), /Unsafe/);
  assert.throws(() => makeMainConfig({...template,routes:[]},getCredentials(env)), /Unsafe/);
  assert.throws(() => makeMainConfig({...template,vars:{AR3D_PLIVO_CALLER_NUMBER:'+912269833332'}},getCredentials(env)), /Unsafe/);
  assert.throws(() => makeMainConfig({...template,vars:{...template.vars,AR3D_SCRIPTED_CAMPAIGNS_ENABLED:'enabled'}},getCredentials(env)), /Unsafe/);
  assert.throws(() => makeMainConfig({...template,vars:{}},getCredentials(env)), /Unsafe/);
  assert.throws(() => makeMainConfig({...template,triggers:{crons:['0 */6 * * *']}},getCredentials(env)), /Unsafe/);
  assert.throws(() => makeMainConfig({...template,triggers:{crons:['0 */6 * * *','* * * * *','*/2 * * * *']}},getCredentials(env)), /Unsafe/);
  assert.throws(() => makeMainConfig({...template,triggers:{crons:['* * * * *'],queues:['other']}},getCredentials(env)), /Unsafe/);
  assert.throws(() => makeMainConfig({...template,triggers:undefined},getCredentials(env)), /Unsafe/);
  assert.throws(() => makeMainConfig({...template,d1_databases:[{...template.d1_databases[0],database_name:'tiyansh-production'},template.d1_databases[1]]},getCredentials(env)), /Unexpected/);
  assert.throws(() => makeMainConfig({...template,r2_buckets:[{binding:'RECORDINGS',bucket_name:'rekixo-3d-assets'}]},getCredentials(env)), /Wrong/);
});
test('fresh initialization refuses partially initialized tables', () => {
  assert.equal(checkTables([], 'CRM_DB','fresh'), 'fresh');
  assert.throws(() => checkTables(['leads'],'CRM_DB','fresh'), /not empty/);
});
test('preflight only allows fully fresh or ready schema', () => {
  assert.equal(checkTables([], 'CONTROL_DB','preflight'), 'fresh');
  assert.equal(checkTables(REQUIRED_TABLES.CONTROL_DB,'CONTROL_DB','preflight'), 'ready');
  assert.throws(() => checkTables(['tenants'], 'CONTROL_DB','preflight'), /partial schema/);
});
test('ready requires every required migration table', () => {
  assert.throws(() => checkTables(['leads'], 'CRM_DB','ready'), /missing tables/);
  assert.equal(checkTables(REQUIRED_TABLES.CRM_DB,'CRM_DB','ready'), 'ready');
  assert.throws(() => checkColumns(['tenant_id','consent_status'],'CRM_DB','leads'), /missing columns/);
});

const mockTriggers=Object.entries({...REQUIRED_SAFETY_TRIGGERS,...REQUIRED_MINUTE_LEDGER_TRIGGERS,...REQUIRED_HOLD_TRIGGERS,...REQUIRED_PROVIDER_JOURNAL_TRIGGERS,...REQUIRED_PURCHASE_TRIGGERS,...REQUIRED_PROVIDER_SAFETY_TRIGGERS}).map(([name,parts])=>
  ({name,sql:'CREATE TRIGGER '+name+' '+parts.join(' ')+' BEGIN SELECT RAISE(ABORT, "deny"); END'}));
function cloudflareMock({ controlTables=[],crmTables=[],controlName='ar3d-calling-control',crmName='ar3d-calling-shared-crm',leadColumns=['tenant_id','consent_status','dnd_status','interest_status','followup_at','customer_segment','plot_size_preference','visit_date_preference'],bucketName='ar3d-calling-recordings',triggers=mockTriggers }={}) {
  return async (url,opts) => {
    const control=url.includes(env.CONTROL_DB_ID);
    const tableNames=control?controlTables:crmTables;
    let result;
    if(url.includes('/r2/buckets/')) result={name:bucketName};
    else if(!url.endsWith('/query')) result = { name: control ? controlName : crmName };
    else {
      const sql=JSON.parse(opts.body).sql;
      let rows;
      if(sql.includes("type='trigger'")) rows=sql.includes('trg_minute_ledger_')?triggers.filter(x=>x.name.startsWith('trg_minute_ledger_')):triggers;
      else if(sql.includes('sqlite_master')) rows=tableNames.map(name=>({name}));
      else if(sql.includes('PRAGMA')) {
        if(sql.includes('leads')) rows=leadColumns.map(name=>({name}));
        else if(sql.includes('conversation_simulations')) rows=['tenant_id','state_json','expires_at'].map(name=>({name}));
        else if(sql.includes('tenants')) rows=['id','plan_code','storage_mode','suspended_from_status'].map(name=>({name}));
        else if(sql.includes('human_users')) rows=['id','global_role','password_hash'].map(name=>({name}));
        else if(sql.includes('human_mfa_settings')) rows=['user_id','recovery_generation_id','enabled_at'].map(name=>({name}));
        else if(sql.includes('human_mfa_recovery_codes')) rows=['user_id','code_hash','used_at'].map(name=>({name}));
        else if(sql.includes('provider_event_inbox')) rows=['tenant_id','provider','event_id','status'].map(name=>({name}));
        else if(sql.includes('human_ip_login_limits')) rows=['ip_hash','attempt_count','blocked_until'].map(name=>({name}));
        else if(sql.includes('lead_opt_out_events')) rows=['tenant_id','lead_id','source','created_at'].map(name=>({name}));
        else if(sql.includes('lead_consent_evidence')) rows=['tenant_id','lead_id','review_status','submitted_by'].map(name=>({name}));
        else if(sql.includes('call_campaign_drafts')) rows=['tenant_id','status','language_mode'].map(name=>({name}));
        else if(sql.includes('call_campaign_candidates')) rows=['tenant_id','campaign_id','lead_id'].map(name=>({name}));
        else if(sql.includes('scripted_call_results')) rows=REQUIRED_COLUMNS.CRM_DB.scripted_call_results.map(name=>({name}));
        else if(sql.includes('tenant_credit_budgets')) rows=REQUIRED_COLUMNS.CONTROL_DB.tenant_credit_budgets.map(name=>({name}));
        else if(sql.includes('tenant_credit_audit')) rows=REQUIRED_COLUMNS.CONTROL_DB.tenant_credit_audit.map(name=>({name}));
        else if(sql.includes('tenant_minute_ledger')) rows=REQUIRED_COLUMNS.CONTROL_DB.tenant_minute_ledger.map(name=>({name}));
        else if(sql.includes('provider_safety_events')) rows=REQUIRED_COLUMNS.CONTROL_DB.provider_safety_events.map(name=>({name}));
        else if(sql.includes('tenant_credit_purchases')) rows=REQUIRED_COLUMNS.CONTROL_DB.tenant_credit_purchases.map(name=>({name}));
        else if(sql.includes('provider_financial_journal')) rows=REQUIRED_COLUMNS.CONTROL_DB.provider_financial_journal.map(name=>({name}));
        else if(sql.includes('tenant_minute_holds')) rows=REQUIRED_COLUMNS.CONTROL_DB.tenant_minute_holds.map(name=>({name}));
        else if(sql.includes('lead_staff_assignments')) rows=REQUIRED_COLUMNS.CRM_DB.lead_staff_assignments.map(name=>({name}));
        else if(sql.includes('verified_provider_call_costs')) rows=REQUIRED_COLUMNS.CRM_DB.verified_provider_call_costs.map(name=>({name}));
        else if(sql.includes('call_intent_proposals')) rows=['tenant_id','id','campaign_id','lead_id','purpose','state','created_by','created_at'].map(name=>({name}));
        else if(sql.includes('company_profile_versions')) rows=REQUIRED_COLUMNS.CONTROL_DB.company_profile_versions.map(name=>({name}));
        else if(sql.includes('client_account_contacts')) rows=REQUIRED_COLUMNS.CONTROL_DB.client_account_contacts.map(name=>({name}));
        else if(sql.includes('company_change_requests')) rows=REQUIRED_COLUMNS.CONTROL_DB.company_change_requests.map(name=>({name}));
        else if(sql.includes('scripted_phone_pilots')) rows=REQUIRED_COLUMNS.CONTROL_DB.scripted_phone_pilots.map(name=>({name}));
        else if(sql.includes('shared_voice_gateway')) rows=REQUIRED_COLUMNS.CONTROL_DB.shared_voice_gateway.map(name=>({name}));
        else if(sql.includes('voice_call_routes')) rows=REQUIRED_COLUMNS.CONTROL_DB.voice_call_routes.map(name=>({name}));
        else if(sql.includes('calling_agent_')) {const t=sql.match(/PRAGMA table_info\(([^)]+)\)/)[1];rows=REQUIRED_COLUMNS.CONTROL_DB[t].map(name=>({name}));}
        else if(sql.includes('calling_script_')) {const t=sql.match(/PRAGMA table_info\(([^)]+)\)/)[1];rows=REQUIRED_COLUMNS.CONTROL_DB[t].map(name=>({name}));}
        else if(sql.includes('calling_')) {const t=sql.match(/PRAGMA table_info\(([^)]+)\)/)[1];rows=REQUIRED_COLUMNS.CRM_DB[t].map(name=>({name}));}
        else if(sql.includes('agents')) rows=['tenant_id','status','questions_json'].map(name=>({name}));
        else rows=['token_hash','expires_at'].map(name=>({name}));
      } else throw Error('Unexpected SQL');
      result = [{ success:true,results:rows }];
    }
    return {ok:true,json:async()=>({success:true,result})};
  };
}
test('preflight accepts new empty resources with correct Cloudflare identities', async () => {
  const r = await inspectCloudflare({credentials:getCredentials(env),mode:'preflight',template,apiFetch:cloudflareMock()});
  assert.deepEqual(r.modes,{CONTROL_DB:'fresh',CRM_DB:'fresh'});
});
test('identity mismatch blocks touching any resource', async () => {
  await assert.rejects(inspectCloudflare({credentials:getCredentials(env),mode:'fresh',template,apiFetch:cloudflareMock({controlName:'tiyansh-production'})}),/mismatch/);
});
test('production preflight accepts the isolated scripted phone upgrade with ready CRM', async () => {
  const controlTables=REQUIRED_TABLES.CONTROL_DB.filter(name=>name!=='scripted_phone_pilots');
  const check=(crmTables,mode='preflight')=>inspectCloudflare({
    credentials:getCredentials(env),mode,template,apiFetch:cloudflareMock({controlTables,crmTables})
  });
  const {modes}=await check(REQUIRED_TABLES.CRM_DB);
  assert.deepEqual(modes,{CONTROL_DB:'control_scripted_pilot_upgrade',CRM_DB:'ready'});
  assert.equal(verifiedSchemaState(modes),'control_scripted_pilot_upgrade');
  await assert.rejects(check([]),/mixed or invalid/);
  await assert.rejects(check(REQUIRED_TABLES.CRM_DB,'ready'),/scripted_phone_pilots/);
});

test('mixed empty/initialized state is not accepted without human inspection', async () => {
  await assert.rejects(inspectCloudflare({credentials:getCredentials(env),mode:'preflight',template,apiFetch:cloudflareMock({controlTables:REQUIRED_TABLES.CONTROL_DB})}),/mixed/);
});
test('ready passes complete schema with expected lead columns', async () => {
  const r=await inspectCloudflare({credentials:getCredentials(env),mode:'ready',template,apiFetch:cloudflareMock({controlTables:REQUIRED_TABLES.CONTROL_DB,crmTables:REQUIRED_TABLES.CRM_DB})});
  assert.deepEqual(r.modes,{CONTROL_DB:'ready',CRM_DB:'ready'});
});
test('ready blocks missing lead workflow columns', async () => {
  await assert.rejects(inspectCloudflare({credentials:getCredentials(env),mode:'ready',template,apiFetch:cloudflareMock({controlTables:REQUIRED_TABLES.CONTROL_DB,crmTables:REQUIRED_TABLES.CRM_DB,leadColumns:['tenant_id','consent_status']})}),/missing columns/);
});


test('CRM trigger signature validation rejects missing or replaced calling safety triggers', () => {
  assert.doesNotThrow(()=>checkSafetyTriggers(mockTriggers));
  assert.throws(()=>checkSafetyTriggers(mockTriggers.filter(x=>x.name!=='trg_no_call_launch')),/trg_no_call_launch/);
  assert.throws(()=>checkSafetyTriggers(mockTriggers.map(x=>x.name==='trg_no_call_launch'?
    {...x,sql:'CREATE TRIGGER trg_no_call_launch BEFORE INSERT ON calls BEGIN SELECT 1; END'}:x)),/trg_no_call_launch/);
});
test('main deploy preflight refuses an incorrectly named or missing R2 bucket', async () => {
  await assert.rejects(inspectCloudflare({credentials:getCredentials(env),mode:'preflight',template,
    apiFetch:cloudflareMock({bucketName:'some-other-AR3D-bucket'})}),/R2 bucket/);
});
test('ready schema refuses absent CRM safety triggers even when all tables exist', async () => {
  await assert.rejects(inspectCloudflare({credentials:getCredentials(env),mode:'ready',template,
    apiFetch:cloudflareMock({controlTables:REQUIRED_TABLES.CONTROL_DB,
      crmTables:REQUIRED_TABLES.CRM_DB,triggers:mockTriggers.slice(1)})}),/safety trigger/);
});
test('ready schema checks post-migration safety columns, not just original tables', async () => {
  assert.throws(()=>checkColumns(['tenant_id','status'],'CRM_DB','call_campaign_drafts'),/missing columns/);
  assert.throws(()=>checkColumns(['user_id'],'CONTROL_DB','human_mfa_recovery_codes'),/missing columns/);
   assert.throws(()=>checkColumns(['tenant_id','status'],'CRM_DB','call_intent_proposals'),/missing columns/);
});

test('ready deployment blocks missing tenant suspension state tracking', () => {
  assert.throws(()=>checkColumns(['id','plan_code','storage_mode'],'CONTROL_DB','tenants'),/missing columns/);
});

test('preflight refuses incomplete provider event inbox schema',()=>{
  assert.throws(()=>checkColumns(['tenant_id','provider'],'CONTROL_DB','provider_event_inbox'),/missing columns/);
});


test('unattended operations allow only both new-empty or both verified-ready schemas',()=>{
  assert.equal(verifiedSchemaState({CONTROL_DB:'fresh',CRM_DB:'fresh'}),'fresh');
  assert.equal(verifiedSchemaState({CONTROL_DB:'ready',CRM_DB:'ready'}),'ready');
  assert.throws(()=>verifiedSchemaState({CONTROL_DB:'fresh',CRM_DB:'ready'}),/mixed or invalid/);
  assert.throws(()=>verifiedSchemaState({CONTROL_DB:'ready',CRM_DB:'partial'}),/mixed or invalid/);
  assert.throws(()=>verifiedSchemaState({CONTROL_DB:'unsafe',CRM_DB:'unsafe'}),/mixed or invalid/);
});

test('historical carrier-only tables are ignored by the required active schema',()=>{
 const expanded=[...REQUIRED_TABLES.CONTROL_DB,'retired_carrier_receipts'];
 assert.equal(checkTables(expanded,'CONTROL_DB','preflight'),'ready');
 assert.equal(checkTables(expanded,'CONTROL_DB','ready'),'ready');
 assert.throws(()=>checkTables(REQUIRED_TABLES.CONTROL_DB.filter(t=>t!=='human_sessions'),
  'CONTROL_DB','preflight'),/partial schema/);
});
test('Calling CRM v10 upgrade permits exactly one missing blocked-proposal table',async()=>{
  const old=REQUIRED_TABLES.CRM_DB.filter(x=>x!=='call_intent_proposals');
  assert.equal(checkTables(old,'CRM_DB','preflight'),'crm_call_intent_upgrade');
  assert.throws(()=>checkTables(old,'CRM_DB','ready'),/missing tables/);
  assert.throws(()=>checkTables(old.filter(x=>x!=='leads'),'CRM_DB','preflight'),/partial schema/);
  assert.equal(verifiedSchemaState({
    CONTROL_DB:'ready',CRM_DB:'crm_call_intent_upgrade'
  }),'crm_call_intent_upgrade');
  const retained=mockTriggers.filter(x=>!x.name.startsWith('trg_call_intent_'));
  const checked=await inspectCloudflare({
    credentials:getCredentials(env),mode:'preflight',template,
    apiFetch:cloudflareMock({controlTables:REQUIRED_TABLES.CONTROL_DB,
      crmTables:old,triggers:retained})
  });
  assert.deepEqual(checked.modes,{CONTROL_DB:'ready',CRM_DB:'crm_call_intent_upgrade'});
  await assert.rejects(inspectCloudflare({
    credentials:getCredentials(env),mode:'preflight',template,
    apiFetch:cloudflareMock({controlTables:REQUIRED_TABLES.CONTROL_DB,
      crmTables:old,triggers:retained.filter(x=>x.name!=='trg_no_call_launch')})
  }),/safety trigger/);
  assert.throws(()=>checkColumns(['tenant_id','id'],'CRM_DB','call_intent_proposals'),
    /missing columns/);
  assert.throws(()=>verifiedSchemaState({
    CONTROL_DB:'unknown_upgrade',CRM_DB:'crm_call_intent_upgrade'
  }),/mixed or invalid/);
});
test('campaign dispatch upgrade requires exactly four missing tables on the complete v10 baseline',async()=>{
 const added=['calling_policies','calling_clearances','calling_runs','calling_jobs'];
 const old=REQUIRED_TABLES.CRM_DB.filter(x=>!added.includes(x));
 assert.equal(checkTables(old,'CRM_DB','preflight'),'crm_dispatch_upgrade');
 assert.equal(verifiedSchemaState({CONTROL_DB:'ready',CRM_DB:'crm_dispatch_upgrade'}),'crm_dispatch_upgrade');
 assert.throws(()=>checkTables([...old,'calling_policies'],'CRM_DB','preflight'),/partial/);
 assert.throws(()=>checkTables(old.filter(x=>x!=='leads'),'CRM_DB','preflight'),/partial/);
 const result=await inspectCloudflare({credentials:getCredentials(env),mode:'preflight',template,apiFetch:cloudflareMock({controlTables:REQUIRED_TABLES.CONTROL_DB,crmTables:old})});
 assert.equal(result.modes.CRM_DB,'crm_dispatch_upgrade');
});
test('company profile upgrade requires complete prior Control schema and preserves all existing columns',async()=>{
 const old=REQUIRED_TABLES.CONTROL_DB.filter(x=>x!=='company_profile_versions');
 assert.equal(checkTables(old,'CONTROL_DB','preflight'),'control_profile_upgrade');
 assert.equal(verifiedSchemaState({CONTROL_DB:'control_profile_upgrade',CRM_DB:'ready'}),'control_profile_upgrade');
 assert.throws(()=>checkTables(old.filter(x=>x!=='human_users'),'CONTROL_DB','preflight'),/partial/);
 assert.throws(()=>checkTables(old,'CONTROL_DB','ready'),/missing tables/);
 const result=await inspectCloudflare({credentials:getCredentials(env),mode:'preflight',template,apiFetch:cloudflareMock({controlTables:old,crmTables:REQUIRED_TABLES.CRM_DB})});
 assert.equal(result.modes.CONTROL_DB,'control_profile_upgrade');
});
test('agent publication upgrade requires exactly three missing tables on the complete profile baseline',async()=>{
 const added=['calling_agent_publications','shared_voice_gateway','voice_call_routes'];const old=REQUIRED_TABLES.CONTROL_DB.filter(x=>!added.includes(x));
 assert.equal(checkTables(old,'CONTROL_DB','preflight'),'control_publication_upgrade');
 assert.equal(verifiedSchemaState({CONTROL_DB:'control_publication_upgrade',CRM_DB:'ready'}),'control_publication_upgrade');
 assert.throws(()=>checkTables(old.filter(x=>x!=='company_profile_versions'),'CONTROL_DB','preflight'),/partial/);
 assert.throws(()=>checkTables([...old,added[0]],'CONTROL_DB','preflight'),/partial/);
 const result=await inspectCloudflare({credentials:getCredentials(env),mode:'preflight',template,apiFetch:cloudflareMock({controlTables:old,crmTables:REQUIRED_TABLES.CRM_DB})});assert.equal(result.modes.CONTROL_DB,'control_publication_upgrade');
});

test('production preflight accepts the exact scripted results CRM upgrade', async () => {
  const crmTables=REQUIRED_TABLES.CRM_DB.filter(name=>name!=='scripted_call_results');
  const {modes}=await inspectCloudflare({credentials:getCredentials(env),mode:'preflight',template,
    apiFetch:cloudflareMock({controlTables:REQUIRED_TABLES.CONTROL_DB,crmTables})});
  assert.equal(verifiedSchemaState(modes),'crm_scripted_results_upgrade');
  assert.throws(()=>checkTables(crmTables,'CRM_DB','ready'),/scripted_call_results/);
});

test('minute ledger upgrade requires exact prior schema and ready CRM',()=>{const old=REQUIRED_TABLES.CONTROL_DB.filter(t=>t!=='tenant_minute_ledger');assert.equal(checkTables(old,'CONTROL_DB','preflight'),'control_minute_ledger_upgrade');assert.equal(verifiedSchemaState({CONTROL_DB:'control_minute_ledger_upgrade',CRM_DB:'ready'}),'control_minute_ledger_upgrade');assert.throws(()=>checkTables(old,'CONTROL_DB','ready'),/tenant_minute_ledger/);assert.throws(()=>checkTables(old.filter(t=>t!=='human_sessions'),'CONTROL_DB','preflight'),/partial schema/)});

test('minute ledger triggers required on complete schema',()=>{const rows=mockTriggers.filter(x=>Object.hasOwn(REQUIRED_MINUTE_LEDGER_TRIGGERS,x.name));checkMinuteLedgerTriggers(rows);assert.throws(()=>checkMinuteLedgerTriggers(rows.slice(1)),/Minute ledger safety trigger/);});

test('exact hold migration and mandatory triggers',()=>{const old=REQUIRED_TABLES.CONTROL_DB.filter(t=>t!=='tenant_minute_holds');assert.equal(checkTables(old,'CONTROL_DB','preflight'),'control_minute_holds_upgrade');assert.equal(verifiedSchemaState({CONTROL_DB:'control_minute_holds_upgrade',CRM_DB:'ready'}),'control_minute_holds_upgrade');assert.throws(()=>checkTables(old,'CONTROL_DB','ready'),/tenant_minute_holds/);const rows=mockTriggers.filter(x=>Object.hasOwn(REQUIRED_HOLD_TRIGGERS,x.name));checkHoldTriggers(rows);assert.throws(()=>checkHoldTriggers(rows.slice(1)),/Minute hold safety trigger/)});

test('provider journal additive upgrade and immutable trigger verification',async()=>{
 const old=REQUIRED_TABLES.CONTROL_DB.filter(x=>x!=='provider_financial_journal');
 assert.equal(checkTables(old,'CONTROL_DB','preflight'),'control_provider_journal_upgrade');
 assert.equal(verifiedSchemaState({CONTROL_DB:'control_provider_journal_upgrade',CRM_DB:'ready'}),'control_provider_journal_upgrade');
 assert.throws(()=>checkTables(old,'CONTROL_DB','ready'),/missing tables/);
 assert.throws(()=>checkProviderJournalTriggers([]),/Provider journal safety trigger/);
 const r=await inspectCloudflare({credentials:getCredentials(env),mode:'preflight',template,apiFetch:cloudflareMock({controlTables:old,crmTables:REQUIRED_TABLES.CRM_DB})});
 assert.equal(r.modes.CONTROL_DB,'control_provider_journal_upgrade');
});

test('credit purchase isolated migration requires atomic allocation trigger',async()=>{
 const old=REQUIRED_TABLES.CONTROL_DB.filter(x=>x!=='tenant_credit_purchases');
 assert.equal(checkTables(old,'CONTROL_DB','preflight'),'control_credit_purchase_upgrade');
 assert.equal(verifiedSchemaState({CONTROL_DB:'control_credit_purchase_upgrade',CRM_DB:'ready'}),'control_credit_purchase_upgrade');
 assert.throws(()=>checkPurchaseTriggers([]),/Credit purchase safety trigger/);
 const r=await inspectCloudflare({credentials:getCredentials(env),mode:'preflight',template,apiFetch:cloudflareMock({controlTables:old,crmTables:REQUIRED_TABLES.CRM_DB})});
 assert.equal(r.modes.CONTROL_DB,'control_credit_purchase_upgrade');
});

test('provider safety history requires isolated migration and immutable triggers',async()=>{
 const old=REQUIRED_TABLES.CONTROL_DB.filter(x=>x!=='provider_safety_events');
 assert.equal(checkTables(old,'CONTROL_DB','preflight'),'control_provider_safety_upgrade');
 assert.equal(verifiedSchemaState({CONTROL_DB:'control_provider_safety_upgrade',CRM_DB:'ready'}),'control_provider_safety_upgrade');
 assert.throws(()=>checkProviderSafetyTriggers([]),/Provider safety trigger/);
 const r=await inspectCloudflare({credentials:getCredentials(env),mode:'preflight',template,apiFetch:cloudflareMock({controlTables:old,crmTables:REQUIRED_TABLES.CRM_DB})});
 assert.equal(r.modes.CONTROL_DB,'control_provider_safety_upgrade');
});
