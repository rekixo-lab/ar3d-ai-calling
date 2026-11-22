import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,admin,client,now} from './helpers/calling-fixture.mjs';
import {handleCallingScripts} from '../src/calling-script-routes.mjs';
import {defaultScript} from '../src/calling-script-core.mjs';
const otherTenant='44444444-4444-4444-8444-444444444444';
const call=(f,action='',d={},user=admin,method='POST',options={})=>handleCallingScripts(new Request('https://app.example.invalid/v1/human/calling-scripts'+(action?'/'+action:'')+(method==='GET'?'?tenantId='+tid:''),{method,headers:{Origin:'https://app.example.invalid','Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({tenantId:tid,...d})}:{})}),f.env,user,{now,...options});
async function save(f,config=defaultScript(),baseRevision=0){const r=await call(f,'',{config,baseRevision},admin);assert.equal(r.status,201,await r.clone().text());return r.json()}
test('client owns script history, conflicts cannot overwrite, restore creates another version',async()=>{const f=fixture();try{
 const first=await save(f);assert.equal(first.revision,1);assert.match(first.prompt,/end the call immediately/);
 assert.equal((await call(f,'',{config:defaultScript(),baseRevision:0},admin)).status,409);
 assert.equal((await call(f,'',{config:defaultScript(),baseRevision:1},client)).status,403);
 const config={...defaultScript(),questions:['बजट बताइए?'],faqs:[{question:'कीमत?',answer:'टीम से पुष्टि करेंगे।'}],rules:'बजट मिलने पर लोकेशन पूछें।'};
 await save(f,config,1);await save(f,defaultScript(),2);
 const state=await (await call(f,'',{},client,'GET')).json();assert.deepEqual(state.versions.map(v=>v.revision),[3,2,1]);assert.deepEqual(state.versions[1].config,config);assert.equal(state.canEdit,false);
 assert.throws(()=>f.c.db.prepare('UPDATE calling_script_versions SET prompt=? WHERE id=?').run('changed',first.id),/immutable/);
}finally{f.close()}});
test('tenant boundaries, viewer permissions, current admin MFA and same origin enforced',async()=>{const f=fixture();try{
 assert.equal((await call(f,'',{config:defaultScript(),baseRevision:0},{id:'viewer',globalRole:'user'})).status,403);
 assert.equal((await call(f,'',{tenantId:otherTenant,config:defaultScript(),baseRevision:0},client)).status,403);
 assert.equal((await call(f,'binding',{},client)).status,404);
 assert.equal((await call(f,'',{config:defaultScript(),baseRevision:0}, {...admin,token_hash:'wrong'})).status,403);
 const req=new Request('https://app.example.invalid/v1/human/calling-scripts',{method:'POST',headers:{Origin:'https://attacker.invalid'}});
 assert.equal((await handleCallingScripts(req,f.env,client)).status,403);
 assert.equal((await call(f,'',{config:{...defaultScript(),questions:[]},baseRevision:0},admin)).status,400);
}finally{f.close()}});
