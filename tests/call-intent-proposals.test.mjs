// Real migrated SQLite integration: tenant ownership, opt-out, dedupe,
// immutable blocked status and zero calls. No external provider requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import worker from '../src/index.mjs';
import {handleCallIntentProposals} from '../src/call-intent-proposals.mjs';

const T='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const LEAD='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LEAD2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAMPAIGN='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_CAMPAIGN='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const user={id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',globalRole:'user'};
const stamp='2026-11-20T00:00:00.000Z';
const url='https://aicalling.ar3dstudio.in/v1/human/call-intent-proposals';
const request=(method='GET',arg='')=>new Request(url+(
  method==='GET'?'?tenantId='+T+arg:''
),{
  method,headers:method==='POST'?{
    'Content-Type':'application/json',Origin:'https://aicalling.ar3dstudio.in'
  }:undefined,
  body:method==='POST'?JSON.stringify(arg):undefined
});
function fixture(role='client_admin'){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for(const f of readdirSync('migrations/crm').filter(x=>x.endsWith('.sql')).sort()){
    db.exec(readFileSync(join('migrations/crm',f),'utf8'));
  }
  for(const [tid,lid,phone] of [[T,LEAD,'+919000000001'],[OTHER,LEAD2,'+919000000002']]){
    db.prepare(
      'INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES(?,?,?,?,'+
      "'excel',?,?)"
    ).run(tid,lid,'Fictional Test Buyer',phone,stamp,stamp);
  }
  for(const [tid,cid,lid] of [[T,CAMPAIGN,LEAD],[OTHER,OTHER_CAMPAIGN,LEAD2]]){
    db.prepare('INSERT INTO call_campaign_drafts('+
      'tenant_id,id,name,language_mode,purpose,status,created_by,created_at,updated_at) '+
      "VALUES(?,?,'Fictional Draft','hi','property_information','draft',?,?,?)"
    ).run(tid,cid,user.id,stamp,stamp);
    db.prepare('INSERT INTO call_campaign_candidates(tenant_id,campaign_id,lead_id,created_at) '+
      'VALUES(?,?,?,?)').run(tid,cid,lid,stamp);
  }
  let writes=0;
  const wrapper={
    prepare(sql){
      const st=db.prepare(sql);
      return {bind(...args){return {
        async first(){return st.get(...args)??null},
        async all(){return {results:st.all(...args)}},
        async run(){writes++;return {meta:{changes:Number(st.run(...args).changes)}}}
      }}};
    },
    async batch(stmts){
      db.exec('BEGIN IMMEDIATE');
      try{
        const results=[];
        for(const st of stmts)results.push(await st.run());
        db.exec('COMMIT');return results;
      }catch(e){db.exec('ROLLBACK');throw e}
    }
  };
  const control={prepare(sql){
    if(!sql.includes('FROM tenant_memberships'))throw Error('unexpected control query');
    return {bind(tid,id){return {async first(){
      return tid===T&&id===user.id?{
        tenant_id:T,role,storage_mode:'shared',status:'active'
      }:null;
    }}}};
  }};
  return {db,env:{CONTROL_DB:control,CRM_DB:wrapper},close(){db.close()},
    get writes(){return writes}};
}
const data=(changes={})=>({
  tenantId:T,campaignId:CAMPAIGN,leadId:LEAD,acknowledgeNoDial:true,...changes
});
test('staff can stage one blocked proposal in migrated CRM, without dialing',async()=>{
  const f=fixture();
  try{
    const res=await handleCallIntentProposals(request('POST',data()),f.env,user);
    assert.equal(res.status,201,JSON.stringify(await res.clone().json()));
    const value=await res.json();
    assert.equal(value.state,'blocked');
    assert.equal(value.executionAllowed,false);
    assert.equal(value.providerCallCreated,false);
    assert.equal(value.customerCallsStarted,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM call_intent_proposals').get().n,1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='call_intent.proposal_blocked'").get().n,1);
    const listing=await handleCallIntentProposals(request(),f.env,user);
    assert.equal(listing.status,200);
    const out=await listing.json();
    assert.equal(out.executionAllowed,false);
    assert.equal(out.proposals.length,1);
    assert.equal(out.proposals[0].state,'blocked');
    assert.equal(out.proposals[0].consentStatus,'unknown');
    assert.equal(out.proposals[0].dndStatus,'unknown');
    for(const sensitive of ['+919000000001','Fictional Test Buyer','provider_call_sid','fictional transcript text']){
      assert.ok(!JSON.stringify(out).includes(sensitive),sensitive);
    }
    const again=await handleCallIntentProposals(request('POST',data()),f.env,user);
    assert.equal(again.status,409);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM call_intent_proposals').get().n,1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM crm_audit_events').get().n,1);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{f.close()}
});
test('cross-tenant lead and campaign IDs cannot be registered',async()=>{
  const f=fixture();
  try{
    for(const invalid of [{campaignId:OTHER_CAMPAIGN},{leadId:LEAD2}]){
      const r=await handleCallIntentProposals(request('POST',data(invalid)),f.env,user);
      assert.equal(r.status,409);
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM call_intent_proposals').get().n,0);
    const viewer=await handleCallIntentProposals(
      new Request(url+'?tenantId='+OTHER),f.env,user);
    assert.equal(viewer.status,403);
  }finally{f.close()}
});
test('opted-out or denied/blocked leads cannot get even a new proposal',async()=>{
  for(const mode of ['optout','denied','dnd']){
    const f=fixture();
    try{
      if(mode==='optout')f.db.prepare('INSERT INTO lead_opt_out_events('+
        'tenant_id,id,lead_id,source,actor,created_at) '+
        "VALUES(?,?,?,'customer_request','test',?)"
      ).run(T,'ffffffff-ffff-4fff-8fff-ffffffffffff',LEAD,stamp);
      if(mode==='denied')f.db.prepare(
        "UPDATE leads SET consent_status='denied' WHERE tenant_id=? AND id=?"
      ).run(T,LEAD);
      if(mode==='dnd')f.db.prepare(
        "UPDATE leads SET dnd_status='blocked' WHERE tenant_id=? AND id=?"
      ).run(T,LEAD);
      const r=await handleCallIntentProposals(request('POST',data()),f.env,user);
      assert.equal(r.status,409,mode);
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM call_intent_proposals').get().n,0);
    }finally{f.close()}
  }
});
test('once recorded, opt-out becomes visible but intent stays blocked',async()=>{
  const f=fixture();
  try{
    assert.equal((await handleCallIntentProposals(
      request('POST',data()),f.env,user)).status,201);
    f.db.prepare('INSERT INTO lead_opt_out_events('+
      'tenant_id,id,lead_id,source,actor,created_at) '+
      "VALUES(?,?,?,'customer_request','test',?)"
    ).run(T,'ffffffff-ffff-4fff-8fff-ffffffffffff',LEAD,stamp);
    const res=await handleCallIntentProposals(request(),f.env,user);
    const out=await res.json();
    assert.equal(out.proposals[0].optOutRecorded,true);
    assert.equal(out.proposals[0].executionAllowed,false);
    assert.throws(()=>f.db.prepare(
      "UPDATE call_intent_proposals SET state='authorized' WHERE tenant_id=?"
    ).run(T));
    assert.throws(()=>f.db.prepare(
      "UPDATE call_intent_proposals SET created_by='fake' WHERE tenant_id=?"
    ).run(T));
    assert.equal(f.db.prepare('SELECT state FROM call_intent_proposals').get().state,'blocked');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
  }finally{f.close()}
});
test('viewer cannot write; arbitrary fields, approval flags and methods denied',async()=>{
  const f=fixture('viewer');
  try{
    assert.equal((await handleCallIntentProposals(request(),f.env,user)).status,200);
    assert.equal((await handleCallIntentProposals(
      request('POST',data()),f.env,user)).status,403);
    assert.equal((await handleCallIntentProposals(
      request('POST',data({force:true})),f.env,user)).status,400);
    assert.equal((await handleCallIntentProposals(
      request('POST',data({acknowledgeNoDial:false})),f.env,user)).status,400);
    assert.equal((await handleCallIntentProposals(
      request('DELETE',''),f.env,user)).status,405);
    assert.equal((await handleCallIntentProposals(
      new Request(url+'?tenantId='+T+'&approved=true'),f.env,user)).status,400);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM call_intent_proposals').get().n,0);
  }finally{f.close()}
});
test('outer Worker origin/session gate blocks unauthenticated real route',async()=>{
  const r=await worker.fetch(new Request(url+'?tenantId='+T),{CONTROL_DB:{}});
  assert.equal(r.status,401);
  const post=await worker.fetch(new Request(url,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify(data())
  }),{CONTROL_DB:{}});
  assert.equal(post.status,403);
});
