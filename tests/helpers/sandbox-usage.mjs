// Pure hypothetical usage previews. No provider facts, D1 writes or chargeable events.
// Only the internal synthetic engine may supply the exact event envelope.
const KEY=/^sandbox-[a-z0-9-]{1,64}$/;
export function previewSandboxUsage(events,{quotaCalls=100,ratePaisePerMinute=null}={}){
  if(!Array.isArray(events)||events.length>100||
     !Number.isSafeInteger(quotaCalls)||quotaCalls<1||quotaCalls>100000||
     (ratePaisePerMinute!==null&&(!Number.isSafeInteger(ratePaisePerMinute)||
       ratePaisePerMinute<0||ratePaisePerMinute>100000)))
    throw Error('invalid synthetic usage preview parameters');
  const seen=new Map(),calls=new Set();
  let totalSeconds=0,roundedMinutes=0,duplicatesIgnored=0;
  for(const raw of events){
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||
       Object.keys(raw).sort().join(',')!=='callId,durationSeconds,eventId,source'||
       raw.source!=='synthetic_sandbox'||typeof raw.eventId!=='string'||
       !KEY.test(raw.eventId)||typeof raw.callId!=='string'||!KEY.test(raw.callId)||
       !Number.isSafeInteger(raw.durationSeconds)||raw.durationSeconds<0||
       raw.durationSeconds>3600)
      throw Error('untrusted or invalid sandbox usage event');
    const signature=raw.callId+':'+raw.durationSeconds;
    const earlier=seen.get(raw.eventId);
    if(earlier!==undefined){
      if(earlier!==signature)throw Error('conflicting duplicate event');
      duplicatesIgnored++;
      continue;
    }
    if(calls.has(raw.callId))throw Error('duplicate call with a different event ID');
    seen.set(raw.eventId,signature);calls.add(raw.callId);
    totalSeconds+=raw.durationSeconds;
    // Billing providers vary; per-call rounding here is illustrative ONLY.
    roundedMinutes+=Math.ceil(raw.durationSeconds/60);
  }
  const acceptedCalls=calls.size;
  return {
    source:'synthetic_sandbox',acceptedCalls,duplicatesIgnored,totalSeconds,
    hypotheticalRoundedMinutes:roundedMinutes,
    hypotheticalRatePaisePerMinute:ratePaisePerMinute,
    hypotheticalCostPaise:ratePaisePerMinute===null?null:roundedMinutes*ratePaisePerMinute,
    quotaPreview:{limitCalls:quotaCalls,remainingCalls:Math.max(0,quotaCalls-acceptedCalls),
      overLimit:acceptedCalls>quotaCalls},
    paymentCollected:false,billable:false,invoiceGenerated:false,
    notice:'Illustrative rounding and quota only. Actual telecom usage, tariffs, subscriptions, taxes and payments are NOT connected.'
  };
}
