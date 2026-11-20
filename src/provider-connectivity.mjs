// Optional real, read-only connectivity check. Accessible only through an
// already authenticated Super Admin endpoint (same-origin POST).
// Never logs, persists, returns or forwards secrets/client call data.
import {checkExotelAccountReadOnly} from './exotel-readonly-verification.mjs';
import {configuredExotelRegion} from './exotel-region.mjs';
// Public operator-readable messages are fixed literals, never provider body.
const EXOTEL_CHECK_REASONS=Object.freeze({
  http_401:'HTTP 401: Exotel rejected API authentication. Verify API Key (username), API Token (password), and exact Account SID.',
  http_403:'HTTP 403: Exotel refused this read-only resource. Check account verification, API permissions or trial restrictions with Exotel.',
  http_404:'HTTP 404: Exotel could not find this Account SID or endpoint in the selected account region.',
  http_429:'HTTP 429: Exotel API rate limit. Avoid repeated requests and retry later.',
  http_5xx:'HTTP 5xx: Exotel service returned an error; retry when the service is healthy.',
  transport_unavailable:'Exotel could not be reached within the request timeout. Check connectivity and try again.',
  unexpected_content_type:'Exotel responded with a non-JSON format; inspect the provider account/API access.',
  unexpected_call_list_schema:'HTTP 200 but the call-list response did not match the documented JSON schema.',
  invalid_response_json:'Exotel returned malformed JSON; inspect provider API behavior.',
  response_unreadable:'Exotel returned an unreadable or oversized response.',
  unexpected_http_status:'Exotel returned an unexpected HTTP status.',
  unknown:'The read-only probe was not verified; contact Exotel support if credentials and account approval are correct.'
});
export async function probeExotelConnectivity(env,{apiFetch=fetch}={}){
  if(!env||typeof env!=='object')throw Error('provider configuration missing');
  const region=configuredExotelRegion(env);
  const accountSid=env.EXOTEL_ACCOUNT_SID;
  const present=typeof accountSid==='string'&&/^[A-Za-z0-9_-]{4,128}$/.test(accountSid)&&
    ['EXOTEL_API_KEY','EXOTEL_API_TOKEN'].every(k=>typeof env[k]==='string'&&
      env[k].trim().length>=8);
  const regionSecretPresent=typeof env.EXOTEL_REGION==='string'&&env.EXOTEL_REGION.length>0;
  const apiRegionStatus=region?'configured':regionSecretPresent?'invalid':'missing';
  if(!present||!region)return Object.freeze({
    provider:'exotel',configured:false,verified:false,
    apiRegionConfigured:Boolean(region),apiRegion:region,apiRegionStatus,
    outboundCallsEnabled:false,voiceStreamingEnabled:false,
    note:'Set EXOTEL_REGION=india or singapore for the account region, plus EXOTEL_ACCOUNT_SID, EXOTEL_API_KEY and EXOTEL_API_TOKEN as private Worker secrets. No call is placed.'
  });
  try{
    const verified=await checkExotelAccountReadOnly({
      accountSid:env.EXOTEL_ACCOUNT_SID,
      apiKey:env.EXOTEL_API_KEY,
      apiToken:env.EXOTEL_API_TOKEN,
      region
    },{apiFetch});
    return Object.freeze({
      provider:'exotel',configured:true,verified:verified.accountLookupSucceeded===true,
      apiRegionConfigured:true,apiRegion:region,apiRegionStatus,
      outboundCallsEnabled:false,voiceStreamingEnabled:false,
      note:'Exotel read-only API reachable. Business approval, caller number, DND, voice transport and calling permissions remain independent.'
    });
  }catch(error){
    // Only internally assigned allowlisted codes can leave the Worker.
    // Vendor error body, exception text, URL and secrets never leave.
    const untrustedCode=error?.diagnosticCode;
    const checkCode=typeof untrustedCode==='string'&&
      Object.hasOwn(EXOTEL_CHECK_REASONS,untrustedCode)?untrustedCode:'unknown';
    return Object.freeze({
      provider:'exotel',configured:true,verified:false,
      apiRegionConfigured:true,apiRegion:region,apiRegionStatus,
      checkCode,checkDiagnostic:EXOTEL_CHECK_REASONS[checkCode],
      outboundCallsEnabled:false,voiceStreamingEnabled:false,
      note:'Exotel read-only account check unsuccessful. No real calling was attempted.'
    });
  }
}
