import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
const tenantId='22222222-2222-4222-8222-222222222222';
const agentId='33333333-3333-4333-8333-333333333333';
const alien='44444444-4444-4444-8444-444444444444';
const cookie='ar3d_calling_session='+'a'.repeat(64);
function req(path,method='GET',data,origin=true){return new Request('https://example.test'+path,{method,
  headers:{cookie,...(origin?{origin:'https://example.test'}:{}),...(data?{'content-type':'application/json'}:{})},
  body:data?JSON.stringify(data):undefined})}
function fixture(role='client_admin',exists=true){
  let row=null;const log=[];
  const CONTROL_DB={prepare(sql){return{bind(...args){log.push({database:'control',sql,args});return{async first(){
    if(sql.includes('FROM human_sessions'))return{id:'user',email:'demo@example.test',globalRole:'user'};
    if(sql.includes('FROM tenant_memberships'))return args[0]===tenantId&&role?{tenant_id:tenantId,role,storage_mode:'shared',status:'active'}:null;
    return null;
  }}}}}};
  const CRM_DB={prepare(sql){return{bind(...args){log.push({database:'crm',sql,args});return{
    async first(){
      if(sql.includes('FROM agents WHERE'))return exists&&args[0]===tenantId&&args[1]===agentId?{id:agentId,languageMode:'hi-en',questionsJson:JSON.stringify(['What is your location?','What is your budget?'])}:null;
      if(sql.includes('FROM conversation_simulations WHERE'))return row&&args[0]===tenantId&&args[1]===row.id?{stateJson:row.stateJson,revision:row.revision,expiresAt:row.expiresAt}:null;
      if(sql.includes('UPDATE conversation_simulations')){if(!row||args[2]!==tenantId||args[3]!==row.id||args[4]!==row.revision)return null;row.stateJson=args[0];row.revision+=1;return {revision:row.revision}}
      return null;
    },
    async all(){if(sql.includes('FROM agents WHERE'))return {results:[{id:agentId,displayName:'Sales Agent',languageMode:'hi-en',status:'draft',questionsJson:'["Where?"]'}]};return{results:[]}},
    async run(){if(sql.includes('INSERT INTO conversation_simulations')){row={id:args[1],stateJson:args[4],revision:1,expiresAt:args[8]};return{meta:{changes:1}}}return{meta:{changes:1}}}
  }}}}};
  return {env:{CONTROL_DB,CRM_DB},log};
}
test('simulator page is isolated from real calling routes',async()=>{
  const r=await worker.fetch(new Request('https://example.test/app/simulator'),{});
  assert.equal(r.status,200);assert.match(await r.text(),/SIMULATION ONLY/);
  assert.equal((await worker.fetch(new Request('https://example.test/app/assets/simulator.js'),{})).status,200);
});
test('simulation requires human session, same origin and tenant editor',async()=>{
  const {env}=fixture(null);
  const data={tenantId,agentId};
  assert.equal((await worker.fetch(req('/v1/human/simulations','POST',data),env)).status,403);
  assert.equal((await worker.fetch(req('/v1/human/simulations','POST',data,false),fixture().env)).status,403);
  assert.equal((await worker.fetch(new Request('https://example.test/v1/human/simulations/agents?tenantId='+tenantId),fixture().env)).status,401);
});
test('simulation start/turn/read uses tenant membership, revision CAS and no calling data',async()=>{
  const {env,log}=fixture();
  const created=await worker.fetch(req('/v1/human/simulations','POST',{tenantId,agentId}),env);
  assert.equal(created.status,201);const first=await created.json();
  assert.equal(first.revision,1);assert.match(first.notice,/No phone call/);
  const next=await worker.fetch(req('/v1/human/simulations/'+first.id+'/turn','POST',{tenantId,expectedRevision:1,message:'Indore'}),env);
  assert.equal(next.status,200);const updated=await next.json();assert.equal(updated.revision,2);assert.equal(updated.simulation.answers[0].answer,'Indore');
  const stale=await worker.fetch(req('/v1/human/simulations/'+first.id+'/turn','POST',{tenantId,expectedRevision:1,message:'25 lakh'}),env);
  assert.equal(stale.status,409);
  const read=await worker.fetch(req('/v1/human/simulations/'+first.id+'?tenantId='+tenantId),env);
  assert.equal(read.status,200);assert.equal((await read.json()).revision,2);
  assert.equal(log.some(x=>/INSERT INTO calls|UPDATE leads|consent_status|dnd_status/.test(x.sql)),false);
  assert.ok(log.filter(x=>x.database==='crm').every(x=>x.args.includes(tenantId)));
});
test('agents cannot be read across tenants; unavailable agent cannot simulate',async()=>{
  const f=fixture();
  assert.equal((await worker.fetch(req('/v1/human/simulations/agents?tenantId='+alien),f.env)).status,403);
  assert.equal((await worker.fetch(req('/v1/human/simulations','POST',{tenantId,agentId}),fixture('client_admin',false).env)).status,404);
});
test('malicious field values cannot bypass revision or message bounds',async()=>{
  const f=fixture(),created=await (await worker.fetch(req('/v1/human/simulations','POST',{tenantId,agentId}),f.env)).json();
  for(const data of [{tenantId,expectedRevision:0,message:'hi'},{tenantId,expectedRevision:1,message:'a'.repeat(501)}]){
    assert.equal((await worker.fetch(req('/v1/human/simulations/'+created.id+'/turn','POST',data),f.env)).status,400);
  }
});
