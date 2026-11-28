// Invoked only by the existing Plivo signature-verified callback.
// A signed keypad response is consent, NOT customer identity. Never record,
// persist or log the dynamic text, and never replay an issued utterance.
import {uuid,requestId,exactNoticeSession,currentNotice,noticeJob} from './industry-notice-common.mjs';
import {retrieveVerifiedIndustryNotice} from './industry-notice-connectors.mjs';
const phases=new Set(['posting','submitted','unknown']);
const clockFrom=now=>{const start=Date.now();return ()=>now+Math.max(0,Date.now()-start)};
const freshRow=(db,id)=>db.prepare('SELECT * FROM scripted_phone_pilots WHERE id=?').bind(id).first();
const norm=s=>String(s||'').replace(/^\+/,'');
function matchesTarget(row,p){return p.get('Direction')==='outbound'&&norm(p.get('To'))===norm(row.destination)&&norm(p.get('From'))===norm(row.caller)}
function noticeMessage(language){
 return language==='hi'?'आपके लिए एक सेवा सूचना है। अधिक जानकारी के लिए अपनी संस्था के आधिकारिक माध्यम का उपयोग करें। धन्यवाद।':'There is a service notification for you. Please use your organisation’s official channel for details. Thank you.';
}
function disclosure(language){
 return language==='hi'?'नमस्ते। यह एक स्वचालित ए आई सेवा सूचना कॉल है। आगे सुनने की सहमति के लिए 1 दबाएँ। भविष्य में ऐसी कॉल रोकने के लिए 2 दबाएँ।':'Hello. This is an automated AI service notification call. Press 1 to consent to hear the notice, or press 2 to opt out of future calls.';
}
export async function handleNoticeVoiceCallback(env,config,original,step,arg,p,{now,end,xml,speak,actionUrl,finishOptOut}){
 const c=env.CONTROL_DB,db=env.CRM_DB,clock=clockFrom(now),call=p.get('CallUUID'),request=p.get('ALegRequestUUID')||p.get('RequestUUID');
 if(arg||!uuid(call)||!original.job_id||!['answer','hangup','notice-consent'].includes(step))return end();
 let row=original,j=await noticeJob(db,row.tenant_id,row.job_id);
 if(!exactNoticeSession(j,row)||!phases.has(j.state))return end();
 // Recover the exact accepted request even when its HTTP response was lost.
 // Never bind an arbitrary signed call to a funded-but-not-posting job.
 if(['answer','hangup'].includes(step)&&!row.provider_request_id&&requestId(request)&&matchesTarget(row,p)){
  await c.prepare("UPDATE scripted_phone_pilots SET provider_request_id=? WHERE id=? AND provider_request_id IS NULL AND provider_call_id IS NULL AND phase IN('requested','unknown') AND hangup_at IS NULL").bind(request,row.id).run();
  row=await freshRow(c,row.id);
 }
 if(!exactNoticeSession(j,row)||!row.provider_request_id||request&&request!==row.provider_request_id)return end();
 if(step==='hangup'){
  if(row.provider_call_id?row.provider_call_id!==call:!matchesTarget(row,p)||request!==row.provider_request_id)return end();
  const raw=p.get('Duration'),duration=/^\d{1,3}$/.test(raw||'')?Number(raw):null;
  await c.prepare("UPDATE scripted_phone_pilots SET hangup_at=COALESCE(hangup_at,?),duration_seconds=COALESCE(duration_seconds,?),provider_call_id=COALESCE(provider_call_id,?),phase=CASE WHEN phase IN('requested','unknown','consent','question','finishing') THEN 'ended' ELSE phase END WHERE id=? AND provider_request_id=? AND (provider_call_id IS NULL OR provider_call_id=?)").bind(now,duration,call,row.id,row.provider_request_id,call).run();
  if(row.phase==='suppressing')await finishOptOut(row,now);
  return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
 }
 if(row.provider_call_id===call&&row.phase==='suppressing')return finishOptOut(row,now);
 // Honor STOP on the bound call even if normal disclosure has been revoked.
 if(step==='notice-consent'&&row.provider_call_id===call&&p.get('Digits')==='2'&&['consent','question','ended','completed','needs_review'].includes(row.phase)){
  const saved=await c.prepare("UPDATE scripted_phone_pilots SET phase='suppressing' WHERE id=? AND provider_call_id=? AND phase=? AND survey_json=?").bind(row.id,call,row.phase,row.survey_json).run();
  if(saved.meta.changes===1)return finishOptOut(row,now);
  return end();
 }
 if(row.hangup_at!==null||row.expires_at<=now)return end();
 const live=async(phase,at)=>{
  const next=await noticeJob(db,j.tenant_id,j.id),s=await freshRow(c,row.id);
  if(!next||!phases.has(next.state)||!exactNoticeSession(next,s)||s.phase!==phase||s.provider_call_id!==call||s.hangup_at!==null)return false;
  return await currentNotice(env,next,at,{hold:true,session:false})&&at<s.expires_at&&at<Date.parse(s.created_at)+115000;
 };
 if(step==='answer'){
  if(!matchesTarget(row,p)||request!==row.provider_request_id||row.provider_call_id||!await currentNotice(env,j,clock(),{hold:true,session:true}))return end();
  const saved=await c.prepare("UPDATE scripted_phone_pilots SET provider_call_id=?,phase='consent' WHERE id=? AND phase IN('requested','unknown') AND provider_call_id IS NULL AND provider_request_id=? AND hangup_at IS NULL AND survey_json=?").bind(call,row.id,row.provider_request_id,row.survey_json).run();
  if(saved.meta.changes!==1)return end();
  return xml('<GetDigits action="'+actionUrl(row.id,'notice-consent')+'" method="GET" numDigits="1" retries="1" timeout="8">'+speak(row.language,disclosure(row.language))+'</GetDigits><Hangup/>');
 }
 if(step!=='notice-consent'||p.get('Digits')!=='1'||row.provider_call_id!==call||row.phase!=='consent'||!await live('consent',clock()))return end();
 // Claim the only disclosure attempt before the connector requests. Replays,
 // opt-out, hangup and authorization loss cannot start another utterance.
 const claim=await c.prepare("UPDATE scripted_phone_pilots SET phase='question' WHERE id=? AND phase='consent' AND provider_call_id=? AND hangup_at IS NULL AND survey_json=?").bind(row.id,call,row.survey_json).run();
 if(claim.meta.changes!==1)return end();
 let text=null,validUntil=Infinity;
 if(j.delivery_mode==='general')text=noticeMessage(row.language);
 else{
  const scope={tenantId:j.tenant_id,leadId:j.lead_id,sessionId:row.id,callUuid:call,templateId:j.template_id,graphSha256:j.graph_sha256,recipientReviewSha256:j.review_sha256,language:j.language};
  const result=await retrieveVerifiedIndustryNotice(env,{scope,now:clock(),assertCurrent:(_s,ts)=>live('question',ts)});
  if(result.ok){text=result.speech;validUntil=result.validUntil}
 }
 const at=clock();
 if(!text||at>=validUntil||!await live('question',at)){
  await c.prepare("UPDATE scripted_phone_pilots SET phase='needs_review' WHERE id=? AND phase='question' AND provider_call_id=? AND hangup_at IS NULL").bind(row.id,call).run();
  return end();
 }
 const issued=await c.prepare("UPDATE scripted_phone_pilots SET phase='completed' WHERE id=? AND phase='question' AND provider_call_id=? AND hangup_at IS NULL AND survey_json=?").bind(row.id,call,row.survey_json).run();
 // 'completed' here means XML issued, not evidence that the customer heard
 // it. The signed hangup and independent CDR remain necessary for billing.
 if(issued.meta.changes!==1||clock()>=validUntil||!await live('completed',clock())||clock()>=validUntil)return end();
 return xml(speak(row.language,text)+'<Hangup/>');
}
