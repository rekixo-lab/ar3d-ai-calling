import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {
  sanitizeProvisionalSurvey,stageVerifiedVoicebotReview
} from '../src/voicebot-review-service.mjs';

const TENANT='11111111-1111-4111-8111-111111111111';
const LEAD='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW=Date.parse('2026-11-20T07:30:00+05:30');
const survey={
  propertyType:'flat',location:'Raipur',area:'Shankar Nagar',size:'3BHK',
  budgetInr:3500000,interest:'interested',visitDate:'2026-11-27',visitAt:null
};
const attest={
  vendorAuthenticationVerified:true,exotelDetailsLookupVerified:true,
  approvedCallerMatched:true,registeredCallToLeadMatched:true,
  dataUseAuthorized:true
};
function fakeDb(){
  const rows=new Map(),audits=[];
  return {
    rows,audits,
    prepare(sql){
      return {
        bind(...args){
          return {
            async run(){
              if(sql.includes('INSERT INTO voicebot_qualification_reviews')){
                const [tenantId,id,leadId,callRef,acctHash,digest,output,optOut,createdAt]=args;
                if(tenantId!==TENANT||leadId!==LEAD)return {meta:{changes:0}};
                const key=tenantId+'|'+callRef;
                if(rows.has(key))return {meta:{changes:0}};
                rows.set(key,{id,leadId,digest,surveyJson:output,
                  possibleOptOut:optOut,status:'pending',accountHash:acctHash,
                  createdAt});
                return {meta:{changes:1}};
              }
              if(sql.includes('INSERT INTO crm_audit_events')){
                const [tenantId,auditId,at,tenantRef,id]=args;
                if([...rows.values()].some(x=>x.id===id)){
                  audits.push({tenantId,auditId,at,tenantRef,id});
                  return {meta:{changes:1}};
                }
                return {meta:{changes:0}};
              }
              throw Error('unrecognized fake write');
            },
            async first(){
              if(!sql.includes('FROM voicebot_qualification_reviews'))
                throw Error('unrecognized fake read');
              const [tenant,call]=args;
              const row=rows.get(tenant+'|'+call);
              return row?{id:row.id,leadId:row.leadId,digest:row.digest,
                surveyJson:row.surveyJson,possibleOptOut:row.possibleOptOut,status:row.status}:null;
            }
          };
        }
      };
    },
    async batch(stmts){const output=[];for(const stmt of stmts)output.push(await stmt.run());return output;}
  };
}
const payload=(changes={})=>({
  tenantId:TENANT,leadId:LEAD,callReference:'CAfictionalstage20261120',
  accountSid:'fictionalaccount',deliveryDigest:'a'.repeat(64),
  provisionalSurvey:survey,attestation:attest,now:NOW,...changes
});

test('provisional survey is bounded, never schedules visits and rejects extra fields',()=>{
  const data=JSON.parse(sanitizeProvisionalSurvey(survey,{now:NOW}));
  assert.equal(data.propertyType,'flat');
  assert.equal(data.visitAt,null);
  assert.throws(()=>sanitizeProvisionalSurvey({...survey,unexpected:'untrusted'},{now:NOW}),/property survey/);
  assert.throws(()=>sanitizeProvisionalSurvey(survey,{possibleOptOut:true,now:NOW}),/opt-out/);
  assert.deepEqual(JSON.parse(sanitizeProvisionalSurvey(null,{possibleOptOut:true,now:NOW})),
    {optOutReviewRequired:true});
});
test('unverified or mismatched provider claims cannot enter the persistent inbox',async()=>{
  const db=fakeDb();
  await assert.rejects(stageVerifiedVoicebotReview(db,payload({
    attestation:{...attest,exotelDetailsLookupVerified:false}
  })),/independent proof/);
  await assert.rejects(stageVerifiedVoicebotReview(db,payload({
    callReference:'+919876543210'
  })),/identifiers/);
  assert.equal(db.rows.size,0);
  assert.equal(db.audits.length,0);
});
test('attested staging is deduplicated and never updates a lead or starts a call',async()=>{
  const db=fakeDb();
  const first=await stageVerifiedVoicebotReview(db,payload());
  assert.equal(first.status,'pending');
  assert.equal(first.duplicate,false);
  assert.equal(first.crmLeadChanged,false);
  assert.equal(first.realCallsCreated,0);
  const same=await stageVerifiedVoicebotReview(db,payload());
  assert.equal(same.duplicate,true);
  assert.equal(db.rows.size,1);
  assert.equal(db.audits.length,1);
  await assert.rejects(stageVerifiedVoicebotReview(db,payload({
    deliveryDigest:'b'.repeat(64)
  })),/conflicting delivery/);
});
test('lead foreign ownership rejects staging and no actual caller is exposed',async()=>{
  const db=fakeDb();
  await assert.rejects(stageVerifiedVoicebotReview(db,payload({
    tenantId:'22222222-2222-4222-8222-222222222222'
  })),/missing registered lead/);
  assert.equal(db.rows.size,0);
});
test('review queue requires signed-in session and mutating POST requires same-origin',async()=>{
  const env={CONTROL_DB:{}};
  const base='https://aicalling.ar3dstudio.in';
  const unauthed=await worker.fetch(new Request(base+'/v1/human/voicebot-reviews'),env);
  assert.equal(unauthed.status,401);
  const unsupported=await worker.fetch(new Request(base+'/v1/human/voicebot-reviews/'+
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/apply',{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    }),env);
  assert.equal(unsupported.status,403);
});
