// Phase 3C: disconnected provider and audio readiness primitives.
// Never imported by the Worker in this phase. No network or dialing.
// Plivo reference: https://docs.plivo.com/docs/voice/concepts/signature-validation
// GET canonicalization follows existing scripted-phone-pilot.mjs, with a
// separate exact HTTPS path and a deliberately narrow unambiguous query subset.
import {validateFlowGraph} from './call-flow-dsl.mjs';
const enc=new TextEncoder();
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const fail=code=>{throw Error(code)};
export const SCHOOL_CALLBACK_PATH='/v1/provider/plivo/school-pilot';
/** Signature verification alone never grants calling permission or consumes a nonce.
 * POST and ambiguous query values are intentionally unsupported in this candidate.
 * Real provider test vectors and durable nonce/call binding required before routing.
 */
export async function verifySchoolPlivoGet(req,{origin,token}={}){
 try{
  if(req.method!=='GET'||typeof token!=='string'||token.length<8||token.length>256||req.url.length>8192)return false;
  const base=new URL(origin),url=new URL(req.url);
  if(base.protocol!=='https:'||base.origin!==origin||url.origin!==origin||
     url.pathname!==SCHOOL_CALLBACK_PATH||url.username||url.password||url.hash)return false;
  const nonce=req.headers.get('X-Plivo-Signature-V3-Nonce')||'';
  const signatures=req.headers.get('X-Plivo-Signature-V3')||'';
  const pairs=[...url.searchParams];
  if(!/^[\x21-\x7e]{1,128}$/.test(nonce)||!signatures||signatures.length>512||pairs.length>45||
     new Set(pairs.map(([name])=>name)).size!==pairs.length||
     pairs.some(([k,v])=>!/^[A-Za-z0-9_]{1,80}$/.test(k)||/[&=\x00-\x1f\x7f]/.test(v)))return false;
  pairs.sort(([a],[b])=>a<b?-1:a>b?1:0);
  const query=pairs.map(([k,v])=>k+'='+v).join('&');
  const payload=url.origin+url.pathname+(query?'?'+query:'')+'.'+nonce;
  const key=await crypto.subtle.importKey('raw',enc.encode(token),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  for(const sig of signatures.split(',').map(x=>x.trim())){
   if(/^[A-Za-z0-9+/]{43}=$/.test(sig)&&await crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(sig),c=>c.charCodeAt(0)),enc.encode(payload)))return true;
  }
  return false;
 }catch{return false}
}
async function schoolGraph(graphJson,graphSha256){
 if(typeof graphJson!=='string'||enc.encode(graphJson).length>32768||!digest(graphSha256)||
    await sha(enc.encode('ar3d:offline-flow:v1:'+graphJson))!==graphSha256)fail('invalid_school_audio_graph');
 const graph=validateFlowGraph(JSON.parse(graphJson));
 if(graph.templateId!=='school_admission_v1'||graph.industry!=='school'||graph.regulated!==false||
    graph.nodes.some(n=>!['greeting','speak_static','ask_text_bounded','ask_choice','branch_exact','end_call'].includes(n.type)))fail('school_audio_only');
 return graph;
}
/** Offline metadata only: one content-addressed MP3 per speakable node.
 * No URLs accepted. Asset hashes must come from trusted offline synthesis/review.
 */
export async function buildSchoolAudioManifest({graphJson,graphSha256,assets}){
 const graph=await schoolGraph(graphJson,graphSha256),nodes=graph.nodes.filter(n=>typeof n.text==='string');
 if(!Array.isArray(assets)||assets.length!==nodes.length||
    new Set(assets.map(a=>a?.nodeId)).size!==nodes.length)fail('invalid_school_audio_assets');
 const entries=[];
 for(const n of nodes){
  const a=assets.find(x=>x?.nodeId===n.id);
  if(!exact(a,['nodeId','audioSha256','bytes'])||!digest(a.audioSha256)||!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>1048576)fail('invalid_school_audio_asset');
  entries.push({nodeId:n.id,textSha256:await sha(enc.encode(n.text)),audioSha256:a.audioSha256,bytes:a.bytes,
   key:'school-pilot/v1/'+graphSha256+'/'+n.id+'/'+a.audioSha256+'.mp3'});
 }
 const manifest={schemaVersion:1,graphSha256,language:graph.language,engine:'sarvam',entries};
 return {manifest,manifestSha256:await sha(enc.encode(JSON.stringify(manifest)))};
}
export async function verifySchoolAudioBytes({graphJson,graphSha256,manifest,expectedManifestSha256,nodeId,bytes}){
 if(!digest(expectedManifestSha256)||!manifest||!Array.isArray(manifest.entries)||manifest.entries.length>40||
    !(bytes instanceof Uint8Array)||bytes.length>1048576)fail('invalid_school_audio_manifest');
 const rebuilt=await buildSchoolAudioManifest({graphJson,graphSha256,assets:manifest.entries.map(({nodeId,audioSha256,bytes})=>({nodeId,audioSha256,bytes}))});
 if(JSON.stringify(rebuilt.manifest)!==JSON.stringify(manifest)||rebuilt.manifestSha256!==expectedManifestSha256)fail('invalid_school_audio_manifest');
 const asset=rebuilt.manifest.entries.find(x=>x.nodeId===nodeId);
 if(!asset||asset.bytes!==bytes.length||await sha(bytes)!==asset.audioSha256)fail('invalid_school_audio_bytes');
 return {key:asset.key,verified:true,callable:false};
}
// Hard gate: no config, synthetic review, signature or manifest can enable calls yet.
export function schoolLivePilotStatus(){
 return {enabled:false,callable:false,reason:'separate_live_authorization_and_provider_adapter_required'};
}
