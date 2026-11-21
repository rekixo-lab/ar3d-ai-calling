// Verified Exotel delivery -> bounded temporary CRM turns -> human-review queue.
// Never uses caller-supplied tenant/lead IDs, starts calls or grants consent.
import {registeredVoiceCallKey} from './shared-voice-gateway.mjs';
import {getExotelOperatorTestStatusReadOnly} from './exotel-readonly-verification.mjs';
import {resolveCrmDb,sha256hex} from './core.mjs';
import {beginFixedVoicePreview,advanceFixedVoicePreview} from './fixed-voice-turns.mjs';
import {stageVerifiedVoicebotReview} from './voicebot-review-service.mjs';

const SID=/^CA[A-Za-z0-9_-]{10,78}$/;
const STOP=/(?:stop calling|do not call|don't call|remove my number|unsubscribe|कॉल मत|फोन मत|दोबारा कॉल मत|नंबर हटा|नम्बर हटा|बात नहीं करनी)/iu;
const need=(v)=>{if(!v)throw Error('voicebot_registered_delivery_unconfirmed')};
const clean=x=>String(x||'').trim();

async function registeredCampaignCall(env,parsed,now){
  const ids=[...new Set([parsed.providerCallSid,parsed.callId].filter(x=>SID.test(x||'')))];
  need(ids.length>0&&parsed.accountId===env.EXOTEL_ACCOUNT_SID);
  const found=[];
  for(const sid of ids){
    const key=await registeredVoiceCallKey(env,sid);
    const route=await env.CONTROL_DB.prepare(
      'SELECT tenant_id,publication_id,job_id,operator_request_id FROM voice_call_routes WHERE call_key=? AND expires_at>?'
    ).bind(key,new Date(now).toISOString()).first();
    if(route)found.push({sid,route});
  }
  need(found.length===1&&found[0].route.job_id&&!found[0].route.operator_request_id);
  const {sid,route}=found[0];
  const tenant=await env.CONTROL_DB.prepare(
    "SELECT id,storage_mode,dedicated_binding,status FROM tenants WHERE id=? AND status='active'"
  ).bind(route.tenant_id).first();
  need(tenant&&tenant.storage_mode==='shared');
  const pub=await env.CONTROL_DB.prepare(
    "SELECT provider_state,provider_bot_id FROM calling_agent_publications WHERE tenant_id=? AND id=?"
  ).bind(tenant.id,route.publication_id).first();
  need(pub?.provider_state==='ready');
  const db=resolveCrmDb(env,tenant);
  const job=await db.prepare(
    "SELECT id,lead_id,provider_call_sid,account_sid,caller_id,destination,flow_id,reserved_at,state FROM calling_jobs WHERE tenant_id=? AND id=? AND state IN('submitted','completed')"
  ).bind(tenant.id,route.job_id).first();
  need(job&&job.provider_call_sid===sid&&job.account_sid===env.EXOTEL_ACCOUNT_SID&&job.reserved_at);
  const publicationBot=pub.provider_bot_id;
  if(parsed.botId)need(parsed.botId===publicationBot);
  const permission=await db.prepare(
    'SELECT 1 AS approved FROM calling_clearances WHERE tenant_id=? AND lead_id=? AND expires_at>? LIMIT 1'
  ).bind(tenant.id,job.lead_id,new Date(now).toISOString()).first();
  need(permission);
  return {tenantId:tenant.id,leadId:job.lead_id,db,job,sid};
}

function turnItems(parsed,kind,now){
  const at=new Date(now).toISOString(),expiry=now+30*86400000;
  if(kind==='session_end')return [{
    eventId:'__session_end__',sequence:0,kind:'session_end',answer:'',optOut:0,at,expiry
  }];
  return parsed.events.map(ev=>{
    const user=ev.segments.filter(s=>s.speaker==='user'||s.speaker==='customer');
    const answer=ev.status==='completed'?clean(user.map(s=>s.text).join(' ')):'';
    need(answer.length<=220);
    const optOut=user.some(s=>STOP.test(s.text))?1:0;
    return {eventId:ev.eventId,sequence:ev.sequence,kind:ev.status,
      answer,optOut,at,expiry};
  });
}

async function persist(db,scope,parsed,items){
  const statements=items.map(t=>db.prepare(
    'INSERT INTO voicebot_verified_turns(tenant_id,call_sid,lead_id,session_id,conversation_id,event_id,sequence,kind,answer_text,possible_opt_out,received_at,expires_at) '+
    'VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,call_sid,event_id) DO NOTHING'
  ).bind(scope.tenantId,scope.sid,scope.leadId,parsed.sessionId,parsed.conversationId,
    t.eventId,t.sequence,t.kind,t.answer,t.optOut,t.at,t.expiry));
  await db.batch(statements);
  for(const t of items){
    const row=await db.prepare(
      'SELECT lead_id,session_id,conversation_id,sequence,kind,answer_text,possible_opt_out FROM voicebot_verified_turns WHERE tenant_id=? AND call_sid=? AND event_id=?'
    ).bind(scope.tenantId,scope.sid,t.eventId).first();
    need(row&&row.lead_id===scope.leadId&&row.session_id===parsed.sessionId&&
      row.conversation_id===parsed.conversationId&&Number(row.sequence)===t.sequence&&
      row.kind===t.kind&&row.answer_text===t.answer&&Number(row.possible_opt_out)===t.optOut);
  }
}

async function maybeStage(env,scope,parsed,now,apiFetch){
  const {db,tenantId,leadId,sid,job}=scope;
  const result=await db.prepare(
    'SELECT session_id,conversation_id,lead_id,sequence,kind,answer_text,possible_opt_out FROM voicebot_verified_turns WHERE tenant_id=? AND call_sid=? ORDER BY sequence'
  ).bind(tenantId,sid).all();
  const rows=result.results||[];
  need(rows.length<=120&&rows.every(x=>x.session_id===parsed.sessionId&&
    x.conversation_id===parsed.conversationId&&x.lead_id===leadId));
  if(!rows.some(r=>r.kind==='session_end'))return {stage:'awaiting_session_end'};
  const optOut=rows.some(r=>Number(r.possible_opt_out)===1);
  const answers=new Map();
  for(const row of rows.filter(r=>r.kind==='completed')){
    if(!row.answer_text)continue;
    const old=answers.get(Number(row.sequence));
    need(old===undefined||old===row.answer_text);
    answers.set(Number(row.sequence),row.answer_text);
  }
  const ordered=[...answers.entries()].sort((a,b)=>a[0]-b[0]);
  if(!optOut&&(ordered.length<6||ordered.length>7||
    ordered.some(([seq],i)=>seq!==i+1)))
    return {stage:'incomplete_answers_pending_review'};
  let survey=null;
  if(!optOut){
    let progress=beginFixedVoicePreview({language:'hi',now});
    for(const [,answer] of ordered){
      if(progress.state.status!=='active')return {stage:'answer_order_needs_review'};
      progress=advanceFixedVoicePreview(progress.state,{transcript:answer,confidence:1,now});
      if(progress.action==='repeat'||progress.action==='human_review')
        return {stage:'ambiguous_answer_needs_review'};
    }
    if(progress.state.status!=='completed')return {stage:'incomplete_answers_pending_review'};
    const a=progress.state.answers;
    survey={propertyType:a.propertyType,location:a.location,area:a.area,size:a.size,
      budgetInr:a.budgetInr,interest:a.interest,visitDate:a.visitDate??null,visitAt:null};
  }
  // One independent provider lookup per completed review, never an outbound dial.
  const provider=await getExotelOperatorTestStatusReadOnly({
    accountSid:env.EXOTEL_ACCOUNT_SID,apiKey:env.EXOTEL_API_KEY,
    apiToken:env.EXOTEL_API_TOKEN,region:env.EXOTEL_REGION
  },{callSid:sid,callerId:job.caller_id,destination:job.destination},{apiFetch});
  need(provider.providerIdentityVerified&&['in-progress','completed'].includes(provider.status));
  const digest=await sha256hex(JSON.stringify([tenantId,leadId,sid,parsed.sessionId,
    parsed.conversationId,optOut,ordered]));
  await stageVerifiedVoicebotReview(db,{
    tenantId,leadId,callReference:sid,accountSid:env.EXOTEL_ACCOUNT_SID,
    deliveryDigest:digest,provisionalSurvey:survey,possibleOptOut:optOut,now,
    attestation:{vendorAuthenticationVerified:true,exotelDetailsLookupVerified:true,
      approvedCallerMatched:true,registeredCallToLeadMatched:true,dataUseAuthorized:true}
  });
  return {stage:'human_review_created'};
}

export async function recordVerifiedVoicebotTurn(env,parsed,kind,{
  now=Date.now(),apiFetch=fetch
}={}){
  need(env.CRM_DB&&env.CONTROL_DB&&Number.isSafeInteger(now)&&now>0);
  if(kind==='transcript'&&parsed.events.length===0)return {stage:'no_customer_turn'};
  need(kind==='transcript'||kind==='session_end');
  const scope=await registeredCampaignCall(env,parsed,now);
  const turns=turnItems(parsed,kind,now);
  await persist(scope.db,scope,parsed,turns);
  return maybeStage(env,scope,parsed,now,apiFetch);
}

export async function pruneVerifiedVoicebotTurns(env,{now=Date.now()}={}){
  need(env.CRM_DB?.prepare&&Number.isSafeInteger(now));
  // Shared Calling CRM only. Never delete human-review or actual lead records.
  const r=await env.CRM_DB.prepare(
    'DELETE FROM voicebot_verified_turns WHERE rowid IN (SELECT rowid FROM voicebot_verified_turns WHERE expires_at<=? ORDER BY expires_at LIMIT 100)'
  ).bind(now).run();
  return Number(r.meta?.changes||0);
}
