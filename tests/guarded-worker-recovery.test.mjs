import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recoverVerifiedCallingWorker,FAILED_VERSION,VERIFIED_VERSION,RECOVERY_WORKER}
 from '../scripts/guarded-worker-recovery.mjs';

const account='a'.repeat(32),token='t'.repeat(40);
function script({state='missing',current=FAILED_VERSION,history=true,post=true}={}){
 const requests=[];let writes=0;
 const apiFetch=async(url,opts)=>{
  const method=opts.method||'GET';
  requests.push({url,method,body:opts.body?JSON.parse(opts.body):null});
  assert.match(url,/^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/a{32}\/workers\/scripts\/ar3d-ai-calling\//);
  if(url.endsWith('/secrets'))return Response.json({success:true,result:
   state==='ready'||(post&&writes>0)?
    [{name:'LOGIN_RATE_LIMIT_SECRET'},{name:'MFA_ENCRYPTION_KEY'}]:
    []});
  if(url.endsWith('/deployments')&&method==='GET')return Response.json({
   success:true,result:{deployments:[{
    versions:[{version_id:current,percentage:100}]
   },...(history?[{versions:[{version_id:VERIFIED_VERSION,percentage:100}]}]:[])]}
  });
  if(url.endsWith('/deployments')&&method==='POST'){
   writes++;
   return Response.json({success:true,result:{id:'safe-recovery'}});
  }
  assert.fail('Unexpected recovery request');
 };
 return {requests,apiFetch,get writes(){return writes}};
}
const run=(f)=>recoverVerifiedCallingWorker({
 account,token,apiFetch:f.apiFetch,delay:async()=>{}
});

test('healthy Worker is not rolled back and no write is attempted',async()=>{
 const f=script({state:'ready'});
 assert.deepEqual(await run(f),{ready:true,recovered:false});
 assert.equal(f.writes,0);assert.equal(f.requests.length,1);
});
test('missing secret bindings recover only the known previously verified Worker',async()=>{
 const f=script();
 assert.deepEqual(await run(f),{ready:true,recovered:true});
 assert.equal(f.writes,1);
 const post=f.requests.find(x=>x.method==='POST');
 assert.ok(post);assert.equal(post.url,'https://api.cloudflare.com/client/v4/accounts/'+account+
  '/workers/scripts/'+RECOVERY_WORKER+'/deployments');
 assert.deepEqual(post.body.versions,[{version_id:VERIFIED_VERSION,percentage:100}]);
 assert.equal(post.body.strategy,'percentage');
 assert.ok(f.requests.filter(x=>x.method==='GET').length>=3);
});
test('changed current Worker or missing verified version refuses rollback',async()=>{
 for(const options of [{current:'eeeeeeee-2222-4222-8222-222222222222'},{history:false}]){
  const f=script(options);
  await assert.rejects(run(f),/Refusing automatic rollback/);
  assert.equal(f.writes,0);
 }
});
test('a rollback with unverified secret propagation never claims success and never retries write',async()=>{
 const f=script({post:false});
 await assert.rejects(run(f),/bindings remain unverified/);
 assert.equal(f.writes,1);
});
test('recovery cannot target another Worker or accept missing CI credentials',async()=>{
 const f=script();
 await assert.rejects(recoverVerifiedCallingWorker({
  account:'invalid',token,apiFetch:f.apiFetch
 }),/credentials unavailable/);
 assert.equal(f.writes,0);
});
test('guarded deployment checks secret names before publishing and preserves existing vars',()=>{
 const yaml=readFileSync('.github/workflows/deploy-production.yml','utf8');
 assert.match(yaml,/Verify isolated auth secrets and recover last verified version if necessary/);
 assert.match(yaml,/wrangler@4 deploy --keep-vars --config wrangler\.jsonc/);
 assert.match(yaml,/steps\.auth\.outputs\.recovered != 'true'/);
 assert.match(yaml,/Mark rollback-only recovery as not a new release/);
 assert.doesNotMatch(yaml,/LOGIN_RATE_LIMIT_SECRET:|MFA_ENCRYPTION_KEY:|printenv|set -x/);
});
