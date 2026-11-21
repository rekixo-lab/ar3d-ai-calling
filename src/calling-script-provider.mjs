// Exotel's official ExotelMCP assistant-version contract. Credentials stay on Worker.
// Saves a new, non-stable version. A provider save is never reported as live rollout.
export function scriptProviderConfiguration(env){
 const dedicated=['EXOTEL_VOICEBOT_ACCOUNT_ID','EXOTEL_VOICEBOT_API_KEY','EXOTEL_VOICEBOT_API_TOKEN'];
 const selected=dedicated.some(k=>env[k])?dedicated:['EXOTEL_ACCOUNT_SID','EXOTEL_API_KEY','EXOTEL_API_TOKEN'];
 const missing=selected.filter(k=>!env[k]);
 return {ready:missing.length===0,missing,credentialSource:selected===dedicated?'voicebot_api':'account_api',accessVerified:false};
}
async function request(env,path,{fetcher=fetch,method='GET',body,apiVersion='v2'}={}){
 if(!scriptProviderConfiguration(env).ready)throw Error('voicebot_management_credentials_required');
 const dedicated=scriptProviderConfiguration(env).credentialSource==='voicebot_api';
 const account=dedicated?env.EXOTEL_VOICEBOT_ACCOUNT_ID:env.EXOTEL_ACCOUNT_SID;
 const key=dedicated?env.EXOTEL_VOICEBOT_API_KEY:env.EXOTEL_API_KEY,token=dedicated?env.EXOTEL_VOICEBOT_API_TOKEN:env.EXOTEL_API_TOKEN;
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(account))throw Error('invalid_provider_account');
 if(!/^[\x21-\x7e]{1,256}$/.test(key)||key.includes(':')||!/^[\x21-\x7e]{1,256}$/.test(token))throw Error('invalid_provider_credentials');
 if(!['v1','v2'].includes(apiVersion))throw Error('invalid_provider_api_version');
 const url='https://voicebot.in.exotel.com/voicebot/api/'+apiVersion+'/accounts/'+account+path;
 let response;
 try{response=await fetcher(url,{method,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:'Basic '+btoa(key+':'+token),'Content-Type':'application/json',Accept:'application/json'},...(body?{body:JSON.stringify(body)}:{})})}catch{throw Error(method==='POST'?'provider_write_unknown':'provider_unreachable')}
 if(!response.ok)throw Error(response.status>=500&&method==='POST'?'provider_write_unknown':response.status===401||response.status===403?'voicebot_management_access_denied':'provider_http_'+response.status);
 let raw='';const reader=response.body?.getReader();if(!reader)throw Error(method==='POST'?'provider_write_unknown':'provider_invalid_response');
 try{const decoder=new TextDecoder();let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000)throw Error();raw+=decoder.decode(value,{stream:true})}raw+=decoder.decode();return JSON.parse(raw)}catch{throw Error(method==='POST'?'provider_write_unknown':'provider_invalid_response')}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
const unwrap=r=>r?.response?.data||r?.response||r?.data||r;
const versionConfig=(data,version)=>data?.versions?.[version]||
 ((data?.version===version||data?.latest_version===version)?data:null);
function responseShape(raw){
 const out=[];
 function walk(v,path,depth){if(out.length>=30)return;if(!v||typeof v!=='object'){out.push(path+':'+(typeof v==='number'&&Number.isSafeInteger(v)&&/(?:^|\.)(?:code|status_code|http_code)$/.test(path)?String(v):typeof v));return}if(depth>=3){out.push(path+':object');return}for(const [key,value] of Object.entries(v).slice(0,20)){if(!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key))continue;walk(value,path?path+'.'+key:key,depth+1)}}
 walk(raw,'',0);return out.join(', ');
}
export async function probeScriptProvider(env,botId,options={}){
 const raw=await request(env,'/voicebots/'+botId,options),data=unwrap(raw);
 if((data?.bot_id||data?.id)!==botId)return {accessVerified:false,botId,assistantCandidates:[],notice:'Provider response did not verify the expected bot. Response structure (values hidden): '+responseShape(raw)};
 const candidates=[];
 const extract=(config,botVersion)=>{
  if(!config||typeof config!=='object')return;
  const id=config.assistant_id||config.id,version=config.assistant_version||config.version;
  if(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||'')&&/^v[1-9]\d{0,8}$/.test(version||''))candidates.push({assistantId:id,sourceVersion:version,botVersion});
 };
 const botVersion=data.version||data.stable_version;
 extract(data.assistant_config,/^v[1-9]\d{0,8}$/.test(botVersion||'')?botVersion:null);
 for(const [version,config] of Object.entries(data.versions||{}))if(/^v[1-9]\d{0,8}$/.test(version))extract(config?.assistant_config,version);
 return {accessVerified:true,botId,assistantCandidates:candidates,configurationShape:'Bot keys: '+Object.keys(data||{}).join(', ')+'. '+responseShape({webhook_config:data.webhook_config,assistant_config:data.assistant_config}),notice:'Read-only API access verified. This does not prove live rollout.'};
}
export async function stageScript(env,binding,prompt,options={}){
 const path='/assistants/'+binding.assistant_id;
 const current=unwrap(await request(env,path+'?version='+binding.source_version,options));
 const config=versionConfig(current,binding.source_version);
 if(!config||!Array.isArray(config.agents)||config.agents.length!==1||typeof config.agents[0]!=='object'||!config.agents[0])throw Error('provider_source_requires_single_agent');
 const agents=config.agents.map(agent=>({...agent,instruction:prompt}));
 const result=unwrap(await request(env,path+'/versions',{...options,method:'POST',body:{source_version:binding.source_version,mark_as_stable:'false',version_description:'AR3D reviewed conversation script',data:{agents}}}));
 const version=result?.version||result?.latest_version;
 if(!/^v[1-9]\d{0,8}$/.test(version||''))throw Error('provider_write_unknown');
 // A read-back must match the precise new version and prompt, not stable/latest.
 let check;try{check=unwrap(await request(env,path+'?version='+version,options))}catch{throw Error('provider_write_unknown')}
 const saved=versionConfig(check,version);
 if(saved?.agents?.length!==1||saved.agents[0].instruction!==prompt)throw Error('provider_write_unknown');
 return {version};
}

