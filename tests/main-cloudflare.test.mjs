import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_TABLES, REQUIRED_SAFETY_TRIGGERS, getCredentials, makeMainConfig, checkTables, checkColumns, checkSafetyTriggers, inspectCloudflare, verifiedSchemaState,
} from '../scripts/main-cloudflare.mjs';

const env = {
  CLOUDFLARE_API_TOKEN: 'top-secret-api-token-placeholder-1234',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CONTROL_DB_ID: '11111111-1111-4111-8111-111111111111',
  CRM_DB_ID: '22222222-2222-4222-8222-222222222222',
};
const template = {
  name:'ar3d-ai-calling', main:'./src/index.mjs', workers_dev:false,
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
test('config binds only main AR3D Calling resources without existing AR3D routes', () => {
  const config = makeMainConfig(template,getCredentials(env));
  assert.equal(config.name,'ar3d-ai-calling');
  assert.equal(config.workers_dev,true);
  assert.equal(config.d1_databases[0].database_id, env.CONTROL_DB_ID);
  assert.equal(config.r2_buckets[0].bucket_name,'ar3d-calling-recordings');
  assert.equal(config.routes, undefined);
});
test('rejects existing production Cloudflare routes and wrong database/bucket names', () => {
  assert.throws(() => makeMainConfig({...template,routes:[{pattern:'admin.rekixo.com/*'}]},getCredentials(env)), /Unsafe/);
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

const mockTriggers=Object.entries(REQUIRED_SAFETY_TRIGGERS).map(([name,parts])=>
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
      if(sql.includes("type='trigger'")) rows=triggers;
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
