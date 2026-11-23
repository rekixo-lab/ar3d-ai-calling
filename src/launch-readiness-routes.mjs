import {inspectScriptedPromptPack} from './scripted-phone-pilot.mjs';
// Super Admin, current-MFA only. This endpoint is strictly read-only:
// it never calls Plivo, creates secrets, changes CRM consent, or enables dialing.
// Public descriptions are intentionally code-backed/explicitly unverified.
export const PATH='/v1/human/launch-readiness';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
const json=(body,status=200)=>Response.json(body,{status,headers});
const valid=(s,re)=>typeof s==='string'&&re.test(s);
const authId=s=>valid(s,/^[A-Za-z0-9]{8,64}$/);
const authToken=s=>valid(s,/^[A-Za-z0-9]{16,128}$/);
const indiaNumber=s=>valid(s,/^\+91[1-9]\d{9}$/);
const secureOrigin=s=>valid(s,/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i);
const uuid=s=>valid(s,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);

export function buildPlivoReadinessSnapshot(env){
 const configured=[
  ['plivoAuthId',authId(env?.PLIVO_AUTH_ID),'Plivo Auth ID is syntactically configured'],
  ['plivoAuthToken',authToken(env?.PLIVO_AUTH_TOKEN),'Plivo Auth Token is syntactically configured'],
  ['plivoCallerNumber',indiaNumber(env?.AR3D_PLIVO_CALLER_NUMBER),'Indian E.164 caller ID is configured'],
  ['recordingAuthorizationMarked',env?.AR3D_PLIVO_RECORDING_AUTH==='confirmed','Recording authorization is operator-marked confirmed'],
  ['pilotOrigin',secureOrigin(env?.AR3D_SCRIPTED_PILOT_ORIGIN),'Secure callback origin is configured'],
  ['pilotEnabled',env?.AR3D_SCRIPTED_PILOT_ENABLED==='enabled','Internal pilot switch is enabled'],
  ['pilotDestination',indiaNumber(env?.AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER),'Internal pilot destination is configured'],
  ['pilotTenantId',uuid(env?.AR3D_SCRIPTED_PILOT_TENANT_ID),'Internal pilot tenant ID is configured'],
  ['pilotLeadId',uuid(env?.AR3D_SCRIPTED_PILOT_LEAD_ID),'Internal pilot CRM lead ID is configured'],
  ['workersAi',typeof env?.AI?.run==='function','Workers AI transcription binding exists'],
  ['privateRecordings',typeof env?.RECORDINGS?.get==='function'&&
    typeof env?.RECORDINGS?.head==='function','Private R2 recording/prompt binding exists'],
  ['customerDispatchSwitch',env?.AR3D_SCRIPTED_CAMPAIGNS_ENABLED==='enabled','Customer campaign switch is enabled']
 ].map(([id,present,label])=>({id,configured:Boolean(present),label}));
 const engineering=[
  {id:'open_conversation',ready:false,label:'Optional later upgrade: open-ended real-time conversation is not part of the agreed fixed-question v1'},
  {id:'provider_dnd',ready:false,label:'Independently verified provider DND/suppression lookup is not integrated'},
  {id:'privacy_disaster_recovery',ready:false,label:'Production PII deletion, scheduled backup and verified restore drill are not signed off'},
  {id:'billing',ready:false,label:'Durable provider-rated minute reconciliation, paid subscriptions and invoicing are not implemented'}
 ];
 const external=[
  {id:'india_kyc',verified:false,label:'India business KYC and permitted traffic classification require Plivo/provider confirmation'},
  {id:'approved_caller',verified:false,label:'Approved Plivo Indian caller number and verified live route require provider confirmation'},
  {id:'consent_dnd',verified:false,label:'Live recipient consent, DND evidence, call-time rules and recording notice require operator sign-off'},
  {id:'internal_pilot',verified:false,label:'Real signed Plivo internal pilot call, audio quality and CRM result require human acceptance'},
  {id:'admin_mfa',verified:false,label:'Per-account MFA rollout and operator access review require production sign-off'}
 ];
 return {
  provider:'Plivo',
  checkedAt:new Date().toISOString(),
  mode:'prelaunch_read_only',
  environment:configured,
  engineering,
  external,
  scriptedCallingImplemented:true,
  realTimeConversationImplemented:false,
  credentialsValidatedWithProvider:false,
  kycStatusVerified:false,
  liveCallAttempted:false,
  customerCallsAuthorizedByThisReport:false,
  canClaimProductionReady:false,
  notice:'The agreed v1 is a fixed-question Smart Voice Q&A, not an open-ended real-time LLM. Configuration or uploaded recordings do not prove carrier KYC, consent/DND or live audio quality.'
 };
}

export async function handleLaunchReadiness(req,env,user){
 const url=new URL(req.url);
 if(url.pathname!==PATH)return null;
 if(req.method!=='GET')return json({error:'method not allowed'},405);
 if(url.search)return json({error:'unsupported query'},400);
 if(user?.globalRole!=='super_admin')return json({error:'forbidden'},403);
 const now=Date.now();
 const mfa=await env.CONTROL_DB.prepare(`SELECT 1 AS verified
  FROM human_mfa_settings m JOIN human_sessions s ON s.user_id=m.user_id
  WHERE m.user_id=? AND s.token_hash=? AND m.enabled_at IS NOT NULL
    AND s.created_at>=m.enabled_at AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1`)
   .bind(user.id,user.token_hash,now).first();
 if(!mfa)return json({error:'current Super Admin MFA session required'},403);
 // R2 HEAD metadata only, after fresh MFA verification. No audio-body reads.
 const audioPacks=await Promise.all(['hi','en'].map(language=>
  inspectScriptedPromptPack(env,language)));
 return json({...buildPlivoReadinessSnapshot(env),audioPacks});
}
