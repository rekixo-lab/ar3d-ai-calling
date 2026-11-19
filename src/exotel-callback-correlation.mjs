// Source-unverified Exotel callbacks must NEVER advance calls or billing.
// Provider docs require IP validation and call-details fallback, which remain
// external blockers; matching a nonce/CallSid alone is not authentication.
import {parseUnverifiedExotelCallback} from './exotel-voice-adapter.mjs';
const KEY=/^[a-zA-Z0-9_-]{12,128}$/;
export function correlateUnverifiedExotelCallback(body,expected){
  if(!expected||typeof expected!=='object'||Array.isArray(expected)||
     Object.keys(expected).some(k=>!['callSid','correlationNonce'].includes(k))||
     typeof expected.callSid!=='string'||!KEY.test(expected.callSid)||
     typeof expected.correlationNonce!=='string'||!KEY.test(expected.correlationNonce))
    throw Error('invalid callback correlation reference');
  const parsed=parseUnverifiedExotelCallback(body);
  if(parsed.callSid!==expected.callSid)throw Error('Exotel CallSid mismatch');
  const form=new URLSearchParams(new TextDecoder('utf-8',{fatal:true}).decode(body));
  if(form.get('CustomField')!==expected.correlationNonce)
    throw Error('Exotel callback correlation mismatch');
  return Object.freeze({
    provider:'exotel',status:parsed.status,
    shapeValid:true,callSidMatched:true,correlationMatched:true,
    vendorSourceAuthenticated:false,providerLookupVerified:false,
    replayLedgerWritten:false,callLedgerUpdated:false,customerConsentChanged:false,
    recordingRetrieved:false,invoiceGenerated:false,billable:false,
    result:'quarantine_pending_provider_verification'
  });
}
