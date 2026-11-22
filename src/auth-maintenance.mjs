import {retentionPlan} from './retention-maintenance.mjs';
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
