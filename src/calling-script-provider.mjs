// Exotel's official ExotelMCP assistant-version contract. Credentials stay on Worker.
// Saves a new, non-stable version. A provider save is never reported as live rollout.
export function scriptProviderConfiguration(env){
 const dedicated=['EXOTEL_VOICEBOT_ACCOUNT_ID','EXOTEL_VOICEBOT_API_KEY','EXOTEL_VOICEBOT_API_TOKEN'];
 const selected=dedicated.some(k=>env[k])?dedicated:['EXOTEL_ACCOUNT_SID','EXOTEL_API_KEY','EXOTEL_API_TOKEN'];
 const missing=selected.filter(k=>!env[k]);
 return {ready:missing.length===0,missing,credentialSource:selected===dedicated?'voicebot_api':'account_api',accessVerified:false};
}
async function request(env,path,{fetcher=fetch,method='GET',body}={}){
 if(!scriptProviderConfiguration(env).ready)throw Error('voicebot_management_credentials_required');
 const dedicated=scriptProviderConfiguration(env).credentialSource==='voicebot_api';
 const account=dedicated?env.EXOTEL_VOICEBOT_ACCOUNT_ID:env.EXOTEL_ACCOUNT_SID;
 const key=dedicated?env.EXOTEL_VOICEBOT_API_KEY:env.EXOTEL_API_KEY,token=dedicated?env.EXOTEL_VOICEBOT_API_TOKEN:env.EXOTEL_API_TOKEN;
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(account))throw Error('invalid_provider_account');
 if(!/^[\x21-\x7e]{1,256}$/.test(key)||key.includes(':')||!/^[\x21-\x7e]{1,256}$/.test(token))throw Error('invalid_provider_credentials');
 const url='https://voicebot.in.exotel.com/voicebot/api/v2/accounts/'+account+path;
 let response;
 try{response=await fetcher(url,{method,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:'Basic '+btoa(key+':'+token),'Content-Type':'application/json',Accept:'application/json'},...(body?{body:JSON.stringify(body)}:{})})}catch{throw Error(method==='POST'?'provider_write_unknown':'provider_unreachable')}
 if(!response.ok)throw Error(response.status>=500&&method==='POST'?'provider_write_unknown':response.status===401||response.status===403?'voicebot_management_access_denied':'provider_http_'+response.status);
 let raw='';const reader=response.body?.getReader();if(!reader)throw Error(method==='POST'?'provider_write_unknown':'provider_invalid_response');
 try{const decoder=new TextDecoder();let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000)throw Error();raw+=decoder.decode(value,{stream:true})}raw+=decoder.decode();return JSON.parse(raw)}catch{throw Error(method==='POST'?'provider_write_unknown':'provider_invalid_response')}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
const unwrap=r=>r?.response?.data||r?.data||r;
function responseShape(raw){
 const out=[];
 function walk(v,path,depth){if(out.length>=30)return;if(!v||typeof v!=='object'){out.push(path+':'+typeof v);return}if(depth>=3){out.push(path+':object');return}for(const [key,value] of Object.entries(v).slice(0,20)){if(!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key))continue;walk(value,path?path+'.'+key:key,depth+1)}}
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
 extract(data.assistant_config,/^v[1-9]\d{0,8}$/.test(data.version||'')?data.version:null);
 for(const [version,config] of Object.entries(data.versions||{}))if(/^v[1-9]\d{0,8}$/.test(version))extract(config?.assistant_config,version);
 return {accessVerified:true,botId,assistantCandidates:candidates,notice:'Read-only API access verified. This does not prove live rollout.'};
}
export async function stageScript(env,binding,prompt,options={}){
 const path='/assistants/'+binding.assistant_id;
 const current=unwrap(await request(env,path+'?version='+binding.source_version,options));
 const config=current?.versions?.[binding.source_version];
 if(!config||!Array.isArray(config.agents)||config.agents.length!==1||typeof config.agents[0]!=='object'||!config.agents[0])throw Error('provider_source_requires_single_agent');
 const agents=config.agents.map(agent=>({...agent,instruction:prompt}));
 const result=unwrap(await request(env,path+'/versions',{...options,method:'POST',body:{source_version:binding.source_version,mark_as_stable:'false',version_description:'AR3D reviewed conversation script',data:{agents}}}));
 const version=result?.version||result?.latest_version;
 if(!/^v[1-9]\d{0,8}$/.test(version||''))throw Error('provider_write_unknown');
 // A read-back must match the precise new version and prompt, not stable/latest.
 let check;try{check=unwrap(await request(env,path+'?version='+version,options))}catch{throw Error('provider_write_unknown')}
 if(check?.versions?.[version]?.agents?.length!==1||check.versions[version].agents[0].instruction!==prompt)throw Error('provider_write_unknown');
 return {version};
}
