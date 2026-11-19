// Optional Razorpay gateway adapter, pure webhook signature verification only.
// No webhook route, payment creation, captures, subscriptions or invoices.
// Merchant onboarding and selected processor are separate operator decisions.
// https://razorpay.com/docs/webhooks/validate-test/
const HEX=/^[0-9a-f]{64}$/i;
const EVENT=/^[A-Za-z0-9_-]{8,128}$/;
const LIMIT=65536;
export async function inspectSignedRazorpayWebhook({bodyBytes,signature,eventId,secret}={}){
  if(!(bodyBytes instanceof Uint8Array)||bodyBytes.length<2||
     bodyBytes.length>LIMIT||typeof signature!=='string'||!HEX.test(signature)||
     typeof eventId!=='string'||!EVENT.test(eventId)||
     typeof secret!=='string'||secret.length<24||secret.length>512)
    throw Error('invalid Razorpay webhook verification request');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(signature.match(/../g),h=>parseInt(h,16));
  const valid=await crypto.subtle.verify('HMAC',key,bytes,bodyBytes);
  if(!valid)throw Error('Razorpay webhook signature mismatch');
  let payload;
  try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bodyBytes))}
  catch{throw Error('invalid Razorpay webhook JSON')}
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||
     typeof payload.event!=='string'||!['payment.captured','payment.failed','order.paid'].includes(payload.event))
    throw Error('Razorpay webhook event unsupported');
  // Deliberately return no customer/payment details. A durable tenant/order
  // association, merchant account check, anti-replay ledger, independent
  // provider lookup and tax processing must precede payment fulfillment.
  return Object.freeze({
    gateway:'razorpay',eventId,eventKind:payload.event,
    hmacVerified:true,rawBodyModified:false,
    accountAssociated:false,duplicateEventChecked:false,
    paymentReconciled:false,subscriptionActivated:false,
    invoiceGenerated:false,customerChargedByThisSystem:false,
    usableForFulfillment:false,
    note:'Signature verified only. Durable order correlation and payment verification are required before any service access or invoice.'
  });
}
