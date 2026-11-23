import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {fixture,tid,lead,at} from './helpers/calling-fixture.mjs';
import {COOKIE,newSession} from '../src/human-auth.mjs';

const origin='https://calling.example.test';
const otherTenant='77777777-7777-4777-8777-777777777777';
const otherLead='88888888-8888-4888-8888-888888888888';
const dateForTest=()=>new Date(Date.now()+10*86400000+330*60000).toISOString().slice(0,10);
function post(f,token,data,site=origin){
 return worker.fetch(new Request(origin+'/v1/human/ai-test-crm',{
  method:'POST',headers:{cookie:COOKIE+'='+token,origin:site,'content-type':'application/json'},
  body:JSON.stringify(data)
 }),f.env);
}
async function begin(f,token,tenantId=tid,leadId=lead,language='hi'){
 return post(f,token,{action:'start',tenantId,leadId,language});
}
async function advance(f,token,old,transcript){
 return post(f,token,{action:'turn',state:old.state,context:old.context,
  proof:old.proof,transcript,confidence:1});
}
async function finish(f,token,first,answers){
 let current=first,previous=null;
 for(const answer of answers){
  previous=current;
  const r=await advance(f,token,current,answer);
  assert.equal(r.status,200,await r.clone().text());
  current=await r.json();
 }
 return {current,previous};
}
function seedOther(f){
 f.c.db.prepare(`INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at)
 VALUES(?,'other-test-builder','Other Test Builder','starter','shared','active',?,?)`).run(otherTenant,at,at);
 f.r.db.prepare(`INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at)
 VALUES(?,?,'Foreign lead','+919000000080','excel',?,?)`).run(otherTenant,otherLead,at,at);
}

test('opt-in Hindi seven-turn test auto-saves one selected CRM lead and preserves audit/consent/Excel notes',async()=>{
 const f=fixture();
 try{
  f.r.db.prepare("UPDATE leads SET requirements_json=?,consent_status='denied',dnd_status='blocked' WHERE tenant_id=? AND id=?")
   .run(JSON.stringify({raw:'Excel source must survive'}),tid,lead);
  const token=await newSession(f.env.CONTROL_DB,'client');
  const before=f.r.db.prepare('SELECT name,mobile_e164 AS mobile,consent_status AS consent,dnd_status AS dnd FROM leads WHERE tenant_id=? AND id=?').get(tid,lead);
  const firstResponse=await begin(f,token);
  assert.equal(firstResponse.status,200,await firstResponse.clone().text());
  const first=await firstResponse.json();
  assert.equal(first.selectedCustomer,'Fictional buyer');
  assert.equal(first.savedToCrm,false);
  assert.equal(first.crmWrites,0);
  const answers=['फ्लैट','रायपुर','शंकर नगर','3BHK','35 लाख','हाँ',dateForTest()];
  const {current,previous}=await finish(f,token,first,answers);
  assert.equal(current.action,'completed');
  assert.equal(current.savedToCrm,true);
  assert.equal(current.crmWrites,1);
  assert.equal(current.phoneCallsStarted,0);
  assert.equal(current.leadId,lead);
  const stored=f.r.db.prepare('SELECT * FROM leads WHERE tenant_id=? AND id=?').get(tid,lead);
  assert.equal(stored.preferred_location,'रायपुर');
  assert.equal(stored.plot_size_preference,'3BHK');
  assert.equal(stored.budget_max_inr,3500000);
  assert.equal(stored.interest_status,'interested');
  assert.equal(stored.visit_date_preference,answers.at(-1));
  assert.deepEqual({
   name:stored.name,mobile:stored.mobile_e164,consent:stored.consent_status,dnd:stored.dnd_status
  },before);
  const req=JSON.parse(stored.requirements_json);
  assert.equal(req.raw,'Excel source must survive');
  assert.equal(req.propertySurvey.channel,'auto_ai_test_browser');
  assert.equal(req.propertySurvey.simulated,true);
  assert.equal(req.propertySurvey.transcriptVerified,false);
  assert.equal(req.propertySurvey.phoneCallPlaced,false);
  assert.equal(req.propertySurvey.previewSessionId,first.context.nonce);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE tenant_id=? AND action='lead.ai_test_auto_saved'").get(tid).n,1);
  for(const table of ['calls','calling_jobs','site_visits','lead_opt_out_events'])
   assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0,table);
  const repeat=await advance(f,token,previous,answers.at(-1));
  assert.equal(repeat.status,409);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='lead.ai_test_auto_saved'").get().n,1);
 }finally{f.close()}
});

