// Optional real, read-only connectivity check. Accessible only through an
// already authenticated Super Admin endpoint (same-origin POST).
// Never logs, persists, returns or forwards secrets/client call data.
import {checkExotelAccountReadOnly} from './exotel-readonly-verification.mjs';
import {configuredExotelRegion} from './exotel-region.mjs';
const FIELDS=Object.freeze(['EXOTEL_ACCOUNT_SID','EXOTEL_API_KEY','EXOTEL_API_TOKEN']);
export async function probeExotelConnectivity(env,{apiFetch=fetch}={}){
  if(!env||typeof env!=='object')throw Error('provider configuration missing');
  const region=configuredExotelRegion(env);
  const present=FIELDS.every(k=>typeof env[k]==='string'&&
     env[k].trim().length>=8);
  if(!present||!region)return Object.freeze({
    provider:'exotel',configured:false,verified:false,
    apiRegionConfigured:Boolean(region),apiRegion:region,
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
      apiRegionConfigured:true,apiRegion:region,
      outboundCallsEnabled:false,voiceStreamingEnabled:false,
      note:'Exotel read-only API reachable. Business approval, caller number, DND, voice transport and calling permissions remain independent.'
    });
  }catch{
    // Never return raw Exotel HTTP body or thrown errors to the browser.
    return Object.freeze({
      provider:'exotel',configured:true,verified:false,
      apiRegionConfigured:true,apiRegion:region,
      outboundCallsEnabled:false,voiceStreamingEnabled:false,
      note:'Exotel read-only account check unsuccessful. Review account, permissions and key scope privately.'
    });
  }
}
