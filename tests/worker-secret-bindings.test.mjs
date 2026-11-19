import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCallingSecretBindings} from '../scripts/inspect-main-secrets.mjs';

const account='a'.repeat(32),token='t'.repeat(40);
const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/ar3d-ai-calling/secrets';
test('check only exact standalone Worker secrets metadata without returning secret values',async()=>{
  let calls=0;
  const result=await inspectCallingSecretBindings({account,token,apiFetch:async(url,req)=>{
    calls++;assert.equal(url,base);assert.equal(req.method,'GET');
    assert.equal(req.headers.Authorization,'Bearer '+token);
    return {ok:true,json:async()=>({success:true,result:[
      {name:'LOGIN_RATE_LIMIT_SECRET',type:'secret_text'},
      {name:'MFA_ENCRYPTION_KEY',type:'secret_text'},
      {name:'ADMIN_BOOTSTRAP_TOKEN',type:'secret_text'}
    ]})};
  }});
  assert.equal(calls,1);
  assert.deepEqual(result,{loginConfigured:true,mfaConfigured:true,bootstrapConfigured:true});
  assert.ok(!JSON.stringify(result).includes(token));
});
test('missing bootstrap token is permitted after first admin creation, missing login is not',async()=>{
  const r=await inspectCallingSecretBindings({account,token,apiFetch:async()=>({
    ok:true,json:async()=>({success:true,result:[{name:'MFA_ENCRYPTION_KEY'}]})
  })});
  assert.deepEqual(r,{loginConfigured:false,mfaConfigured:true,bootstrapConfigured:false});
});
test('unexpected API data and incorrect account are rejected without leaking secrets',async()=>{
  await assert.rejects(inspectCallingSecretBindings({account:'not-account',token,apiFetch:async()=>{throw Error('should never fetch')}}),/Missing Cloudflare/);
  await assert.rejects(inspectCallingSecretBindings({account,token,apiFetch:async()=>({
    ok:false,json:async()=>({success:false,errors:[{message:'private-info'}]})
  })}),/Could not verify isolated Worker/);
  await assert.rejects(inspectCallingSecretBindings({account,token,apiFetch:async()=>({
    ok:true,json:async()=>({success:true,result:{names:['ADMIN_BOOTSTRAP_TOKEN']}})
  })}),/Could not verify isolated Worker/);
});
