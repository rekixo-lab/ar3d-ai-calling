// This maintenance adapter is deliberately NOT registered as a scheduled
// handler or HTTP route. A trusted operator must explicitly enable execution
// after approving retention periods, backups and privacy policies.
const MAX_ROWS=250;
export function retentionPlan(timestamp=Date.now(),limit=100){
  if(!Number.isSafeInteger(timestamp)||timestamp<0||!Number.isSafeInteger(limit)||
     limit<1||limit>MAX_ROWS)throw Error('invalid retention parameters');
  const iso=new Date(timestamp).toISOString(),previous=timestamp-16*60*1000;
  return Object.freeze([
    {database:'CONTROL_DB',table:'human_sessions',
      sql:'DELETE FROM human_sessions WHERE token_hash IN (SELECT token_hash FROM human_sessions WHERE expires_at<? LIMIT ?)',
      params:[timestamp,limit]},
    {database:'CONTROL_DB',table:'human_mfa_challenges',
      sql:'DELETE FROM human_mfa_challenges WHERE token_hash IN (SELECT token_hash FROM human_mfa_challenges WHERE expires_at<? LIMIT ?)',
      params:[timestamp,limit]},
    {database:'CONTROL_DB',table:'human_invitations',
      sql:'DELETE FROM human_invitations WHERE token_hash IN (SELECT token_hash FROM human_invitations WHERE expires_at<? LIMIT ?)',
      params:[timestamp,limit]},
    {database:'CONTROL_DB',table:'human_ip_login_limits',
      sql:'DELETE FROM human_ip_login_limits WHERE ip_hash IN (SELECT ip_hash FROM human_ip_login_limits WHERE window_start<? AND blocked_until<=? LIMIT ?)',
      params:[previous,timestamp,limit]},
    {database:'CRM_DB',table:'conversation_simulations',
      sql:'DELETE FROM conversation_simulations WHERE rowid IN (SELECT rowid FROM conversation_simulations WHERE expires_at<? LIMIT ?)',
      params:[iso,limit]}
  ]);
}
export async function executeRetention(env,{timestamp=Date.now(),limit=100,execute=false}={}){
  const plan=retentionPlan(timestamp,limit);
  if(!execute)return {dryRun:true,tables:plan.map(x=>x.table),rowsDeleted:0};
  if(env?.RETENTION_MAINTENANCE_ENABLED!=='true'||!env.CONTROL_DB||!env.CRM_DB)
    throw Error('retention maintenance has not been operator-enabled');
  const removed={};
  for(const task of plan){
    const result=await env[task.database].prepare(task.sql).bind(...task.params).run();
    removed[task.table]=Number(result.meta?.changes||0);
  }
  return {dryRun:false,removed,notes:'Only expired auth/session artifacts and synthetic demos were deleted; leads, opt-outs and recordings were not touched.'};
}