export async function verifyPublishedAssistant(env,binding,publication,options={}){
 const data=unwrap(await request(env,'/assistants/'+binding.assistant_id+'?version='+publication.provider_version,options));
 const config=versionConfig(data,publication.provider_version);
 if((data.id||data.assistant_id)!==binding.assistant_id||data.stable_version!==publication.provider_version||config?.agents?.length!==1||config.agents[0].instruction!==publication.prompt)throw Error('published_agent_changed_republish_required');
 return true;
}

export {request as voicebotRequest,unwrap as unwrapVoicebot,versionConfig as assistantVersionConfig};
export async function createIsolatedPublishedAssistant(env,runtime,prompt,name,{fetcher=fetch,onCreated=async()=>{}}={}){
 const options={fetcher};
 const source=versionConfig(unwrap(await request(env,'/assistants/'+runtime.template_assistant_id+'?version='+runtime.template_version,options)),runtime.template_version);
 if(!source||source.agents?.length!==1||[source.tools,source.mcp_servers,source.agents[0].tools,source.agents[0].mcp_tools,source.agents[0].sub_agents].some(x=>x!=null&&(typeof x!=='object'||Object.keys(x).length>0)))throw Error('gateway_template_requires_single_agent_without_tools');
 const agent={...source.agents[0],id:crypto.randomUUID(),name:'Property enquiry assistant',description:'Dedicated client property enquiry',instruction:prompt};
 let wrote=false,creationAcknowledged=false;
 try{
  wrote=true;
  const created=unwrap(await request(env,'/assistants',{...options,method:'POST',body:{name:('AR3D - '+name).slice(0,120),description:'Dedicated AR3D client publication',instruction:prompt,agents:[agent]}}));
  creationAcknowledged=true;
  const id=created.id||created.assistant_id;
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||''))throw Error();
  await onCreated(id);
  let saved=unwrap(await request(env,'/assistants/'+id,options)),version=saved.latest_version||saved.version;
  if(!/^v[1-9]\d{0,8}$/.test(version||''))throw Error();
  // Pin both the supervisor and agent model from the working template rather
  // than letting the create endpoint choose a different default model.
  const stable=unwrap(await request(env,'/assistants/'+id+'/versions',{...options,method:'POST',body:{source_version:version,mark_as_stable:'true',version_description:'Immutable AR3D company publication',data:{instruction:prompt,llm_config:source.llm_config,intent_detection_config:source.intent_detection_config,agents:[agent]}}}));
  version=stable.version||stable.latest_version;
  if(!/^v[1-9]\d{0,8}$/.test(version||''))throw Error();
  saved=unwrap(await request(env,'/assistants/'+id+'?version='+version,options));
  const config=versionConfig(saved,version);
  if((saved.id||saved.assistant_id)!==id||saved.stable_version!==version||config?.agents?.length!==1||config.agents[0].instruction!==prompt)throw Error();
  if(source.llm_config?.model_id&&saved.llm_config?.model_id!==source.llm_config.model_id)throw Error();
  if(source.agents[0].llm_config?.model_id&&config.agents[0].llm_config?.model_id!==source.agents[0].llm_config.model_id)throw Error();
  return {assistantId:id,version};
 }catch(e){if(wrote&&!(creationAcknowledged===false&&(/^(?:provider_http_(?:400|401|403|404|422|429)|voicebot_management_access_denied)$/.test(e.message))))throw Error('provider_write_unknown');throw e}
}
