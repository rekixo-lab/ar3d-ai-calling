// Read-only, ONE-WAY correlation *candidate* for the original operator's
// AR3D self-test call and quarantined Exotel Voicebot receipt metadata.
// This is NOT authenticated provider provenance, verified human identity,
// a customer/lead binding, transcript retrieval, consent or CRM evidence.
const HEX=/^[0-9a-f]{64}$/i;
const SID=/^[A-Za-z0-9_-]{4,128}$/;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const unavailable=Object.freeze({
  state:'unavailable',sourceAuthenticated:false,leadMatched:false,
  canUpdateCrm:false
});
function count(raw){
  const n=Number(raw??0);
  if(!Number.isSafeInteger(n)||n<0)throw Error('invalid webhook receipt count');
  return n;
}
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
async function receiptHmac(token,domain,value){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(token),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new TextEncoder().encode(domain+'\0'+JSON.stringify(value));
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes)));
}

// Exotel's documented external_id can equal the original AR3D call SID;
// metadata.call_sid is an independent leg reference, not always equal.
// Only accept one exact unambiguous shape: external_id equals our privately
// recorded provider CallSid AND metadata.call_sid is absent or the same.
// Accounts omitted by Exotel are allowed for a candidate ONLY. This never
// authorizes a call or upgrades the authenticity of a webhook.
export async function inspectOperatorWebhookCandidates(
  db,{webhookToken,accountSid,registeredCallSid,now=Date.now()}={}
){
  if(!db?.prepare||!HEX.test(String(webhookToken||''))||
     !SID.test(String(accountSid||''))||
     !SID.test(String(registeredCallSid||''))||
     !Number.isSafeInteger(now)||now<=0)
    return unavailable;
  const inputs=[
    [accountSid,registeredCallSid,registeredCallSid],
    [accountSid,registeredCallSid,''],
    ['',registeredCallSid,registeredCallSid],
    ['',registeredCallSid,'']
  ];
  try{
    const fingerprints=await Promise.all(inputs.map(a=>
      receiptHmac(webhookToken,'call',a)));
    const record=await db.prepare(
      'SELECT COUNT(*) AS uniqueReceipts, '+
      "SUM(CASE WHEN event_kind='transcript' THEN 1 ELSE 0 END) AS transcriptEvents, "+
      "SUM(CASE WHEN event_kind='session_end' THEN 1 ELSE 0 END) AS sessionEnds, "+
      "SUM(CASE WHEN turn_status='completed' THEN 1 ELSE 0 END) AS completedTurns, "+
      'SUM(CASE WHEN possible_opt_out=1 THEN 1 ELSE 0 END) AS possibleOptOutEvents, '+
      'COUNT(DISTINCT session_fingerprint) AS uniqueSessions, '+
      'MAX(received_at) AS lastReceivedAt '+
      'FROM exotel_voicebot_event_receipts '+
      "WHERE status='quarantined' AND expires_at>? "+
      'AND call_fingerprint IN (?,?,?,?)'
    ).bind(now,...fingerprints).first();
    if(!record)throw Error('receipt table absent');
    const metrics={
      uniqueReceipts:count(record.uniqueReceipts),
      transcriptEvents:count(record.transcriptEvents),
      sessionEnds:count(record.sessionEnds),
      completedTurns:count(record.completedTurns),
      possibleOptOutEvents:count(record.possibleOptOutEvents),
      uniqueSessions:count(record.uniqueSessions)
    };
    const last=record.lastReceivedAt;
    if(last!==null&&last!==undefined&&(
      typeof last!=='string'||!ISO.test(last)||!Number.isFinite(Date.parse(last))
    ))throw Error('invalid timestamp');
    return Object.freeze({
      state:'candidate_only',...metrics,lastReceivedAt:last??null,
      exactExternalIdCandidateOnly:true,
      crossLegIdsIncluded:false,
      sourceAuthenticated:false,providerCallDetailsVerifiedByThisCheck:false,
      leadMatched:false,canUpdateCrm:false,customerCallsStarted:0
    });
  }catch{
    // Missing schema, credentials or query errors are NOT "zero webhooks".
    // Keep the self-test history readable without exposing SQL/secret details.
    return unavailable;
  }
}
