// Guarded operator view, names/presence ONLY; never exposes secret values,
// account numbers, API tokens, callback URLs, clients or private data.
// A configured binding is NOT independent proof of business/telecom approval.
const tasks=Object.freeze([
 {id:'exotel_contract',owner:'operator',label:'Exotel Voice AI business approval and Account SID'},
 {id:'caller_number',owner:'operator',label:'Authorized ExoPhone/Caller ID and telecom/DLT traffic classification'},
 {id:'consent_dnd',owner:'operator',label:'Purpose-specific verified consent, DND and suppressions'},
 {id:'voice_provider',owner:'operator',label:'Approved Hindi/English realtime AI voice/STT/TTS/LLM plan'},
 {id:'payment_provider',owner:'operator',label:'Payment processor KYC, pricing, tax and refund policies'},
 {id:'backups',owner:'operator',label:'Cloudflare D1/R2 backups, access controls and real restore rehearsal'},
 {id:'mfa',owner:'operator',label:'Super Admin MFA enrollment and recovery code safe storage'},
 {id:'project_apis',owner:'operator',label:'Authorized read-only AR3D project knowledge API'}
]);
const bindings=Object.freeze([
 ['loginRateLimit','LOGIN_RATE_LIMIT_SECRET'],
 ['mfaEncryption','MFA_ENCRYPTION_KEY'],
 ['exotelApiKey','EXOTEL_API_KEY'],
 ['exotelApiToken','EXOTEL_API_TOKEN'],
 ['exotelAccount','EXOTEL_ACCOUNT_SID'],
 ['exotelCaller','EXOTEL_CALLER_ID'],
 ['voiceProvider','VOICE_AI_API_KEY'],
 ['paymentGateway','RAZORPAY_KEY_ID'],
 ['paymentSecret','RAZORPAY_KEY_SECRET'],
 ['paymentWebhook','RAZORPAY_WEBHOOK_SECRET']
]);
export function operationalReadiness(env={}){
  if(!env||typeof env!=='object')env={};
  const configured={};
  for(const [name,key] of bindings)
    configured[name]=typeof env[key]==='string'&&env[key].trim().length>=8;
  return {
    stage:'operator_and_provider_approval_required',
    codeDeployed:true,commercialLaunchApproved:false,
    liveCallingEnabled:false,realVoiceStreamingEnabled:false,
    paymentCollectionEnabled:false,
    // Secret presence, not its value, shown only on authenticated Super Admin route.
    credentialBindingsConfigured:configured,
    operatorActions:tasks.map(t=>({...t,status:'requires_independent_verification'})),
    note:'Presence of environment keys alone cannot authorize telecom calling, recipient consent, payment collection or live audio.'
  };
}
