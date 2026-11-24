// Bounded, optional text-only Sarvam adapter for the existing validated
// contextual interpreter. No tools, dialing, database access, or retries.
import {readBoundedBytes} from './scripted-speech.mjs';
export function createSarvamContextualAdapter(key,fetcher=fetch){
 if(typeof key!=='string'||!key.trim()||key.length>512)throw Error('sarvam_not_configured');
 let requests=0,usage=null;
 return {
  get requests(){return requests},
  get usage(){return usage},
  async run(_model,request){
   if(requests!==0||!Array.isArray(request?.messages)||request.messages.length!==2||
      request.messages[0]?.role!=='system'||request.messages[1]?.role!=='user'||
      request.messages.some(m=>typeof m.content!=='string'||m.content.length>5000)||
      request.response_format?.type!=='json_schema'||!request.response_format.json_schema)throw Error('invalid_contextual_request');
   requests++;
   const body={model:'sarvam-105b-conversations',messages:request.messages,
    response_format:{type:'json_schema',json_schema:{name:'property_answer',strict:true,schema:request.response_format.json_schema}},
    temperature:0,max_tokens:160,stream:false};
   const response=await fetcher('https://api.sarvam.ai/v1/chat/completions',{
    method:'POST',headers:{'api-subscription-key':key,'Content-Type':'application/json'},
    body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(3000)});
   if(!response.ok){try{await response.body?.cancel()}catch{}throw Error('sarvam_contextual_unavailable')}
   const raw=JSON.parse(new TextDecoder().decode(await readBoundedBytes(response,65536)));
   const u=raw?.usage;
   if(Number.isSafeInteger(u?.prompt_tokens)&&u.prompt_tokens>=0&&Number.isSafeInteger(u?.completion_tokens)&&u.completion_tokens>=0)
    usage={inputTokens:u.prompt_tokens,outputTokens:u.completion_tokens};
   const c=raw?.choices?.[0];
   if(c?.finish_reason!=='stop'||typeof c.message?.content!=='string'||c.message.content.length>2000)throw Error('invalid_contextual_response');
   return {response:c.message.content};
  }
 };
}
