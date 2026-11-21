import assert from 'node:assert/strict';
import {fixture,tid,admin,client,now,at} from './calling-fixture.mjs';
import {handleCallingScripts} from '../../src/calling-script-routes.mjs';
import {defaultScript} from '../../src/calling-script-core.mjs';
import {emptyCompanyProfile} from '../../src/company-profile.mjs';
import {requirePublishedAgent} from '../../src/published-agent.mjs';
export const gatewayBot='44444444-4444-4444-8444-444444444444',templateAssistant='55555555-5555-4555-8555-555555555555',guardAssistant='66666666-6666-4666-8666-666666666666';
export const publicationRequest=(action,data)=>new Request('https://app.example.invalid/v1/human/calling-scripts/'+action,{method:'POST',headers:{Origin:'https://app.example.invalid','Content-Type':'application/json'},body:JSON.stringify({tenantId:tid,...data})});
export async function setupPublication(f){
 const r=await handleCallingScripts(publicationRequest('versions',{baseRevision:0,config:defaultScript()}),f.env,client,{now});assert.equal(r.status,201);const script=await r.json();
 f.c.db.prepare('INSERT INTO company_profile_versions VALUES(?,?,?,?,?)').run(tid,1,JSON.stringify({...emptyCompanyProfile(),companyName:'Demo Builder',projects:'Demo Heights',pricing:'20 lakh onwards'}),client.id,at);
 f.c.db.prepare("INSERT INTO shared_voice_gateway(id,bot_id,flow_id,template_assistant_id,template_version,guard_assistant_id,gateway_version,state,updated_by,updated_at) VALUES(1,?,?,?,'v1',?,'v2','ready',?,?)").run(gatewayBot,'123456',templateAssistant,guardAssistant,admin.id,at);
 f.env.EXOTEL_REQUIRE_PUBLISHED_AGENT='enabled';f.env.EXOTEL_VOICEBOT_WEBHOOK_TOKEN='a'.repeat(64);
 return script;
}
export function publicationProvider({uncertain=false,mismatch=false,unstableCreate=false}={}){
 const assistants=new Map();let posts=0;
 return {assistants,get posts(){return posts},fetcher:async(url,init)=>{
  if(url instanceof Request)throw Error('unexpected live call');
  if(url.includes('/voicebots/'))return Response.json({response:{id:gatewayBot,stable_version:'v2',latest_version:'v2',traffic_allocation:{v2:100},assistant_config:{id:guardAssistant,version:null}}});
  if(url.endsWith('/assistants')&&init.method==='POST'){
   posts++;const body=JSON.parse(init.body);assert.equal(body.agents.length,1);assert.deepEqual(body.agents[0].tools,[]);assert.match(body.instruction,/Demo Heights/);assert.match(body.instruction,/20 lakh onwards/);assert.match(body.instruction,/जी हाँ/);
   if(uncertain)throw Error('private-provider-token');const id=crypto.randomUUID();assistants.set(id,{prompt:body.instruction,version:'v1',stable:unstableCreate?null:'v1'});return Response.json({response:{id,latest_version:'v1'}});
  }
  if(url.includes('/assistants/'+templateAssistant))return Response.json({response:{id:templateAssistant,latest_version:'v1',stable_version:'v1',agents:[{id:'template',tools:[],instruction:'template',llm_config:{model:'trusted-existing-model'}}]}});
  const id=url.match(/\/assistants\/([^/?]+)/)?.[1],a=assistants.get(id);assert.ok(a,'unknown assistant requested');
  if(init.method==='POST'){
   const body=JSON.parse(init.body);assert.equal(body.mark_as_stable,'true');assert.equal(body.source_version,'v1');a.version='v2';a.stable='v2';return Response.json({response:{latest_version:'v2'}});
  }
  return Response.json({response:{id,latest_version:a.version,stable_version:a.stable,agents:[{id:'published',tools:[],instruction:mismatch?'wrong prompt':a.prompt}]}});
 }};
}
export async function publishForTest(f,script,p){const r=await handleCallingScripts(publicationRequest('publish',{id:script.id,profileRevision:1}),f.env,client,{now,fetcher:p.fetcher});assert.equal(r.status,200,await r.clone().text());return r.json()}
