// Pure isolated provider-ledger reconciliation preview. Never invoices, charges,
// modifies D1, or accepts unverifiable client-supplied phone numbers.
const ID=/^[A-Za-z0-9_-]{8,128}$/;
const VALID=new Set(['completed','failed','busy','no-answer']);
const MAX_EVENTS=1000;
export function reconcileProviderUsage(records,{quota=100,ratePaisePerMinute=null}={}){
  if(!Array.isArray(records)||records.length>MAX_EVENTS||
     !Number.isSafeInteger(quota)||quota<1||quota>100000||
     (ratePaisePerMinute!==null&&(!Number.isSafeInteger(ratePaisePerMinute)||
       ratePaisePerMinute<0||ratePaisePerMinute>100000)))
    throw Error('invalid provider usage batch');
  const seen=new Map(),calls=new Map();
  let duplicates=0,minutes=0,seconds=0,completed=0,failures=0;
  for(const e of records){
    if(!e||typeof e!=='object'||Array.isArray(e)||
       Object.keys(e).some(k=>!['eventId','callSid','tenantId','status','durationSeconds','source'].includes(k))||
       e.source!=='exotel_verified_readonly'||typeof e.eventId!=='string'||!ID.test(e.eventId)||
       typeof e.callSid!=='string'||!ID.test(e.callSid)||
       typeof e.tenantId!=='string'||!ID.test(e.tenantId)||
       !VALID.has(e.status)||!Number.isSafeInteger(e.durationSeconds)||
       e.durationSeconds<0||e.durationSeconds>14400||
       (e.status!=='completed'&&e.durationSeconds!==0))
      throw Error('untrusted or invalid provider usage record');
    const fingerprint=[e.tenantId,e.callSid,e.status,e.durationSeconds].join(':');
    if(seen.has(e.eventId)){
      if(seen.get(e.eventId)!==fingerprint)throw Error('conflicting provider event replay');
      duplicates++;continue;
    }
    const callKey=e.tenantId+':'+e.callSid;
    if(calls.has(callKey))throw Error('duplicate provider call with different event');
    seen.set(e.eventId,fingerprint);calls.set(callKey,true);
    seconds+=e.durationSeconds;
    if(e.status==='completed'){
      completed++;
      minutes+=Math.ceil(e.durationSeconds/60);
    }else failures++;
  }
  const estimatedPaise=ratePaisePerMinute===null?null:minutes*ratePaisePerMinute;
  if(estimatedPaise!==null&&!Number.isSafeInteger(estimatedPaise))
    throw Error('provider usage estimate exceeded safe range');
  return Object.freeze({
    source:'exotel_verified_readonly_preview',events:seen.size,
    completedCalls:completed,otherOutcomes:failures,
    duplicatesIgnored:duplicates,connectedSeconds:seconds,
    hypotheticalRoundedMinutes:minutes,quotaPreviewOnly:{
      limitCalls:quota,overLimit:seen.size>quota,remaining:Math.max(0,quota-seen.size)
    },
    hypotheticalRatePaisePerMinute:ratePaisePerMinute,
    hypotheticalChargePaise:estimatedPaise,
    durableEventsWritten:0,providerInvoiceReconciled:false,
    billable:false,paymentCollected:false,subscriptionUpdated:false,
    invoiceIssued:false,
    notice:'Provider-origin usage preview only. Billing method, rounding, taxes, provider invoices and payment plan not approved.'
  });
}
