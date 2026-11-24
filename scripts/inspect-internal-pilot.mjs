// Read-only diagnostic of the latest AR3D Internal pilot only. Never print IDs,
// destinations, survey contents, credentials, or raw provider/Cloudflare errors.
import {readFileSync} from 'node:fs';
import {getCredentials,inspectCloudflare,verifiedSchemaState} from './main-cloudflare.mjs';
async function run(){
 const c=getCredentials(process.env);
 const template=JSON.parse(readFileSync('wrangler.example.jsonc','utf8'));
 const {modes}=await inspectCloudflare({credentials:c,mode:'ready',template});
 if(verifiedSchemaState(modes)!=='ready')throw Error('schema not ready');
 const base='https://api.cloudflare.com/client/v4/accounts/'+c.account+'/d1/database/';
 const headers={Authorization:'Bearer '+c.token,'Content-Type':'application/json'};
 async function select(db,sql,params=[]){
  const res=await fetch(base+db+'/query',{method:'POST',headers,redirect:'error',
   body:JSON.stringify({sql,params})});
  const d=await res.json();
  if(!res.ok||d.success!==true||d.result?.[0]?.success!==true||!Array.isArray(d.result[0].results))
   throw Error('query failed');
  return d.result[0].results;
 }
 const rows=await select(c.control,`SELECT p.id,p.tenant_id,p.lead_id,p.destination,p.phase,p.turn,
  p.language,p.duration_seconds,p.hangup_at IS NOT NULL AS signed_hangup,
  CASE WHEN json_valid(p.survey_json) THEN json_extract(p.survey_json,'$.attempts') END AS attempts,
  CASE WHEN json_valid(p.survey_json) THEN json_extract(p.survey_json,'$.index') END AS question_index,
  CASE WHEN json_valid(p.survey_json) THEN json_extract(p.survey_json,'$.phoneMeta.lastAudioOutcome') END AS audio_outcome,
  CASE WHEN json_valid(p.survey_json) THEN json_extract(p.survey_json,'$.phoneMeta.audioMs') END AS audio_ms,
  CASE WHEN json_valid(p.survey_json) THEN json_extract(p.survey_json,'$.phoneMeta.sttConnected') END AS stt_connected,
  CASE WHEN json_valid(p.survey_json) THEN json_extract(p.survey_json,'$.phoneMeta.engine') END AS engine,
  p.provider_call_id IS NOT NULL AS signed_call_reference,
  p.provider_request_id IS NOT NULL AS request_reference
  FROM scripted_phone_pilots p JOIN tenants t ON t.id=p.tenant_id
  WHERE p.job_id IS NULL AND t.display_name='AR3D Internal' AND t.storage_mode='shared'
  ORDER BY p.created_at DESC LIMIT 1`);
 if(!rows.length){console.log('Internal pilot diagnostic: no matching test record');return}
 const p=rows[0],uuid=/^[0-9a-f-]{36}$/i;
 if(![p.id,p.tenant_id,p.lead_id].every(x=>uuid.test(x||''))||!/^[+]91[6-9][0-9]{9}$/.test(p.destination||''))throw Error('invalid internal reference');
 const [crm]=await select(c.crm,`SELECT COUNT(*) AS matched,
  COALESCE(MAX(CASE WHEN json_valid(requirements_json) THEN json_extract(requirements_json,'$.scriptedCallPilot.id')=? ELSE 0 END),0) AS survey_saved
  FROM leads WHERE tenant_id=? AND id=? AND mobile_e164=?`,[p.id,p.tenant_id,p.lead_id,p.destination]);
 const [audit]=await select(c.crm,`SELECT COUNT(*) AS saved FROM crm_audit_events
  WHERE tenant_id=? AND target_id=? AND action='lead.scripted_phone_pilot_saved'`,[p.tenant_id,p.lead_id]);
 const phases=['requested','consent','question','transcribing','finishing','suppressing','completed','declined','needs_review','ended','unknown','rejected'];
 console.log('Internal pilot diagnostic: '+JSON.stringify({
  phase:phases.includes(p.phase)?p.phase:'unknown',
  language:['hi','en'].includes(p.language)?p.language:'unknown',
  processedTurns:Number.isSafeInteger(p.turn)?p.turn:null,
  attempts:Number.isSafeInteger(p.attempts)?p.attempts:null,
  questionIndex:Number.isSafeInteger(p.question_index)?p.question_index:null,
  engine:p.engine==='sarvam'?'sarvam':'historical',
  audioOutcome:typeof p.audio_outcome==='string'&&/^(recognized|speech_empty|speech_unrecognized|speech_service_failed|recording_(id_missing|fetch_failed|type_invalid|body_invalid|http_(?:[0-9]{3}|unknown)))$/.test(p.audio_outcome)?p.audio_outcome:null,
  audioMs:Number.isSafeInteger(p.audio_ms)?p.audio_ms:null,
  sttConnected:p.stt_connected==null?null:p.stt_connected===1,
  durationSeconds:Number.isSafeInteger(p.duration_seconds)?p.duration_seconds:null,
  signedHangup:p.signed_hangup===1,providerCallReference:p.signed_call_reference===1,
  providerRequestReference:p.request_reference===1,crmLeadMatched:crm?.matched===1,
  thisSurveySaved:crm?.survey_saved===1,hasPriorSaveAudit:Number(audit?.saved)>0
 }));
}
run().catch(()=>{console.error('Internal pilot diagnostic unavailable; no identifiers or credentials logged.');process.exitCode=1});
