// Full migration-backed SQLite acceptance for the EXOTEL REVIEW API and internal
// staging seam. No real Exotel network, credential, number or Cloudflare writes.
// Node 22+ node:sqlite (local only) matches D1's SQLite statement behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {handleVoicebotReviewRequest} from '../src/voicebot-review-routes.mjs';
import {stageVerifiedVoicebotReview} from '../src/voicebot-review-service.mjs';
const tenant='11111111-1111-4111-8111-111111111111';
const lead='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const at='2026-11-20T00:00:00.000Z';
const now=Date.parse('2026-11-20T06:30:00+05:30');
const user={id:'fictional-staff',globalRole:'user'};
const approved={
  vendorAuthenticationVerified:true,exotelDetailsLookupVerified:true,
  approvedCallerMatched:true,registeredCallToLeadMatched:true,
  dataUseAuthorized:true
};
const property={propertyType:'plot',location:'Raipur',area:'Shankar Nagar',
  size:'1200 sqft',budgetInr:2500000,interest:'interested',visitDate:null,visitAt:null};
const scope={
  CONTROL_DB:{prepare(sql){return {bind(...params){return {async first(){
    if(sql.includes('FROM tenant_memberships')&&params[0]===tenant&&params[1]===user.id)
      return {tenant_id:tenant,role:'client_admin',storage_mode:'shared',status:'active'};
    return null;
  }}}}}}
};
function realDb(){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for(const file of readdirSync('migrations/crm').filter(x=>x.endsWith('.sql')).sort()){
    db.exec(readFileSync(join('migrations/crm',file),'utf8'));
  }
  db.prepare(
    'INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,requirements_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)'
  ).run(tenant,lead,'Fictional Buyer','+919000000001','excel',
    JSON.stringify({raw:'Excel metadata'}),at,at);
  const wrapper={
    prepare(sql){
      const stmt=db.prepare(sql);
      return {bind(...args){return {
        async run(){return {meta:{changes:Number(stmt.run(...args).changes)}}},
        async first(){return stmt.get(...args)??null},
        async all(){return {results:stmt.all(...args)}}
      }}};
    },
    async batch(queries){
      db.exec('BEGIN IMMEDIATE');
      try{
        const out=[];
        for(const q of queries)out.push(await q.run());
        db.exec('COMMIT');
        return out;
      }catch(e){db.exec('ROLLBACK');throw e}
    }
  };
  return {db,wrapper};
}
const stage=(db,changes={})=>stageVerifiedVoicebotReview(db,{
  tenantId:tenant,leadId:lead,callReference:'CAfictionalverified20261120',
  accountSid:'fictionalaccount-2026',deliveryDigest:'a'.repeat(64),
  provisionalSurvey:property,attestation:approved,now,...changes
});
function request(path,method='GET',value){
  return new Request('https://fictional.invalid'+path,{
    method,headers:{'Origin':'https://fictional.invalid',
      ...(method==='POST'?{'Content-Type':'application/json'}:{})},
    ...(method==='POST'?{body:JSON.stringify(value)}:{})
  });
}
test('actual migrated CRM stages one review, lists, then applies atomically to correct lead',async()=>{
  const {db,wrapper}=realDb();
  try{
    const initial=await stage(wrapper);
    assert.equal(initial.duplicate,false);
    assert.equal((await stage(wrapper)).duplicate,true);
    const events=db.prepare("SELECT action FROM crm_audit_events").all();
    assert.equal(events.length,1,'duplicate must not create duplicate audit evidence');
    const env={...scope,CRM_DB:wrapper};
    const listing=await handleVoicebotReviewRequest(
      request('/v1/human/voicebot-reviews?tenantId='+tenant),env,user
    );
    assert.equal(listing.status,200);
    const response=await listing.json();
    assert.equal(response.reviews.length,1);
    const value=response.reviews[0];
    assert.equal(value.provisionalSurvey.budgetInr,2500000);
    assert.equal(value.leadUpdatedAt,at);
    assert.equal(JSON.stringify(response).includes('9000000001'),false);
    const applied=await handleVoicebotReviewRequest(
      request('/v1/human/voicebot-reviews/'+value.id+'/apply','POST',
        {tenantId:tenant,expectedUpdatedAt:at,acknowledged:true}),env,user
    );
    assert.equal(applied.status,200,JSON.stringify(await applied.clone().json()));
    const body=await applied.json();
    assert.equal(body.status,'applied');
    const leadState=db.prepare(
      'SELECT name,mobile_e164,preferred_location,plot_size_preference,budget_max_inr,interest_status,consent_status,dnd_status,requirements_json FROM leads WHERE tenant_id=? AND id=?'
    ).get(tenant,lead);
    assert.equal(leadState.name,'Fictional Buyer');
    assert.equal(leadState.mobile_e164,'+919000000001');
    assert.equal(leadState.preferred_location,'Raipur');
    assert.equal(leadState.plot_size_preference,'1200 sqft');
    assert.equal(leadState.budget_max_inr,2500000);
    assert.equal(leadState.consent_status,'unknown');
    assert.equal(leadState.dnd_status,'unknown');
    assert.equal(JSON.parse(leadState.requirements_json).raw,'Excel metadata');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM site_visits').get().n,0);
    assert.equal(db.prepare("SELECT status FROM voicebot_qualification_reviews").get().status,'applied');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='voicebot.review_applied'").get().n,1);
    const repeated=await handleVoicebotReviewRequest(
      request('/v1/human/voicebot-reviews/'+value.id+'/apply','POST',
        {tenantId:tenant,expectedUpdatedAt:at,acknowledged:true}),env,user
    );
    assert.equal(repeated.status,409);
    assert.throws(()=>db.prepare(
      "UPDATE voicebot_qualification_reviews SET status='pending' WHERE id=?"
    ).run(initial.id));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close()}
});
test('actual SQLite refuses duplicate cross-account evidence even when transcript matches',async()=>{
  const {db,wrapper}=realDb();
  try{
    await stage(wrapper);
    await assert.rejects(stage(wrapper,{accountSid:'different-provider-account'}),/account|conflicting/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM voicebot_qualification_reviews').get().n,1);
  }finally{db.close()}
});
test('opt-out result cannot be applied/dismissed until irreversible Do Not Call was registered',async()=>{
  const {db,wrapper}=realDb();
  try{
    const review=await stage(wrapper,{
      callReference:'CAfictionaloptout2026',
      deliveryDigest:'b'.repeat(64),possibleOptOut:true,provisionalSurvey:null
    });
    const env={...scope,CRM_DB:wrapper};
    const url='/v1/human/voicebot-reviews/'+review.id;
    const applied=await handleVoicebotReviewRequest(request(url+'/apply','POST',{
      tenantId:tenant,expectedUpdatedAt:at,acknowledged:true
    }),env,user);
    assert.equal(applied.status,409);
    const denied=await handleVoicebotReviewRequest(
      request(url+'/dismiss','POST',{tenantId:tenant}),env,user
    );
    assert.equal(denied.status,409);
    db.prepare("UPDATE leads SET consent_status='denied',dnd_status='blocked' WHERE tenant_id=? AND id=?").run(tenant,lead);
    const dismissed=await handleVoicebotReviewRequest(
      request(url+'/dismiss','POST',{tenantId:tenant}),env,user
    );
    assert.equal(dismissed.status,200);
    assert.equal(db.prepare('SELECT status FROM voicebot_qualification_reviews').get().status,'dismissed');
    assert.equal(db.prepare('SELECT consent_status FROM leads').get().consent_status,'denied');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
  }finally{db.close()}
});
