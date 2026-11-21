import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid} from './helpers/calling-fixture.mjs';
import {handleHumanRequest} from '../src/human-routes.mjs';
import {sha256hex} from '../src/core.mjs';

test('both native Super Admin tenant creation paths seed generic AI safely and only as drafts',async()=>{
 const f=fixture();
 try{
  const session='f'.repeat(64);
  const hash=await sha256hex(session);
  f.c.db.prepare("UPDATE human_sessions SET token_hash=?, created_at=?, expires_at=? WHERE user_id='admin'")
   .run(hash,new Date(Date.now()-1000).toISOString(),Date.now()+8*60*60*1000);
  const post=async(displayName,slug,plan='starter',storageMode='shared')=>
   handleHumanRequest(new Request('https://calling.example.invalid/v1/human/tenants',{
    method:'POST',headers:{
     'Content-Type':'application/json','Origin':'https://calling.example.invalid',
     'Cookie':'ar3d_calling_session='+session},
    body:JSON.stringify({displayName,slug,plan,storageMode})
   }),f.env);
  for(const [displayName,slug,plan,storageMode] of [
   ['Another Estate','another-estate','starter','shared'],
   ['Dedicated Estate','dedicated-estate','growth','dedicated']
  ]){
   const response=await post(displayName,slug,plan,storageMode);
   assert.equal(response.status,201,await response.clone().text());
   const data=await response.json();
   assert.equal(data.aiDraftReady,true);assert.equal(data.aiPublished,false);
   const p=f.c.db.prepare('SELECT * FROM company_profile_versions WHERE tenant_id=?').get(data.id);
   const s=f.c.db.prepare('SELECT * FROM calling_script_versions WHERE tenant_id=?').get(data.id);
   assert.equal(p.revision,1);
   assert.equal(JSON.parse(p.config_json).companyName,displayName);
   assert.equal(JSON.parse(p.config_json).projects,'');
   assert.equal(JSON.parse(p.config_json).pricing,'');
   assert.equal(s.revision,1);assert.equal(s.provider_state,'draft');
   assert.equal(JSON.parse(s.config_json).questions.length,7);
   assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM calling_agent_publications WHERE tenant_id=?').get(data.id).n,0);
   assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calling_jobs WHERE tenant_id=?').get(data.id).n,0);
  }
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM company_profile_versions WHERE tenant_id=?').get(tid).n,0);
  assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM calling_script_versions WHERE tenant_id=?').get(tid).n,0);
 }finally{f.close()}
});
