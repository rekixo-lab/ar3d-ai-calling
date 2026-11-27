// Phase 3C: durable *synthetic only* session transitions on a D1-compatible binding.
// No Worker route, actual phone number, provider dispatch, audio or wallet effects.
import {createSyntheticSchoolSession,applySyntheticSchoolCallback} from './synthetic-school-pilot.mjs';
import {runVirtualVoiceTurns} from './virtual-voice-turns.mjs';

const encoder=new TextEncoder();
const validId=x=>typeof x==='string'&&/^synthetic-[a-z0-9_-]{1,80}$/.test(x);
const fail=code=>{throw Error(code)};
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
async function load(db,tenantId,sessionId){
 if(!validId(tenantId)||!validId(sessionId))fail('invalid_synthetic_session');
 const row=await db.prepare('SELECT graph_json,expires_at,revision,state_json,events_json FROM synthetic_school_sessions WHERE tenant_id=? AND session_id=?').bind(tenantId,sessionId).first();
 if(!row)fail('synthetic_session_not_found');
 const state=JSON.parse(row.state_json),events=JSON.parse(row.events_json);
 if(state.tenantId!==tenantId||state.sessionId!==sessionId||state.sequence!==row.revision||
    state.expiresAt!==row.expires_at||!Array.isArray(events)||events.length!==row.revision||
    !Array.isArray(state.answers)||state.answers.length!==row.revision||
    new Set(events.map(e=>e.eventId)).size!==events.length||
    events.some(e=>!validId(e.eventId)||!/^[a-f0-9]{64}$/.test(e.bodySha))||
    (events.length?JSON.stringify(events.at(-1))!==JSON.stringify(state.lastEvent):state.lastEvent!==null))
  fail('invalid_synthetic_persisted_state');
 return {row,state,events};
}
/** Trusted synthetic test caller only. Reusing a session ID is rejected by the PK. */
export async function startStoredSchoolSession(db,input){
 const output=await createSyntheticSchoolSession(input),s=output.session;
 const r=await db.prepare('INSERT INTO synthetic_school_sessions(tenant_id,session_id,graph_json,expires_at,revision,state_json,events_json) VALUES(?,?,?,?,0,?,?)')
  .bind(s.tenantId,s.sessionId,input.graphJson,s.expiresAt,JSON.stringify(s),'[]').run();
 if(r?.meta?.changes!==1)fail('synthetic_session_not_saved');
 return output;
}
/** The caller derives tenant and session from trusted context, not from unverified body.
 * Each accepted event and its new state commit in ONE atomic conditional UPDATE.
 * Only the winner emits hypothetical commands; a lost CAS rereads and revalidates.
 * Exact historical retries authenticate against their original predecessor and
 * produce no commands. Stale, expired and conflicting retries fail closed.
 */
export async function applyStoredSchoolCallback(db,{tenantId,sessionId,rawBody,signature,key,now}){
 if(typeof rawBody!=='string'||encoder.encode(rawBody).length>4096)fail('invalid_synthetic_event');
 let event;
 try{event=JSON.parse(rawBody)}catch{fail('invalid_synthetic_event')}
 if(!event||!validId(event.eventId))fail('invalid_synthetic_event');
 const bodySha=await hash(rawBody);
 for(let attempt=0;attempt<3;attempt++){
  const {row,state,events}=await load(db,tenantId,sessionId);
  const seen=events.findIndex(e=>e.eventId===event.eventId);
  if(seen>=0){
   if(events[seen].bodySha!==bodySha)fail('synthetic_event_conflict');
   // Validate identical old retries using the exact earlier answer prefix.
   const answers=state.answers.slice(0,seen);
   const prior=runVirtualVoiceTurns(JSON.parse(row.graph_json),{answers});
   const predecessor={...state,answers,sequence:seen,expectedNode:prior.expectedNode,status:prior.status,lastEvent:seen?events[seen-1]:null};
   const authenticated=await applySyntheticSchoolCallback({session:predecessor,graphJson:row.graph_json,rawBody,signature,key,now});
   if(authenticated.session.lastEvent.bodySha!==bodySha||authenticated.session.answers.at(-1)!==state.answers[seen])
    fail('invalid_synthetic_persisted_state');
   return {...authenticated,session:state,duplicate:true,commands:[]};
  }
  const output=await applySyntheticSchoolCallback({session:state,graphJson:row.graph_json,rawBody,signature,key,now});
  if(output.duplicate)fail('invalid_synthetic_persisted_state');
  const next=output.session;
  const updated=await db.prepare('UPDATE synthetic_school_sessions SET revision=?,state_json=?,events_json=? WHERE tenant_id=? AND session_id=? AND revision=? AND state_json=? AND events_json=? AND expires_at>?')
   .bind(next.sequence,JSON.stringify(next),JSON.stringify([...events,next.lastEvent]),tenantId,sessionId,row.revision,row.state_json,row.events_json,now).run();
  if(updated?.meta?.changes===1)return output;
 }
 fail('synthetic_session_write_conflict');
}
