// Phase 3A: deterministic virtual voice-turn protocol for immutable offline snapshots.
// It deliberately never imports Plivo, Sarvam, R2, Worker dialing, CRM or billing.
import {validateFlowGraph} from './call-flow-dsl.mjs';

const forbiddenText=/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const validReply=x=>typeof x==='string'&&x.trim().length>=1&&x.trim().length<=160&&
 x.length<=160&&!forbiddenText.test(x);
const simulationLabel='Virtual voice turns are TEXT ONLY. There is no microphone, provider request, audio file, phone call, live customer, CRM mutation or billing.';

function result(status,commands,transcript,effects,consumed,expectedNode){
 return {
  mode:'virtual_voice_turns',simulated:true,callable:false,liveCall:false,
  providerRequests:0,plivoRequests:0,sarvamRequests:0,r2Requests:0,
  crmMutations:0,whatsappMessages:0,billedSeconds:0,
  status,answersUsed:consumed,expectedNode:expectedNode||null,
  commands,transcript,effects,notice:simulationLabel,
 };
}
/**
 * Replays fictional answers from the beginning of ONE immutable validated flow.
 * No mutable session, callback, provider adapter or side effect exists.
 * Same snapshot and answers always produce the same result; a client cannot
 * forge a saved cursor/verification flag or skip an earlier question.
 * Commands are VIRTUAL UI instructions, not Plivo XML or carrier commands.
 */
export function runVirtualVoiceTurns(flow,{answers=[]}={}){
 validateFlowGraph(flow);
 if(!Array.isArray(answers)||answers.length>12||answers.some(x=>!validReply(x)))
  throw Error('invalid_fictional_voice_answers');
 const byId=new Map(flow.nodes.map(n=>[n.id,n]));
 const transcript=[],commands=[],effects=[];
 let cursor=flow.start,lastReply='',used=0;
 for(let steps=0;steps<48;steps++){
  const node=byId.get(cursor);
  if(!node)throw Error('invalid_virtual_voice_graph');
  if(node.type==='greeting'||node.type==='speak_static'){
   commands.push({kind:'would_speak_reviewed_text',nodeId:node.id,text:node.text});
   transcript.push({speaker:'draft_ai',text:node.text});
   cursor=node.next;continue;
  }
  if(node.type==='ask_text_bounded'||node.type==='ask_choice'){
   commands.push({kind:'would_speak_reviewed_text',nodeId:node.id,text:node.text});
   transcript.push({speaker:'draft_ai',text:node.text});
   if(used===answers.length){
    commands.push({kind:'await_fictional_reply',nodeId:node.id,questionIndex:used+1,
     field:node.field,...(node.type==='ask_choice'?{choices:[...node.choices]}:{})});
    return result('awaiting_fictional_reply',commands,transcript,effects,used,node.id);
   }
   const reply=answers[used].trim();
   if(node.type==='ask_text_bounded'&&reply.length>node.maxLength)
    throw Error('invalid_fictional_voice_answer_length');
   if(node.type==='ask_choice'&&!node.choices.includes(reply))
    throw Error('invalid_fictional_voice_choice');
   used++;
   transcript.push({speaker:'fictional_person',text:reply});
   lastReply=reply;
   cursor=node.next;continue;
  }
  if(node.type==='branch_exact'){
   cursor=Object.hasOwn(node.branches,lastReply)?node.branches[lastReply]:node.otherwise;
   continue;
  }
  if(node.type==='verify_recipient'){
   // No off-platform proof of identity can be supplied by a fictional text turn.
   effects.push('identity_verification_not_performed');
   cursor=node.onFailure;continue;
  }
  if(node.type==='fetch_approved_snapshot'){
   effects.push('private_data_source_not_accessed');
   cursor=node.onUnavailable;continue;
  }
  if(node.type==='speak_verified_field'){
   // Defensive backstop even if a future graph validation bug occurs.
   effects.push('private_fields_blocked');
   return result('private_field_blocked',commands,transcript,effects,used,null);
  }
  if(node.type==='create_human_task'){
   effects.push('hypothetical_human_task:'+node.kind);
   cursor=node.next;continue;
  }
  if(node.type==='save_reviewed_outcome'){
   effects.push('hypothetical_outcome:'+node.outcome);
   cursor=node.next;continue;
  }
  if(node.type==='end_call'){
   if(used!==answers.length)throw Error('invalid_extra_fictional_answers');
   commands.push({kind:'would_end_preview',nodeId:node.id});
   return result('virtual_preview_complete',commands,transcript,effects,used,null);
  }
  throw Error('unsupported_virtual_voice_step');
 }
 throw Error('virtual_voice_step_limit');
}
