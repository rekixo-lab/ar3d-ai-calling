// Deterministic mock-only conversation batch. Never dials, reads real leads,
// writes D1, opens sockets, streams media, stores phone numbers or changes consent.
import {beginSimulation,advanceSimulation} from './conversation-core.mjs';
import {processTypedTranscript,makeSpeechPlan} from './voice-core.mjs';
import {planCallStatusTransition} from './provider-contract.mjs';
import {previewSandboxUsage} from './sandbox-usage.mjs';

const SCENARIOS=['completed','opt_out','repeat','pricing','low_confidence'];
const QUESTIONS=['आपका बजट क्या है? / What is your budget?',
                 'किस लोकेशन में प्लॉट चाहिए? / Which location do you prefer?'];
function assertMockStateChain(){
  const stages=['pending','initiating','ringing','connected','completed'];
  for(let i=1;i<stages.length;i++)
    if(planCallStatusTransition(stages[i-1],stages[i]).allowed!==true)
      throw Error('synthetic state transition contract mismatch');
}
export function runSyntheticPilot({count=100,scenario='mixed',quotaCalls=100,
  ratePaisePerMinute=null}={}){
  if(!Number.isSafeInteger(count)||count<1||count>100||
     !['mixed',...SCENARIOS].includes(scenario))throw Error('invalid sandbox pilot parameters');
  assertMockStateChain();
  const outcomes={completed:0,opted_out:0,repeat_requested:0,
    pricing_deferred:0,low_confidence_repeated:0};
  const events=[];
  for(let i=0;i<count;i++){
    const mode=scenario==='mixed'?SCENARIOS[i%SCENARIOS.length]:scenario;
    let state=beginSimulation({languageMode:i%2===0?'hi':'en',questions:QUESTIONS});
    const plan=makeSpeechPlan(state);
    if(plan.audioGenerated!==false||plan.provider!=='none')throw Error('unsafe speech provider plan');
    if(mode==='opt_out'){
      state=advanceSimulation(state,i%2===0?'कॉल मत करना':'Do not call');
      if(state.status!=='opted_out')throw Error('synthetic opt-out not honored');
      outcomes.opted_out++;
    }else{
      if(mode==='repeat'){
        state=advanceSimulation(state,'repeat');
        outcomes.repeat_requested++;
      }
      if(mode==='pricing'){
        state=advanceSimulation(state,'What is the price?');
        outcomes.pricing_deferred++;
      }
      if(mode==='low_confidence'){
        const result=processTypedTranscript(state,{
          source:'typed_demo',transcript:'unclear',confidence:0.20
        });
        if(result.action!=='repeat_requested'||result.mutated||result.state!==state)
          throw Error('low confidence must not mutate the simulation');
        outcomes.low_confidence_repeated++;
      }
      state=advanceSimulation(state,'40 lakh');
      state=advanceSimulation(state,'Raipur');
      if(state.status!=='completed'||state.answers.length!==2)
        throw Error('synthetic conversation did not complete');
      outcomes.completed++;
    }
    events.push({
      source:'synthetic_sandbox',
      eventId:'sandbox-event-'+String(i+1).padStart(4,'0'),
      callId:'sandbox-call-'+String(i+1).padStart(4,'0'),
      durationSeconds:mode==='opt_out'?12:25+(i%41)
    });
  }
  return {
    mode:'synthetic_only',scenario,count,
    outcomes,usagePreview:previewSandboxUsage(events,{quotaCalls,ratePaisePerMinute}),
    providerConnected:false,realCallsStarted:0,realAudioGenerated:0,
    leadDataAccessed:false,phoneNumbersProcessed:false,databaseWrites:0,
    notice:'Deterministic fake conversations and illustrative duration only. No real voice calls, telco provider, consent authorization or billable usage.'
  };
}
