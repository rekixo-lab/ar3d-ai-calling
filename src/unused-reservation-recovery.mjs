// Repair only the terminal pre-submission failure caused by treating D1's
// trigger-inclusive changes count as a failed reservation. This is an explicit
// Super Admin operation, never a scheduler retry or an age-based hold release.
import {SCRIPTED_CALLING_POLICY} from './scripted-phone-pilot.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const jobPattern=/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const auditAction='calling.unused_reservation_released';

export async function releaseUnusedReservation(env,crm,{tenantId,jobId},actor,now=Date.now()){
 if(!uuid.test(tenantId||'')||!jobPattern.test(jobId||'')||typeof actor!=='string'||!actor||
    !Number.isSafeInteger(now)||now<0)throw Error('invalid unused reservation recovery');
 // This exact failure is written only when reserveBudgetedMinutes returned
 // false, before reserveCampaignQuestionnaire and the provider submission.
 // Failed jobs are terminal: neither dispatch nor callbacks can revive them.
 // Missing sessions alone are deliberately insufficient evidence.
 const job=await crm.prepare(`SELECT j.reserved_at AS reservedAt FROM calling_jobs j
  WHERE j.tenant_id=? AND j.id=? AND j.flow_id=? AND j.state='failed'
  AND j.error_code='credit_reservation_unavailable'
  AND j.reserved_at IS NOT NULL AND j.reserved_at=j.updated_at
  AND j.account_sid IS NOT NULL AND j.caller_id IS NOT NULL AND j.destination IS NOT NULL
  AND j.provider_call_sid IS NULL AND j.provider_status IS NULL
  AND j.duration_seconds IS NULL AND j.checked_at IS NULL
  AND EXISTS(SELECT 1 FROM crm_audit_events e WHERE e.tenant_id=j.tenant_id AND e.target_id=j.id
   AND e.actor='scripted_campaign' AND e.action='calling.failed' AND e.created_at=j.updated_at)
  AND NOT EXISTS(SELECT 1 FROM crm_audit_events e WHERE e.tenant_id=j.tenant_id AND e.target_id=j.id
   AND e.action IN('calling.submitted','calling.completed','calling.unknown','calling.carrier_reviewed'))
  AND NOT EXISTS(SELECT 1 FROM scripted_call_results r WHERE r.tenant_id=j.tenant_id AND r.job_id=j.id)
  AND NOT EXISTS(SELECT 1 FROM verified_provider_call_costs c WHERE c.tenant_id=j.tenant_id AND c.job_id=j.id)`)
  .bind(tenantId,jobId,SCRIPTED_CALLING_POLICY).first();
 if(!job)return {ok:false,state:'no_submission_not_proven'};

 const control=env.CONTROL_DB,evidence='verified-no-submission:reservation-failure:'+jobId;
 const lookup=()=>control.prepare(`SELECT h.state,h.reserved_seconds AS reservedSeconds,
  h.charged_seconds AS chargedSeconds,h.evidence_ref AS evidenceRef,h.created_at AS createdAt,
  r.reserved_seconds AS moneySeconds,r.created_at AS moneyCreatedAt,
  EXISTS(SELECT 1 FROM human_users WHERE id=? AND global_role='super_admin' AND status='active') AS operatorAllowed,
  EXISTS(SELECT 1 FROM scripted_phone_pilots WHERE tenant_id=h.tenant_id AND job_id=h.job_id) AS sessionPresent,
  EXISTS(SELECT 1 FROM provider_cost_reconciliations WHERE tenant_id=h.tenant_id AND job_id=h.job_id) AS reconciled,
  EXISTS(SELECT 1 FROM provider_balance_covered_calls WHERE tenant_id=h.tenant_id AND job_id=h.job_id) AS covered,
  EXISTS(SELECT 1 FROM tenant_audit_events WHERE tenant_id=h.tenant_id AND target_id=h.job_id
   AND action=? AND json_extract(detail_json,'$.evidenceRef')=?) AS recoveryRecorded
  FROM tenant_minute_holds h JOIN provider_cost_reservations r ON r.tenant_id=h.tenant_id AND r.job_id=h.job_id
  WHERE h.tenant_id=? AND h.job_id=?`).bind(actor,auditAction,evidence,tenantId,jobId).first();
 const prior=await lookup();
 if(!prior)return {ok:false,state:'reservation_unavailable'};
 if(!prior.operatorAllowed)return {ok:false,state:'super_admin_required'};
 if(prior.sessionPresent||prior.reconciled||prior.covered||prior.createdAt!==job.reservedAt||
    prior.moneyCreatedAt!==job.reservedAt||prior.moneySeconds!==prior.reservedSeconds)
  return {ok:false,state:'no_submission_not_proven'};
 const matches=r=>r?.state==='released'&&r.chargedSeconds===0&&r.evidenceRef===evidence&&r.recoveryRecorded===1;
 const success=(r,replayed)=>({ok:true,replayed,state:'released',releasedSeconds:r.reservedSeconds,
  chargedSeconds:0,callPlaced:false,providerRequests:0});
 if(prior.state!=='held')return matches(prior)?success(prior,true):{ok:false,state:'reservation_changed'};

 // Same verified-no-submission closure as closeMinuteHold, with an additional
 // atomic absence check that the general settlement primitive does not expose.
 // The audit and closure commit together; no provider expense is fabricated.
 // RETURNING identifies the updated row. Never infer success from D1 metadata,
 // whose changes value includes writes performed by triggers.
 const auditId=crypto.randomUUID(),at=new Date(now).toISOString();
 const detail=JSON.stringify({evidenceRef:evidence,kind:'verified_no_submission',
  reason:'credit_reservation_unavailable_before_session',releasedSeconds:prior.reservedSeconds,providerRequests:0});
 await control.batch([
  control.prepare(`UPDATE tenant_minute_holds SET state='released',charged_seconds=0,evidence_ref=?,closed_at=?
   WHERE tenant_id=? AND job_id=? AND state='held' AND reserved_seconds=? AND created_at=?
   AND EXISTS(SELECT 1 FROM human_users WHERE id=? AND global_role='super_admin' AND status='active')
   AND EXISTS(SELECT 1 FROM provider_cost_reservations r WHERE r.tenant_id=tenant_minute_holds.tenant_id
    AND r.job_id=tenant_minute_holds.job_id AND r.reserved_seconds=tenant_minute_holds.reserved_seconds
    AND r.created_at=tenant_minute_holds.created_at)
   AND NOT EXISTS(SELECT 1 FROM scripted_phone_pilots s WHERE s.tenant_id=tenant_minute_holds.tenant_id AND s.job_id=tenant_minute_holds.job_id)
   AND NOT EXISTS(SELECT 1 FROM provider_cost_reconciliations r WHERE r.tenant_id=tenant_minute_holds.tenant_id AND r.job_id=tenant_minute_holds.job_id)
   AND NOT EXISTS(SELECT 1 FROM provider_balance_covered_calls c WHERE c.tenant_id=tenant_minute_holds.tenant_id AND c.job_id=tenant_minute_holds.job_id)
   RETURNING tenant_id,job_id,reserved_seconds`)
   .bind(evidence,at,tenantId,jobId,prior.reservedSeconds,job.reservedAt,actor),
  control.prepare(`INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,detail_json,created_at)
   SELECT ?,?,'human:'||?,?,?, ?,? WHERE changes()=1`)
   .bind(auditId,tenantId,actor,auditAction,jobId,detail,at)
 ]);
 const saved=await lookup();
 if(!matches(saved))return {ok:false,state:'reservation_changed'};
 const own=await control.prepare('SELECT id FROM tenant_audit_events WHERE id=?').bind(auditId).first();
 return success(saved,!own);
}
