/**
 * Ensure only the dedicated AR3D WhatsApp tick queue exists, after the workflow's
 * account/D1 identity preflight. Wrangler separately attaches this Worker's
 * producer and consumer. This script never changes plans, consumers, producers,
 * queue settings, or any other queue, and never prints Cloudflare response bodies.
 * API: https://developers.cloudflare.com/api/resources/queues/methods/list/
 *      https://developers.cloudflare.com/api/resources/queues/methods/create/
 *      https://developers.cloudflare.com/api/resources/queues/methods/get/
 */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {getCredentials} from './main-cloudflare.mjs';

export const WHATSAPP_QUEUE_NAME='ar3d-calling-whatsapp';
export const CALLING_WORKER_NAME='ar3d-ai-calling';
const API='https://api.cloudflare.com/client/v4';
const ID=/^[a-f0-9]{32}$/i;
const PAGE_SIZE=500,MAX_PAGES=21,MAX_RESPONSE_BYTES=5*1024*1024;

class QueueEnsureError extends Error {
 constructor(message,{status=0,kind='validation'}={}){super(message);this.name='QueueEnsureError';this.status=status;this.kind=kind;}
}
const stop=message=>{throw new QueueEnsureError(message)};
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fieldType=value=>value===undefined?'missing':value===null?'null':Array.isArray(value)?'array('+value.length+')':typeof value;
function requestDiagnostic(stage,status,data,{parsed=true}={}){
 // Never interpolate provider strings, URLs, identifiers, error messages, or
 // body contents. Only fixed stage labels, JSON types, booleans and bounded
 // numeric error codes may reach deployment logs.
 const codes=[];
 if(record(data)&&Array.isArray(data.errors)){
  for(const error of data.errors.slice(0,10))
   if(record(error)&&Number.isSafeInteger(error.code)&&error.code>=1000&&error.code<=99999999&&!codes.includes(error.code))codes.push(error.code);
 }
 const success=record(data)&&typeof data.success==='boolean'?'boolean('+data.success+')':fieldType(record(data)?data.success:undefined);
 return ' [stage='+stage+'; HTTP='+status+'; envelope='+(parsed?fieldType(data):'unparsed')+
  '; success='+success+'; result='+fieldType(record(data)?data.result:undefined)+
  '; errors='+fieldType(record(data)?data.errors:undefined)+'; cf_codes='+(codes.length?codes.join(','):'none')+']';
}
function checkedCredentials(value){
 if(!record(value))stop('Cloudflare queue credentials are missing.');
 return getCredentials({CLOUDFLARE_API_TOKEN:value.token,CLOUDFLARE_ACCOUNT_ID:value.account,CONTROL_DB_ID:value.control,CRM_DB_ID:value.crm});
}
function relationshipList(queue,field){
 const count=queue[field+'_total_count'];
 const entries=(queue[field]===undefined||queue[field]===null)&&count===0?[]:queue[field];
 if(!Array.isArray(entries)||!Number.isSafeInteger(count)||count<0||count!==entries.length)
  stop('WhatsApp queue ownership metadata is incomplete; deployment was stopped.');
 return entries;
}
/** Pure, fail-closed validation of the queue detail returned by Cloudflare. */
export function validateWhatsAppQueue(queue,{expectedId}={}){
 if(!record(queue)||queue.queue_name!==WHATSAPP_QUEUE_NAME||!ID.test(queue.queue_id||'')||
  expectedId!==undefined&&queue.queue_id!==expectedId)
  stop('Cloudflare returned a different or invalid WhatsApp queue; deployment was stopped.');
 const consumers=relationshipList(queue,'consumers'),producers=relationshipList(queue,'producers');
 for(const consumer of consumers){
  if(!record(consumer)||consumer.type!=='worker'||consumer.script_name!==CALLING_WORKER_NAME||
   consumer.queue_name!==undefined&&consumer.queue_name!==WHATSAPP_QUEUE_NAME||
   consumer.dead_letter_queue!==undefined&&consumer.dead_letter_queue!==null&&consumer.dead_letter_queue!=='')
   stop('WhatsApp queue has an unexpected consumer or dead-letter destination; deployment was stopped.');
 }
 for(const producer of producers){
  if(!record(producer)||producer.type!=='worker'||producer.script!==CALLING_WORKER_NAME)
   stop('WhatsApp queue has an unexpected producer; deployment was stopped.');
 }
 if(queue.settings!==undefined&&(!record(queue.settings)||queue.settings.delivery_paused===true||
  queue.settings.delivery_delay!==undefined&&queue.settings.delivery_delay!==0))
  stop('WhatsApp queue delivery settings require review; no queue settings were changed.');
 return {queueId:queue.queue_id,queueName:WHATSAPP_QUEUE_NAME,consumerCount:consumers.length,producerCount:producers.length};
}
async function responseJson(response){
 const length=response.headers?.get('content-length');
 if(length!==null&&length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MAX_RESPONSE_BYTES))
  throw new QueueEnsureError('Cloudflare queue response was invalid or too large.',{kind:'response'});
 const reader=response.body?.getReader();
 if(!reader)throw new QueueEnsureError('Cloudflare queue response was empty.',{kind:'response'});
 const decoder=new TextDecoder('utf-8',{fatal:true});let raw='',size=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
   if(size>MAX_RESPONSE_BYTES){await reader.cancel();throw new Error('bounded response')}
   raw+=decoder.decode(value,{stream:true});}
  raw+=decoder.decode();return JSON.parse(raw);
 }catch{throw new QueueEnsureError('Cloudflare queue response was invalid or too large.',{kind:'response'});}
 finally{reader.releaseLock()}
}
async function request(credentials,path,{fetcher,method='GET',body,stage}={}){
 if(!/^(list-page-(?:[1-9]|1[0-9]|2[01])|create|detail)$/.test(stage||''))stop('Cloudflare queue request stage is invalid.');
 let response;
 try{
  response=await fetcher(API+'/accounts/'+credentials.account+'/queues'+path,{
   method,redirect:'error',signal:AbortSignal.timeout(20000),
   headers:{Authorization:'Bearer '+credentials.token,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{})
  });
 }catch{throw new QueueEnsureError('Cloudflare queue request did not complete; no automatic write retry was attempted.'+requestDiagnostic(stage,0,undefined,{parsed:false}),{kind:'transport'});}
 let data,parseError;
 try{data=await responseJson(response)}catch(error){parseError=error}
 const diagnostic=requestDiagnostic(stage,response.status,data,{parsed:!parseError});
 if(!response.ok){
  if(response.status===401||response.status===403)
   throw new QueueEnsureError('Cloudflare queue access was denied. The deployment token needs Queues Read/Write or Workers Scripts permissions; no plan or permission was changed.'+diagnostic,{status:response.status,kind:'permission'});
  throw new QueueEnsureError('Cloudflare queue request failed; deployment was stopped.'+diagnostic,{status:response.status,kind:'http'});
 }
 if(parseError)throw new QueueEnsureError('Cloudflare queue response was invalid or too large.'+diagnostic,{status:response.status,kind:'response'});
 // All three Queues API schemas declare success as optional true. An omitted
 // flag is valid only with a successful HTTP status and the operation's result
 // shape; explicit false/null/nonboolean values still fail closed. Cloudflare
 // also uses null for an empty errors collection. Exact identity, pagination
 // and relationship validation remain mandatory below.
 if(!record(data)||data.success!==undefined&&data.success!==true||
  data.errors!==undefined&&data.errors!==null&&(!Array.isArray(data.errors)||data.errors.length)||
  (stage.startsWith('list-page-')?!Array.isArray(data.result):!record(data.result)))
  throw new QueueEnsureError('Cloudflare did not confirm the queue request; deployment was stopped.'+diagnostic,{status:response.status,kind:'response'});
 return data;
}
/** Uses the documented page/per_page parameters; there is no name filter. */
export async function findWhatsAppQueue(credentials,{fetcher=fetch}={}){
 const checked=checkedCredentials(credentials);let found=null;
 const seen=new Set();
 for(let page=1;page<=MAX_PAGES;page++){
  const data=await request(checked,'?'+new URLSearchParams({page:String(page),per_page:String(PAGE_SIZE)}),{fetcher,stage:'list-page-'+page});
  if(!Array.isArray(data.result)||data.result.length>PAGE_SIZE)stop('Cloudflare queue listing was incomplete or invalid; deployment was stopped.');
  const info=data.result_info;
  if(info!==undefined&&!record(info)||info?.page!==undefined&&info.page!==page||
   info?.total_pages!==undefined&&(!Number.isSafeInteger(info.total_pages)||info.total_pages<0||info.total_pages>MAX_PAGES)||
   info?.per_page!==undefined&&(!Number.isSafeInteger(info.per_page)||info.per_page<1||info.per_page>PAGE_SIZE))
   stop('Cloudflare queue pagination could not be verified; deployment was stopped.');
  const actualPageSize=info?.per_page??PAGE_SIZE;
  if(data.result.length>actualPageSize)stop('Cloudflare queue listing exceeded its declared page size; deployment was stopped.');
  for(const queue of data.result){
   if(!record(queue)||typeof queue.queue_name!=='string'||!ID.test(queue.queue_id||''))stop('Cloudflare queue listing was invalid; deployment was stopped.');
   if(seen.has(queue.queue_id))stop('Cloudflare queue listing repeated a resource; deployment was stopped.');seen.add(queue.queue_id);
   if(queue.queue_name===WHATSAPP_QUEUE_NAME){
    if(found)stop('More than one queue matched the WhatsApp name; deployment was stopped.');found={queue_id:queue.queue_id,queue_name:queue.queue_name};
   }
  }
  const last=info?.total_pages!==undefined?page>=Math.max(1,info.total_pages):data.result.length<actualPageSize;
  if(last)return found;
  if(!data.result.length)stop('Cloudflare queue pagination ended unexpectedly; deployment was stopped.');
 }
 stop('Cloudflare queue listing exceeded the bounded account inventory; deployment was stopped.');
}
async function detail(credentials,queue,{fetcher}){
 const data=await request(credentials,'/'+queue.queue_id,{fetcher,stage:'detail'});
 return validateWhatsAppQueue(data.result,{expectedId:queue.queue_id});
}
/** The only write is POST /queues with this one fixed queue_name. */
export async function ensureWhatsAppQueue(credentials,{fetcher=fetch}={}){
 const checked=checkedCredentials(credentials);
 const existing=await findWhatsAppQueue(checked,{fetcher});
 if(existing)return {...await detail(checked,existing,{fetcher}),created:false,reconciled:false};
 let created;
 try{created=await request(checked,'',{fetcher,method:'POST',body:{queue_name:WHATSAPP_QUEUE_NAME},stage:'create'});}
 catch(error){
  // Concurrent creation or a lost acknowledgement can be resolved with reads.
  // Never repeat the POST, and never reinterpret an access denial as absence.
  if(error instanceof QueueEnsureError&&(error.status===409||error.status>=500||['transport','response'].includes(error.kind))){
   const observed=await findWhatsAppQueue(checked,{fetcher});
   if(observed)return {...await detail(checked,observed,{fetcher}),created:false,reconciled:true};
  }
  throw error;
 }
 if(!record(created.result)||created.result.queue_name!==WHATSAPP_QUEUE_NAME||!ID.test(created.result.queue_id||''))
  stop('Cloudflare did not return the requested queue identity; no additional changes were attempted.');
 return {...await detail(checked,created.result,{fetcher}),created:true,reconciled:false};
}
export async function runEnsureWhatsAppQueueCli(environment=process.env,{fetcher=fetch,log=console.log,error=console.error}={}){
 try{
  const result=await ensureWhatsAppQueue(getCredentials(environment),{fetcher});
  log('WhatsApp queue ready: '+WHATSAPP_QUEUE_NAME+' ('+(result.created?'created':result.reconciled?'verified after creation response':'existing')+').');
  return 0;
 }catch(e){
  const message=e instanceof QueueEnsureError?e.message:'Cloudflare queue setup could not be verified. Check the deployment credentials and identity preflight.';
  error('WhatsApp queue setup stopped: '+message);return 1;
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
 process.exitCode=await runEnsureWhatsAppQueueCli();
