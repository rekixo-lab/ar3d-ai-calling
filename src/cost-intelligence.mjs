// Super Admin cost intelligence: observation and estimates only, never a wallet debit.
// Currency of a raw Plivo CDR is not inferred from the account or caller location.
import {PRODUCTION_COST_PLAN as p} from './production-cost-plan.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const count=(v,max=1000000000)=>Number.isSafeInteger(v)&&v>=0&&v<=max?v:null;
const cost=(n,rate,unit)=>n===null?null:Math.round(n*rate/unit);
export function costObservation(row,cdr=null){
 let survey={};try{survey=JSON.parse(row.survey_json)}catch{}
 const m=survey?.phoneMeta||{},engine=m.engine||'whisper',connected=count(row.duration_seconds,86400);
 const providerSeconds=cdr?count(cdr.billedSeconds,86400):null;
 const plannedSeconds=providerSeconds??(connected===null?null:Math.ceil(connected/30)*30);
 const audio=engine==='sarvam'?count(m.sttAudioMs):null;
 const knownAudio=audio!==null&&m.sttDurationUnknown===0;
 const rounded=knownAudio&&m.costMeterVersion===1&&m.sttFailedRequests===0?count(m.sttRoundedSeconds,86400):null;
 const stt=engine==='sarvam'&&knownAudio?cost(rounded??audio, p.sarvamPerBilledAudioMinute,rounded===null?60000:60):null;
 const llmRequests=engine==='sarvam'?count(m.llmRequests):null;
 const llm=engine==='sarvam'&&llmRequests!==null&&m.llmUsageUnknown===0?
  llmRequests===0?0:cost(connected,p.llmBudgetPerConnectedMinute,60):null;
 const phone=cost(plannedSeconds,p.plivoPerBilledMinute,60);
 const total=phone!==null&&stt!==null&&llm!==null?phone+stt+llm:null;
 return {id:row.id,jobId:row.job_id??null,scope:row.job_id?'campaign':'internal',startedAt:row.created_at,status:row.phase,engine,connectedSeconds:connected,
  providerCdr:cdr?{reportedAmount:cdr.reportedAmount,billedSeconds:cdr.billedSeconds,currencyStatus:'unverified'}:null,
  plannedBilledSeconds:plannedSeconds,sttAudioMs:audio,sttEstimatedRoundedSeconds:rounded,sttDurationUnknown:count(m.sttDurationUnknown),
  sttFailedRequests:count(m.sttFailedRequests),llmRequests,llmInputTokens:count(m.llmInputTokens),llmOutputTokens:count(m.llmOutputTokens),
  llmUsageUnknown:count(m.llmUsageUnknown),estimatedMicroInr:{plivo:phone,stt,llmBudget:llm,total},
  sttBasis:stt===null?'unavailable':rounded===null?'aggregate_audio_unrounded':'per_request_ceil_model',
  llmBasis:llm===null?'unavailable':llm===0?'no_llm_requests':'budget_allowance_not_token_invoice',
  estimateComplete:total!==null,rateVersion:p.version,clientCharge:null,margin:null,clientCreditsDebited:false};
}
export async function readInternalPlivoCdr(env,row,fetcher){
 const auth=env.PLIVO_AUTH_ID,token=env.PLIVO_AUTH_TOKEN;
 if(typeof auth!=='string'||!/^[A-Za-z0-9]{8,64}$/.test(auth)||typeof token!=='string'||!/^[A-Za-z0-9]{16,128}$/.test(token)||
    row.provider_account_id!==auth||!uuid.test(row.provider_call_id||''))throw Error('provider identity unavailable');
 const res=await fetcher('https://api.plivo.com/v1/Account/'+encodeURIComponent(auth)+'/Call/'+encodeURIComponent(row.provider_call_id)+'/',{
  method:'GET',redirect:'manual',signal:AbortSignal.timeout(5000),headers:{Authorization:'Basic '+btoa(auth+':'+token),Accept:'application/json'}});
 if(!res.ok||!res.headers.get('content-type')?.toLowerCase().includes('json')||Number(res.headers.get('content-length'))>8192)throw Error('CDR unavailable');
 const raw=await res.text();if(raw.length>8192)throw Error('CDR too large');
 const c=JSON.parse(raw),phone=v=>typeof v==='string'?v.replace(/^\+/,''):null;
 if(c.call_uuid!==row.provider_call_id||c.call_direction!=='outbound'||phone(c.from_number)!==phone(row.caller)||phone(c.to_number)!==phone(row.destination)||
    count(c.billed_duration,86400)===null||count(c.call_duration,86400)===null||
    typeof c.total_amount!=='string'||!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,8})?$/.test(c.total_amount))throw Error('CDR mismatch');
 return {reportedAmount:c.total_amount,billedSeconds:c.billed_duration,callSeconds:c.call_duration,currencyStatus:'unverified'};
}
