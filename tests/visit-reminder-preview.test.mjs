import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,lead,client,at} from './helpers/calling-fixture.mjs';
import {handleVisitReminderPreview} from '../src/visit-reminder-preview-routes.mjs';

const visit='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const now=Date.parse('2026-11-23T06:30:00.000Z');
const link='https://app.example.invalid/v1/human/visit-reminder-preview';
function req(options={}){
 const params=new URLSearchParams({
  tenantId:tid,visitId:visit,channel:'whatsapp',language:'hi',...options
 });
 return new Request(link+'?'+params);
}
function seed(f,status='confirmed',time=new Date(now+86400000).toISOString()){
 f.r.db.prepare('INSERT INTO site_visits(tenant_id,id,lead_id,scheduled_at,status,created_at) VALUES(?,?,?,?,?,?)')
  .run(tid,visit,lead,time,status,at);
}

test('verified confirmed visit permits a Hindi/English reminder DRAFT only, no outbound messages',async()=>{
 const f=fixture();
 try{
  seed(f);
  const changed=f.r.db.prepare('SELECT total_changes() AS n').get().n;
  const r=await handleVisitReminderPreview(req(),f.env,client,{now});
  assert.equal(r.status,200,await r.clone().text());
  const d=await r.json();
  assert.match(d.message,/साइट विजिट/);
  assert.match(d.message,/Fictional buyer/);
  assert.equal(d.sent,false);
  assert.equal(d.autoSendEnabled,false);
  assert.equal(d.channelOptInVerified,false);
  assert.equal(d.approvedWhatsAppTemplateVerified,false);
  assert.equal(d.customerDndVerified,false);
  assert.equal(d.status,'draft_only');
  assert.ok(!JSON.stringify(d).includes('+919000000001'));
  const sms=await handleVisitReminderPreview(req({channel:'sms',language:'en'}),f.env,client,{now});
  assert.equal(sms.status,200);
  assert.match((await sms.json()).message,/site visit is scheduled/);
  assert.equal(f.r.db.prepare('SELECT total_changes() AS n').get().n,changed);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_jobs').get().n,0);
 }finally{f.close()}
});

test('no drafts for refused, DND, cancelled, requested or expired visits',async()=>{
 const states=['requested','cancelled','completed'];
 for(const status of states){
  const f=fixture();
  try{
   seed(f,status);
   assert.equal((await handleVisitReminderPreview(req(),f.env,client,{now})).status,409);
  }finally{f.close()}
 }
 for(const column of ['consent_status','dnd_status']){
  const f=fixture();
  try{
   seed(f);
   f.r.db.prepare('UPDATE leads SET '+column+'=? WHERE tenant_id=? AND id=?')
    .run(column==='consent_status'?'denied':'blocked',tid,lead);
   const r=await handleVisitReminderPreview(req(),f.env,client,{now});
   assert.equal(r.status,409);
   assert.deepEqual(await r.json(),{error:'do not contact this customer'});
  }finally{f.close()}
 }
 const f=fixture();
 try{
  seed(f,'confirmed',new Date(now-86400000).toISOString());
  assert.equal((await handleVisitReminderPreview(req(),f.env,client,{now})).status,409);
 }finally{f.close()}
});

test('tenant isolation, viewer rejection, invalid params and write methods',async()=>{
 const f=fixture();
 try{
  seed(f);
  assert.equal((await handleVisitReminderPreview(req(),f.env,{
   id:'viewer',globalRole:'user'
  },{now})).status,403);
  const foreign='99999999-9999-4999-8999-999999999999';
  assert.equal((await handleVisitReminderPreview(req({tenantId:foreign}),f.env,client,{now})).status,403);
  assert.equal((await handleVisitReminderPreview(req({visitId:foreign}),f.env,client,{now})).status,404);
  assert.equal((await handleVisitReminderPreview(req({channel:'telegram'}),f.env,client,{now})).status,400);
  assert.equal((await handleVisitReminderPreview(req({language:'xx'}),f.env,client,{now})).status,400);
  const duplicate=new Request(link+'?tenantId='+tid+'&tenantId='+tid+'&visitId='+visit+'&channel=sms&language=hi');
  assert.equal((await handleVisitReminderPreview(duplicate,f.env,client,{now})).status,400);
  const post=new Request(link+'?'+new URLSearchParams({
   tenantId:tid,visitId:visit,channel:'sms',language:'hi'
  }),{method:'POST',body:'{}'});
  assert.equal((await handleVisitReminderPreview(post,f.env,client,{now})).status,405);
 }finally{f.close()}
});
