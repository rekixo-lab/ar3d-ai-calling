import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../src/index.mjs';
import {js} from '../src/app-assets.mjs';
import {fixedPropertyQuestions,normalizePropertySurvey,surveyToCrm}
  from '../src/fixed-property-survey.mjs';

const tenant='22222222-2222-4222-8222-222222222222';
const other='44444444-4444-4444-8444-444444444444';
const lead='33333333-3333-4333-8333-333333333333';
const cookie='ar3d_calling_session='+'a'.repeat(64);
const origin='https://demo.test';
const originalAt='2026-11-19T10:00:00.000Z';
const originalName='Excel Customer Only';
const originalMobile='+919876543210';
const survey={
  propertyType:'flat',location:'Raipur',area:'Shankar Nagar',
  size:'3BHK',budgetInr:3500000,interest:'interested',
  visitDate:null,visitAt:null
};
function request(method='GET',data,query=tenant,sendOrigin=true){
  const path='/v1/human/leads/'+lead+'/qualification';
  return new Request(origin+path+(method==='GET'?'?tenantId='+query:''),{
    method,
    headers:{cookie,...(sendOrigin?{Origin:origin}:{}),
      ...(method==='POST'?{'Content-Type':'application/json'}:{})},
    ...(method==='POST'?{body:JSON.stringify(data)}:{})
  });
}
function fixture({role='client_admin',status='new',updatedAt=originalAt,consent='unknown',
  dnd='unknown',existing=true}={}){
  const logs=[],visits=[];
  const leadRecord={
    id:lead,name:originalName,mobile_e164:originalMobile,
    updatedAt,requirements_json:JSON.stringify({raw:'Excel note; preserve me'}),
    consentStatus:consent,dndStatus:dnd,interestStatus:status,
    plotSizePreference:null,preferredLocation:null,budgetMaxInr:null
  };
  const CONTROL_DB={prepare(sql){return{bind(...params){logs.push({sql,params,db:'control'});return {
    async first(){
      if(sql.includes('FROM human_sessions'))
        return {id:'operator01',email:'staff@example.invalid',globalRole:'user'};
      if(sql.includes('FROM tenant_memberships'))
        return role&&params[0]===tenant?{tenant_id:tenant,role,
          storage_mode:'shared',status:'active'}:null;
      return null;
    }
  }}}}};
  const CRM_DB={
    prepare(sql){return{bind(...params){const row={sql,params,db:'crm'};logs.push(row);return{
      sql,params,async first(){
        if(sql.includes('FROM leads WHERE tenant_id=? AND id=?'))
          return existing&&params[0]===tenant&&params[1]===lead?leadRecord:null;
        return null;
      }
    }}}},
    async batch(rows){
      return rows.map(({sql,params})=>{
        if(sql.includes('UPDATE leads SET')){
          const old=params.at(-1);
          if(old!==leadRecord.updatedAt)return {meta:{changes:0}};
          leadRecord.preferredLocation=params[0];
          leadRecord.plotSizePreference=params[1];
          leadRecord.budgetMinInr=params[2];
          leadRecord.budgetMaxInr=params[3];
          leadRecord.interestStatus=params[4];
          leadRecord.visitDatePreference=params[5];
          leadRecord.requirements_json=params[6];
          leadRecord.updatedAt=params[7];
          return {meta:{changes:1}};
        }
        if(sql.includes('INSERT INTO site_visits')){
          const at=params[2];
          if(visits.some(x=>x.at===at))return {meta:{changes:0}};
          visits.push({id:params[1],at,status:'requested'});
          return {meta:{changes:1}};
        }
        return {meta:{changes:1}};
      });
    }
  };
  return {env:{CONTROL_DB,CRM_DB},logs,leadRecord,visits};
}
test('boss-approved fixed 7-question flow never requests imported customer name/mobile',()=>{
  for(const type of ['plot','flat','house']){
    for(const language of ['hi','en']){
      const q=fixedPropertyQuestions(type,language);
      assert.equal(q.length,7);
      assert.deepEqual(q.map(x=>x.field),[
        'propertyType','location','area','size','budgetInr','interest','visitDate']);
      assert.ok(q.every(x=>!/mobile|phone number|नाम क्या|your name/i.test(x.text)));
      assert.equal(q[3].kind,type==='plot'?'text':'choice');
      if(type!=='plot')assert.ok(q[3].options.includes('3BHK'));
    }
  }
  assert.throws(()=>fixedPropertyQuestions('landline','hi'),/invalid/);
  assert.throws(()=>fixedPropertyQuestions('plot','xx'),/invalid/);
});
test('flat and plot answers map to existing CRM fields, but never call or grant consent',()=>{
  const normalized=normalizePropertySurvey(survey);
  assert.deepEqual(surveyToCrm(normalized),{
    preferredLocation:'Raipur',plotSizePreference:'3BHK',
    budgetMaxInr:3500000,interestStatus:'interested',
    visitDatePreference:null,visitRequested:false
  });
  const plot=normalizePropertySurvey({...survey,propertyType:'plot',size:'1200 sqft',
    interest:'later'});
  assert.equal(surveyToCrm(plot).plotSizePreference,'1200 sqft');
  assert.equal(surveyToCrm(plot).interestStatus,'followup');
  const no=normalizePropertySurvey({...survey,interest:'not_interested'});
  assert.equal(surveyToCrm(no).interestStatus,'not_interested');
  assert.ok(!Object.keys(normalized).includes('consentStatus'));
  assert.ok(!Object.keys(normalized).includes('mobile'));
});
test('reject forged user, phone, permission, caller and invalid property answers',()=>{
  const cases=[
    {...survey,mobile:originalMobile},
    {...survey,name:originalName},
    {...survey,consentStatus:'granted'},
    {...survey,verifiedCall:true},
    {...survey,propertyType:'car'},
    {...survey,propertyType:'plot',size:'2BHK'.repeat(50)},
    {...survey,propertyType:'flat',size:'1200 sqft'},
    {...survey,location:''},{...survey,area:'x'.repeat(121)},
    {...survey,budgetInr:'35 lakh'},
    {...survey,budgetInr:-1},
    {...survey,interest:'approved_to_call'},
    {...survey,interest:'later',visitDate:'2026-12-01'},
    {...survey,visitDate:'2026-02-30'},
    {...survey,visitAt:'2026-12-01T10:00:00Z'}
  ];
  for(const value of cases)assert.throws(()=>normalizePropertySurvey(value),/invalid|only applies/);
});
test('future India-local day + time creates only a visit request',()=>{
  const t=Date.now()+8*86400000;
  const localDate=new Date(t+330*60000).toISOString().slice(0,10);
  const result=normalizePropertySurvey({...survey,visitDate:localDate,
    visitAt:new Date(t).toISOString()});
  assert.equal(result.visitAt,new Date(t).toISOString());
  assert.equal(surveyToCrm(result).visitRequested,true);
  assert.throws(()=>normalizePropertySurvey({...survey,visitDate:'2026-01-01',
    visitAt:new Date(t).toISOString()}),/mismatch/);
  assert.throws(()=>normalizePropertySurvey({...survey,visitDate:localDate,
    visitAt:'2024-01-01T10:00:00Z'}),/future/);
});

