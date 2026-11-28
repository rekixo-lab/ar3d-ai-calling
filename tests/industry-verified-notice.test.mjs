import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {INDUSTRY_NOTICE_CONTRACTS,buildVerifiedIndustryNotice} from '../src/industry-verified-notice.mjs';
const now=Date.parse('2026-11-28T04:00:00.000Z');
const tenantId='11111111-1111-4111-8111-111111111111';
const keys={tenantId,identityKeyHex:'a1'.repeat(32),recordKeyHex:'b2'.repeat(32)};
const base={tenantId,leadId:'22222222-2222-4222-8222-222222222222',sessionId:'33333333-3333-4333-8333-333333333333',callUuid:'44444444-4444-4444-8444-444444444444',graphSha256:'c3'.repeat(32),recipientReviewSha256:'d4'.repeat(32)};
const examples={
 appointment_reminder_v1:{customerName:'Synthetic Customer',appointmentAt:'2026-12-01T06:00:00.000Z'},
 finance_due_notice_v1:{customerName:'Synthetic Customer',amountPaise:1234567,dueDate:'2026-12-05'},
 banking_service_v1:{customerName:'Synthetic Customer',serviceCode:'statement_available'},
 insurance_renewal_v1:{customerName:'Synthetic Customer',renewalDate:'2026-12-20'}
};
const sign=(value,key,domain)=>{const payload=JSON.stringify(value);return {payload,signature:createHmac('sha256',Buffer.from(key,'hex')).update(domain+'\n'+payload).digest('hex')}};
function fixture(templateId,language='en',changeRecord={},changeIdentity={}){
 const t=INDUSTRY_NOTICE_CONTRACTS.find(x=>x.templateId===templateId);
 const scope={...base,templateId,language},binding={...base,templateId};
 const r={version:1,audience:'ar3d_notice_record',purpose:t.purpose,source:t.source,...binding,issuedAt:now-10000,expiresAt:now+60000,asOf:now-20000,recordRevision:1,fields:{...examples[templateId]},...changeRecord};
 const record=sign(r,keys.recordKeyHex,'ar3d:approved-industry-record:v1');
 const p={version:1,audience:'ar3d_notice_identity',purpose:t.purpose,method:'authenticated_customer_portal',...binding,issuedAt:now-1000,expiresAt:now+30000,recordSha256:createHash('sha256').update(record.payload).digest('hex'),...changeIdentity};
 return {scope,identity:sign(p,keys.identityKeyHex,'ar3d:recipient-proof:v1'),record,trusted:{...keys},now};
}
test('four verified notice contracts render typed records in both languages without dispatch permission',async()=>{
 assert.equal(INDUSTRY_NOTICE_CONTRACTS.length,4);
 for(const t of INDUSTRY_NOTICE_CONTRACTS)for(const lang of ['hi','en']){
  const r=await buildVerifiedIndustryNotice(fixture(t.templateId,lang));
  assert.equal(r.ok,true,t.templateId+': '+JSON.stringify(r));
  assert.equal(r.dispatchReady,false);assert.equal(r.validUntil,now+30000);
  assert.ok(r.speech.includes('Synthetic Customer'));assert.ok(!r.speech.includes(base.leadId));
  if(t.templateId==='finance_due_notice_v1')assert.ok(r.speech.includes('12,345.67'));
  if(t.templateId==='appointment_reminder_v1')assert.match(r.speech,/11:30/);
 }
});
test('missing, forged, stale, cross-tenant, cross-call and altered review proof never discloses data',async()=>{
 const t='finance_due_notice_v1',g=fixture(t);
 for(const bad of [
  {...g,identity:null},{...g,record:null},{...g,trusted:null},
  {...g,identity:{...g.identity,signature:'00'.repeat(32)}},
  {...g,record:{...g.record,payload:g.record.payload.replace('1234567','1234568')}},
  {...g,scope:{...g.scope,sessionId:'55555555-5555-4555-8555-555555555555'}},
  {...g,scope:{...g.scope,tenantId:'55555555-5555-4555-8555-555555555555'}},
  {...g,scope:{...g.scope,graphSha256:'00'.repeat(32)}},
  {...g,scope:{...g.scope,recipientReviewSha256:'00'.repeat(32)}},
  {...g,trusted:{...g.trusted,identityKeyHex:g.trusted.recordKeyHex}},
  {...g,now:now+30000},
  fixture(t,'en',{}, {method:'spoken_yes'}),
  fixture(t,'en',{}, {recordSha256:'00'.repeat(32)}),
  fixture(t,'en',{asOf:now-16*60000}),fixture(t,'en',{source:'crm_excel_import'}),
  fixture(t,'en',{}, {issuedAt:now+1})
 ]){
  assert.deepEqual(await buildVerifiedIndustryNotice(bad),{ok:false,state:'verified_notice_unavailable',speech:null,dispatchReady:false});
 }
});
test('typed notices reject arbitrary data and account identifiers even with valid signatures',async()=>{
 for(const [t,fields] of [
  ['finance_due_notice_v1',{...examples.finance_due_notice_v1,accountNumber:'1234567890'}],
  ['finance_due_notice_v1',{...examples.finance_due_notice_v1,amountPaise:-100}],
  ['finance_due_notice_v1',{...examples.finance_due_notice_v1,dueDate:'2026-02-30'}],
  ['finance_due_notice_v1',{...examples.finance_due_notice_v1,customerName:'Name 123456'}],
  ['appointment_reminder_v1',{...examples.appointment_reminder_v1,appointmentAt:'2026-01-01T06:00:00.000Z'}],
  ['banking_service_v1',{...examples.banking_service_v1,serviceCode:'tell me your OTP'}],
  ['insurance_renewal_v1',{...examples.insurance_renewal_v1,policyNumber:'1234567890'}]
 ]){
  const r=await buildVerifiedIndustryNotice(fixture(t,'en',{fields}));assert.equal(r.ok,false);assert.equal(r.speech,null);
 }
});
