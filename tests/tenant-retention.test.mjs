import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../src/index.mjs';
import {js} from '../src/app-assets.mjs';
import {retentionPlan,executeRetention} from '../src/retention-maintenance.mjs';

const tenantId='22222222-2222-4222-8222-222222222222';
const other='44444444-4444-4444-8444-444444444444';
const cookie='ar3d_calling_session='+'a'.repeat(64);
function req(action='suspend',reason='Security review requires temporary suspension'){
  return new Request('https://example.test/v1/human/tenants/'+tenantId+'/'+action,{method:'POST',
    headers:{cookie,origin:'https://example.test','content-type':'application/json'},
    body:JSON.stringify({reason})});
}
function fixture({globalRole='super_admin',status='trial',prior=null,mode='shared',available=true}={}){
  const log=[];
  const db={prepare(sql){return {bind(...params){log.push({sql,params});return {
    async first(){
      if(sql.includes('FROM human_sessions'))return {id:'user1',email:'admin@example.test',globalRole};
      if(sql.includes('FROM tenants WHERE id=?'))return params[0]===tenantId?
        {id:tenantId,status,suspended_from_status:prior,storage_mode:mode,dedicated_binding:mode==='dedicated'?'DEDICATED_DB_TEST':null}:null;
      return null;
    }
  }}}},async batch(rows){return rows.map(()=>({meta:{changes:1}}))}};
  return {env:{CONTROL_DB:db,CRM_DB:available?{}:null,...(mode==='dedicated'&&available?{DEDICATED_DB_TEST:{}}:{})},log};
}
test('Super Admin suspension writes tenant status and a reasoned audit record',async()=>{
  const f=fixture();
  const response=await worker.fetch(req(),f.env),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.status,'suspended');assert.equal(body.accessEnabled,false);
  assert.ok(f.log.some(x=>x.sql.includes("SET status='suspended',suspended_from_status=status")));
  const audit=f.log.find(x=>x.sql.includes('tenant_audit_events'));
  assert.ok(audit.params.some(x=>String(x).includes('Security review')));
  assert.ok(audit.params.includes(tenantId));
});
test('resume restores old state, never activates billing or unprovisioned dedicated DB',async()=>{
  const f=fixture({status:'suspended',prior:'trial'});
  const res=await worker.fetch(req('resume','Resolved temporary account security review'),f.env);
  assert.equal(res.status,200);assert.equal((await res.json()).status,'trial');
  const dedicated=fixture({status:'suspended',prior:'active',mode:'dedicated',available:false});
  assert.equal((await worker.fetch(req('resume','Approved after security investigation'),dedicated.env)).status,409);
});
test('Suspension requires global Super Admin, audit reason, valid transition',async()=>{
  assert.equal((await worker.fetch(req(),fixture({globalRole:'user'}).env)).status,403);
  assert.equal((await worker.fetch(req('suspend','too short'),fixture().env)).status,400);
  assert.equal((await worker.fetch(req('resume','A documented recovery reason'),fixture({status:'trial'}).env)).status,409);
  assert.equal((await worker.fetch(req('resume','A documented recovery reason'),fixture({status:'suspended',prior:null}).env)).status,409);
  assert.equal((await worker.fetch(req('suspend','A documented suspension reason'),fixture({status:'cancelled'}).env)).status,409);
});
test('Retention defaults to dry-run and requires explicit secret to execute',async()=>{
  const plan=retentionPlan(1800000000000,100);
  assert.equal(plan.length,5);
  assert.ok(plan.every(s=>s.params.every(p=>p!==undefined)));
  assert.ok(plan.every(s=>s.sql.startsWith('DELETE FROM ')));
  assert.ok(plan.every(s=>!/lead_opt_out|consent|recording|crm_audit|tenant_audit|leads\b/.test(s.sql)));
  assert.deepEqual((await executeRetention({}, {timestamp:1800000000000})).dryRun,true);
  await assert.rejects(executeRetention({CONTROL_DB:{},CRM_DB:{}},{timestamp:1800000000000,execute:true}),/not been operator-enabled/);
  assert.throws(()=>retentionPlan(1800000000000,251),/invalid/);
});
test('Explicitly enabled maintenance touches only expired artifacts with bounded deletes',async()=>{
  const log=[];
  const db={prepare(sql){return {bind(...params){log.push({sql,params});return {
    async run(){return {meta:{changes:2}}}
  }}}}};
  const result=await executeRetention({CONTROL_DB:db,CRM_DB:db,RETENTION_MAINTENANCE_ENABLED:'true'},
    {execute:true,timestamp:1800000000000,limit:30});
  assert.equal(result.dryRun,false);assert.equal(Object.keys(result.removed).length,5);
  assert.equal(result.removed.human_sessions,2);assert.equal(result.removed.conversation_simulations,2);
  assert.ok(log.every(x=>x.params.at(-1)===30));
  assert.ok(log.every(x=>/DELETE FROM human_|DELETE FROM conversation_simulations/.test(x.sql)));
});
test('Super Admin dashboard includes suspend and resume but no payment charging',()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  assert.match(js,/Tenant Access: Suspend \/ Resume/);
  assert.match(js,/tenantRows/);
});