test('GET returns only selected tenant lead, question bank and Excel-identities untouched',async()=>{
  const f=fixture();
  const r=await worker.fetch(request(),f.env);
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.leadId,lead);
  assert.equal(data.survey,null);
  assert.equal(data.voiceConnected,false);
  assert.equal(data.questionSets.flat.hi[3].kind,'choice');
  assert.equal(data.questionSets.plot.en[3].kind,'text');
  assert.equal(data.questionSets.flat.en[3].options[1],'2BHK');
  assert.equal(f.leadRecord.name,originalName);
  assert.equal(f.leadRecord.mobile_e164,originalMobile);
  assert.equal((await worker.fetch(request('GET',null,other),f.env)).status,403);
  assert.equal((await worker.fetch(request('GET',null,tenant),fixture({existing:false}).env)).status,404);
});
test('staff-reviewed answers save atomically, preserve Excel raw notes and consent/DND unchanged',async()=>{
  const f=fixture({consent:'denied',dnd:'blocked'});
  const payload={tenantId:tenant,expectedUpdatedAt:originalAt,...survey};
  const r=await worker.fetch(request('POST',payload),f.env);
  assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(body.ok,true);
  assert.equal(body.voiceConnected,false);
  assert.equal(body.callingConsentChanged,false);
  assert.equal(body.dndChanged,false);
  assert.equal(body.visitRequested,false);
  assert.equal(f.leadRecord.name,originalName);
  assert.equal(f.leadRecord.mobile_e164,originalMobile);
  assert.equal(f.leadRecord.consentStatus,'denied');
  assert.equal(f.leadRecord.dndStatus,'blocked');
  assert.equal(f.leadRecord.interestStatus,'interested');
  assert.equal(f.leadRecord.plotSizePreference,'3BHK');
  assert.equal(f.leadRecord.budgetMaxInr,3500000);
  const saved=JSON.parse(f.leadRecord.requirements_json);
  assert.equal(saved.raw,'Excel note; preserve me');
  assert.equal(saved.propertySurvey.area,'Shankar Nagar');
  assert.equal(saved.propertySurvey.phoneCallPlaced,false);
  assert.equal(saved.propertySurvey.transcriptVerified,false);
  assert.ok(f.logs.some(x=>x.sql.includes('lead.fixed_qualification_saved')));
  assert.equal(f.visits.length,0);
  assert.ok(f.logs.every(x=>!/INSERT INTO calls|UPDATE agents|consent_status=|dnd_status=/.test(x.sql)));
  assert.equal((await worker.fetch(request('POST',payload),f.env)).status,409);
  const read=await (await worker.fetch(request(),f.env)).json();
  assert.equal(read.survey.propertyType,'flat');
});
test('visit is requested once only for a reviewed interested customer with exact date/time',async()=>{
  const f=fixture(),t=Date.now()+5*86400000;
  const localDate=new Date(t+330*60000).toISOString().slice(0,10);
  const payload={tenantId:tenant,expectedUpdatedAt:originalAt,...survey,
    visitDate:localDate,visitAt:new Date(t).toISOString()};
  const r=await worker.fetch(request('POST',payload),f.env);
  assert.equal(r.status,200);
  assert.equal((await r.json()).visitRequested,true);
  assert.equal(f.visits.length,1);
  assert.equal(f.visits[0].status,'requested');
  assert.equal(f.leadRecord.visitDatePreference,localDate);
  assert.ok(f.logs.some(x=>x.sql.includes("'visit.requested'")));
  assert.equal((await worker.fetch(request('POST',payload),f.env)).status,409);
  assert.equal(f.visits.length,1);
});
test('no access for viewer, other tenant, unauthenticated, cross origin or unknown fields',async()=>{
  const payload={tenantId:tenant,expectedUpdatedAt:originalAt,...survey};
  assert.equal((await worker.fetch(request('POST',payload),fixture({role:'viewer'}).env)).status,403);
  assert.equal((await worker.fetch(request('POST',{...payload,tenantId:other}),fixture().env)).status,403);
  assert.equal((await worker.fetch(request('POST',payload,tenant,false),fixture().env)).status,403);
  const unauth=new Request(origin+'/v1/human/leads/'+lead+'/qualification?tenantId='+tenant);
  assert.equal((await worker.fetch(unauth,fixture().env)).status,401);
  for(const input of [
    {...payload,source:'real_telecom'},
    {...payload,mobile:originalMobile},
    {...payload,callNow:true},
    {...payload,propertyType:'apartment-tower'}
  ])assert.equal((await worker.fetch(request('POST',input),fixture().env)).status,400);
  assert.equal((await worker.fetch(request('DELETE'),fixture().env)).status,405);
});
test('UI: name/mobile prefilled from Excel, 7 fixed questions, BHK conditional and no live call buttons',()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  assert.match(js,/7 Fixed Questions — Property Qualification/);
  assert.match(js,/Excel Name:/);
  assert.ok(js.includes('questionSets[propertyType.value][language.value]'));
  assert.match(js,/Open Fixed Questionnaire/);
  assert.match(js,/Save Reviewed Answers to CRM/);
  assert.match(js,/visitRequested/);
  assert.match(js,/No phone call/);
  assert.ok(!js.includes('/v1/human/calls/start'));
});

test('staff-reviewed range persists both budget endpoints and rejects reversed bounds',async()=>{
 const f=fixture();const payload={tenantId:tenant,expectedUpdatedAt:originalAt,...survey,budgetMinInr:2000000};
 const response=await worker.fetch(request('POST',payload),f.env);assert.equal(response.status,200);
 assert.equal(f.leadRecord.budgetMinInr,2000000);assert.equal(f.leadRecord.budgetMaxInr,3500000);
 assert.equal(JSON.parse(f.leadRecord.requirements_json).propertySurvey.budgetMinInr,2000000);
 const rejected=await worker.fetch(request('POST',{...payload,expectedUpdatedAt:f.leadRecord.updatedAt,budgetMinInr:4000000}),f.env);assert.equal(rejected.status,400);
});
