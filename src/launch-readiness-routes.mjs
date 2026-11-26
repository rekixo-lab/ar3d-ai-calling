import {inspectScriptedPromptPack,inspectInternalPilotLead} from './scripted-phone-pilot.mjs';
import {fundingCap} from './minute-holds.mjs';
import {moneyBudgetConfig} from './provider-cost-reservations.mjs';
import {resolveFundingEnv} from './provider-funding.mjs';
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
const indiaMobile=s=>valid(s,/^\+91[6-9]\d{9}$/);
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
  ['pilotDestination',indiaMobile(env?.AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER),'Internal pilot destination is configured'],
  ['pilotTenantId',uuid(env?.AR3D_SCRIPTED_PILOT_TENANT_ID),'Internal pilot tenant ID is configured'],
  ['pilotLeadId',uuid(env?.AR3D_SCRIPTED_PILOT_LEAD_ID),'Internal pilot CRM lead ID is configured'],
  ['sarvamSpeech',typeof env?.SARVAM_API_KEY==='string'&&Boolean(env.SARVAM_API_KEY.trim()),'Sarvam speech credential is configured (presence only)'],
  ['fundingReview',env?.AR3D_FUNDED_CAMPAIGN_DISPATCH==='approved'&&fundingCap(env)!==null&&moneyBudgetConfig(env)!==null,'Reviewed provider funding limits configured; recorded funds are not a live provider balance'],
  ['privateRecordings',typeof env?.RECORDINGS?.get==='function'&&
    typeof env?.RECORDINGS?.head==='function','Private R2 recording/prompt binding exists'],
  ['customerDispatchSwitch',env?.AR3D_SCRIPTED_CAMPAIGNS_ENABLED==='enabled','Customer campaign switch is enabled']
 ].map(([id,present,label])=>({id,configured:Boolean(present),label}));
 const engineering=[
  {id:'open_conversation',ready:false,label:'Optional later upgrade: open-ended real-time conversation is not part of the agreed fixed-question v1'},
  {id:'provider_dnd',ready:false,label:'Independently verified provider DND/suppression lookup is not integrated'},
  {id:'privacy_disaster_recovery',ready:false,label:'Production PII deletion, scheduled backup and verified restore drill are not signed off'},
  {id:'billing',ready:false,label:'Manual minute ledger, holds and matched CDR reconciliation are implemented; provider funding, actual commercial settlement and cost acceptance still require verification. External payments are out of scope.'}
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
  approvedLocalCallerBinding:env?.AR3D_PLIVO_CALLER_NUMBER==='+918065491333',
  productionOriginMatched:env?.AR3D_SCRIPTED_PILOT_ORIGIN==='https://aicalling.ar3dstudio.in',
  credentialsValidatedWithProvider:false,
  kycStatusVerified:false,
  liveCallAttempted:false,
  customerCallsAuthorizedByThisReport:false,
  canClaimProductionReady:false,
  notice:'The agreed v1 is a fixed-question Smart Voice Q&A, not an open-ended real-time LLM. Configuration or uploaded recordings do not prove carrier KYC, consent/DND or live audio quality.'
 };
}

// This concise operator checklist is derived only from Worker binding shape
// and R2 metadata. It does not prove telecom authorization, deployment or
// actual provider calls; no secrets or customer records are exposed.
export function productionSetupActions(snapshot,audioPacks,internalLead){
 const flags=Object.fromEntries((snapshot?.environment||[]).map(x=>[x.id,!!x.configured]));
 const hindi=Array.isArray(audioPacks)?audioPacks.find(x=>x?.language==='hi'):null;
 const step=(id,owner,label,ready,note)=>({id,owner,label,ready:Boolean(ready),note});
 return [
  step('deploy','Operator','Verify production Cloudflare main-push deployment',false,
   'Check the latest deploy-production.yml main run and Cloudflare ar3d-ai-calling Deployments. Confirm the safe POST Hangup smoke. PR CI is not proof of deployment.'),
  step('plivo_secrets','Operator','Set server-side Plivo Auth ID and Token',
   flags.plivoAuthId&&flags.plivoAuthToken,
   'Use Worker Secrets PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN, not chat, code or a public Variable.'),
  step('caller','Operator','Verify selected 080 caller and Plivo number ownership',
   flags.plivoCallerNumber&&snapshot?.approvedLocalCallerBinding,
   'Caller must be +918065491333; use MFA-only Check Plivo API & rented numbers. A matching number does not authorize promotional calling.'),
  step('callback','Operator','Set exact HTTPS callback origin',
   flags.pilotOrigin&&snapshot?.productionOriginMatched,
   'AR3D_SCRIPTED_PILOT_ORIGIN must be https://aicalling.ar3dstudio.in in the isolated Worker.'),
  step('hindi_audio','Operator','Review Hindi private R2 prompt pack and actual sound',
   !!hindi?.ready,
   'All scripted-phone-pilot/hi required MP3 object metadata must be ready; listen to opening, question and closing manually.'),
  step('recording','Operator','Confirm recording authorization and notice',
   flags.recordingAuthorizationMarked,
   'Set AR3D_PLIVO_RECORDING_AUTH=confirmed only after verifying recording permission, access and recipient notice.'),
  step('recipient','Operator','Enter owned verified internal mobile and CRM identifiers',
   flags.pilotDestination&&flags.pilotTenantId&&flags.pilotLeadId,
   'Configure AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER, AR3D_SCRIPTED_PILOT_TENANT_ID and AR3D_SCRIPTED_PILOT_LEAD_ID for an internal consenting recipient.'),
  step('recipient_match','Operator','Check internal CRM tenant and mobile match (no call)',
   internalLead?.ready===true,
   ({matched:'Configured lead matches the mobile in an available tenant and is not locally blocked. This is not proof of consent or external DND clearance.',
     configuration_missing:'Set a valid Indian mobile, tenant UUID and lead UUID first.',
     tenant_unavailable:'Configured tenant is unavailable or its CRM binding cannot be resolved.',
     lead_unavailable:'Lead is missing, mobile does not match, or local opt-out/consent/DND prevents the pilot.',
     check_unavailable:'CRM readiness read failed; retry the read-only check.'})[internalLead?.state]||'Internal CRM match has not been checked.'),
  step('traffic','Plivo/provider','Verify permitted service/transactional calling purpose',false,
   'India Business KYC and 080 caller ownership do not authorize promotional builder lead calls or unrelated client traffic.'),
  step('internal_call','Operator','Complete one signed Production acceptance call',false,
   'With allowed purpose and verified owned recipient only, temporarily enable the internal pilot, then review Plivo Logs, seven Hindi turns, signed callbacks and CRM.'),
  step('customer_campaigns','Provider/operator','Keep customer campaigns disabled until independent gates pass',false,
   'Do not enable AR3D_SCRIPTED_CAMPAIGNS_ENABLED for new property marketing on this 080 number. Allocated minutes and a funding envelope do not grant dial permission.')
 ];
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
 env=await resolveFundingEnv(env);
 // R2 HEAD metadata only, after fresh MFA verification. No audio-body reads.
 const audioPacks=await Promise.all(['hi','en'].map(language=>
  inspectScriptedPromptPack(env,language)));
 const internalLead=await inspectInternalPilotLead(env);
 const snapshot=buildPlivoReadinessSnapshot(env);
 return json({...snapshot,audioPacks,internalLead,
  setupActions:productionSetupActions(snapshot,audioPacks,internalLead)});
}
