// Operator-only Exotel trial setup, intentionally read-only. It is NOT a
// provider authorization, callback registration, voice gateway or dialer.
import {fixedPropertyQuestions} from './fixed-property-survey.mjs';

const c=v=>typeof v==='string'&&v.trim().length>=8;
const REQUIRED=['EXOTEL_ACCOUNT_SID','EXOTEL_API_KEY','EXOTEL_API_TOKEN'];
function textFor(type,lang,field){
  const match=fixedPropertyQuestions(type,lang).find(q=>q.field===field);
  if(!match)throw Error('unknown questionnaire field');
  return match.text;
}
export function managedVoicebotInstructions(){
  const field=(key,type='plot')=>{
    const hi=textFor(type,'hi',key),en=textFor(type,'en',key);
    return '  Hindi: '+hi+'\n  English: '+en;
  };
  // These are instructions for a *provider-managed* optional Voicebot. A
  // client may paste them into its Exotel bot editor after provider approval.
  // No code treats the provider's transcript/response as authenticated.
  return [
    'AR3D REAL ESTATE — SIMPLE SEVEN-QUESTION VOICEBOT (DRAFT)',
    'You are an automated real-estate enquiry assistant for [BUILDER_NAME].',
    'Before a permitted call, the human operator must independently verify',
    'lawful contact permission, DND preferences and the approved caller ID.',
    'Start by identifying [BUILDER_NAME], disclosing that you are an automated',
    'assistant and asking whether it is a convenient time to speak.',
    'If not convenient, stop politely. Never interpret a refusal as consent.',
    'Customer NAME and MOBILE are ALREADY in the Excel/CRM; do NOT ask again.',
    'Speak in Hindi or English, following the customer’s preference.',
    'Ask ONLY the following fixed questions, one at a time, waiting for an answer:',
    '1) Property type (plot/flat/house):\n'+field('propertyType'),
    '2) City/location:\n'+field('location'),
    '3) Area/neighborhood:\n'+field('area'),
    '4) Conditional size — ask exactly one:',
    '   Plot:\n'+field('size','plot'),
    '   Flat or House: 1BHK/2BHK/3BHK/4BHK/5BHK+:\n'+field('size','flat'),
    '5) Approximate budget in Indian rupees:\n'+field('budgetInr'),
    '6) Interest (interested / follow up later / not interested):\n'+field('interest'),
    '7) ONLY if interested — preferred SITE VISIT date:\n'+field('visitDate'),
    'Never claim a visit is confirmed; a sales person must confirm date/time.',
    'If the answer is unclear, repeat the SAME question up to two more times.',
    'After three unclear answers, mark it for human follow-up; do not guess.',
    'If they say “do not call”, “कॉल मत करना”, or ask for removal: stop immediately,',
    'mark the transcript as an opt-out request for verified suppression handling.',
    'Never claim property inventory, exact rates, loan approval or a guaranteed slot.',
    'Never make further calls, change DND/consent or schedule a visit by yourself.',
    'Keep a structured extraction for a separately verified CRM integration:',
    '{"propertyType":"plot|flat|house|null","location":null,"area":null,',
    '"size":null,"budgetInr":null,"interest":"interested|later|not_interested|null",',
    '"visitDate":null,"visitAt":null,"optOutRequested":false}',
    'Date: YYYY-MM-DD, INR budget as a whole number, unknown fields null.',
    'A provider transcript/JSON is UNTRUSTED until authenticated and reviewed.',
    'Only an independently verified, replay-protected integration may write CRM.',
    'Do not invent answers or caller identity from incomplete recognition.'
  ].join('\n');
}
export function exotelTrialReadiness(env={}){
  if(!env||typeof env!=='object')throw Error('environment required');
  const credentials=Object.fromEntries(REQUIRED.map(k=>[k,c(env[k])]));
  const all=REQUIRED.every(k=>credentials[k]);
  return Object.freeze({
    provider:'Exotel',
    purpose:'7 fixed property questions; customer name/mobile imported in CRM',
    mode:'trial_setup_only',
    credentialsPresent:Object.freeze(credentials),
    accountReadyForReadOnlyCheck:all,
    accountApiConnectivityVerified:false,
    manualSteps:[
      {id:'account',title:'Create company Exotel trial account',owner:'operator',verification:'Check your Exotel portal'},
      {id:'trial_mobile',title:'Verify a personally controlled test number',owner:'operator',verification:'Provider trial number list'},
      {id:'voicebot',title:'Ask Exotel to enable Managed Voicebot (Hindi/English) trial, outbound API and transcript export',owner:'provider',verification:'Provider dashboard/confirmation'},
      {id:'caller_id',title:'Confirm eligible ExoPhone/Caller ID, KYC, voice traffic type and rules for real-estate trials',owner:'provider',verification:'Written provider confirmation'},
      {id:'consent',title:'Before real-customer campaigns verify purpose-specific consent, DND and opt-outs',owner:'business',verification:'Independent evidence'},
      {id:'multi_tenant',title:'Obtain written agreement for serving multiple builders and assigning their caller numbers',owner:'business',verification:'Provider written approval'},
      {id:'api_secrets',title:'Set Account SID, API Key and API Token as private Cloudflare Worker secrets',owner:'operator',verification:'Server-side GET check, never paste secrets in browser'}
    ],
    engineeringRemaining:[
      'Choose the provider-managed Voicebot path if the trial permits a phone test and verified transcript/CRM export, otherwise a real WSS + STT/TTS gateway must be built.',
      'Implement vendor-documented, authenticated, replay-protected voicebot result ingestion mapped to tenant and Excel lead before automatic CRM saves.',
      'Review and enable a narrow real-call dispatch path with consent/DND, verified caller ID, cost limits and valid local calling windows; existing no-call safety guards must not be removed.',
      'Reconcile real calls, handle busy/no-answer/opt-outs, escalate errors and verify a private recording/retention policy only if approved.',
      'Test one authorized caller number with a personally controlled verified recipient; follow with consented small pilot and operator sign-off.'
    ],
    managedVoicebotTrialDocs:'https://docs.exotel.com/intelligent-voice-agents',
    apiDocs:'https://developer.exotel.com/docs/agentstream/connect-voice-ai',
    canPlaceRealCalls:false,
    canAutoSaveProviderTranscript:false,
    canStartBrowserPreview:true,
    credentialsAloneAreSufficient:false,
    notice:'Readiness data is code/config presence only; not Exotel trial access, verified KYC, calling approval, speech streaming, telecom consent, or a completed integration.'
  });
}
