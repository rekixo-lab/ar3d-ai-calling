// Bounded, explicitly funded static School TTS. No customer/CRM input or call.
// This envelope must be funded separately from the existing call/STT account.
import {currentSuperAdminMfa,mutationOriginAllowed} from './human-auth.mjs';
import {checkedProductionSchoolSnapshot} from './industry-launch-requests.mjs';
import {schoolVoicePlan,audioSha,buildSchoolAudioPack,validateSchoolAudioPack,readSchoolAudioAsset,validMP3Header,SCHOOL_AUDIO_MAX} from './industry-school-voice-plan.mjs';
import {readBoundedBytes,answerContentType} from './scripted-speech.mjs';
const BASE='/v1/human/school-audio';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const exact=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===k.length&&k.every(x=>Object.hasOwn(o,x));
const ref=x=>typeof x==='string'&&x.trim().length>=10&&x.length<=160&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(x);
const fail=x=>{throw Error(x)};
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(d,status=200)=>Response.json(d,{status,headers});
const error=(code,status=400)=>reply({error:code},status);
const number=(v,min,max)=>typeof v==='string'&&/^\d{1,12}$/.test(v)&&Number(v)>=min&&Number(v)<=max?Number(v):null;
const sessionPredicate="EXISTS(SELECT 1 FROM human_sessions s JOIN human_users u ON u.id=s.user_id JOIN human_mfa_settings m ON m.user_id=u.id WHERE u.id=? AND u.global_role='super_admin' AND u.status='active' AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at)";
const tenantPredicate="EXISTS(SELECT 1 FROM tenants t WHERE t.id=? AND t.status IN('active','trial'))";
const launchPredicate="EXISTS(SELECT 1 FROM industry_launch_requests r WHERE r.tenant_id=? AND r.id=? AND r.snapshot_id=? AND r.graph_sha256=? AND r.state='configuration_reviewed' AND r.purpose='school_admission')";
function budget(env){
 const key=env.AR3D_SCHOOL_TTS_API_KEY,cap=number(env.AR3D_SCHOOL_TTS_BUDGET_MICROS,1,1000000000),rate=number(env.AR3D_SCHOOL_TTS_RATE_MICROS_PER_CHAR,1,100000),reference=env.AR3D_SCHOOL_TTS_FUNDING_REFERENCE;
 if(env.AR3D_SCHOOL_TTS_ENABLED!=='approved'||typeof key!=='string'||!key.trim()||key.length>512||
  key===env.SARVAM_API_KEY||cap===null||rate===null||!ref(reference)||
  typeof env.RECORDINGS?.put!=='function'||typeof env.RECORDINGS?.get!=='function')return null;
 return {key,cap,rate,reference:reference.trim()};
}
async function scopeFor(db,tid,launchId){
 if(!uuid(tid)||!uuid(launchId))fail('school_audio_invalid_scope');
 const r=await db.prepare("SELECT r.* FROM industry_launch_requests r JOIN tenants t ON t.id=r.tenant_id WHERE r.tenant_id=? AND r.id=? AND r.state='configuration_reviewed' AND r.purpose='school_admission' AND t.status IN('active','trial')").bind(tid,launchId).first();
 if(!r)fail('school_audio_scope_unavailable');
 const s=await checkedProductionSchoolSnapshot(db,tid,r.snapshot_id);
 if(s.digest!==r.graph_sha256)fail('school_audio_scope_unavailable');
 const scope={tenantId:tid,snapshotId:r.snapshot_id,graph:s.graph,digest:s.digest},plan=await schoolVoicePlan(scope.graph,scope.digest);
 const chars=plan.spoken.reduce((n,node)=>n+node.text.length,0);
 if(chars<1||chars>2000)fail('school_audio_invalid_scope');
 // Reject obvious identifiers in reviewed static scripts as defense in depth.
 // This is not a comprehensive personal-data or script-content classifier.
 if(plan.spoken.some(n=>/(?:[\d०-९][\s-]?){8}|[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(n.text)))fail('school_audio_private_text');
 return {scope,plan,chars};
}
async function job(db,tid,id){return db.prepare('SELECT * FROM school_audio_preparations WHERE tenant_id=? AND launch_id=?').bind(tid,id).first()}
function packFrom(row){if(!row?.manifest_json||!digest(row.manifest_sha256))fail('school_audio_unavailable');return {manifest:JSON.parse(row.manifest_json),manifestSha256:row.manifest_sha256}}
function view(row,b,scope,now){
 return {state:row?.state??'not_prepared',expired:row?.state==='claimed'&&row.deadline<=now,configured:!!b,
  characters:scope.chars,nodeCount:scope.plan.spoken.length,
  reservedMicros:row?.reserved_micros??null,quoteMicros:b?scope.chars*b.rate:null,
  attemptedNodes:row?.attempted_nodes??0,manifestSha256:row?.manifest_sha256??null,
  nodes:row?.manifest_json?scope.plan.spoken.map(n=>({id:n.id,text:n.text})):[],
  callable:false,dispatchReady:false};
}
async function body(req){
 if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')fail('school_audio_invalid_request');
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBytes(req,4096)))}catch{fail('school_audio_invalid_request')}
}
async function generate(env,tid,id,user,s,b,clock,fetcher){
 const db=env.CONTROL_DB,at=clock(),reserve=s.chars*b.rate,scope=s.scope;
 if(!Number.isSafeInteger(reserve)||reserve<1||reserve>100000000||reserve>b.cap)fail('school_audio_budget_unavailable');
 const claim=await db.prepare("INSERT INTO school_audio_preparations(tenant_id,launch_id,snapshot_id,graph_sha256,char_count,node_count,reserved_micros,rate_micros,funding_reference,claimed_by,claimed_at,deadline) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE "+sessionPredicate+" AND "+tenantPredicate+" AND "+launchPredicate+
  " AND NOT EXISTS(SELECT 1 FROM school_audio_preparations WHERE tenant_id=? AND launch_id=?)"+
  " AND NOT EXISTS(SELECT 1 FROM school_audio_preparations WHERE state='claimed' AND deadline>?)"+
  " AND ?>=?+COALESCE((SELECT SUM(reserved_micros) FROM school_audio_preparations),0)")
  .bind(tid,id,scope.snapshotId,scope.digest,s.chars,s.plan.spoken.length,reserve,b.rate,b.reference,user.id,at,at+120000,
    user.id,user.token_hash,at,tid,tid,id,scope.snapshotId,scope.digest,tid,id,at,b.cap,reserve).run();
 if(claim.meta.changes!==1)fail('school_audio_claim_unavailable');
 try{
  const assets=[],blobs=[];
  for(const node of s.plan.spoken){
   const stamp=clock();
   // Persist an attempted request BEFORE contacting Sarvam. No paid retry.
   const next=await db.prepare("UPDATE school_audio_preparations SET attempted_nodes=attempted_nodes+1 WHERE tenant_id=? AND launch_id=? AND state='claimed' AND claimed_by=? AND deadline>? AND attempted_nodes=? AND "+sessionPredicate+" AND "+tenantPredicate)
    .bind(tid,id,user.id,stamp,assets.length,user.id,user.token_hash,stamp,tid).run();
   if(next.meta.changes!==1)fail('school_audio_claim_unavailable');
   const response=await fetcher('https://api.sarvam.ai/text-to-speech/stream',{
    method:'POST',headers:{'api-subscription-key':b.key,'Content-Type':'application/json','Accept':'audio/mpeg'},
    body:JSON.stringify({text:node.text,language_code:s.plan.language==='en'?'en-IN':'hi-IN',model:'bulbul:v3',speaker:'shubh',output_audio_codec:'mp3',output_audio_bitrate:'64k',speech_sample_rate:22050}),
    redirect:'error',signal:AbortSignal.timeout(15000)
   });
   if(!response.ok||answerContentType(response.headers)!=='audio/mpeg'){try{await response.body?.cancel()}catch{}fail('school_audio_provider_failed')}
   const bytes=await readBoundedBytes(response,SCHOOL_AUDIO_MAX);
   if(!validMP3Header(bytes))fail('school_audio_invalid_mp3');
   assets.push({nodeId:node.id,sha256:await audioSha(bytes),bytes:bytes.length});blobs.push(bytes);
  }
  const pack=await buildSchoolAudioPack(scope,assets);
  for(let i=0;i<pack.manifest.entries.length;i++){
   const entry=pack.manifest.entries[i];
   // Content-addressed objects cannot overwrite another reviewed asset.
   await env.RECORDINGS.put(entry.key,blobs[i],{onlyIf:new Headers({'If-None-Match':'*'}),sha256:entry.sha256,httpMetadata:{contentType:'audio/mpeg',cacheControl:'private, no-store'}});
   await readSchoolAudioAsset(env.RECORDINGS,scope,pack,entry.nodeId);
  }
  const stamp=clock();
  const ready=await db.prepare("UPDATE school_audio_preparations SET state='ready',manifest_json=?,manifest_sha256=? WHERE tenant_id=? AND launch_id=? AND state='claimed' AND attempted_nodes=node_count AND deadline>? AND "+sessionPredicate+" AND "+tenantPredicate)
   .bind(JSON.stringify(pack.manifest),pack.manifestSha256,tid,id,stamp,user.id,user.token_hash,stamp,tid).run();
  if(ready.meta.changes!==1)fail('school_audio_claim_unavailable');
 }catch{
  // A timeout, failed write, unknown carrier charge or crash never returns
  // budget to the pool. Incomplete R2 objects are not usable for dispatch.
  await db.prepare("UPDATE school_audio_preparations SET state='failed' WHERE tenant_id=? AND launch_id=? AND state='claimed'").bind(tid,id).run();
  fail('school_audio_preparation_failed');
 }
}
export async function readApprovedSchoolAudioPack(env,{tenantId,launchId}){
 const s=await scopeFor(env.CONTROL_DB,tenantId,launchId),r=await job(env.CONTROL_DB,tenantId,launchId);
 if(r?.state!=='approved'||r.snapshot_id!==s.scope.snapshotId||r.graph_sha256!==s.scope.digest)fail('school_audio_not_approved');
 const pack=packFrom(r);await validateSchoolAudioPack(s.scope,pack.manifest,pack.manifestSha256);
 for(const node of s.plan.spoken)await readSchoolAudioAsset(env.RECORDINGS,s.scope,pack,node.id);
 return {...pack,snapshotId:r.snapshot_id,graphSha256:r.graph_sha256};
}
export async function handleSchoolAudioPreparation(req,env,user,{now=Date.now(),fetcher=fetch}={}){
 const url=new URL(req.url),m=url.pathname.match(/^\/v1\/human\/school-audio\/([a-f0-9-]{36})(?:\/(prepare|review|audio\/[a-z][a-z0-9_]{0,31}))?$/i);
 if(!url.pathname.startsWith(BASE+'/'))return null;
 if(!m||!uuid(m[1]))return error('school_audio_invalid_scope');
 const op=m[2],get=!op||op.startsWith('audio/');
 if(req.method!==(get?'GET':'POST'))return error('method_not_allowed',405);
 if(!get&&!mutationOriginAllowed(req))return error('same_origin_required',403);
 try{
  const db=env.CONTROL_DB;
  if(!await currentSuperAdminMfa(db,user,now))return error('current_super_admin_mfa_required',403);
  const data=get?{tenantId:url.searchParams.get('tenantId')}:await body(req),tid=data?.tenantId,id=m[1];
  if(!uuid(tid)||get&&([...url.searchParams].length!==1)||!get&&url.search)return error('school_audio_invalid_scope');
  const s=await scopeFor(db,tid,id),b=budget(env),r=await job(db,tid,id);
  if(!op)return reply(view(r,b,s,now));
  if(op.startsWith('audio/')){
   if(!['ready','approved','rejected'].includes(r?.state)||r.snapshot_id!==s.scope.snapshotId||r.graph_sha256!==s.scope.digest)return error('school_audio_unavailable',404);
   const bytes=await readSchoolAudioAsset(env.RECORDINGS,s.scope,packFrom(r),op.slice(6));
   return new Response(bytes,{headers:{...headers,'Content-Type':'audio/mpeg','Content-Length':String(bytes.length)}});
  }
  if(op==='prepare'){
   if(!exact(data,['tenantId','expectedGraphSha256','expectedCostMicros','confirm'])||data.expectedGraphSha256!==s.scope.digest||data.confirm!=='SEPARATELY_FUNDED_STATIC_SCRIPT_ONLY_NO_CALLS')return error('school_audio_invalid_request');
   if(!b)return error('school_audio_not_configured',409);
   if(r||data.expectedCostMicros!==s.chars*b.rate)return error('school_audio_claim_unavailable',409);
   const start=Date.now(),clock=()=>now+Math.max(0,Date.now()-start);
   await generate(env,tid,id,user,s,b,clock,fetcher);
   return reply(view(await job(db,tid,id),b,s,clock()),201);
  }
  if(!exact(data,['tenantId','manifestSha256','decision','reference','acknowledgeListened'])||!digest(data.manifestSha256)||
   !['approved','rejected'].includes(data.decision)||!ref(data.reference)||data.acknowledgeListened!==true)return error('school_audio_invalid_request');
  if(r?.state!=='ready'||r.manifest_sha256!==data.manifestSha256||r.snapshot_id!==s.scope.snapshotId||r.graph_sha256!==s.scope.digest)return error('school_audio_review_conflict',409);
  if(data.decision==='approved'&&r.claimed_by===user.id)return error('school_audio_independent_reviewer_required',403);
  if(data.decision==='approved')for(const node of s.plan.spoken)await readSchoolAudioAsset(env.RECORDINGS,s.scope,packFrom(r),node.id);
  const update=await db.prepare("UPDATE school_audio_preparations SET state=?,reviewed_by=?,reviewed_at=?,review_reference=? WHERE tenant_id=? AND launch_id=? AND state='ready' AND manifest_sha256=? AND "+sessionPredicate+" AND "+tenantPredicate)
   .bind(data.decision,user.id,now,data.reference.trim(),tid,id,data.manifestSha256,user.id,user.token_hash,now,tid).run();
  if(update.meta.changes!==1)return error('school_audio_review_conflict',409);
  return reply(view(await job(db,tid,id),b,s,now));
 }catch(e){
  const code=String(e?.message||'');
  if(['school_audio_invalid_request','school_audio_invalid_scope','school_audio_private_text'].includes(code))return error(code);
  if(['school_audio_scope_unavailable','school_audio_claim_unavailable','school_audio_budget_unavailable','school_snapshot_unavailable','school_production_flow_not_supported'].includes(code))return error(code,409);
  return error('school_audio_unavailable',503);
 }
}
