import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,admin,client,tid,now} from './helpers/calling-fixture.mjs';
import {handleCompanyProfile,emptyCompanyProfile,compileCompanyFacts} from '../src/company-profile.mjs';
const profile={...emptyCompanyProfile(),companyName:'Demo Builder',projects:'Demo Heights — 2 and 3 BHK',pricing:'20 lakh onwards'};
const request=(method,data,origin='https://app.example.invalid')=>new Request('https://app.example.invalid/v1/human/company-profile'+(method==='GET'?'?tenantId='+data.tenantId:''),{method,headers:{Origin:origin,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(data)}:{})});
test('company profile isolates tenant data and immutable history with atomic revision saves',async()=>{const f=fixture();try{
 const save=()=>handleCompanyProfile(request('POST',{tenantId:tid,baseRevision:0,profile}),f.env,client,{now});
 assert.deepEqual((await Promise.all([save(),save()])).map(r=>r.status).sort(),[201,409]);
 const read=await handleCompanyProfile(request('GET',{tenantId:tid}),f.env,client,{now});const value=await read.json();assert.deepEqual(value.profile,profile);assert.equal(value.revision,1);
 assert.throws(()=>f.c.db.exec('UPDATE company_profile_versions SET revision=2'),/immutable/);
 assert.throws(()=>f.c.db.exec('DELETE FROM company_profile_versions'),/immutable/);
 const outsider=await handleCompanyProfile(request('GET',{tenantId:tid}),f.env,{id:'outsider',globalRole:'user'},{now});assert.equal(outsider.status,403);
 assert.equal((await handleCompanyProfile(request('POST',{tenantId:tid,baseRevision:1,profile}),f.env,{id:'viewer',globalRole:'user'},{now})).status,403);
 assert.equal((await handleCompanyProfile(request('POST',{tenantId:tid,baseRevision:1,profile},'https://evil.invalid'),f.env,client,{now})).status,403);
 assert.equal((await handleCompanyProfile(request('GET',{tenantId:tid}),f.env,{...admin,token_hash:'bad'},{now})).status,403);
 assert.equal((await handleCompanyProfile(request('GET',{tenantId:tid}),f.env,admin,{now})).status,200);
}finally{f.close()}});
test('profile validates bounded business information and compiles it as reference facts',async()=>{const f=fixture();try{
 for(const bad of [{...profile,companyName:''},{...profile,website:'javascript:alert(1)'},{...profile,website:'https://user:pass@example.invalid'},{...profile,projects:'x'.repeat(6001)},{...profile,admin:true}])assert.equal((await handleCompanyProfile(request('POST',{tenantId:tid,baseRevision:0,profile:bad}),f.env,client,{now})).status,400);
 const facts=compileCompanyFacts(profile);assert.ok(facts.includes('Demo Builder'));assert.ok(facts.includes('20 lakh onwards'));assert.ok(facts.includes('not independently verified'));
}finally{f.close()}});
