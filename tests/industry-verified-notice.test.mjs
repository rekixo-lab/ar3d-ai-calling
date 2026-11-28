import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {INDUSTRY_NOTICE_CONTRACTS,buildVerifiedIndustryNotice} from '../src/industry-verified-notice.mjs';
import {industryNoticeConnectorStatus,retrieveVerifiedIndustryNotice} from '../src/industry-notice-connectors.mjs';
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

function connectorFixture(templateId='finance_due_notice_v1',options={}){
 const f=fixture(templateId,options.language||'en',options.recordChanges||{},options.identityChanges||{});
 const requests=[],times=[];
 let elapsed=0,checks=0;
 const env={
  AR3D_NOTICE_ISSUER_KEYS_JSON:JSON.stringify([keys]),
  INDUSTRY_NOTICE_RECORD_SERVICE:{fetch:async req=>{
   requests.push({issuer:'record',url:req.url,method:req.method,redirect:req.redirect,body:await req.json()});
   elapsed+=options.recordDelay||0;
   return options.recordResponse?.()??Response.json(f.record);
  }},
  INDUSTRY_NOTICE_IDENTITY_SERVICE:{fetch:async req=>{
   requests.push({issuer:'identity',url:req.url,method:req.method,redirect:req.redirect,body:await req.json()});
   elapsed+=options.identityDelay||0;
   return options.identityResponse?.()??Response.json(f.identity);
  }}
 };
 const run=(overrides={})=>retrieveVerifiedIndustryNotice(env,{scope:f.scope,now,clock:()=>now+elapsed,assertCurrent:async(scope,ts)=>{
  checks++;times.push(ts);assert.equal(scope.tenantId,tenantId);return checks!==options.revokeAt;
 },...overrides});
 return {env,f,requests,times,run};
}
test('all four notice integrations retrieve independently signed records and proof using fixed service bindings',async()=>{
 for(const t of INDUSTRY_NOTICE_CONTRACTS)for(const language of ['hi','en']){
  const c=connectorFixture(t.templateId,{language});
  const ready=industryNoticeConnectorStatus(c.env,tenantId);
  assert.equal(ready.state,'configured_unverified');assert.equal(ready.dispatchReady,false);
  assert.ok(!JSON.stringify(ready).includes(keys.identityKeyHex));
  const out=await c.run();assert.equal(out.ok,true,JSON.stringify(out));
  assert.equal(out.dispatchReady,false);assert.ok(out.speech.includes('Synthetic Customer'));
  assert.equal(c.requests.length,2);assert.deepEqual(c.requests.map(x=>x.issuer),['record','identity']);
  assert.equal(c.requests[0].url,'https://industry-record.internal/v1/approved-notice');
  assert.equal(c.requests[1].url,'https://industry-identity.internal/v1/recipient-proof');
  assert.ok(c.requests.every(x=>x.method==='POST'&&x.redirect==='manual'));
  assert.equal(c.requests[0].body.purpose,t.purpose);
  assert.equal(c.requests[1].body.recordSha256,createHash('sha256').update(c.f.record.payload).digest('hex'));
  assert.ok(!JSON.stringify(c.requests).includes('Synthetic Customer'));
  assert.ok(!JSON.stringify(c.requests).includes(keys.recordKeyHex));
  assert.ok(c.times.length>=4);
 }
});
test('connector setup is tenant scoped and rejects shared keys and invalid scope',async()=>{
 for(const mode of ['missing','wrong_tenant','same_binding','same_key','reused_key','wrong_scope','extra_scope','no_guard']){
  const c=connectorFixture();let override={};
  if(mode==='missing')delete c.env.INDUSTRY_NOTICE_IDENTITY_SERVICE;
  if(mode==='same_binding')c.env.INDUSTRY_NOTICE_IDENTITY_SERVICE=c.env.INDUSTRY_NOTICE_RECORD_SERVICE;
  if(mode==='wrong_tenant')c.env.AR3D_NOTICE_ISSUER_KEYS_JSON=JSON.stringify([{...keys,tenantId:'99999999-9999-4999-8999-999999999999'}]);
  if(mode==='same_key')c.env.AR3D_NOTICE_ISSUER_KEYS_JSON=JSON.stringify([{...keys,recordKeyHex:keys.identityKeyHex}]);
  if(mode==='reused_key')c.env.AR3D_NOTICE_ISSUER_KEYS_JSON=JSON.stringify([keys,{tenantId:'99999999-9999-4999-8999-999999999999',recordKeyHex:'e3'.repeat(32),identityKeyHex:keys.recordKeyHex}]);
  if(mode==='wrong_scope')override={scope:{...c.f.scope,templateId:'property_enquiry_v1'}};
  if(mode==='extra_scope')override={scope:{...c.f.scope,amountPaise:10}};
  if(mode==='no_guard')override={assertCurrent:null};
  const out=await c.run(override);assert.equal(out.ok,false,mode);assert.equal(out.speech,null);assert.equal(c.requests.length,0);
 }
});
test('invalid records and unsafe responses disclose nothing and avoid identity lookups',async()=>{
 const invalid=[
  {recordChanges:{source:'crm_excel_import'}},{recordChanges:{asOf:now-16*60000}},
  {recordChanges:{tenantId:'99999999-9999-4999-8999-999999999999'}},
  {recordResponse:()=>new Response(null,{status:302,headers:{Location:'https://untrusted.invalid'}})},
  {recordResponse:()=>new Response('x'.repeat(13000),{headers:{'Content-Type':'application/json'}})},
  {recordResponse:()=>new Response(Uint8Array.of(0x7b,0xff,0x7d),{headers:{'Content-Type':'application/json'}})},
  {recordResponse:()=>Response.json({payload:'{}',signature:'00'.repeat(32)})},
  {recordResponse:()=>new Response('{"payload":"{}"}',{headers:{'Content-Type':'text/html'}})}
 ];
 for(const options of invalid){
  const c=connectorFixture('finance_due_notice_v1',options),out=await c.run();
  assert.equal(out.ok,false);assert.equal(out.speech,null);assert.equal(c.requests.length,1);
 }
 for(const options of [{identityChanges:{method:'spoken_yes'}},{identityChanges:{recordSha256:'00'.repeat(32)}},{identityDelay:16000}]){
  const c=connectorFixture('finance_due_notice_v1',options),out=await c.run();
  assert.equal(out.ok,false);assert.equal(out.speech,null);assert.equal(c.requests.length,2);
 }
});
test('live eligibility is checked before each issuer and after verification',async()=>{
 for(const revokeAt of [1,2,3,4]){
  const c=connectorFixture('finance_due_notice_v1',{revokeAt}),out=await c.run();
  assert.equal(out.ok,false);assert.equal(out.speech,null);
  assert.equal(c.requests.length,revokeAt===1?0:revokeAt===2?1:2);
 }
 const c=connectorFixture('finance_due_notice_v1',{identityDelay:2000,recordDelay:1000});
 const out=await c.run();assert.equal(out.ok,true);assert.ok(c.times.includes(now+3000));
});
