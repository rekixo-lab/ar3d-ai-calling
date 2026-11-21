import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,admin,client,now} from './helpers/calling-fixture.mjs';
import {handleCallingScripts} from '../src/calling-script-routes.mjs';
import {defaultScript,compileScript} from '../src/calling-script-core.mjs';
import {scriptProviderConfiguration} from '../src/calling-script-provider.mjs';
const botId='44444444-4444-4444-8444-444444444444',assistantId='55555555-5555-4555-8555-555555555555';
test('read-only provider probe tests existing credentials, returns only whitelisted IDs and never mutates',async()=>{const f=fixture();try{
 let count=0;
 const fetcher=async(url,init)=>{count++;assert.equal(init.method,'GET');assert.ok(url.endsWith('/voicebots/'+botId));return Response.json({bot_id:botId,version:'v4',assistant_config:{assistant_id:assistantId,version:'v2',secret:'must-not-return'},webhook_token:'must-not-return'})};
 const result=await call(f,'probe',{botId},admin,'POST',{fetcher});assert.equal(result.status,200);const data=await result.json();assert.equal(data.accessVerified,true);assert.equal(data.assistantCandidates[0].assistantId,assistantId);assert.ok(!JSON.stringify(data).includes('must-not-return'));assert.equal(count,1);
 const actualEnvelope=await call(f,'probe',{botId},admin,'POST',{fetcher:async()=>Response.json({http_code:200,response:{id:botId,stable_version:'v6',assistant_config:{id:assistantId,version:'v4'},webhook_config:{token:'never-return'}},request_id:'private-request'})});
 const actual=await actualEnvelope.json();assert.equal(actual.accessVerified,true);assert.deepEqual(actual.assistantCandidates,[{assistantId,sourceVersion:'v4',botVersion:'v6'}]);assert.ok(!JSON.stringify(actual).includes('never-return'));assert.ok(!JSON.stringify(actual).includes('private-request'));
 assert.equal((await call(f,'probe',{botId},client,'POST',{fetcher})).status,403);assert.equal(count,1);
 const denied=await call(f,'probe',{botId},admin,'POST',{fetcher:async()=>new Response('denied',{status:403})});assert.equal((await denied.json()).error,'voicebot_management_access_denied');
 const unexpected=await call(f,'probe',{botId},admin,'POST',{fetcher:async()=>Response.json({response:{data:{token:'never-expose-this',credentials:'private'}}})});
 const diagnostic=await unexpected.json();assert.equal(diagnostic.accessVerified,false);assert.match(diagnostic.notice,/response.data.token:string/);assert.ok(!JSON.stringify(diagnostic).includes('never-expose-this'));assert.ok(!JSON.stringify(diagnostic).includes('private'));
 f.env.EXOTEL_VOICEBOT_ACCOUNT_ID='dedicated';assert.equal(scriptProviderConfiguration(f.env).ready,false);assert.equal(scriptProviderConfiguration(f.env).credentialSource,'voicebot_api');
}finally{f.close()}});
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
 delete f.env.EXOTEL_API_TOKEN;const v=await save(f);await call(f,'binding',{botId,assistantId,sourceVersion:'v2'},admin);
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
