import {CAMPAIGN_CRON,runCampaignCron} from './campaign-dispatch.mjs';
// Live-safe, fixed-policy security maintenance for the isolated Calling
// Control D1. Runs ONLY from a Cloudflare Cron Trigger. No client, CRM,
// recording, consent, opt-out, lead or billing records are deleted.
import {retentionPlan} from './retention-maintenance.mjs';
import {pruneVerifiedVoicebotTurns} from './verified-voicebot-bridge.mjs';
export const AUTH_MAINTENANCE_CRON='0 */6 * * *';
export const AUTH_MAINTENANCE_LIMIT=100;
const TABLES=Object.freeze(['human_sessions','human_mfa_challenges',
  'human_invitations','human_ip_login_limits']);

export async function pruneExpiredAuth(env,{now=Date.now(),cron=AUTH_MAINTENANCE_CRON}={}){
  if(cron!==AUTH_MAINTENANCE_CRON||!Number.isSafeInteger(now)||now<0||
     !env?.CONTROL_DB?.prepare)
    throw Error('unauthorized or unconfigured auth retention event');
  // Reuse already reviewed, parameterized expiry predicates. Retain exactly
  // the four Control DB tasks; never run the fifth CRM conversation task.
  const plan=retentionPlan(now,AUTH_MAINTENANCE_LIMIT);
  if(plan.length!==5||!TABLES.every((table,i)=>plan[i]?.table===table&&
      plan[i].database==='CONTROL_DB')||
     plan[4]?.database!=='CRM_DB'||plan[4]?.table!=='conversation_simulations')
    throw Error('unexpected retention policy; maintenance refused');
  const counts={};
  for(const task of plan.slice(0,4)){
    if(!task.sql.startsWith('DELETE FROM '+task.table+' WHERE ')||
       !task.sql.includes(' LIMIT ?'))
      throw Error('unsafe expired session maintenance SQL');
    const result=await env.CONTROL_DB.prepare(task.sql)
      .bind(...task.params).run();
    const changes=result?.meta?.changes;
    if(!Number.isSafeInteger(changes)||changes<0||changes>AUTH_MAINTENANCE_LIMIT)
      throw Error('unconfirmed expired session cleanup');
    counts[task.table]=changes;
  }
  return Object.freeze({
    result:'expired_auth_artifacts_pruned',
    tablesChecked:TABLES.length,
    rowsDeleted:Object.values(counts).reduce((a,b)=>a+b,0),
    // No tokens, email, IP, invitation or account data in logs.
    service:'ar3d-ai-calling',consentTouched:false,crmTouched:false,
    leadDataTouched:false,recordingsTouched:false,billingTouched:false
  });
}

// Privacy-safe automatic deletion of the metadata-only Exotel webhook receipts.
// This uses the existing isolated Calling Control D1 cron and exactly one
// allowlisted table. No raw transcripts/phone numbers are stored to begin with.
export async function pruneExpiredExotelWebhookReceipts(env,{
  now=Date.now(),cron=AUTH_MAINTENANCE_CRON
}={}){
  if(cron!==AUTH_MAINTENANCE_CRON||!Number.isSafeInteger(now)||now<0||
     !env?.CONTROL_DB?.prepare)
    throw Error('unauthorized Exotel metadata retention event');
  const result=await env.CONTROL_DB.prepare(
    'DELETE FROM exotel_voicebot_event_receipts WHERE receipt_key IN ('+
    'SELECT receipt_key FROM exotel_voicebot_event_receipts '+
    'WHERE expires_at<=? ORDER BY expires_at LIMIT ?)'
  ).bind(now,AUTH_MAINTENANCE_LIMIT).run();
  const changes=result?.meta?.changes;
  if(!Number.isSafeInteger(changes)||changes<0||changes>AUTH_MAINTENANCE_LIMIT)
    throw Error('unconfirmed Exotel receipt retention cleanup');
  return changes;
}
export async function handleCallingCron(controller,env){
  if(controller?.cron===CAMPAIGN_CRON){
    const timestamp=controller.scheduledTime??Date.now();
    let campaigns;
    try{campaigns=await runCampaignCron(env,{now:timestamp})}
    catch{console.error('AR3D campaign scheduler unavailable');campaigns={processed:0,error:'scheduler_unavailable'}}
    // Reuse ONE account cron slot. Auth maintenance still runs only on the
    // original six-hour UTC boundaries; a campaign failure cannot skip it.
    if(Math.floor(timestamp/60000)%360!==0)return campaigns;
    const maintenance=await handleCallingCron({cron:AUTH_MAINTENANCE_CRON,scheduledTime:timestamp},env);
    return {...campaigns,maintenance};
  }
  if(controller?.cron!==AUTH_MAINTENANCE_CRON)
    throw Error('unknown Calling Worker cron expression');
  const timestamp=controller?.scheduledTime??Date.now();
  const result=await pruneExpiredAuth(env,{
    now:timestamp,cron:controller.cron
  });
  const webhookReceiptsDeleted=await pruneExpiredExotelWebhookReceipts(env,{
    now:timestamp,cron:controller.cron
  });
  const verifiedTurnsDeleted=env.CRM_DB?.prepare?await pruneVerifiedVoicebotTurns(env,{now:timestamp}):0;
  // Safe numeric counters only; never log event IDs, phones or transcript data.
  console.log('AR3D AI Calling control metadata cleanup: auth_tables='+
    result.tablesChecked+' auth_rows='+result.rowsDeleted+
    ' expired_webhook_receipts='+webhookReceiptsDeleted);
  return Object.freeze({...result,crmTouched:Boolean(env.CRM_DB?.prepare),webhookReceiptsDeleted,verifiedTurnsDeleted});
}
