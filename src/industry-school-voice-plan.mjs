// Production School voice plan: frozen graph + exact content-addressed MP3 pack.
// No provider request, call submission, credit mutation or storage write.
import {validateFlowGraph} from './call-flow-dsl.mjs';
import {INDUSTRY_TEMPLATES} from './industry-template-catalog.mjs';
import {sha256hex} from './core.mjs';
import {readBoundedBytes} from './scripted-speech.mjs';
export const SCHOOL_VOICE_MODE='industry_school_v1';
export const SCHOOL_FLOW_ID='ar3d-industry-school-v1';
export const SCHOOL_AUDIO_MAX=524288;
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const fail=x=>{throw Error(x)};
const bad=/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
export async function audioSha(bytes){
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>SCHOOL_AUDIO_MAX)fail('school_audio_size');
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function schoolVoicePlan(graph,graphDigest){
 validateFlowGraph(graph);
 if(graph.templateId!=='school_admission_v1'||graph.industry!=='school'||graph.mode!=='interactive'||graph.regulated||graph.callable!==false||
  !digest(graphDigest)||await sha256hex('ar3d:offline-flow:v1:'+JSON.stringify(graph))!==graphDigest)fail('school_voice_graph_invalid');
 const nodes=graph.nodes,questions=nodes.slice(1,-2);
 if(questions.length<1||questions.length>3||nodes[0].type!=='greeting'||nodes.at(-2).type!=='speak_static'||nodes.at(-1).type!=='end_call'||
  questions.some((n,i)=>n.type!=='ask_text_bounded'||n.field!=='answer_'+(i+1))||
  nodes.slice(0,-1).some((n,i)=>n.next!==nodes[i+1].id))fail('school_voice_graph_unsupported');
 return {language:graph.language==='en'?'en':'hi',greeting:nodes[0],questions,closing:nodes.at(-2),spoken:nodes.slice(0,-1)};
}
function audioKey(tid,snapshot,graph,node,hash){return 'industry-voice/v1/'+tid+'/'+snapshot+'/'+graph+'/'+node+'/'+hash+'.mp3'}
/** Pack is an exact, canonical manifest of approved audio bytes. Not a TTS job.
 * A future funded preparation job may write these objects to existing RECORDINGS.
 */
