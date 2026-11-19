// Independent, fail-closed review contract. Synthetic facts supplied by this
// engineering sandbox are NEVER evidence of real consent, DND clearance,
// provider approval, compliant number allocation or a legal calling window.
// There is deliberately no true launch outcome in this module.
const FIELDS=['customerSegment','purpose','consentReview','dndReview','optedOut',
  'callerApproval','callerClassification','providerApproval','callingWindow',
  'disclosure','humanHandoff','recordingNotice'];
const PURPOSES=['promotional','service'];
const SEGMENTS=['prior_inquiry','unknown_contact'];
const APPROVED='independently_verified';
export function assessTelecomPreflight(raw={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     Object.keys(raw).some(k=>!FIELDS.includes(k)))throw Error('invalid telecom review input');
  const reasons=[];
  if(!SEGMENTS.includes(raw.customerSegment))
    reasons.push('Customer segment requires independent classification');
  if(!PURPOSES.includes(raw.purpose))
    reasons.push('Calling purpose requires review');
  // An existing inquiry does NOT independently establish consent.
  if(raw.consentReview!==APPROVED)
    reasons.push('Verified purpose-specific customer consent is unavailable');
  if(raw.dndReview!==APPROVED)
    reasons.push('Independent DND/customer-preference clearance is unavailable');
  if(raw.optedOut!==false)
    reasons.push('Contact is opted out or opt-out state is unknown');
  if(raw.providerApproval!==APPROVED)
    reasons.push('Provider identity, account and business approval are pending');
  if(raw.callerApproval!==APPROVED)
    reasons.push('Caller ID allocation and authority are not verified');
  if(raw.callerClassification!==raw.purpose||
     !PURPOSES.includes(raw.callerClassification))
    reasons.push('Promotional/service numbering and traffic classification not verified');
  if(raw.callingWindow!==APPROVED)
    reasons.push('Provider-approved local calling hours are not verified');
  if(raw.disclosure!==APPROVED)
    reasons.push('AI identity/call purpose disclosure is not approved');
  if(raw.humanHandoff!==APPROVED)
    reasons.push('Human handoff and opt-out escalation are not verified');
  if(raw.recordingNotice!==APPROVED)
    reasons.push('Recording policy/notice and retention are not verified');
  return Object.freeze({
    outcome:reasons.length?'blocked':'manual_review_only',
    checksPassing:reasons.length===0,
    executionAllowed:false, // invariant: cannot become true from API input
    immutableNoDialGate:true,
    reasons:reasons.length?reasons:[
      'Independent legal/provider approval cannot be granted by this software',
      'Live dispatch, verified callback/media gateway and billing are not enabled'
    ],
    notice:'Simulation and review only. Never authorize a live call from client-supplied flags.'
  });
}
