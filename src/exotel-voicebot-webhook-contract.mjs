// Exotel Managed Voicebot webhook format, validated OFFLINE only.
// No incoming provider route, trust in vendor source, call initiation,
// CRM write, consent change, billing or audio recording is implemented.
// Documented: https://docs.exotel.com/intelligent-voice-agents/voicebot-webhooks
// Exotel sends completed transcript *turns* during calls; session_end
// alone does NOT carry the full transcript. Events may be retried/out of order.
const MAX_JSON=16384;
const ID=/^[A-Za-z0-9_.:-]{4,128}$/;
const SESSION_STATES=new Set(['session_start','session_in_progress','session_end']);
const REASONS=new Set(['timer','turn-complete','turn-progress','pre-agent-transfer','start','end']);
const NETWORK=new Set(['pstn','sip']);
const EVENT_TYPES=new Set(['sentiment','summary','intent','entity','outcome','transcript']);
const SPEAKERS=new Set(['assistant','user','customer']);
const OPT_OUT=/(?:stop calling|do not call|don't call|remove my number|unsubscribe|कॉल मत|फोन मत|दोबारा कॉल मत|नंबर हटा|नम्बर हटा|बात नहीं करनी)/iu;
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const isId=x=>typeof x==='string'&&ID.test(x);
function need(ok,msg){if(!ok)throw Error('invalid Exotel Voicebot '+msg)}
function boundedText(value){
  need(typeof value==='string'&&value.length>=1&&value.length<=500&&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
  'transcript segment');
  return value;
}
function safeIso(x){
  if(x===undefined||x===null)return null;
  need(typeof x==='string'&&x.length<=40&&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(x),
    'timestamp');
  need(Number.isFinite(Date.parse(x)),'timestamp');
  return x;
}
export function parseExotelVoicebotEvent(raw){
  const value=raw instanceof Uint8Array?
    (()=>{
      need(raw.byteLength>10&&raw.byteLength<=MAX_JSON,'raw bytes');
      try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))}
      catch{throw Error('invalid Exotel Voicebot JSON')}
    })():raw;
  need(rec(value),'envelope');
  // Never retain phone/contact URI, custom parameters, summary, or IP.
  need(isId(value.session_id)&&isId(value.conversation_id)&&
    isId(value.external_id),'session identity');
  need(SESSION_STATES.has(value.session_state)&&REASONS.has(value.trigger_reason),
    'session state');
  need(NETWORK.has(value.network_type),'network type');
  need(value.account_id===undefined||typeof value.account_id==='string'&&
    value.account_id.length<=128,'account');
  need(value.bot_id===undefined||typeof value.bot_id==='string'&&
    value.bot_id.length<=128,'bot');
  need(value.metadata===undefined||rec(value.metadata),'metadata');
  // The vendor documents both external_id and metadata.call_sid, but their
  // equality is shown in a sample, not specified as a required invariant.
  // Real calls may expose a separate call-leg SID. Validate each independently,
  // then correlate both against independently verified provider records before
  // any tenant/lead or CRM operation. This parser grants NO source trust.
  if(value.metadata?.call_sid!==undefined&&value.metadata?.call_sid!=='')
    need(isId(value.metadata.call_sid),'provider call reference');
  safeIso(value.start_time);safeIso(value.end_time);
  need(Array.isArray(value.events)&&value.events.length<=8,'event list');
  const ids=new Set(),events=[];
  for(const item of value.events){
    need(rec(item)&&EVENT_TYPES.has(item.event_type)&&isId(item.event_id)&&
      rec(item.event_data),'event');
    need(!ids.has(item.event_id),'duplicate event id in one delivery');
    ids.add(item.event_id);
    if(item.event_type!=='transcript')continue; // other AI claims are untrusted.
    const parts=item.event_data.transcripts;
    need(Array.isArray(parts)&&parts.length===1,'transcript turn');
    const turn=parts[0];
    need(rec(turn)&&Number.isSafeInteger(turn.sequence)&&
      turn.sequence>=1&&turn.sequence<=100,'turn sequence');
    const status=turn.status??'completed';
    need(['completed','inprogress'].includes(status),'turn status');
    need(Array.isArray(turn.transcript_segments)&&
      turn.transcript_segments.length>=1&&
      turn.transcript_segments.length<=16,'turn segments');
    const segments=turn.transcript_segments.map(seg=>{
      need(rec(seg)&&SPEAKERS.has(seg.speaker),'speaker');
      safeIso(seg.start_timestamp);safeIso(seg.end_timestamp);
      return Object.freeze({speaker:seg.speaker,text:boundedText(seg.text)});
    });
    events.push(Object.freeze({
      eventId:item.event_id,sequence:turn.sequence,status,
      segments:Object.freeze(segments)
    }));
  }
  return Object.freeze({
    source:'untrusted_exotel_voicebot_webhook_payload',
    sessionId:value.session_id,conversationId:value.conversation_id,
    callId:value.external_id,providerCallSid:value.metadata?.call_sid||null,
    accountId:value.account_id||null,botId:value.bot_id||null,
    state:value.session_state,reason:value.trigger_reason,
    events:Object.freeze(events),
    sourceAuthenticated:false,leadMatched:false,crmWrites:0,
    customerPhoneReturned:false,consentChanged:false,
    liveCallsStarted:0
  });
}
export function reviewExotelVoicebotEvents(deliveries,{
  expectedCallId,expectedSessionId,expectedAccountId
}={}){
  need(Array.isArray(deliveries)&&deliveries.length>=1&&
    deliveries.length<=60,'delivery count');
  // Independent provider lookup + operator-created call registry is required
  // before the expected IDs can be treated as trustworthy.
  need(isId(expectedCallId)&&isId(expectedSessionId),'expected call identity');
  if(expectedAccountId!==undefined)need(isId(expectedAccountId),'expected account');
  const eventIds=new Map(),completed=new Map(),seenStates=new Set();
  let ignoredProgress=0,duplicateEvents=0,possibleProgressOptOut=false;
  let deliveryIdentity=null;
  for(const raw of deliveries){
    const event=parseExotelVoicebotEvent(raw);
    need(event.callId===expectedCallId&&event.sessionId===expectedSessionId,
      'call identity mismatch');
    if(expectedAccountId!==undefined)need(event.accountId===expectedAccountId,
      'account identity mismatch');
    // Same CallSid and session alone do not guarantee all deliveries belong
    // to the same conversation or bot account. Never mix their question turns.
    const identity=JSON.stringify([
      event.conversationId,event.accountId,event.providerCallSid
    ]);
    if(deliveryIdentity!==null)need(deliveryIdentity===identity,
      'mixed conversation/account identity');
    else deliveryIdentity=identity;
    seenStates.add(event.state);
    for(const item of event.events){
      const fingerprint=JSON.stringify([item.sequence,item.status,item.segments]);
      const old=eventIds.get(item.eventId);
      if(old!==undefined){
        need(old===fingerprint,'conflicting duplicate event id');
        duplicateEvents++;continue;
      }
      eventIds.set(item.eventId,fingerprint);
      if(item.status!=='completed'){
        ignoredProgress++;
        // A provisional "do not call" may be revised, but never silently
        // lose a safety signal merely because Exotel omitted a final turn.
        if(item.segments.some(seg=>(seg.speaker==='user'||seg.speaker==='customer')&&
          OPT_OUT.test(seg.text))) possibleProgressOptOut=true;
        continue;
      }
      const previous=completed.get(item.sequence);
      if(previous!==undefined){
        need(previous===JSON.stringify(item.segments),
          'conflicting completed turn sequence');
        duplicateEvents++;continue;
      }
      completed.set(item.sequence,JSON.stringify(item.segments));
    }
  }
  const sorted=[...completed].sort((a,b)=>a[0]-b[0]);
  const completedSequenceContinuous=sorted.every(([number],i)=>number===i+1);
  const answerTexts=sorted.flatMap(([,raw])=>JSON.parse(raw))
    .filter(x=>x.speaker==='user'||x.speaker==='customer')
    .map(x=>x.text);
  // Never return transcript words, account IDs, session IDs, phone numbers,
  // CRM customer details or potentially sensitive event metadata to UI.
  const optOutReviewNeeded=possibleProgressOptOut||answerTexts.some(t=>OPT_OUT.test(t));
  return Object.freeze({
    provider:'exotel',mode:'offline_contract_review_only',
    completedTurns:sorted.length,customerAnswerSegments:answerTexts.length,
    nonfinalTurnsIgnored:ignoredProgress,duplicateEventsIgnored:duplicateEvents,
    seenSessionEnd:seenStates.has('session_end'),
    completedSequenceContinuous,optOutReviewNeeded,
    completeSevenQuestionSurveyVerified:false,
    humanReviewRequired:true,identityVerifiedWithExotel:false,
    providerWebhookAuthenticated:false,recipientConsentVerified:false,
    callRegistryMatched:false,callerNumberVerified:false,
    crmWrites:0,visitConfirmed:false,phoneCallsStarted:0,billable:false,
    notice:'Only provider-shaped fictional/test events were parsed; no authenticated voice delivery or CRM mutation.'
  });
}
export function exotelVoicebotAck(){
  // Exotel VoiceBot webhook docs expect this shape on session-end/turn
  // notifications; we DO NOT expose an unauthenticated public endpoint.
  return Object.freeze({http_code:200,response:{data:{}}});
}
// Synthetic events reproduce the officially documented wire *shape*.
// No real user, Exotel account, phone number or network request is included.
export function runExotelVoicebotOfflineFixture(scenario='seven_questions'){
  need(['seven_questions','out_of_order','retry_duplicate','opt_out','malformed'].includes(scenario),
    'test scenario');
  const sessionId='fictional-session-2026',callId='CAfictionalcall2026';
  const base={
    session_id:sessionId,conversation_id:'fictional-conversation-2026',
    external_id:callId,account_id:'fictional-account-2026',
    session_state:'session_in_progress',trigger_reason:'turn-complete',
    network_type:'pstn',contact_uri:'+919000000001',
    metadata:{call_sid:callId},events:[]
  };
  const answers=['Plot','Raipur','Shankar Nagar','1200 sqft',
    '25 lakh','हाँ interested','2026-11-25'];
  const deliveries=answers.map((text,i)=>({
    ...base,events:[{event_type:'transcript',event_id:'fictional-event-'+(i+1),
      event_data:{transcripts:[{sequence:i+1,status:'completed',
        transcript_segments:[
          {speaker:'assistant',text:'Fictional question '+(i+1)},
          {speaker:'user',text}
        ]}]}}
    ]
  }));
  deliveries.push({...base,session_state:'session_end',trigger_reason:'end',
    events:[]});
  if(scenario==='out_of_order')deliveries.reverse();
  if(scenario==='retry_duplicate')deliveries.splice(2,0,
    JSON.parse(JSON.stringify(deliveries[1])));
  if(scenario==='opt_out')deliveries[3].events[0].event_data.transcripts[0]
    .transcript_segments[1].text='कॉल मत करना';
  if(scenario==='malformed')deliveries[3].events[0].event_data.transcripts[0]
    .transcript_segments[0].speaker='administrator';
  return reviewExotelVoicebotEvents(deliveries,{
    expectedCallId:callId,expectedSessionId:sessionId,
    expectedAccountId:'fictional-account-2026'
  });
}
