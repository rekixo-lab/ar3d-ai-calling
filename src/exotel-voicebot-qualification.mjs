// Convert Exotel's documented per-turn Voicebot transcript events into a
// provisional fixed-property survey. This module is pure: NO network, D1/R2,
// call, callback registration, consent mutation or automatic CRM writes.
// Only trusted server orchestration may eventually persist a reviewed result.
import {parseExotelVoicebotEvent,reviewExotelVoicebotEvents} from './exotel-voicebot-webhook-contract.mjs';
import {beginFixedVoicePreview,advanceFixedVoicePreview} from './fixed-voice-turns.mjs';

function requireValid(value,reason){
  if(!value)throw Error('invalid voicebot qualification: '+reason);
}
const output=(mode,data)=>Object.freeze({
  provider:'exotel',mode,sourceAuthenticated:false,callRegistryVerified:false,
  consentVerified:false,dndVerified:false,humanReviewRequired:true,
  crmWrites:0,visitsConfirmed:0,realCallsStarted:0,
  ...data
});
export function compileVoicebotQualification(deliveries,{
  expectedCallId,expectedSessionId,expectedAccountId,
  language='hi',now=Date.now()
}={}){
  requireValid(['hi','en'].includes(language)&&Number.isSafeInteger(now)&&now>=0,
    'language/time');
  // This independently detects conflicting replays, identity mismatches and
  // out-of-order completed events. Session-end carries no transcript.
  const review=reviewExotelVoicebotEvents(deliveries,{
    expectedCallId,expectedSessionId,expectedAccountId
  });
  const completed=new Map();
  for(const raw of deliveries){
    const event=parseExotelVoicebotEvent(raw);
    for(const turn of event.events){
      if(turn.status!=='completed')continue;
      const fingerprint=JSON.stringify(turn.segments);
      const previous=completed.get(turn.sequence);
      requireValid(previous===undefined||previous===fingerprint,
        'conflicting complete sequence');
      completed.set(turn.sequence,fingerprint);
    }
  }
  const numbered=[...completed].sort((a,b)=>a[0]-b[0]);
  const answers=[];
  for(const [,serialized] of numbered){
    const segs=JSON.parse(serialized);
    const user=segs.filter(x=>['user','customer'].includes(x.speaker));
    if(!user.length)continue;
    requireValid(user.length<=8,'customer segment count');
    const text=user.map(x=>x.text).join(' ').trim();
    requireValid(text.length<=220,'customer answer too long');
    answers.push(text);
  }
  const common={
    completedTurns:review.completedTurns,customerAnswers:answers.length,
    duplicateEventsIgnored:review.duplicateEventsIgnored,
    nonfinalTurnsIgnored:review.nonfinalTurnsIgnored,
    sessionEndReceived:review.seenSessionEnd,
    completedSequenceContinuous:review.completedSequenceContinuous,
    optOutReviewNeeded:review.optOutReviewNeeded
  };
  if(review.optOutReviewNeeded){
    return output('offline_opt_out_review',{
      ...common,status:'opt_out_needs_verification',provisionalSurvey:null,
      note:'Possible do-not-call request. Independently verify identity and suppress further contact; no preferences were changed.'
    });
  }
  let result=beginFixedVoicePreview({language,now});
  let used=0;
  for(const answer of answers){
    if(result.state.status!=='active')break;
    result=advanceFixedVoicePreview(result.state,{transcript:answer,confidence:1,now});
    used++;
    if(result.action==='repeat'||result.action==='human_review')break;
  }
  const finished=result.state.status==='completed';
  const clean=finished&&review.seenSessionEnd&&review.completedSequenceContinuous&&
    used===answers.length&&
    (answers.length===6||answers.length===7);
  const status=clean?'provisional_review_ready':'needs_human_review';
  // No raw transcript, customer phone, account ID, CallSid or webhook metadata
  // appears in this response. The structured fields remain a human-reviewed
  // proposal: never treat text as independently verified customer identity.
  const a=result.state.answers;
  const survey=finished?Object.freeze({
    propertyType:a.propertyType,location:a.location,area:a.area,
    size:a.size,budgetInr:a.budgetInr,interest:a.interest,
    visitDate:a.visitDate??null,visitAt:null
  }):null;
  return output('offline_structured_qualification',{
    ...common,status,provisionalSurvey:survey,
    consumedAnswers:used,
    note:clean?
      'Seven-question structure parsed for staff review only. No visit is confirmed or CRM updated.':
      'Incomplete/ambiguous transcript or missing session end: manual review required, nothing saved.'
  });
}

function tomorrowIso(now){
  // 7 full days ahead gives an unambiguous future calendar date in India.
  return new Date(now+7*86400000+330*60000).toISOString().slice(0,10);
}
// Demonstrates the actual Exotel JSON envelope offline with invented data.
// Used by the authenticated Super Admin preflight; never accepts user-supplied
// customer transcripts, numbers, account secrets or vendor callbacks.
export function runVoicebotQualificationFixture(scenario='plot_complete',{
  now=Date.now()
}={}){
  requireValid(['plot_complete','flat_complete','not_interested',
    'out_of_order','retry_duplicate','opt_out','incomplete','conflict'].includes(scenario),
    'scenario');
  const sid='fictional-session-2026',call='CAfictionalvoicebot2026',
    account='fictional-account-2026';
  const base={
    session_id:sid,conversation_id:'fictional-conversation-2026',
    external_id:call,account_id:account,network_type:'pstn',
    metadata:{call_sid:call},session_state:'session_in_progress',
    trigger_reason:'turn-complete'
  };
  const flat=['Flat','Raipur','Shankar Nagar','3BHK',
    '35 lakh','interested',tomorrowIso(now)];
  const plot=['Plot','Raipur','Shankar Nagar','1200 sqft',
    '25 lakh','interested',tomorrowIso(now)];
  let strings=scenario==='flat_complete'?flat:plot;
  if(scenario==='not_interested')strings=plot.slice(0,5).concat('not interested');
  const events=strings.map((a,i)=>({
    ...base,events:[{
      event_type:'transcript',event_id:'fictional-event-'+(i+1),
      event_data:{transcripts:[{
        sequence:i+1,status:'completed',
        transcript_segments:[
          {speaker:'assistant',text:'Fictional prompt '+(i+1)},
          {speaker:'user',text:a}
        ]
      }]}
    }]
  }));
  events.push({...base,session_state:'session_end',
    trigger_reason:'end',events:[]});
  if(scenario==='out_of_order')events.reverse();
  if(scenario==='retry_duplicate')
    events.splice(2,0,JSON.parse(JSON.stringify(events[1])));
  if(scenario==='opt_out')
    events[3].events[0].event_data.transcripts[0].transcript_segments[1].text='कॉल मत करना';
  if(scenario==='incomplete')events.pop();
  if(scenario==='conflict'){
    const replay=JSON.parse(JSON.stringify(events[1]));
    replay.events[0].event_id='fictional-conflicting-event';
    replay.events[0].event_data.transcripts[0].transcript_segments[1].text='Mumbai';
    events.splice(2,0,replay);
  }
  return compileVoicebotQualification(events,{
    expectedCallId:call,expectedSessionId:sid,expectedAccountId:account,
    language:'hi',now
  });
}
