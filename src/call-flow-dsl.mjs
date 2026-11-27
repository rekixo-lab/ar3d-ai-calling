// MI-02: deterministic, offline-only graph compiler and simulator.
// This file deliberately imports NO telephony, CRM writes, WhatsApp, R2 or AI provider.
import {validateIndustryAgentDraft,getIndustryTemplate} from './industry-template-catalog.mjs';
export const FLOW_DSL_VERSION=1;
const textBad=/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const idRE=/^[a-z][a-z0-9_]{0,31}$/;
const fieldRE=/^[a-z][a-z0-9_]{0,39}$/;
const outcomes=new Set(['acknowledged','callback_requested','not_interested','needs_review']);
const resources=new Set(['finance_account','appointment','insurance_policy']);
const privateFields=new Set(['amount_due','due_date','masked_account_ref','renewal_date']);
const exact=(obj,keys)=>Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k));
const string=(value,max=650)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!textBad.test(value);
const nextEdges=n=>n.type==='end_call'?[]:
 n.type==='verify_recipient'?[n.onVerified,n.onFailure]:
 n.type==='fetch_approved_snapshot'?[n.onFresh,n.onUnavailable]:
 n.type==='branch_exact'?[...Object.values(n.branches),n.otherwise]:[n.next];

function validateNode(n){
 if(!n||typeof n!=='object'||Array.isArray(n)||!idRE.test(n.id||''))throw Error('invalid_flow_node');
 const field=(v)=>typeof v==='string'&&fieldRE.test(v);
 const edge=(v)=>typeof v==='string'&&idRE.test(v);
 const textTypes=['greeting','speak_static','ask_text_bounded','ask_choice'];
 if(textTypes.includes(n.type)){
  const keys=n.type==='ask_text_bounded'?['id','type','text','field','maxLength','next']:
    n.type==='ask_choice'?['id','type','text','field','choices','next']:['id','type','text','next'];
  if(!exact(n,keys)||!string(n.text,n.type==='ask_text_bounded'?250:650)||!edge(n.next))throw Error('invalid_flow_text_step');
  if(n.type==='ask_text_bounded'&&(!field(n.field)||!Number.isSafeInteger(n.maxLength)||n.maxLength<1||n.maxLength>160))
   throw Error('invalid_flow_answer_limits');
  if(n.type==='ask_choice'&&(!field(n.field)||!Array.isArray(n.choices)||n.choices.length<2||n.choices.length>12||
    new Set(n.choices).size!==n.choices.length||n.choices.some(v=>!string(v,36))))throw Error('invalid_flow_choices');
  return;
 }
 if(n.type==='end_call'){if(!exact(n,['id','type']))throw Error('invalid_end_call');return}
 if(n.type==='verify_recipient'){
  if(!exact(n,['id','type','onVerified','onFailure'])||!edge(n.onVerified)||!edge(n.onFailure)||n.onVerified===n.onFailure)
   throw Error('invalid_recipient_verification');
  return;
 }
 if(n.type==='fetch_approved_snapshot'){
  if(!exact(n,['id','type','resource','onFresh','onUnavailable'])||!resources.has(n.resource)||
     !edge(n.onFresh)||!edge(n.onUnavailable)||n.onFresh===n.onUnavailable)
   throw Error('invalid_snapshot_gate');
  return;
 }
 if(n.type==='speak_verified_field'){
  if(!exact(n,['id','type','fields','next'])||!Array.isArray(n.fields)||!n.fields.length||n.fields.length>4||
     new Set(n.fields).size!==n.fields.length||n.fields.some(x=>!privateFields.has(x))||!edge(n.next))
   throw Error('invalid_private_fields');
  return;
 }
 if(n.type==='branch_exact'){
  if(!exact(n,['id','type','source','branches','otherwise'])||!field(n.source)||!edge(n.otherwise)||
    !n.branches||typeof n.branches!=='object'||Array.isArray(n.branches)||
    Object.keys(n.branches).length<1||Object.keys(n.branches).length>12||
    Object.entries(n.branches).some(([k,v])=>!string(k,36)||!edge(v)))throw Error('invalid_flow_branch');
  return;
 }
 if(n.type==='create_human_task'){
  if(!exact(n,['id','type','kind','next'])||!['admission_callback','appointment_review','account_review','general_callback'].includes(n.kind)||!edge(n.next))
   throw Error('invalid_simulated_task');
  return;
 }
 if(n.type==='save_reviewed_outcome'){
  if(!exact(n,['id','type','outcome','next'])||!outcomes.has(n.outcome)||!edge(n.next))
   throw Error('invalid_simulated_outcome');
  return;
 }
 throw Error('unsupported_flow_node_type');
}
export function validateFlowGraph(flow){
 if(!flow||typeof flow!=='object'||Array.isArray(flow)||
    !exact(flow,['schemaVersion','templateId','industry','mode','language','regulated','callable','start','nodes'])||
    flow.schemaVersion!==FLOW_DSL_VERSION||flow.callable!==false||flow.start!=='start'||
    !Array.isArray(flow.nodes)||flow.nodes.length<3||flow.nodes.length>40)throw Error('invalid_flow_graph');
 const t=getIndustryTemplate(flow.templateId);
 if(!t||t.industry!==flow.industry||t.regulated!==flow.regulated||
    !t.allowedModes.includes(flow.mode)||!['hi','en','hi-en'].includes(flow.language))throw Error('invalid_flow_template');
 const byId=new Map();
 for(const n of flow.nodes){
  validateNode(n);
  if(byId.has(n.id))throw Error('duplicate_flow_node_id');
  byId.set(n.id,n);
 }
 if(!byId.has(flow.start)||byId.get(flow.start).type!=='greeting')throw Error('invalid_flow_start');
 const visiting=new Set(),visited=new Set(),pathState=new Map();
 function walk(id,verified=false,fresh=false){
  const n=byId.get(id);
  if(!n)throw Error('unknown_flow_edge');
  const fingerprint=id+':'+Number(verified)+':'+Number(fresh);
  if(visiting.has(id))throw Error('cyclic_flow_not_permitted');
  if(pathState.has(fingerprint))return;
  visiting.add(id);visited.add(id);
  if(n.type==='speak_verified_field'&&(!verified||!fresh))throw Error('private_field_missing_verification_or_freshness');
  if(n.type==='end_call'){visiting.delete(id);pathState.set(fingerprint,true);return}
  if(n.type==='verify_recipient'){
   walk(n.onVerified,true,fresh);walk(n.onFailure,verified,fresh);
  }else if(n.type==='fetch_approved_snapshot'){
   walk(n.onFresh,verified,true);walk(n.onUnavailable,verified,fresh);
  }else for(const next of nextEdges(n))walk(next,verified,fresh);
  visiting.delete(id);pathState.set(fingerprint,true);
 }
 walk(flow.start);
 if(visited.size!==byId.size||!flow.nodes.some(n=>n.type==='end_call'))throw Error('unreachable_flow_node');
 return flow;
}
export function compileDraftToFlow(input){
 const c=validateIndustryAgentDraft(input),t=getIndustryTemplate(c.templateId);
 const nodes=[{id:'start',type:'greeting',text:c.greeting,next:c.questions.length?'q_1':'closing'}];
 c.questions.forEach((text,i)=>nodes.push({
  id:'q_'+(i+1),type:'ask_text_bounded',text,field:'answer_'+(i+1),
  maxLength:160,next:i===c.questions.length-1?'closing':'q_'+(i+2)
 }));
 nodes.push({id:'closing',type:'speak_static',text:c.closing,next:'end'},
  {id:'end',type:'end_call'});
 const flow={schemaVersion:FLOW_DSL_VERSION,templateId:c.templateId,industry:t.industry,
  mode:c.mode,language:c.language,regulated:t.regulated,callable:false,start:'start',nodes};
 validateFlowGraph(flow);
 return flow;
}
export function simulateFlowGraph(flow,{answers=[]}={}){
 validateFlowGraph(flow);
 if(!Array.isArray(answers)||answers.length>12||answers.some(a=>typeof a!=='string'||a.length>160||textBad.test(a)))
  throw Error('invalid_fictional_answers');
 const byId=new Map(flow.nodes.map(n=>[n.id,n]));
 const transcript=[],effects=[],state={fields:Object.create(null),answersUsed:0},limit=50;
 let id=flow.start,status='simulation_incomplete';
 for(let step=0;step<limit;step++){
  const n=byId.get(id);
  if(n.type==='greeting'||n.type==='speak_static'){
   transcript.push({speaker:'draft_ai',text:n.text});id=n.next;continue;
  }
  if(n.type==='ask_text_bounded'||n.type==='ask_choice'){
   transcript.push({speaker:'draft_ai',text:n.text});
   if(state.answersUsed===answers.length){status='awaiting_fictional_answer';break}
   const reply=answers[state.answersUsed++].trim();
   if(!reply||reply.length>(n.type==='ask_text_bounded'?n.maxLength:160)||
      n.type==='ask_choice'&&!n.choices.includes(reply)){
    status='invalid_fictional_answer';break;
   }
   transcript.push({speaker:'fictional_customer',text:reply});state.fields[n.field]=reply;id=n.next;continue;
  }
  if(n.type==='branch_exact'){
    const selected=state.fields[n.source];id=Object.hasOwn(n.branches,selected)?n.branches[selected]:n.otherwise;continue;
   }
  if(n.type==='verify_recipient'){
   // NO real identity evidence can exist in this local-only simulation.
   effects.push('recipient_not_verified_in_demo');id=n.onFailure;continue;
  }
  if(n.type==='fetch_approved_snapshot'){
   effects.push('no_external_account_data_in_demo');id=n.onUnavailable;continue;
  }
  if(n.type==='speak_verified_field'){
   // Never synthesize or return private account details, even in a test.
   effects.push('private_field_redacted');status='private_field_blocked';break;
  }
  if(n.type==='create_human_task'){effects.push('would_create_human_task:'+n.kind);id=n.next;continue}
  if(n.type==='save_reviewed_outcome'){effects.push('would_save_outcome:'+n.outcome);id=n.next;continue}
  if(n.type==='end_call'){status='simulated_complete';break}
 }
 return {simulated:true,callable:false,liveCall:false,providerRequests:0,
  crmMutations:0,whatsappMessages:0,answersUsed:state.answersUsed,status,transcript,effects,
  notice:'Fictional text-only rehearsal. No real identity check, account lookup, speech, calling, payment or CRM mutation.'};
}
