// In-memory vendor contract test, no dialing, no customer numbers or fetch.
// All the number/host values below belong to an isolated fictional mock.
import {buildExotelVoiceAiContract,parseUnverifiedExotelCallback,
  normalizeExotelCallStatus} from './exotel-voice-adapter.mjs';
import {assessTelecomPreflight} from './telecom-preflight.mjs';
import {planCallStatusTransition} from './provider-contract.mjs';
const SCENARIOS=['mixed','complete','busy','no_answer','failed','opt_out','unverified'];
const fictionalConfig=Object.freeze({
  accountSid:'synthetic_account',from:'+919000000001',
  callerId:'01234567890',streamUrl:'wss://bot.example.invalid/stream',
  statusCallback:'https://callback.example.invalid/webhook',
  customField:'synthetic-only'
});
const verified='independently_verified';
const baseline=Object.freeze({
  customerSegment:'prior_inquiry',purpose:'promotional',
  consentReview:verified,dndReview:verified,optedOut:false,
  callerApproval:verified,callerClassification:'promotional',
  providerApproval:verified,callingWindow:verified,
  disclosure:verified,humanHandoff:verified,recordingNotice:verified
});
export function runExotelMockPilot({count=100,scenario='mixed'}={}){
  if(!Number.isSafeInteger(count)||count<1||count>100||!SCENARIOS.includes(scenario))
    throw Error('invalid Exotel mock pilot');
  const contract=buildExotelVoiceAiContract(fictionalConfig);
  if(contract.executionAllowed||contract.headersAttached||contract.transportRegistered)
    throw Error('live Exotel transport must stay disabled');
  const outcomes={completed:0,busy:0,no_answer:0,failed:0,
    opt_out_blocked:0,consent_dnd_blocked:0};
  const variant=['complete','busy','no_answer','failed','opt_out','unverified'];
  for(let i=0;i<count;i++){
    const kind=scenario==='mixed'?variant[i%variant.length]:scenario;
    const preflight=assessTelecomPreflight({
      ...baseline,
      ...(kind==='opt_out'?{optedOut:true}:{}),
      ...(kind==='unverified'?{consentReview:'pending',dndReview:'unknown'}:{})
    });
    if(preflight.executionAllowed)throw Error('unsafe preflight attempted live dial');
    if(kind==='opt_out'){outcomes.opt_out_blocked++;continue;}
    if(kind==='unverified'){outcomes.consent_dnd_blocked++;continue;}
    if(!preflight.checksPassing||!planCallStatusTransition('pending','initiating').allowed||
       !planCallStatusTransition('initiating','ringing').allowed)
      throw Error('invalid mock lifecycle state');
    const rawStatus=kind==='complete'?'completed':kind==='no_answer'?'no-answer':kind;
    const payload=normalizeExotelCallStatus({Sid:'fictionalcall'+(i+1),
      Status:rawStatus,Direction:'outbound-api'});
    const callback=new URLSearchParams({CallSid:'fictionalcall'+(i+1),
      Status:rawStatus,EventType:'terminal',ConversationDuration:'15'});
    const event=parseUnverifiedExotelCallback(new TextEncoder().encode(callback.toString()));
    if(payload.trusted||event.trusted||event.billable||event.consentAuthorized)
      throw Error('unverified provider outcome was treated as trusted');
    if(kind==='complete'){
      if(!planCallStatusTransition('ringing','connected').allowed||
         !planCallStatusTransition('connected','completed').allowed)
        throw Error('invalid successful lifecycle');
      outcomes.completed++;
    }else if(kind==='no_answer')outcomes.no_answer++;
    else if(kind==='busy')outcomes.busy++;
    else outcomes.failed++;
  }
  return Object.freeze({
    provider:'exotel',mode:'offline_contract_simulation',count,outcomes,
    endpointContractValidated:true,callbackShapeValidated:true,
    providerApprovalVerified:false,customerNumbersProcessed:0,
    providerNetworkRequests:0,realCallsStarted:0,realAudioFrames:0,
    verifiedWebhooksReceived:0,customerDbWrites:0,billableEvents:0,
    authorizedCallerAllocated:false,commercialLaunchAllowed:false,
    notice:'Exotel-compatible dry-run contract only. No vendor keys, real calls, verified DND, WSS media, recording or billing.'
  });
}
