// Optional operator-only CLI. NEVER takes credentials via args, logs or files.
// Export environment variables privately; do not paste credentials into chat.
// Only GETs the Exotel Calls list with PageSize=1; does not place any calls.
import {checkExotelAccountReadOnly} from '../src/exotel-readonly-verification.mjs';
import {configuredExotelRegion} from '../src/exotel-region.mjs';
if(process.argv.length!==2){
  console.error('Usage: node scripts/check-exotel-readonly.mjs');
  process.exitCode=2;
}else{
  try{
    const region=configuredExotelRegion(process.env);
    if(!region)throw Error('Exotel account region must be explicitly configured');
    const outcome=await checkExotelAccountReadOnly({
      accountSid:process.env.EXOTEL_ACCOUNT_SID,
      apiKey:process.env.EXOTEL_API_KEY,
      apiToken:process.env.EXOTEL_API_TOKEN,
      region
    });
    console.log('Exotel API read-only connection:',outcome.accountLookupSucceeded?'PASS':'FAIL');
    console.log('Real calling authorized: NO. Approved caller ID/consent/DND are still required.');
  }catch{
    console.error('Exotel account not verified; check provider KYC, account region, credentials and API permission privately.');
    process.exitCode=1;
  }
}
