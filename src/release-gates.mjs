// Verified code-level release status for the isolated Calling Worker.
// These are immutable statements about implemented capabilities, NOT a check
// of external vendor approvals or a way to enable dialing/payment.
export const RELEASE_GATES=Object.freeze([
  Object.freeze({id:'crm_demo',workstream:'A',state:'available',description:'Authenticated CRM and deterministic conversation simulator for synthetic testing'}),
  Object.freeze({id:'admin_mfa_enrollment',workstream:'A',state:'operator_pending',description:'MFA code is present; per-account enrollment and enforced rollout remain unverified'}),
  Object.freeze({id:'browser_e2e',workstream:'A',state:'unverified',description:'Real browser/mobile acceptance and cross-tenant staging tests are not signed off'}),
  Object.freeze({id:'backup_restore',workstream:'A',state:'unverified',description:'Scheduled backup, restore drill and incident alerting are not signed off'}),
  Object.freeze({id:'exotel_voice_ai_contract',workstream:'B',state:'mock_tested',description:'Exotel Connect Voice AI request shape and untrusted callback parsing are mock-tested only; live integration remains blocked'}),
  Object.freeze({id:'approved_telecom',workstream:'B',state:'blocked',description:'Provider contract, authorized caller identity and telecom classification are missing'}),
  Object.freeze({id:'consent_and_dnd',workstream:'B',state:'blocked',description:'Independent consent verification and DND clearance are not integrated'}),
  Object.freeze({id:'realtime_voice',workstream:'B',state:'blocked',description:'Realtime provider transport and production STT/LLM/TTS are not connected'}),
  Object.freeze({id:'provider_webhooks',workstream:'B',state:'blocked',description:'No authenticated real-provider callback or live call reconciliation'}),
  Object.freeze({id:'usage_reconciliation',workstream:'C',state:'blocked',description:'Provider usage records and durable billable event reconciliation are not integrated'}),
  Object.freeze({id:'paid_subscriptions',workstream:'C',state:'blocked',description:'Payments, taxes, invoice, refund and plan quota enforcement are not implemented'}),
  Object.freeze({id:'verified_project_knowledge',workstream:'C',state:'blocked',description:'Tenant-scoped, signed AR3D project knowledge has not been verified'})
]);
export function productionReadiness(){
  return {
    product:'AR3D AI Calling',
    mode:'development_synthetic_only',
    capabilities:{
      authenticatedCrmDemo:true,
      syntheticSandbox:true,
      realCalling:false,
      realAudioStreaming:false,
      billableUsage:false,
      paymentCollection:false
    },
    gates:RELEASE_GATES.map(g=>({...g})),
    productionLaunchAuthorized:false,
    notice:'Engineering simulation cannot authorize calls, provide customer consent, approve telecom numbers, charge users or replace security/restore sign-off.'
  };
}
