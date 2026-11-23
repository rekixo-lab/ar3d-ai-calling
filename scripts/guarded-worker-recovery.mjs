// Narrow, one-time recovery for the isolated AR3D Calling Worker only.
// Last healthy version was verified to contain LOGIN_RATE_LIMIT_SECRET and
// MFA_ENCRYPTION_KEY by the successful guarded production deployment.
// The failed later version was observed to lack both binding names.
// No secret values, telecom actions, CRM writes or other Workers involved.
import {appendFileSync} from 'node:fs';
import {inspectCallingSecretBindings} from './inspect-main-secrets.mjs';

export const RECOVERY_WORKER='ar3d-ai-calling';
export const FAILED_VERSION='abe9372b-6981-4553-b181-c86fe25a5289';
export const VERIFIED_VERSION='09d6b5f2-3ddc-4bce-9b52-9b9fbc4122b2';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function guard(account,token){
 if(!/^[0-9a-f]{32}$/i.test(account||'')||typeof token!=='string'||token.length<20)
  throw Error('Cloudflare recovery credentials unavailable');
 if(!uuid.test(FAILED_VERSION)||!uuid.test(VERIFIED_VERSION))
  throw Error('Invalid verified rollback version IDs');
}
async function call(url,token,fetchFn,method='GET',body=null){
 const response=await fetchFn(url,{
  method,headers:{
   'Authorization':'Bearer '+token,
   'Accept':'application/json',
   ...(body?{'Content-Type':'application/json'}:{})
  },
  ...(body?{body:JSON.stringify(body)}:{})
 });
 let value;
 try{value=await response.json()}catch{throw Error('Unexpected Cloudflare recovery API response')}
 if(!response.ok||value?.success!==true)
  throw Error('Cloudflare recovery API rejected request; manual review required');
 return value.result;
}
export async function recoverVerifiedCallingWorker({
 account,token,apiFetch=fetch,delay=sleep
}={}){
 guard(account,token);
 const check=()=>inspectCallingSecretBindings({account,token,apiFetch});
 const first=await check();
 if(first.loginConfigured&&first.mfaConfigured)return {ready:true,recovered:false};
 const endpoint='https://api.cloudflare.com/client/v4/accounts/'+account+
  '/workers/scripts/'+RECOVERY_WORKER+'/deployments';
 const listing=await call(endpoint,token,apiFetch);
 const list=listing?.deployments;
 if(!Array.isArray(list)||!list.length)
  throw Error('Missing deployment history. Refusing automatic recovery');
 const head=list[0];
 if(!Array.isArray(head?.versions)||head.versions.length!==1||
    head.versions[0].percentage!==100||
    head.versions[0].version_id!==FAILED_VERSION||
    !list.some(x=>Array.isArray(x?.versions)&&x.versions.some(v=>v.version_id===VERIFIED_VERSION)))
  throw Error('Current deployment changed or verified version not found. Refusing automatic rollback');
 // Exactly one explicit rollback to the last version whose secret-binding
 // metadata was independently verified green. No retry if POST is uncertain.
 await call(endpoint,token,apiFetch,'POST',{
  strategy:'percentage',
  versions:[{version_id:VERIFIED_VERSION,percentage:100}],
  annotations:{'workers/message':'Restore last verified auth bindings after failed isolated Calling deployment'}
 });
 for(let i=0;i<6;i++){
  await delay(2500);
  const result=await check();
  if(result.loginConfigured&&result.mfaConfigured)
   return {ready:true,recovered:true};
 }
 throw Error('Rollback submitted, but authentication bindings remain unverified');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 recoverVerifiedCallingWorker({
  account:process.env.CLOUDFLARE_ACCOUNT_ID,
  token:process.env.CLOUDFLARE_API_TOKEN
 }).then(out=>{
  if(process.env.GITHUB_OUTPUT)
   appendFileSync(process.env.GITHUB_OUTPUT,'recovered='+String(out.recovered)+'\n');
  console.log(out.recovered?
   'AR3D Calling restored to previously verified authentication-safe Worker version. New release remains pending.':
   'AR3D Calling authentication secret names verified. No rollback required.');
 }).catch(()=>{
  // Never log Cloudflare payload, secret values, or credential material.
  console.error('Isolated Calling Worker authentication recovery requires operator review.');
  process.exitCode=1;
 });
}
