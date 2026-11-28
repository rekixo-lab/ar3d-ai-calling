import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,lead,now,at} from './helpers/calling-fixture.mjs';
import {reviewDigest,noticeSessionDoc,exactNoticeSession} from '../src/industry-notice-common.mjs';
const id='77777777-7777-4777-8777-777777777777',snapshot='88888888-8888-4888-8888-888888888888';
async function seed(f,template='finance_due_notice_v1'){
 const j={tenant_id:tid,id,lead_id:lead,snapshot_id:snapshot,graph_sha256:'a'.repeat(64),template_id:template,language:'hi',delivery_mode:'general',destination:'+919000000001',lead_updated_at:at,consent_ref:'consent-ref',dnd_ref:'dnd-ref',provider_ref:'provider-reviewed',private_speech_ref:null,reviewed_by:'admin',reviewed_at:now,review_expires_at:now+3600000,updated_at:now};
 j.review_sha256=await reviewDigest(j);
 const keys=Object.keys(j);
 f.r.db.prepare('INSERT INTO industry_notice_jobs('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...Object.values(j));
 return j;
}
test('four industry notices have distinct immutable review scopes and cannot skip authorization',async()=>{
 for(const template of ['appointment_reminder_v1','finance_due_notice_v1','banking_service_v1','insurance_renewal_v1']){
  const f=fixture();try{
   const j=await seed(f,template);
   assert.throws(()=>f.r.db.prepare("UPDATE industry_notice_jobs SET state='funded' WHERE id=?").run(id));
   assert.throws(()=>f.r.db.prepare("UPDATE industry_notice_jobs SET destination='+919000000002' WHERE id=?").run(id));
   assert.throws(()=>f.r.db.prepare("DELETE FROM industry_notice_jobs WHERE id=?").run(id));
   assert.equal(j.review_sha256.length,64);
   assert.notEqual(await reviewDigest({...j,language:'en'}),j.review_sha256);
   assert.equal(f.r.db.prepare("SELECT state FROM industry_notice_jobs WHERE id=?").get(id).state,'reviewed');
  }finally{f.close()}
 }
});
test('notice claims are one-use and the exact session contains no private record fields',async()=>{
 const f=fixture();try{
  const j=await seed(f),session='99999999-9999-4999-8999-999999999999';
  const db=f.r.db;
  db.prepare("UPDATE industry_notice_jobs SET state='authorized',actor_id='client',authorized_at=?,release_expires_at=?,updated_at=? WHERE id=?").run(now+1,now+1800000,now+1,id);
  db.prepare("UPDATE industry_notice_jobs SET state='claiming',claimed_at=?,updated_at=? WHERE id=?").run(now+2,now+2,id);
  db.prepare("UPDATE industry_notice_jobs SET state='funded',updated_at=? WHERE id=?").run(now+3,id);
  db.prepare("UPDATE industry_notice_jobs SET state='claimed',session_id=?,updated_at=? WHERE id=?").run(session,now+4,id);
  db.prepare("UPDATE industry_notice_jobs SET state='posting',updated_at=? WHERE id=?").run(now+5,id);
  db.prepare("UPDATE industry_notice_jobs SET state='unknown',updated_at=? WHERE id=?").run(now+6,id);
  assert.throws(()=>db.prepare("UPDATE industry_notice_jobs SET state='authorized' WHERE id=?").run(id));
  const row=db.prepare('SELECT * FROM industry_notice_jobs WHERE id=?').get(id),doc=noticeSessionDoc(row);
  const p={id:session,job_id:id,tenant_id:tid,lead_id:lead,destination:j.destination,lead_updated_at:at,actor_id:'client',language:'hi',rate_slot:null,turn:0,survey_json:JSON.stringify(doc)};
  assert.equal(exactNoticeSession(row,p),true);
  assert.equal(exactNoticeSession(row,{...p,tenant_id:snapshot}),false);
  assert.ok(!JSON.stringify(doc).includes('amountPaise'));
 }finally{f.close()}
});
