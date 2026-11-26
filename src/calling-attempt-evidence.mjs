// Saved, tenant-scoped evidence only. Reading a report never contacts a provider,
// releases a reservation, retries a call or returns provider/recording identifiers.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const JOB=/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const phases=new Set(['requested','consent','question','transcribing','finishing','suppressing','completed','declined','needs_review','ended','unknown','rejected']);
const outcomes=new Set(['recording_id_missing','recording_fetch_failed','recording_type_invalid','recording_body_invalid','recognized','speech_empty','speech_service_failed','speech_unrecognized']);
const count=(value,max=1000000000)=>Number.isSafeInteger(value)&&value>=0&&value<=max?value:null;
function timestamp(value){
 const time=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
 return Number.isFinite(time)&&time>=0&&time<=8640000000000000?new Date(time).toISOString():null;
}
function audioOutcome(value){
 return typeof value==='string'&&(outcomes.has(value)||/^recording_http_[1-5]\d\d$/.test(value))?value:null;
}
function evidence(row){
 const audioBytes=count(row?.audioBytes),audioMs=count(row?.audioMs),sttAudioMs=count(row?.sttAudioMs);
 return {
  sessionPresent:row?.sessionPresent===1,sessionPhase:phases.has(row?.phase)?row.phase:null,
  sessionCreatedAt:timestamp(row?.createdAt),
  // A saved request reference proves acceptance was observed, not ringing or answer.
  // Its absence cannot prove that a timed-out provider request was not accepted.
  requestAccepted:row?.requestAccepted===1,signedHangup:row?.hangupAt!=null,
  hangupAt:timestamp(row?.hangupAt),durationSeconds:count(row?.durationSeconds,86400),
  audioReceived:(audioBytes??0)>0||(sttAudioMs??0)>0,audioBytes,audioMs,sttAudioMs,
  sttFailedRequests:count(row?.sttFailedRequests),lastAudioOutcome:audioOutcome(row?.lastAudioOutcome),
  reservationState:['held','released','settled'].includes(row?.reservationState)?row.reservationState:null,
  reservedSeconds:count(row?.reservedSeconds,86400),chargedSeconds:count(row?.chargedSeconds,86400),
  // The scripted flow processes short answer recordings without saving playback
  // in this application. This says nothing about media retained at the provider.
  playbackAvailable:false
 };
}

export async function readCallingAttemptEvidence(control,tenantId,jobIds){
 if(!UUID.test(tenantId||'')||!Array.isArray(jobIds)||jobIds.length>200||jobIds.some(id=>!JOB.test(id||'')))
  throw Error('invalid call evidence selection');
 const ids=[...new Set(jobIds)],byJob=new Map();
 const audioFields=['audioBytes','audioMs','sttAudioMs','sttFailedRequests','lastAudioOutcome']
  .map(key=>`CASE WHEN json_valid(p.survey_json) THEN json_extract(p.survey_json,'$.phoneMeta.${key}') END AS ${key}`).join(',');
 // D1 has a bounded parameter count; two tenant bindings plus at most 90 jobs.
 // Start from requested jobs so a held reservation without a session is visible.
 for(let start=0;start<ids.length;start+=90){
  const page=ids.slice(start,start+90);
  const rows=await control.prepare(`WITH wanted(jobId) AS (VALUES ${page.map(()=>'(?)').join(',')})
   SELECT w.jobId,p.id IS NOT NULL AS sessionPresent,p.phase,p.created_at AS createdAt,
   p.provider_request_id IS NOT NULL AS requestAccepted,p.hangup_at AS hangupAt,p.duration_seconds AS durationSeconds,${audioFields},
   h.state AS reservationState,h.reserved_seconds AS reservedSeconds,h.charged_seconds AS chargedSeconds
   FROM wanted w LEFT JOIN scripted_phone_pilots p ON p.tenant_id=? AND p.job_id=w.jobId
   LEFT JOIN tenant_minute_holds h ON h.tenant_id=? AND h.job_id=w.jobId`)
   .bind(...page,tenantId,tenantId).all();
  for(const row of rows.results)byJob.set(row.jobId,evidence(row));
 }
 return new Map(ids.map(id=>[id,byJob.get(id)??evidence(null)]));
}
