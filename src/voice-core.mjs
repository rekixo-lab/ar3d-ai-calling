// Provider-independent voice turn planning for synthetic conversation previews.
// NO microphone, STT, TTS, audio processing, real customers, outbound calls or LLM.
import {advanceSimulation} from './conversation-core.mjs';

const MODES=new Set(['hi','en','hi-en']);
const MAX_SPOKEN_TEXT=2800;
const MAX_SEGMENTS=18;
const HINDI=/[\u0900-\u097f]/u;
function validState(state){
  if(!state||!MODES.has(state.languageMode)||!Array.isArray(state.turns)||
     !['active','completed','opted_out'].includes(state.status))throw Error('invalid voice preview state');
}
export function makeSpeechPlan(state){
  validState(state);
  const utterance=[...state.turns].reverse().find(row=>row?.role==='agent')?.text;
  if(typeof utterance!=='string'||!utterance.trim()||utterance.length>MAX_SPOKEN_TEXT||
     /[\u0000-\u0008\u000b-\u001f]/u.test(utterance))throw Error('invalid speech preview text');
  // Split on explicit bilingual " / " separators and newlines only.
  // Locale is a *hint* for future TTS adapters, not speech synthesis.
  const chunks=utterance.split(/\r?\n| +\/ +/u).map(x=>x.trim()).filter(Boolean);
  if(chunks.length<1||chunks.length>MAX_SEGMENTS||chunks.some(x=>x.length>500))
    throw Error('speech preview exceeds safe segment bounds');
  const segments=chunks.map((text,i)=>({
    sequence:i+1,text,
    locale:state.languageMode==='en'?'en-IN':state.languageMode==='hi'?'hi-IN':HINDI.test(text)?'hi-IN':'en-IN'
  }));
  return {mode:'synthetic_preview_only',provider:'none',audioGenerated:false,
    transcriptVerified:false,languageMode:state.languageMode,segments,
    note:'Text-to-speech planning only; no microphone, audio, dialer, or recording is connected.'};
}
export function processTypedTranscript(state,payload){
  validState(state);
  if(state.status!=='active')throw Error('simulation already finished');
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||
     Object.keys(payload).some(k=>!['source','transcript','confidence'].includes(k)))
    throw Error('invalid speech preview payload');
  if(payload.source!=='typed_demo')throw Error('only typed demo transcripts are supported');
  const {confidence,transcript}=payload;
  if(typeof confidence!=='number'||!Number.isFinite(confidence)||confidence<0||confidence>1||
     typeof transcript!=='string'||transcript.length>500||
     /[\u0000-\u0008\u000b\u000e-\u001f]/u.test(transcript))throw Error('invalid synthetic transcript');
  if(confidence<0.60||!transcript.trim()){
    return {action:'repeat_requested',mutated:false,state,
      note:'Synthetic recognition confidence was too low; no question was advanced or answer stored.'};
  }
  const updated=advanceSimulation(state,transcript);
  return {action:updated.status==='opted_out'?'demo_stopped':'advanced',
    mutated:true,state:updated,note:'Typed demo transcript only; no real call, recording or lead update.'};
}
