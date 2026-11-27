// Authenticated text-only dry-run for saved industry drafts. No provider or D1 writes.
import {requireMembership} from './human-auth.mjs';
import {compileDraftToFlow,simulateFlowGraph} from './call-flow-dsl.mjs';
import {validateIndustryAgentDraft} from './industry-template-catalog.mjs';
const uri=/^\/v1\/human\/ai-flows\/([0-9a-f-]{36})\/simulate$/i;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const response=(payload,status=200)=>Response.json(payload,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function smallJson(req){
 if(!String(req.headers.get('content-type')||'').startsWith('application/json')||
    Number(req.headers.get('content-length'))>2800)throw Error('invalid_simulation_payload');
 const reader=req.body?.getReader();
 if(!reader)throw Error('invalid_simulation_payload');
 let bytes=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   bytes+=value.byteLength;if(bytes>2800){await reader.cancel();throw Error('invalid_simulation_payload')}
   text+=decoder.decode(value,{stream:true});
  }
  text+=decoder.decode();
 }finally{reader.releaseLock()}
 let data;try{data=JSON.parse(text)}catch{throw Error('invalid_simulation_payload')}
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==2||
   !Object.hasOwn(data,'tenantId')||!Object.hasOwn(data,'answers'))throw Error('invalid_simulation_payload');
 return data;
}
export async function handleIndustryFlowSimulation(req,env,user){
 const path=new URL(req.url).pathname,match=path.match(uri);
 if(!match)return null;
 if(req.method!=='POST')return response({error:'method_not_allowed'},405);
 if(!uuid.test(match[1]))return response({error:'not_found'},404);
 try{
  const body=await smallJson(req);
  const member=await requireMembership(env.CONTROL_DB,user,body.tenantId,true);
  if(!member)return response({error:'forbidden'},403);
  if(!Array.isArray(body.answers)||body.answers.length>12||body.answers.some(x=>typeof x!=='string'||x.length>160))
   return response({error:'invalid_fictional_answers'},400);
  const row=await env.CONTROL_DB.prepare("SELECT config_json FROM ai_flow_definitions WHERE tenant_id=? AND id=? AND status='draft'")
   .bind(body.tenantId,match[1]).first();
  if(!row)return response({error:'draft_not_found'},404);
  const config=validateIndustryAgentDraft(JSON.parse(row.config_json));
  const flow=compileDraftToFlow(config);
  const run=simulateFlowGraph(flow,{answers:body.answers});
  return response({...run,flow:{schemaVersion:flow.schemaVersion,nodeTypes:flow.nodes.map(x=>x.type),
    templateId:flow.templateId,industry:flow.industry,regulated:flow.regulated,callable:false}});
 }catch(e){
  if(/^(?:invalid_|cyclic_|unknown_flow|unreachable_|private_field)/.test(e?.message||''))
   return response({error:'invalid_simulation_payload'},400);
  console.error('AR3D simulated flow failed (no customer records)',String(e?.name||'error'));
  return response({error:'simulation_unavailable'},503);
 }
}
