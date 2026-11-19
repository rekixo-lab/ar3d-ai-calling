// Optional real, read-only connectivity check. Accessible only through an
// already authenticated Super Admin endpoint (same-origin POST).
// Never logs, persists, returns or forwards secrets/client call data.
import {checkExotelAccountReadOnly} from './exotel-readonly-verification.mjs';
const FIELDS=Object.freeze(['EXOTEL_ACCOUNT_SID','EXOTEL_API_KEY','EXOTEL_API_TOKEN']);
export async function probeExotelConnectivity(env,{apiFetch=fetch}={}){
  if(!env||typeof env!=='object')throw Error('provider configuration missing');
  const present=FIELDS.every(k=>typeof env[k]==='string'&&
     env[k].trim().length>=8);
  if(!present)return Object.freeze({
    provider:'exotel',configured:false,verified:false,
    outboundCallsEnabled:false,voiceStreamingEnabled:false,
    note:'Add approved EXOTEL_ACCOUNT_SID, EXOTEL_API_KEY and EXOTEL_API_TOKEN as private Worker secrets.'
  });
  try{
    const verified=await checkExotelAccountReadOnly({
      accountSid:env.EXOTEL_ACCOUNT_SID,
      apiKey:env.EXOTEL_API_KEY,
      apiToken:env.EXOTEL_API_TOKEN
    },{apiFetch});
    return Object.freeze({
      provider:'exotel',configured:true,verified:verified.accountLookupSucceeded===true,
      outboundCallsEnabled:false,voiceStreamingEnabled:false,
      note:'Exotel read-only API reachable. Business approval, caller number, DND, voice transport and calling permissions remain independent.'
    });
  }catch{
    // Never return raw Exotel HTTP body or thrown errors to the browser.
    return Object.freeze({
      provider:'exotel',configured:true,verified:false,
      outboundCallsEnabled:false,voiceStreamingEnabled:false,
      note:'Exotel read-only account check unsuccessful. Review account, permissions and key scope privately.'
    });
  }
}
