// Tenant-scoped, read-only School result from the exact closed session.
import {currentSuperAdminMfa,requireMembership} from './human-auth.mjs';
import {checkedProductionSchoolSnapshot} from './industry-launch-requests.mjs';
import {schoolVoicePlan,validateSchoolVoiceProgress,SCHOOL_VOICE_MODE} from './industry-school-voice-plan.mjs';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export async function handleIndustryResult(req,env,user,{now=Date.now()}={}){
 const u=new URL(req.url),m=u.pathname.match(/^\/v1\/human\/industry-results\/([a-f0-9-]{36})$/i);
 if(!u.pathname.startsWith('/v1/human/industry-results/'))return null;
 if(!m||!uuid(m[1])||req.method!=='GET'||[...u.searchParams].length!==1||!uuid(u.searchParams.get('tenantId')))return reply({error:'invalid_industry_result_request'},400);
 const tid=u.searchParams.get('tenantId'),id=m[1];
 try{
  if(user?.globalRole==='super_admin'){
   if(!await currentSuperAdminMfa(env.CONTROL_DB,user,now))return reply({error:'forbidden'},403);
  }else{
   const member=await requireMembership(env.CONTROL_DB,user,tid,false);
   if(!member||member.storage_mode!=='shared')return reply({error:'forbidden'},403);
  }
  const j=await env.CRM_DB.prepare("SELECT j.lead_id,j.snapshot_id,j.graph_sha256,j.manifest_sha256,j.review_revision,z.session_id,z.provider_call_uuid,z.hangup_at,z.billed_seconds,c.call_seconds FROM industry_call_jobs j JOIN industry_terminal_closures z ON z.tenant_id=j.tenant_id AND z.job_id=j.id JOIN verified_industry_call_costs c ON c.tenant_id=j.tenant_id AND c.job_id=j.id WHERE j.tenant_id=? AND j.id=? AND j.purpose='school_admission'").bind(tid,id).first();
  if(!j)return reply({error:'industry_result_not_available'},404);
  const row=await env.CONTROL_DB.prepare("SELECT id,phase,survey_json,turn FROM scripted_phone_pilots WHERE tenant_id=? AND job_id=? AND id=? AND lead_id=? AND provider_call_id=? AND hangup_at=? AND phase IN('completed','declined','ended','needs_review')").bind(tid,id,j.session_id,j.lead_id,j.provider_call_uuid,j.hangup_at).first();
  if(!row)return reply({error:'industry_result_not_available'},409);
  const doc=JSON.parse(row.survey_json),v=doc.industryVoice;
  if(doc.phoneMeta?.mode!==SCHOOL_VOICE_MODE||v.snapshotId!==j.snapshot_id||v.graphSha256!==j.graph_sha256||v.manifestSha256!==j.manifest_sha256||v.reviewRevision!==j.review_revision||v.turn!==row.turn)return reply({error:'industry_result_not_available'},409);
  const frozen=await checkedProductionSchoolSnapshot(env.CONTROL_DB,tid,j.snapshot_id),plan=await schoolVoicePlan(frozen.graph,j.graph_sha256);
  validateSchoolVoiceProgress(v,plan);
  const status=v.status==='opted_out'?'opted_out':row.phase==='completed'&&v.status==='completed'?'completed':row.phase==='declined'?'declined':'needs_review';
  return reply({jobId:id,status,connectedSeconds:j.call_seconds,chargedSeconds:j.billed_seconds,
   answers:status==='opted_out'?[]:v.answers.map((a,i)=>({question:plan.questions[i].text,answer:a.value})),
   reviewRequired:status==='needs_review',crmMutated:false});
 }catch{return reply({error:'industry_result_unavailable'},503)}
}
