import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,configureScriptedCampaign,tid,lead,now,at} from './helpers/calling-fixture.mjs';
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

import {fundNoticeJob,dispatchNoticeJob,recoverNoticeJob} from '../src/industry-notice-dispatch.mjs';
import {handleScriptedPhoneCallback} from '../src/scripted-phone-pilot.mjs';
import {createHmac} from 'node:crypto';
test('reviewed general notice shares wallet, submits once, handles signed consent and settles exact CDR',async()=>{
 const f=fixture();try{
  configureScriptedCampaign(f);
  Object.assign(f.env,{AR3D_AUTO_CDR_SETTLEMENT:'approved',AR3D_NOTICE_CARRIER_APPROVAL_REFERENCE:'provider-reviewed'});
  await seed(f);
  f.r.db.prepare("UPDATE industry_notice_jobs SET state='authorized',actor_id='client',authorized_at=?,release_expires_at=?,updated_at=? WHERE id=?").run(now+1,now+1800000,now+1,id);
  const scope={tenantId:tid,jobId:id,now:now+1000};
  const funded=await fundNoticeJob(f.env,scope);assert.equal(funded.state,'funded',JSON.stringify(funded));
  let posts=0;
  const dial=await dispatchNoticeJob(f.env,{...scope,now:now+2000,fetcher:async()=>{posts++;return Response.json({request_uuid:'synthetic-notice-request'},{status:202})}});
  assert.equal(dial.state,'submitted',JSON.stringify(dial));assert.equal(posts,1);
  const j=f.r.db.prepare('SELECT * FROM industry_notice_jobs WHERE id=?').get(id);
  const call='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const signed=(step,extra={})=>{
   const u=new URL('https://app.example.invalid/v1/provider/plivo/scripted-pilot/'+j.session_id+'/'+step);
   for(const [k,v] of Object.entries({CallUUID:call,RequestUUID:'synthetic-notice-request',Direction:'outbound',From:'918000000000',To:'919000000001',...extra}))u.searchParams.set(k,v);
   const nonce='synthetic-notice-nonce',pairs=[...u.searchParams].sort(([a],[b])=>a<b?-1:a>b?1:0);
   const sig=createHmac('sha256',f.env.PLIVO_AUTH_TOKEN).update(u.origin+u.pathname+'?'+pairs.map(([k,v])=>k+'='+v).join('&')+'.'+nonce).digest('base64');
   return new Request(u,{headers:{'X-Plivo-Signature-V3':sig,'X-Plivo-Signature-V3-Nonce':nonce}});
  };
  const answer=await handleScriptedPhoneCallback(signed('answer'),f.env,{now:now+3000});assert.match(await answer.text(),/GetDigits/);
  const consent=await handleScriptedPhoneCallback(signed('notice-consent',{Digits:'1'}),f.env,{now:now+4000});assert.match(await consent.text(),/<Speak/);
  const repeat=await handleScriptedPhoneCallback(signed('notice-consent',{Digits:'1'}),f.env,{now:now+5000});assert.doesNotMatch(await repeat.text(),/<Speak/);
  const ended=await handleScriptedPhoneCallback(signed('hangup',{Duration:'35'}),f.env,{now:now+40000});assert.equal(ended.status,204);
  const settled=await recoverNoticeJob(f.env,{...scope,now:now+110000,fetcher:async()=>Response.json({call_uuid:call,call_direction:'outbound',from_number:'918000000000',to_number:'919000000001',billed_duration:60,call_duration:35,total_amount:'0.02'})});
  assert.equal(settled.state,'settled',JSON.stringify(settled));
  assert.equal(f.c.db.prepare('SELECT charged_seconds FROM tenant_minute_holds WHERE job_id=?').get(id).charged_seconds,60);
 }finally{f.close()}
});
