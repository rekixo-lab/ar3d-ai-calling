// A single production availability policy for the queue, dashboard and
// dispatcher. Feature availability NEVER supplies consent or authorization.
import {resolveFundingEnv} from './provider-funding.mjs';
import {approvedCampaignPhone} from './scripted-phone-pilot.mjs';
import {fundedDispatchApproved,inCallingWindow} from './scripted-campaign-dispatch.mjs';
import {automaticMinuteSettlementApproved} from './plivo-cost-reconcile-routes.mjs';
import {campaignDispatchInterlock} from './calling-dispatch-pause.mjs';
const approvals=Object.freeze([
 ['AR3D_INDUSTRY_SCHOOL_FUNDED_ADMISSION','approved','school_funding_approval_required'],
 ['AR3D_INDUSTRY_SCHOOL_VOICE_ENABLED','enabled','school_voice_approval_required'],
 ['AR3D_SCRIPTED_CAMPAIGNS_ENABLED','enabled','campaign_approval_required'],
 ['AR3D_CAMPAIGN_SARVAM_DISCLOSURE','approved','sarvam_disclosure_approval_required']
]);
export function schoolDispatchBlockers(env){
 const missing=[];
 // The isolated production template explicitly enables this product switch.
 // Absence means available, not approved. Explicit invalid/off fails closed.
 if(env.AR3D_INDUSTRY_SCHOOL_DISPATCH_ENABLED!==undefined&&env.AR3D_INDUSTRY_SCHOOL_DISPATCH_ENABLED!=='enabled')
  missing.push('school_dispatch_operator_disabled');
 for(const [key,value,reason] of approvals)if(env[key]!==value)missing.push(reason);
 return missing;
}
export const industryDispatchEnabled=env=>schoolDispatchBlockers(env).length===0;
// Read-only local checks: no network calls, secrets, wallet or job writes.
export async function inspectSchoolDispatchReadiness(baseEnv,{now=Date.now()}={}){
 const blockers=schoolDispatchBlockers(baseEnv);
 if(!blockers.length){
  try{
   const env=await resolveFundingEnv(baseEnv);
   const [carrier,interlock]=await Promise.all([approvedCampaignPhone(env),campaignDispatchInterlock(env.CONTROL_DB)]);
   if(!carrier)blockers.push('plivo_sarvam_acceptance_required');
   if(!fundedDispatchApproved(env))blockers.push('shared_provider_funding_required');
   if(!automaticMinuteSettlementApproved(env))blockers.push('automatic_cdr_settlement_required');
   if(interlock.paused)blockers.push('emergency_pause_active');
   if(interlock.providerBlocked)blockers.push('provider_fault_review_required');
  }catch{blockers.push('readiness_check_unavailable')}
 }
 return {available:industryDispatchEnabled(baseEnv),ready:blockers.length===0,blockers,callingWindowOpen:inCallingWindow(now)};
}
