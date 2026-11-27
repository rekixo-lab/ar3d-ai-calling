// Phase 3B: SYNTHETIC ONLY signed School pilot session contract.
// Not a Plivo signature implementation. No HTTP route, provider request, audio,
// D1 mutation, CRM, wallet or live calling permission. A future adapter must
// authenticate provider callbacks independently and persist transitions atomically.
import {validateFlowGraph} from './call-flow-dsl.mjs';
import {runVirtualVoiceTurns} from './virtual-voice-turns.mjs';

const encoder=new TextEncoder();
const PREFIX='ar3d:offline-flow:v1:';
const DOMAIN='ar3d:synthetic-school-callback:v1:';
const MAX_SESSION_MS=15*60*1000;
const MAX_SKEW_MS=2*60*1000;
const id=x=>typeof x==='string'&&/^synthetic-[a-z0-9_-]{1,80}$/.test(x);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const time=x=>Number.isSafeInteger(x)&&x>=0;
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const hex=buf=>Array.from(new Uint8Array(buf),b=>b.toString(16).padStart(2,'0')).join('');
async function hash(text){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(text)))}
function fail(code){throw Error(code)}
async function checkedGraph(graphJson,sha){
 if(typeof graphJson!=='string'||encoder.encode(graphJson).length>32768||!digest(sha)||
    await hash(PREFIX+graphJson)!==sha)fail('invalid_pilot_graph_digest');
 const g=validateFlowGraph(JSON.parse(graphJson));
 if(g.templateId!=='school_admission_v1'||g.industry!=='school'||g.regulated!==false||
    g.callable!==false||g.nodes.some(n=>!['greeting','speak_static','ask_text_bounded','ask_choice','branch_exact','end_call'].includes(n.type)))
  fail('school_synthetic_only');
 return g;
}
function preview(graph,answers){return runVirtualVoiceTurns(graph,{answers})}
function result(session,commands,duplicate=false){
 return {session,commands,duplicate,mode:'synthetic_school_callback',liveCall:false,callable:false,
  providerRequests:0,r2Requests:0,crmMutations:0,billedSeconds:0};
}
/** Caller supplies only server-created fictional IDs; no real number or approval. */
export async function createSyntheticSchoolSession({sessionId,tenantId,snapshotId,graphJson,graphSha256,now}){
 if(!id(sessionId)||!id(tenantId)||!id(snapshotId)||!time(now)||!time(now+MAX_SESSION_MS))
  fail('invalid_synthetic_session');
 const graph=await checkedGraph(graphJson,graphSha256);
 const turn=preview(graph,[]);
 if(turn.status!=='awaiting_fictional_reply')fail('invalid_school_start');
 const session={sessionId,tenantId,snapshotId,graphSha256,startedAt:now,expiresAt:now+MAX_SESSION_MS,
  answers:[],sequence:0,expectedNode:turn.expectedNode,status:turn.status,lastEvent:null};
 return result(session,turn.commands);
}
async function verifySignature(rawBody,signature,key){
 if(!(key instanceof Uint8Array)||key.length!==32||!digest(signature))
  fail('invalid_synthetic_signature');
 const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=Uint8Array.from(signature.match(/../g),x=>parseInt(x,16));
 if(!await crypto.subtle.verify('HMAC',k,bytes,encoder.encode(DOMAIN+rawBody)))
  fail('invalid_synthetic_signature');
}
/**
 * Apply a signed fictional reply to trusted server-owned state.
 * Never accept state from a request. Caller MUST use atomic compare-and-swap
 * before exposing new commands in any later persistent adapter. This pure
 * transition does not supply cross-process concurrency or durable replay storage.
 */
export async function applySyntheticSchoolCallback({session,graphJson,rawBody,signature,key,now}){
 if(!session||!id(session.sessionId)||!id(session.tenantId)||!id(session.snapshotId)||
    !time(now)||!time(session.startedAt)||!time(session.expiresAt)||
    session.expiresAt!==session.startedAt+MAX_SESSION_MS||
    now<session.startedAt||now>=session.expiresAt)fail('synthetic_session_expired_or_invalid');
 if(typeof rawBody!=='string'||encoder.encode(rawBody).length>4096)fail('invalid_synthetic_event');
 await verifySignature(rawBody,signature,key);
 let event;
 try{event=JSON.parse(rawBody)}catch{fail('invalid_synthetic_event')}
 if(!exact(event,['sessionId','tenantId','snapshotId','graphSha256','eventId','sequence','expectedNode','answer','issuedAt'])||
    event.sessionId!==session.sessionId||event.tenantId!==session.tenantId||
    event.snapshotId!==session.snapshotId||event.graphSha256!==session.graphSha256||
    !id(event.eventId)||!Number.isSafeInteger(event.sequence)||event.sequence<1||event.sequence>12||
    typeof event.expectedNode!=='string'||typeof event.answer!=='string'||
    !time(event.issuedAt)||event.issuedAt<session.startedAt||event.issuedAt>=session.expiresAt||
    Math.abs(now-event.issuedAt)>MAX_SKEW_MS)fail('invalid_synthetic_event');
 const graph=await checkedGraph(graphJson,session.graphSha256);
 if(!Array.isArray(session.answers)||session.answers.length!==session.sequence)
  fail('invalid_synthetic_state');
 const before=preview(graph,session.answers);
 if(before.status!==session.status||before.expectedNode!==session.expectedNode)
  fail('invalid_synthetic_state');
 const bodySha=await hash(rawBody);
 if(session.lastEvent?.eventId===event.eventId){
  if(session.lastEvent.bodySha!==bodySha)fail('synthetic_event_conflict');
  return result(session,[],true);
 }
 if(event.sequence!==session.sequence+1||before.status!=='awaiting_fictional_reply'||
    event.expectedNode!==before.expectedNode)fail('invalid_synthetic_sequence');
 const answers=[...session.answers,event.answer];
 const after=preview(graph,answers);
 // Replay includes all prior spoken text; emit only NEW hypothetical commands.
 const prefix=before.commands.slice(0,-1);
 if(JSON.stringify(after.commands.slice(0,prefix.length))!==JSON.stringify(prefix))
  fail('invalid_synthetic_command_prefix');
 const updated={...session,answers,sequence:event.sequence,expectedNode:after.expectedNode,
  status:after.status,lastEvent:{eventId:event.eventId,bodySha}};
 return result(updated,after.commands.slice(prefix.length));
}
