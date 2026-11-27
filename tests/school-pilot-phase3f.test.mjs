import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {fixture,admin,now} from './helpers/calling-fixture.mjs';
import {stageSettings,lockedStageConfig,verifyStageResources,markerSql,MIGRATIONS,STAGE_WORKER,STAGE_DB,STAGE_BUCKET} from '../scripts/school-stage-cloudflare.mjs';
import {stageDatabaseIdentity,seedStageSchoolDemo,stageSetupStatus} from '../src/school-stage-setup.mjs';
import {handleIndustryFlowSnapshots} from '../src/industry-flow-snapshots.mjs';
import {reviewedSchoolGraph} from '../src/school-internal-permits.mjs';

const id='56565656-5656-4565-8565-565656565656',tenant='78787878-7878-4787-8787-787878787878';
const raw={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'synthetic-stage-token-for-tests',
 SCHOOL_STAGE_D1_ID:id,SCHOOL_STAGE_TENANT_ID:tenant,SCHOOL_STAGE_ORIGIN:'https://ar3d-ai-calling-school-stage.synthetic.workers.dev',
 PRODUCTION_CONTROL_DB_ID:'11111111-1111-4111-8111-111111111111',PRODUCTION_CRM_DB_ID:'22222222-2222-4222-8222-222222222222'};
