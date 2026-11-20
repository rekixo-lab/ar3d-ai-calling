// Super Admin read-only operational telemetry for Exotel Voicebot webhook
// quarantine receipts. Never resolves call/lead identity or reads transcripts.
const PATH='/v1/human/engineering/exotel-webhook-health';
const HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
const json=(body,status=200)=>Response.json(body,{status,headers:HEADERS});
const fail=(error,status=400)=>json({error},status);
const TOKEN=/^[0-9a-f]{64}$/i;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const count=value=>{
  const n=Number(value??0);
  if(!Number.isSafeInteger(n)||n<0)throw Error('invalid receipt count');
  return n;
};

export async function handleExotelWebhookHealth(req,env,user,{now=Date.now()}={}){
  const url=new URL(req.url);
  if(url.pathname!==PATH)return null;
  if(req.method!=='GET')return fail('method_not_allowed',405);
  if(url.search)return fail('unsupported_query',400);
  if(user?.globalRole!=='super_admin')return fail('forbidden',403);
  if(!Number.isSafeInteger(now)||now<1||!env?.CONTROL_DB?.prepare)
    return fail('control_database_unavailable',503);
  const db=env.CONTROL_DB;
  // Require a session initiated AFTER MFA was enabled, like the existing
  // operator status/read-only Exotel integration. No API-key or tenant access.
  let mfa;
  try{
    mfa=await db.prepare(
      'SELECT m.enabled_at FROM human_mfa_settings m JOIN human_sessions s '+
      'ON s.user_id=m.user_id WHERE m.user_id=? AND s.token_hash=? '+
      'AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at '+
      'AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1'
    ).bind(user.id,user.token_hash,now).first();
  }catch{return fail('session_verification_unavailable',503)}
  if(!mfa?.enabled_at)return fail('recent_mfa_login_required',403);
  let record;
  try{
    record=await db.prepare(
      'SELECT COUNT(*) AS uniqueReceipts, '+
      "SUM(CASE WHEN event_kind='transcript' THEN 1 ELSE 0 END) AS transcriptReceipts, "+
      "SUM(CASE WHEN event_kind='session_end' THEN 1 ELSE 0 END) AS sessionEndReceipts, "+
      "SUM(CASE WHEN turn_status='completed' THEN 1 ELSE 0 END) AS completedTurns, "+
      "SUM(CASE WHEN turn_status='inprogress' THEN 1 ELSE 0 END) AS inProgressTurns, "+
      'SUM(CASE WHEN possible_opt_out=1 THEN 1 ELSE 0 END) AS possibleOptOutSignals, '+
      'COUNT(DISTINCT session_fingerprint) AS distinctSessions, '+
      'MAX(received_at) AS lastReceivedAt '+
      'FROM exotel_voicebot_event_receipts WHERE expires_at>?'
    ).bind(now).first();
  }catch{return fail('webhook_receipts_unavailable',503)}
  if(!record)return fail('webhook_receipts_unavailable',503);
  try{
    const metrics={
      uniqueReceipts:count(record.uniqueReceipts),
      transcriptReceipts:count(record.transcriptReceipts),
      sessionEndReceipts:count(record.sessionEndReceipts),
      completedTurns:count(record.completedTurns),
      inProgressTurns:count(record.inProgressTurns),
      possibleOptOutSignals:count(record.possibleOptOutSignals),
      distinctSessions:count(record.distinctSessions)
    };
    const last=record.lastReceivedAt;
    if(last!==null&&last!==undefined&&(!ISO.test(last)||!Number.isFinite(Date.parse(last))))
      throw Error('invalid receipt timestamp');
    return json({
      mode:'read_only_quarantined_metadata',
      window:'unexpired_receipts_only',
      webhookTokenConfigured:TOKEN.test(String(env.EXOTEL_VOICEBOT_WEBHOOK_TOKEN||'')),
      metrics,lastReceivedAt:last||null,
      sourceVerified:false,callToLeadLinked:false,crmWrites:0,
      liveCallsStarted:0,recordingsFetched:0,
      note:'These are unique stored Bearer-authenticated webhook receipts, not delivery attempts or verified provider-origin events. Dashboard Test URL probes are not stored. No transcript or phone data is available here; any opt-out signal needs separate operator investigation.'
    });
  }catch{return fail('webhook_receipt_schema_invalid',503)}
}