export async function buildSchoolAudioPack(scope,assets){
 if(!uuid(scope?.tenantId)||!uuid(scope.snapshotId)||!Array.isArray(assets))fail('school_audio_scope');
 const plan=await schoolVoicePlan(scope.graph,scope.digest);
 if(assets.length!==plan.spoken.length||new Set(assets.map(a=>a?.nodeId)).size!==assets.length)fail('school_audio_pack_incomplete');
 const entries=[];
 for(const node of plan.spoken){
  const a=assets.find(x=>x?.nodeId===node.id);
  if(!exact(a,['nodeId','sha256','bytes'])||!digest(a.sha256)||!Number.isSafeInteger(a.bytes)||a.bytes<4||a.bytes>SCHOOL_AUDIO_MAX)fail('school_audio_pack_invalid');
  entries.push({nodeId:node.id,textSha256:await sha256hex(node.text),sha256:a.sha256,bytes:a.bytes,
   key:audioKey(scope.tenantId,scope.snapshotId,scope.digest,node.id,a.sha256)});
 }
 const manifest={version:1,tenantId:scope.tenantId,snapshotId:scope.snapshotId,graphSha256:scope.digest,entries};
 return {manifest,manifestSha256:await sha256hex('ar3d:industry-audio-pack:v1:'+JSON.stringify(manifest))};
}
export async function validateSchoolAudioPack(scope,manifest,manifestSha256){
 if(!exact(manifest,['version','tenantId','snapshotId','graphSha256','entries'])||manifest.version!==1||
  manifest.tenantId!==scope.tenantId||manifest.snapshotId!==scope.snapshotId||manifest.graphSha256!==scope.digest||
  !Array.isArray(manifest.entries)||!digest(manifestSha256))fail('school_audio_pack_invalid');
 const expected=await buildSchoolAudioPack(scope,manifest.entries.map(e=>({nodeId:e.nodeId,sha256:e.sha256,bytes:e.bytes})));
 if(JSON.stringify(expected.manifest)!==JSON.stringify(manifest)||expected.manifestSha256!==manifestSha256)fail('school_audio_pack_integrity');
 return expected.manifest;
}
export function validMP3Header(bytes){
 let offset=0;
 if(bytes[0]===73&&bytes[1]===68&&bytes[2]===51){
  if(bytes.length<14||Array.from(bytes.slice(6,10)).some(n=>n>127))return false;
  offset=10+bytes[6]*2097152+bytes[7]*16384+bytes[8]*128+bytes[9]+((bytes[5]&16)?10:0);
 }
 if(offset+4>bytes.length)return false;
 const a=bytes[offset],b=bytes[offset+1],c=bytes[offset+2];
 return a===255&&(b&224)===224&&(b&24)!==8&&(b&6)===2&&(c&240)!==0&&(c&240)!==240&&(c&12)!==12;
}
export async function readSchoolAudioAsset(bucket,scope,pack,nodeId){
 const manifest=await validateSchoolAudioPack(scope,pack.manifest,pack.manifestSha256);
 const entry=manifest.entries.find(e=>e.nodeId===nodeId);
 if(!entry||typeof bucket?.get!=='function')fail('school_audio_asset_missing');
 const obj=await bucket.get(entry.key);
 if(!obj?.body||obj.size!==entry.bytes||obj.httpMetadata?.contentType!=='audio/mpeg')fail('school_audio_asset_missing');
 const bytes=await readBoundedBytes({headers:new Headers({'content-length':String(obj.size)}),body:obj.body},SCHOOL_AUDIO_MAX);
 if(bytes.length!==entry.bytes||!validMP3Header(bytes)||await audioSha(bytes)!==entry.sha256)fail('school_audio_asset_integrity');
 return bytes;
}
export async function beginSchoolVoiceSession(scope,pack){
 const plan=await schoolVoicePlan(scope.graph,scope.digest);
 await validateSchoolAudioPack(scope,pack.manifest,pack.manifestSha256);
 if(scope.purpose!=='school_admission'||!uuid(scope.campaignId)||!uuid(scope.leadId)||
  !Number.isSafeInteger(scope.reviewRevision)||scope.reviewRevision<1||!Number.isFinite(Date.parse(scope.expiresAt)))fail('school_voice_scope');
 return {industryVoice:{version:1,campaignId:scope.campaignId,snapshotId:scope.snapshotId,graphSha256:scope.digest,
  reviewRevision:scope.reviewRevision,reviewExpiresAt:scope.expiresAt,manifest:pack.manifest,manifestSha256:pack.manifestSha256,
  index:0,attempt:0,turn:0,status:'active',answers:[],recordings:[],language:plan.language},
  phoneMeta:{mode:SCHOOL_VOICE_MODE,engine:'sarvam',costMeterVersion:1,sttRoundedSeconds:0,sttFailedRequests:0,
   sttAudioMs:0,sttDurationUnknown:0,llmRequests:0,llmInputTokens:0,llmOutputTokens:0,llmUsageUnknown:0}};
}
const stop=/(?:stop calling|don['’]?t call|do not call|remove my number|unsubscribe|opt.?out|कॉल मत|फोन मत|नंबर हटा|नम्बर हटा|(?:कॉल|फोन)\s+(?:बंद|न\s+कर)|(?:call|phone)\s+(?:mat|nahi|nahin)\s+kar)/iu;
const endCall=/^(?:stop|hang up|end call|not interested|बात नहीं करनी|कॉल बंद करो|फोन बंद करो|अभी बात नहीं करनी|रुचि नहीं है)[।.!?\s]*$/iu;
const admissionInterest=INDUSTRY_TEMPLATES.find(t=>t.id==='school_admission_v1').questions[0];
const refusal=/^(?:no|no thanks|no thank you|not interested|nahi|nahin|नहीं|नही|जी नहीं|जी नही|नहीं चाहिए|नही चाहिए|नहीं धन्यवाद)[।.!?\s]*$/iu;
const repeat=/^(?:repeat|again|say again|pardon|hello|hi|दोबारा बोलिए|फिर से पूछिए|सुनाई नहीं दिया|हेलो|नमस्ते|हम्म)[।.!?\s]*$/iu;
const sensitive=/(?:[\d०-९][\s-]*?){6}|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:otp|aadhaar|aadhar|pan card|pin number|password|cvv)\b|आधार|पासवर्ड|ओटीपी/iu;
export function validateSchoolVoiceProgress(state,plan){
 if(state?.version!==1||state.language!==plan.language||!Number.isSafeInteger(state.index)||state.index<0||state.index>plan.questions.length||
  !Number.isSafeInteger(state.attempt)||state.attempt<0||state.attempt>1||!Number.isSafeInteger(state.turn)||state.turn<0||state.turn>2*plan.questions.length||state.turn<state.index+state.attempt||
  !Array.isArray(state.answers)||state.answers.length!==state.index||state.answers.some((x,i)=>!exact(x,['field','value'])||
    x.field!==plan.questions[i].field||typeof x.value!=='string'||!x.value.trim()||x.value.length>plan.questions[i].maxLength||bad.test(x.value)||sensitive.test(x.value))||
  !Array.isArray(state.recordings)||state.recordings.length!==state.turn||new Set(state.recordings).size!==state.recordings.length||state.recordings.some(x=>!digest(x))||
  !['active','completed','needs_review','declined','opted_out'].includes(state.status)||
  (state.status==='active'&&(state.index>=plan.questions.length||state.turn>=2*plan.questions.length||state.turn>2*state.index+state.attempt))||(state.status==='completed'&&(state.index!==plan.questions.length||state.attempt!==0)))fail('school_voice_progress_invalid');
 return state;
}
/** Called once after a durable recording claim. Never guesses or invokes an LLM.
 * Answers are unverified bounded responses, not inferred admission facts.
 */
export function advanceSchoolVoice(plan,state,{recordingSha256,text,technicalFailure=false}){
 validateSchoolVoiceProgress(state,plan);
 if(state.status!=='active'||!digest(recordingSha256)||state.recordings.includes(recordingSha256)||state.turn>=2*plan.questions.length)fail('school_voice_turn_invalid');
 const next={...state,turn:state.turn+1,recordings:[...state.recordings,recordingSha256],answers:[...state.answers]};
 const value=typeof text==='string'?text.normalize('NFC').trim():'';
 if(value&&stop.test(value)){next.status='opted_out';return next}
 if(value&&endCall.test(value)){next.status='declined';return next}
 if(technicalFailure){next.status='needs_review';return next}
 const question=plan.questions[state.index];
 // The default admission-interest question has a defined negative outcome.
 // Do not infer what a bare 'no' means for an arbitrary client-edited question.
 if(value&&question.text===admissionInterest&&refusal.test(value)){next.status='declined';return next}
 if(!value||value.length>question.maxLength||bad.test(value)||sensitive.test(value)||repeat.test(value)||/[?？]/u.test(value)){
  if(state.attempt===1||next.turn>=2*plan.questions.length){next.status='needs_review';return next}
  next.attempt=1;return next;
 }
 next.answers.push({field:question.field,value});next.index++;next.attempt=0;
 if(next.index===plan.questions.length)next.status='completed';
 else if(next.turn>=2*plan.questions.length)next.status='needs_review';
 return next;
}
export function schoolVoiceNodes(plan,state){
 validateSchoolVoiceProgress(state,plan);
 if(state.status==='completed')return [plan.closing.id];
 if(state.status!=='active')return [];
 return [...(state.index===0&&state.attempt===0&&state.turn===0?[plan.greeting.id]:[]),plan.questions[state.index].id];
}
