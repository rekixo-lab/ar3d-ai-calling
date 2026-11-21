// Exotel's official ExotelMCP assistant-version contract. Credentials stay on Worker.
// Saves a new, non-stable version. A provider save is never reported as live rollout.
export function scriptProviderConfiguration(env){
 const missing=['EXOTEL_VOICEBOT_ACCOUNT_ID','EXOTEL_VOICEBOT_API_KEY','EXOTEL_VOICEBOT_API_TOKEN'].filter(k=>!env[k]);
 return {ready:missing.length===0,missing};
}
async function request(env,path,{fetcher=fetch,method='GET',body}={}){
 if(!scriptProviderConfiguration(env).ready)throw Error('voicebot_management_credentials_required');
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(env.EXOTEL_VOICEBOT_ACCOUNT_ID))throw Error('invalid_provider_account');
 const url='https://voicebot.in.exotel.com/voicebot/api/v2/accounts/'+env.EXOTEL_VOICEBOT_ACCOUNT_ID+path;
 let response;
 try{response=await fetcher(url,{method,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:'Basic '+btoa(env.EXOTEL_VOICEBOT_API_KEY+':'+env.EXOTEL_VOICEBOT_API_TOKEN),'Content-Type':'application/json',Accept:'application/json'},...(body?{body:JSON.stringify(body)}:{})})}catch{throw Error(method==='POST'?'provider_write_unknown':'provider_unreachable')}
 if(!response.ok)throw Error(response.status>=500&&method==='POST'?'provider_write_unknown':response.status===401||response.status===403?'voicebot_management_access_denied':'provider_http_'+response.status);
 let raw='';const reader=response.body?.getReader();if(!reader)throw Error(method==='POST'?'provider_write_unknown':'provider_invalid_response');
 try{const decoder=new TextDecoder();let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000)throw Error();raw+=decoder.decode(value,{stream:true})}raw+=decoder.decode();return JSON.parse(raw)}catch{throw Error(method==='POST'?'provider_write_unknown':'provider_invalid_response')}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
const unwrap=r=>r?.response?.data||r?.data||r;
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
