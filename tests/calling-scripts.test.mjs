import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,admin,client,now} from './helpers/calling-fixture.mjs';
import {handleCallingScripts} from '../src/calling-script-routes.mjs';
import {defaultScript,compileScript} from '../src/calling-script-core.mjs';
const botId='44444444-4444-4444-8444-444444444444',assistantId='55555555-5555-4555-8555-555555555555';
const call=(f,action='',d={},user=client,method='POST',options={})=>handleCallingScripts(new Request('https://app.example.invalid/v1/human/calling-scripts'+(action?'/'+action:'')+(method==='GET'?'?tenantId='+tid:''),{method,headers:{Origin:'https://app.example.invalid','Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({tenantId:tid,...d})}:{})}),f.env,user,{now,...options});
async function save(f,config=defaultScript(),baseRevision=0){const r=await call(f,'',{config,baseRevision});assert.equal(r.status,201,await r.clone().text());return r.json()}
async function connect(f){f.env.EXOTEL_VOICEBOT_ACCOUNT_ID='fictional';f.env.EXOTEL_VOICEBOT_API_KEY='secret-key';f.env.EXOTEL_VOICEBOT_API_TOKEN='secret-token';assert.equal((await call(f,'binding',{botId,assistantId,sourceVersion:'v2'},admin)).status,200)}
test('client owns script history, conflicts cannot overwrite, restore creates another version',async()=>{const f=fixture();try{
 const first=await save(f);assert.equal(first.revision,1);assert.match(first.prompt,/end the call immediately/);
 assert.equal((await call(f,'',{config:defaultScript(),baseRevision:0})).status,409);
 const config={...defaultScript(),questions:['बजट बताइए?'],faqs:[{question:'कीमत?',answer:'टीम से पुष्टि करेंगे।'}],rules:'बजट मिलने पर लोकेशन पूछें।'};
 await save(f,config,1);await save(f,defaultScript(),2);
 const state=await (await call(f,'',{},client,'GET')).json();assert.deepEqual(state.versions.map(v=>v.revision),[3,2,1]);assert.deepEqual(state.versions[1].config,config);assert.equal(state.canStage,false);
 assert.throws(()=>f.c.db.prepare('UPDATE calling_script_versions SET prompt=? WHERE id=?').run('changed',first.id),/immutable/);
}finally{f.close()}});
test('tenant boundaries, viewer permissions, current admin MFA and same origin enforced',async()=>{const f=fixture();try{
 assert.equal((await call(f,'',{config:defaultScript(),baseRevision:0},{id:'viewer',globalRole:'user'})).status,403);
 assert.equal((await call(f,'',{tenantId:botId,config:defaultScript(),baseRevision:0})).status,403);
 assert.equal((await call(f,'binding',{botId,assistantId,sourceVersion:'v2'})).status,403);
 assert.equal((await call(f,'binding',{}, {...admin,token_hash:'wrong'},'GET')).status,403);
 const req=new Request('https://app.example.invalid/v1/human/calling-scripts',{method:'POST',headers:{Origin:'https://attacker.invalid'}});
 assert.equal((await handleCallingScripts(req,f.env,client)).status,403);
 assert.equal((await call(f,'',{config:{...defaultScript(),questions:[]},baseRevision:0})).status,400);
}finally{f.close()}});
test('missing dedicated credentials makes no provider requests, binding cannot be shared',async()=>{const f=fixture();try{
 const v=await save(f);await call(f,'binding',{botId,assistantId,sourceVersion:'v2'},admin);
 let n=0;assert.equal((await call(f,'stage',{id:v.id},admin,'POST',{fetcher:async()=>{n++;throw Error()}})).status,503);assert.equal(n,0);
 f.c.db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,'other','Other','starter','shared','active','now','now')").run(botId);
 assert.equal((await call(f,'binding',{tenantId:botId,botId,assistantId,sourceVersion:'v2'},admin)).status,409);
}finally{f.close()}});
test('provider sync preserves tools and model, saves non-stable version, verifies exact prompt and is retry safe',async()=>{const f=fixture();try{
 const v=await save(f);await connect(f);const requests=[];const agent={id:'survey',instruction:'old',tools:['unchanged'],llm_config:{model:'existing'}};
 const fetcher=async(url,init)=>{
  requests.push({url,init});
  if(init.method==='POST'){
   const d=JSON.parse(init.body);assert.equal(d.source_version,'v2');assert.equal(d.mark_as_stable,'false');
   assert.deepEqual(d.data.agents[0],{...agent,instruction:compileScript(defaultScript())});
   return Response.json({response:{data:{version:'v3'}}});
  }
  const versions={v2:{agents:[agent]},v3:{agents:[{...agent,instruction:compileScript(defaultScript())}]}};
  return Response.json({response:{data:{versions}}});
 };
 const r=await call(f,'stage',{id:v.id},admin,'POST',{fetcher});assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).liveVerified,false);assert.equal(requests.length,3);
 assert.equal((await call(f,'stage',{id:v.id},admin,'POST',{fetcher})).status,200);assert.equal(requests.length,3);
 const result=await (await call(f,'',{},client,'GET')).json();assert.equal(result.versions[0].providerVersion,'v3');assert.ok(!JSON.stringify(result).includes('secret-token'));
}finally{f.close()}});
test('ambiguous POST locks retries, provider errors never expose credentials, multiple agents not overwritten',async()=>{const f=fixture();try{
 const v=await save(f);await connect(f);let posts=0;
 const fetcher=async(url,init)=>{if(init.method==='POST'){posts++;throw Error('secret-token')}return Response.json({response:{data:{versions:{v2:{agents:[{instruction:'old'}]}}}}})};
 const r=await call(f,'stage',{id:v.id},admin,'POST',{fetcher});assert.equal(r.status,502);assert.ok(!(await r.text()).includes('secret-token'));
 assert.equal((await call(f,'stage',{id:v.id},admin,'POST',{fetcher})).status,409);assert.equal(posts,1);
 assert.equal((await call(f,'binding',{botId,assistantId,sourceVersion:'v3'},admin)).status,409);
}finally{f.close()}});