const s=stageSettings(raw);
function fake({name=STAGE_DB,managed=false,domains=[],tables=[],marker={database_id:id,worker_name:STAGE_WORKER}}={}){
 return async(url,opts)=>{
  assert.equal(opts.headers.Authorization,'Bearer '+raw.CLOUDFLARE_API_TOKEN);
  assert.equal(opts.redirect,'error');
  let result;
  if(url.endsWith('/d1/database/'+id)){assert.equal(opts.method,'GET');result={uuid:id,name}}
  else if(url.endsWith('/r2/buckets/'+STAGE_BUCKET+'/domains/managed'))result={enabled:managed};
  else if(url.endsWith('/r2/buckets/'+STAGE_BUCKET+'/domains/custom'))result={domains};
  else if(url.endsWith('/d1/database/'+id+'/query')){
   const {sql}=JSON.parse(opts.body);
   assert.match(sql,/^SELECT /);
   result=[{success:true,results:sql.includes('sqlite_master')?tables.map(name=>({name})):[marker]}];
  }else throw Error('unexpected URL');
  return Response.json({success:true,result});
 };
}
test('stage plan refuses production IDs and wrong origin; locked config has no provider secrets or production bindings',()=>{
 for(const bad of [{SCHOOL_STAGE_D1_ID:raw.PRODUCTION_CONTROL_DB_ID},{SCHOOL_STAGE_D1_ID:raw.PRODUCTION_CRM_DB_ID},
  {SCHOOL_STAGE_ORIGIN:'https://ar3d-ai-calling.synthetic.workers.dev'},{PRODUCTION_CRM_DB_ID:''}]){
  assert.throws(()=>stageSettings({...raw,...bad}),/stage_/);
 }
 const c=lockedStageConfig(s);
 assert.equal(c.name,STAGE_WORKER);assert.equal(c.main,'./src/school-stage-worker.mjs');
 assert.equal(c.d1_databases.length,1);assert.equal(c.d1_databases[0].database_id,id);
 assert.deepEqual(c.r2_buckets,[{binding:'SCHOOL_PILOT_AUDIO',bucket_name:STAGE_BUCKET}]);
 for(const k of ['AR3D_SCHOOL_STAGE_ENABLED','AR3D_SCHOOL_PILOT_APPROVAL_ENABLED','AR3D_SCHOOL_PILOT_AUDIO_ENABLED','AR3D_SCHOOL_PILOT_LIVE_ENABLED','AR3D_SCHOOL_STAGE_BOOTSTRAP_ENABLED'])assert.equal(c.vars[k],'disabled');
 assert.doesNotMatch(JSON.stringify(c),/synthetic-stage-token-for-tests|CRM_DB|RECORDINGS|PLIVO_AUTH_TOKEN/);
});
test('Cloudflare preflight is read-only and rejects wrong names, public R2 and unmarked/legacy schema',async()=>{
 assert.equal((await verifyStageResources(s,{apiFetch:fake()})).schema,'empty');
 for(const options of [{name:'ar3d-calling-control'},{managed:true},{domains:[{domain:'public.example'}]},
  {tables:['tenants']},{tables:['school_stage_identity'],marker:{database_id:tenant,worker_name:STAGE_WORKER}},
  {tables:['school_stage_identity','scripted_phone_pilots']}]){
  await assert.rejects(verifyStageResources(s,{apiFetch:fake(options)}),/stage_/);
 }
 assert.equal((await verifyStageResources(s,{apiFetch:fake({tables:['school_stage_identity']})})).schema,'partial');
});
test('explicit allowlisted migrations create a minimal stage schema without legacy data tables',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(markerSql(s));
  for(const m of MIGRATIONS)db.exec(readFileSync('migrations/control/'+m,'utf8'));
  const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);
  for(const t of ['school_stage_identity','human_users','human_mfa_recovery_codes','ai_flow_snapshots','school_stage_dispatches'])assert.ok(names.includes(t),t);
  for(const t of ['scripted_phone_pilots','tenant_minute_ledger','whatsapp_connections'])assert.ok(!names.includes(t),t);
  assert.throws(()=>db.prepare('UPDATE school_stage_identity SET database_id=?').run(tenant),/immutable stage identity/);
 }finally{db.close()}
});
test('MFA seed creates fictional School only, disabled author and immutable awaiting-review snapshot',async()=>{
 const f=fixture();
 try{
  const env={...f.env,AR3D_SCHOOL_PILOT_TENANT_ID:tenant,AR3D_SCHOOL_STAGE_DB_ID:id,AR3D_SCHOOL_STAGE_ENABLED:'disabled',AR3D_SCHOOL_PILOT_APPROVAL_ENABLED:'disabled',AR3D_SCHOOL_PILOT_AUDIO_ENABLED:'disabled'};
  assert.equal(await stageDatabaseIdentity(env),false);
  f.c.db.exec(markerSql(s));
  assert.equal(await stageDatabaseIdentity(env),true);
  const input={confirm:'CREATE_ONE_FICTIONAL_SCHOOL_STAGE_TENANT'};
  await assert.rejects(seedStageSchoolDemo({...env,AR3D_SCHOOL_STAGE_ENABLED:'approved'},admin,input,{now}),/locked_switches/);
  await assert.rejects(seedStageSchoolDemo(env,{...admin,globalRole:'client_admin'},input,{now}),/mfa_required/);
  const seeded=await seedStageSchoolDemo(env,admin,input,{now});
  assert.equal(seeded.review,'awaiting_review');assert.equal(seeded.liveCall,false);
  await assert.rejects(seedStageSchoolDemo(env,admin,input,{now}));
  const status=await stageSetupStatus(env,admin,{now});
  assert.equal(status.snapshot.id,seeded.snapshotId);
  assert.equal(status.snapshot.digest,seeded.digest);
  assert.equal(status.callsStartedByThisRequest,0);
  const row=f.c.db.prepare("SELECT u.status,u.global_role FROM human_users u JOIN ai_flow_snapshots v ON v.created_by=u.id WHERE v.id=?").get(seeded.snapshotId);
  assert.equal(row.status,'disabled');assert.equal(row.global_role,'user');
  await assert.rejects(reviewedSchoolGraph(env.CONTROL_DB,tenant,seeded.snapshotId),/review_required/);
  const req=new Request('https://example.invalid/v1/human/ai-flow-snapshots/'+seeded.snapshotId+'/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId:tenant,decision:'simulation_reviewed',reason:'Fictional stage script reviewed',acknowledgeSimulationOnly:true})});
  const res=await handleIndustryFlowSnapshots(req,env,admin,{now});
  assert.equal(res.status,200);
  assert.equal((await reviewedSchoolGraph(env.CONTROL_DB,tenant,seeded.snapshotId)).graphSha256,seeded.digest);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM school_stage_dispatches').get().n,0);
 }finally{f.close()}
});
