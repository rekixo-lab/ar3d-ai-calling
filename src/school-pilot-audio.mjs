// Phase 3D: actual Sarvam MP3 + private R2 adapter candidate.
// Server-only, no HTTP route. One atomic claim per MFA-approved permit;
// uncertain provider outcomes are never automatically retried.
import {readBoundedBytes} from './scripted-speech.mjs';
import {buildSchoolAudioManifest,verifySchoolAudioBytes} from './school-pilot-readiness.mjs';
import {pilotSha,requireSchoolPilotMfa,readActiveSchoolPermit} from './school-internal-permits.mjs';

const MAX=1048576;
const fail=x=>{throw Error(x)};
const privateKey=(tenantId,key)=>'school-private/'+tenantId+'/'+key;
function mp3Header(bytes){
 if(bytes.length<8)return false;
 let offset=0;
 if(bytes[0]===73&&bytes[1]===68&&bytes[2]===51){
  if(bytes.length<14||[...bytes.slice(6,10)].some(x=>x>127))return false;
  offset=10+bytes[6]*2097152+bytes[7]*16384+bytes[8]*128+bytes[9]+((bytes[5]&16)?10:0);
 }
 if(offset+4>bytes.length)return false;
 const a=bytes[offset],b=bytes[offset+1],c=bytes[offset+2];
 return a===255&&(b&224)===224&&(b&24)!==8&&(b&6)===2&&(c&240)!==0&&(c&240)!==240&&(c&12)!==12;
}
async function fetchAudio(text,language,key,fetcher){
 const resp=await fetcher('https://api.sarvam.ai/text-to-speech/stream',{
  method:'POST',headers:{'content-type':'application/json','api-subscription-key':key},
  body:JSON.stringify({text,language_code:language==='en'?'en-IN':'hi-IN',model:'bulbul:v3',
   speaker:'shubh',output_audio_codec:'mp3',output_audio_bitrate:'64k',speech_sample_rate:22050}),
  redirect:'manual',signal:AbortSignal.timeout(15000)});
 if(!resp.ok||resp.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='audio/mpeg'){
  try{await resp.body?.cancel()}catch{}fail('school_tts_failed');
 }
 const bytes=await readBoundedBytes(resp,MAX);
 if(!mp3Header(bytes))fail('school_invalid_mp3_header');
 return bytes;
}
async function readObject(bucket,key,size){
 const obj=await bucket.get(key);
 if(!obj||obj.size!==size||!obj.body||obj.httpMetadata?.contentType!=='audio/mpeg')fail('school_audio_object_unavailable');
 return readBoundedBytes({headers:new Headers({'content-length':String(obj.size)}),body:obj.body},MAX);
}
export async function generateSchoolPilotAudio(env,user,{tenantId,permitId},{clock=Date.now,fetcher=fetch}={}){
 const db=env.CONTROL_DB,now=clock();
 await requireSchoolPilotMfa(db,user,now);
 const bucket=env.SCHOOL_PILOT_AUDIO,key=env.SARVAM_API_KEY;
 if(env.AR3D_SCHOOL_PILOT_AUDIO_ENABLED!=='approved'||!bucket?.put||!bucket?.get||
  typeof key!=='string'||!key.trim()||key.length>512)fail('school_audio_disabled_or_unconfigured');
 const initial=await readActiveSchoolPermit(env,tenantId,permitId,now);
 if(initial.row.approved_by!==user.id)fail('school_audio_approver_required');
 const claim=await db.prepare("UPDATE school_internal_pilot_permits SET audio_state='claimed' WHERE id=? AND tenant_id=? AND audio_state='pending' AND stopped_at IS NULL AND expires_at>?").bind(permitId,tenantId,now).run();
 if(claim.meta.changes!==1)fail('school_audio_already_claimed');
 try{
  const check=async()=>{
   if(env.AR3D_SCHOOL_PILOT_AUDIO_ENABLED!=='approved')fail('school_audio_disabled_or_unconfigured');
   const current=await readActiveSchoolPermit(env,tenantId,permitId,clock());
   if(current.row.audio_state!=='claimed')fail('school_audio_claim_lost');
  };
  const nodes=initial.graph.nodes.filter(n=>typeof n.text==='string');
  const total=nodes.reduce((a,n)=>a+Array.from(n.text).length,0);
  if(total>initial.row.max_audio_chars||nodes.length>14)fail('school_pilot_audio_budget_exceeded');
  const audio=[];
  for(const n of nodes){
   await check();
   const bytes=await fetchAudio(n.text,initial.graph.language,key,fetcher);
   audio.push({nodeId:n.id,bytes,audioSha256:await pilotSha(bytes)});
  }
  const {manifest,manifestSha256}=await buildSchoolAudioManifest({graphJson:initial.graphJson,
   graphSha256:initial.graphSha256,assets:audio.map(a=>({nodeId:a.nodeId,audioSha256:a.audioSha256,bytes:a.bytes.length}))});
  for(const a of audio){
   await check();
   const verified=await verifySchoolAudioBytes({graphJson:initial.graphJson,graphSha256:initial.graphSha256,
    manifest,expectedManifestSha256:manifestSha256,nodeId:a.nodeId,bytes:a.bytes});
   const objectKey=privateKey(tenantId,verified.key);
   // Atomic create-only. Existing content-addressed object must still pass byte verification.
   await bucket.put(objectKey,a.bytes,{onlyIf:new Headers({'If-None-Match':'*'}),
    sha256:a.audioSha256,httpMetadata:{contentType:'audio/mpeg',cacheControl:'private, no-store'}});
   const actual=await readObject(bucket,objectKey,a.bytes.length);
   await verifySchoolAudioBytes({graphJson:initial.graphJson,graphSha256:initial.graphSha256,
    manifest,expectedManifestSha256:manifestSha256,nodeId:a.nodeId,bytes:actual});
  }
  await check();
  const saved=await db.prepare("UPDATE school_internal_pilot_permits SET audio_state='ready',manifest_json=?,manifest_sha256=? WHERE id=? AND tenant_id=? AND audio_state='claimed' AND stopped_at IS NULL AND expires_at>?")
   .bind(JSON.stringify(manifest),manifestSha256,permitId,tenantId,clock()).run();
  if(saved.meta.changes!==1)fail('school_audio_claim_lost');
  return {prepared:true,assetCount:audio.length,manifestSha256,characterCount:total,liveCall:false};
 }catch{
  await db.prepare("UPDATE school_internal_pilot_permits SET audio_state='failed' WHERE id=? AND tenant_id=? AND audio_state='claimed'").bind(permitId,tenantId).run();
  fail('school_audio_preparation_failed_no_auto_retry');
 }
}
