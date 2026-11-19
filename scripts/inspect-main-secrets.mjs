/**
 * Check only the NAMES of secrets bound to the isolated calling Worker.
 * Cloudflare's list API intentionally hides values. Do not log API results.
 * Does not create/delete/rotate any secret or interact with other Workers.
 */
const workerName='ar3d-ai-calling';
const required=['LOGIN_RATE_LIMIT_SECRET','MFA_ENCRYPTION_KEY'];

export async function inspectCallingSecretBindings({account,token,apiFetch=fetch}) {
  if(!/^[a-f0-9]{32}$/i.test(String(account||''))||String(token||'').length<20)
    throw Error('Missing Cloudflare CI credentials for isolated Worker check');
  const url='https://api.cloudflare.com/client/v4/accounts/'+account+
    '/workers/scripts/'+workerName+'/secrets';
  const result=await apiFetch(url,{
    method:'GET',
    headers:{Authorization:'Bearer '+token,'Accept':'application/json'}
  });
  let body;
  try{body=await result.json()}catch{throw Error('Cloudflare did not return secrets metadata JSON')}
  if(!result.ok||body?.success!==true||!Array.isArray(body.result))
    throw Error('Could not verify isolated Worker secret binding names; check Workers Scripts Read permission');
  const names=new Set(body.result.map(v=>v?.name).filter(v=>typeof v==='string'));
  return {
    loginConfigured:names.has(required[0]),
    mfaConfigured:names.has(required[1]),
    bootstrapConfigured:names.has('ADMIN_BOOTSTRAP_TOKEN')
  };
}
async function main(){
  const check=await inspectCallingSecretBindings({
    account:process.env.CLOUDFLARE_ACCOUNT_ID,
    token:process.env.CLOUDFLARE_API_TOKEN
  });
  // Metadata only; never reveal values, hashes, account ID, UUID, or token.
  console.log('Isolated Worker secret binding check: login='+
    (check.loginConfigured?'present':'missing')+', MFA='+
    (check.mfaConfigured?'present':'missing')+', temporary bootstrap='+
    (check.bootstrapConfigured?'present':'missing')+'.');
  if(!check.loginConfigured||!check.mfaConfigured)
    throw Error('Required login/MFA Worker secret binding names missing: deployment not ready.');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  main().catch(e=>{console.error(e instanceof Error?e.message:'Binding check failed');
    process.exitCode=1});
}