test('fabricated browser state, proof, tenant, lead and another login session cannot auto-save',async()=>{
 const f=fixture();
 try{
  seedOther(f);
  const token=await newSession(f.env.CONTROL_DB,'client');
  const nextSession=await newSession(f.env.CONTROL_DB,'client');
  const started=await (await begin(f,token)).json();
  const invalid=[
   {...started,context:{...started.context,leadId:otherLead}},
   {...started,context:{...started.context,tenantId:otherTenant}},
   {...started,context:{...started.context,nonce:crypto.randomUUID()}},
   {...started,state:{...started.state,index:6,answers:{interest:'interested'}}},
   {...started,proof:'0'.repeat(64)}
  ];
  for(const x of invalid){
   const r=await advance(f,token,x,'flat');
   assert.ok([403,400].includes(r.status),await r.clone().text());
  }
  assert.equal((await advance(f,nextSession,started,'flat')).status,403);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM crm_audit_events').get().n,0);
  assert.equal(f.r.db.prepare('SELECT preferred_location FROM leads WHERE tenant_id=? AND id=?').get(tid,lead).preferred_location,null);
 }finally{f.close()}
});

test('viewer, foreign customer, cross-origin and lost membership cannot start or continue saving',async()=>{
 const f=fixture();
 try{
  seedOther(f);
  const clientToken=await newSession(f.env.CONTROL_DB,'client');
  const viewerToken=await newSession(f.env.CONTROL_DB,'viewer');
  assert.equal((await begin(f,viewerToken)).status,403);
  assert.equal((await begin(f,clientToken,otherTenant,otherLead)).status,403);
  assert.equal((await begin(f,clientToken,tid,otherLead)).status,404);
  assert.equal((await post(f,clientToken,{action:'start',tenantId:tid,leadId:lead,language:'hi'},'https://evil.invalid')).status,403);
  const first=await (await begin(f,clientToken)).json();
  f.c.db.prepare("UPDATE tenant_memberships SET status='disabled' WHERE tenant_id=? AND user_id='client'").run(tid);
  assert.equal((await advance(f,clientToken,first,'flat')).status,403);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM crm_audit_events').get().n,0);
 }finally{f.close()}
});

test('staff edits while test is running cause conflict instead of silently overwriting newer CRM',async()=>{
 const f=fixture();
 try{
  const token=await newSession(f.env.CONTROL_DB,'client');
  const first=await (await begin(f,token)).json();
  const arr=['flat','Raipur','Shankar Nagar','3BHK','35 lakh','yes'];
  let session=first;
  for(const answer of arr){
   const r=await advance(f,token,session,answer);
   assert.equal(r.status,200);session=await r.json();
  }
  f.r.db.prepare("UPDATE leads SET updated_at=?,preferred_location='Staff-updated city' WHERE tenant_id=? AND id=?")
   .run(new Date().toISOString(),tid,lead);
  const conflict=await advance(f,token,session,dateForTest());
  assert.equal(conflict.status,409);
  assert.match((await conflict.json()).error,/changed during this test/i);
  assert.equal(f.r.db.prepare('SELECT preferred_location FROM leads WHERE tenant_id=? AND id=?').get(tid,lead).preferred_location,'Staff-updated city');
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='lead.ai_test_auto_saved'").get().n,0);
 }finally{f.close()}
});

test('stop-calling and unclear-answer previews cannot mutate CRM or consent',async()=>{
 const f=fixture();
 try{
  const token=await newSession(f.env.CONTROL_DB,'client');
  let s=await (await begin(f,token)).json();
  const stopped=await advance(f,token,s,'कॉल मत करना');
  assert.equal(stopped.status,200);
  assert.equal((await stopped.json()).state.status,'opted_out');
  s=await (await begin(f,token)).json();
  for(const answer of ['repeat','again','pardon']){
   const r=await advance(f,token,s,answer);
   assert.equal(r.status,200);s=await r.json();
  }
  assert.equal(s.state.status,'needs_review');
  assert.equal(s.savedToCrm,false);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM crm_audit_events').get().n,0);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM lead_opt_out_events').get().n,0);
 }finally{f.close()}
});
