import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
const tenant='11111111-1111-4111-8111-111111111111';
const foreign='22222222-2222-4222-8222-222222222222';
const lead='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const review='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const origin='https://demo.test';
const cookie='ar3d_calling_session='+'a'.repeat(64);
const originalAt='2026-11-20T01:00:00.000Z';
const survey={
  propertyType:'plot',location:'Raipur',area:'Shankar Nagar',
  size:'1200 sqft',budgetInr:2500000,interest:'interested',
  visitDate:null,visitAt:null
};
function req(path,method='GET',payload=null,withOrigin=true){
  return new Request(origin+path,{
    method,headers:{cookie,...(withOrigin?{Origin:origin}:{}),
      ...(method==='POST'?{'content-type':'application/json'}:{})},
    ...(method==='POST'?{body:JSON.stringify(payload)}:{})
  });
}
const list='/v1/human/voicebot-reviews?tenantId='+tenant;
const action=(type)=>'/v1/human/voicebot-reviews/'+review+'/'+type;
function fixture({role='client_admin',state='pending',possibleOptOut=false,
  consent='unknown',dnd='unknown',sourceVerified=1,mappingVerified=1}={}){
  const logs=[],audits=[],leadData={
    id:lead,updatedAt:originalAt,requirementsJson:JSON.stringify({raw:'Excel note'}),
    consentStatus:consent,dndStatus:dnd,name:'Preserve Excel name',
    mobile:'+919000000001'
  };
  const rec={id:review,lead_id:lead,survey_json:possibleOptOut?
    JSON.stringify({optOutReviewRequired:true}):JSON.stringify(survey),
    status:state,possible_opt_out:possibleOptOut?1:0,
    source_verified:sourceVerified,mapping_verified:mappingVerified,
    reviewed_by:null,reviewed_at:null};
  const CONTROL_DB={prepare(sql){return {bind(...params){return {
    async first(){
      if(sql.includes('FROM human_sessions'))
        return {id:'staff01',email:'staff@example.invalid',globalRole:'user'};
      if(sql.includes('FROM tenant_memberships'))
        return params[0]===tenant?{tenant_id:tenant,role,status:'active',storage_mode:'shared'}:null;
      return null;
    }
  }}}}};
  const CRM_DB={
    prepare(sql){
      return {bind(...params){
        logs.push({sql,params});
        return {sql,params,
          async first(){
            if(sql.includes('FROM voicebot_qualification_reviews r JOIN leads l')){
              if(params[0]!==tenant||params[1]!==review)return null;
              return {...rec,leadUpdatedAt:leadData.updatedAt,
                requirementsJson:leadData.requirementsJson,
                consentStatus:leadData.consentStatus,dndStatus:leadData.dndStatus};
            }
            return null;
          },
          async all(){
            if(!sql.includes('FROM voicebot_qualification_reviews r JOIN leads l'))
              return {results:[]};
            return {results:[{id:rec.id,leadId:lead,status:rec.status,
              possibleOptOut:rec.possible_opt_out,surveyJson:rec.survey_json,
              createdAt:originalAt,leadUpdatedAt:leadData.updatedAt,
              consentStatus:leadData.consentStatus,dndStatus:leadData.dndStatus}]};
          }
        };
      }};
    },
    async batch(statements){
      const results=[];
      for(const {sql,params} of statements){
        if(sql.includes("UPDATE voicebot_qualification_reviews SET status='applied'")){
          const revision=params.at(-1);
          const changed=rec.status==='pending'&&rec.possible_opt_out===0&&
            revision===leadData.updatedAt?1:0;
          if(changed){rec.status='applied';rec.reviewed_by=params[0];rec.reviewed_at=params[1]}
          results.push({meta:{changes:changed}});
        }else if(sql.includes("UPDATE voicebot_qualification_reviews SET status='dismissed'")){
          const changed=rec.status==='pending'?1:0;
          if(changed){rec.status='dismissed';rec.reviewed_by=params[0];rec.reviewed_at=params[1]}
          results.push({meta:{changes:changed}});
        }else if(sql.includes('UPDATE leads SET')){
          const changed=rec.status==='applied'&&params[8]===lead&&
            params[9]===leadData.updatedAt?1:0;
          if(changed){
            leadData.location=params[0];leadData.size=params[1];leadData.budget=params[2];
            leadData.interest=params[3];leadData.visitDate=params[4];
            leadData.requirementsJson=params[5];leadData.updatedAt=params[6];
          }
          results.push({meta:{changes:changed}});
        }else if(sql.includes('INSERT INTO crm_audit_events')){
          audits.push({sql,params});results.push({meta:{changes:1}});
        }else throw Error('unexpected CRM batch SQL');
      }
      return results;
    }
  };
  return {env:{CONTROL_DB,CRM_DB},logs,audits,leadData,rec};
}
test('review GET is tenant-scoped, private and offers provisional fields only',async()=>{
  const f=fixture(),r=await worker.fetch(req(list),f.env);
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.reviews.length,1);
  assert.equal(data.reviews[0].provisionalSurvey.budgetInr,2500000);
  assert.equal(data.reviews[0].suppressionConfirmed,false);
  assert.equal(data.liveProviderWebhookConfigured,false);
  assert.equal(f.logs.every(x=>x.params.includes(tenant)),true);
  assert.equal(JSON.stringify(data).includes('+919000000001'),false);
  assert.equal((await worker.fetch(req('/v1/human/voicebot-reviews?tenantId='+foreign),f.env)).status,403);
  assert.equal((await worker.fetch(req(list),fixture({role:'viewer'}).env)).status,403);
  assert.equal((await worker.fetch(req(list.replace('tenantId='+tenant,'tenantId='+tenant+'&limit=999')),f.env)).status,400);
});
test('staff apply only changes property fields after acknowledgement, preserves consent and never calls',async()=>{
  const f=fixture({consent:'denied',dnd:'blocked'});
  const payload={tenantId:tenant,expectedUpdatedAt:originalAt,acknowledged:true};
  const r=await worker.fetch(req(action('apply'),'POST',payload),f.env);
  assert.equal(r.status,200);
  const result=await r.json();
  assert.equal(result.status,'applied');assert.equal(result.consentChanged,false);
  assert.equal(result.dndChanged,false);assert.equal(result.realCallsPlaced,0);
  assert.equal(result.visitConfirmed,false);
  assert.equal(f.leadData.name,'Preserve Excel name');
  assert.equal(f.leadData.mobile,'+919000000001');
  assert.equal(f.leadData.consentStatus,'denied');
  assert.equal(f.leadData.location,'Raipur');
  assert.equal(f.leadData.size,'1200 sqft');
  assert.equal(f.leadData.budget,2500000);
  assert.equal(JSON.parse(f.leadData.requirementsJson).raw,'Excel note');
  assert.ok(f.audits.some(x=>x.sql.includes('voicebot.review_applied')));
  assert.ok(f.logs.every(x=>!/INSERT INTO calls|UPDATE.*consent_status|UPDATE.*dnd_status/.test(x.sql)));
  assert.equal((await worker.fetch(req(action('apply'),'POST',payload),f.env)).status,409);
});
test('invalid reviewer, stale lead and unverified source cannot apply',async()=>{
  const body={tenantId:tenant,expectedUpdatedAt:originalAt,acknowledged:true};
  for(const bad of [
    {...body,acknowledged:false},{...body,extra:'grant_consent'},
    {...body,expectedUpdatedAt:'2026-10-01T00:00:00Z'}
  ]){
    const r=await worker.fetch(req(action('apply'),'POST',bad),fixture().env);
    assert.equal(r.status,[400,400,409][[
      {...body,acknowledged:false},{...body,extra:'grant_consent'},
      {...body,expectedUpdatedAt:'2026-10-01T00:00:00Z'}
    ].findIndex(x=>JSON.stringify(x)===JSON.stringify(bad))]);
  }
  assert.equal((await worker.fetch(req(action('apply'),'POST',body),fixture({role:'viewer'}).env)).status,403);
  assert.equal((await worker.fetch(req(action('apply'),'POST',{...body,tenantId:foreign}),fixture().env)).status,403);
  assert.equal((await worker.fetch(req(action('apply'),'POST',body,false),fixture().env)).status,403);
  assert.equal((await worker.fetch(req(action('apply'),'POST',body),fixture({sourceVerified:0}).env)).status,409);
  assert.equal((await worker.fetch(req(action('apply'),'POST',body),fixture({mappingVerified:0}).env)).status,409);
});
test('possible opt-out cannot be applied or dismissed before Do Not Call',async()=>{
  const body={tenantId:tenant,expectedUpdatedAt:originalAt,acknowledged:true};
  const f=fixture({possibleOptOut:true});
  assert.equal((await worker.fetch(req(action('apply'),'POST',body),f.env)).status,409);
  const reject=await worker.fetch(req(action('dismiss'),'POST',{tenantId:tenant}),f.env);
  assert.equal(reject.status,409);
  assert.equal(f.rec.status,'pending');
  const allowed=fixture({possibleOptOut:true,consent:'denied',dnd:'blocked'});
  const dismissed=await worker.fetch(req(action('dismiss'),'POST',{tenantId:tenant}),allowed.env);
  assert.equal(dismissed.status,200);
  assert.equal((await dismissed.json()).leadChanged,false);
  assert.equal(allowed.rec.status,'dismissed');
  assert.equal(allowed.leadData.consentStatus,'denied');
  assert.equal(allowed.leadData.dndStatus,'blocked');
});
test('unknown review, invalid method and anonymous request are denied',async()=>{
  const f=fixture();
  assert.equal((await worker.fetch(req('/v1/human/voicebot-reviews/'+
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc/apply','POST',{
      tenantId:tenant,expectedUpdatedAt:originalAt,acknowledged:true}),f.env)).status,404);
  assert.equal((await worker.fetch(req('/v1/human/voicebot-reviews','POST',{tenantId:tenant}),f.env)).status,405);
  assert.equal((await worker.fetch(new Request(origin+list),f.env)).status,401);
});
