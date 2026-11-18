import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {base32,totpAt,verifyTotp,encryptSecret,decryptSecret,challengeAfterPassword,handleMfaSettings} from '../src/mfa.mjs';
import {makePassword} from '../src/human-auth.mjs';
const enc=new TextEncoder(),env={MFA_ENCRYPTION_KEY:'test only MFA encryption key with sufficient entropy to be used in mocked calls'};
test('RFC6238 SHA1 known vector is 287082 at second 59; replay denied',async()=>{
  const secret=enc.encode('12345678901234567890');
  assert.equal(await totpAt(secret,1),'287082');
  assert.equal(await verifyTotp(secret,'287082',-1,59000),1);
  assert.equal(await verifyTotp(secret,'287082',1,59000),null);
  assert.equal(await verifyTotp(secret,'287082',-1,59000+120000),null);
  assert.equal(await verifyTotp(secret,'invalid',-1,59000),null);
});
test('Base32 has exact RFC4648 formatting for known bytes',()=>{
  assert.equal(base32(enc.encode('foo')),'MZXW6');
  assert.equal(base32(enc.encode('foobar')),'MZXW6YTBOI');
});
test('AES-GCM encrypt/decrypt returns same bytes, rejects wrong Worker key',async()=>{
  const secret=enc.encode('12345678901234567890'),stored=await encryptSecret(secret,env);
  assert.match(stored.secret_iv,/^[a-f0-9]{24}$/);
  assert.match(stored.secret_ciphertext,/^[a-f0-9]{72}$/);
  assert.deepEqual(await decryptSecret(stored,env),secret);
  await assert.rejects(decryptSecret(stored,{MFA_ENCRYPTION_KEY:'another unrelated secure worker secret 123456789'}));
});
test('MFA login challenge cannot issue without encryption key or set a login session cookie',async()=>{
  const a=await challengeAfterPassword({}, {id:'test'}, {});
  assert.equal(a.status,503);
  let insert='';
  const db={prepare(sql){insert=sql;return {bind(){return {async run(){return {meta:{changes:1}}}}}}}};
  const b=await challengeAfterPassword(db,{id:'test'},env),json=await b.json();
  assert.equal(b.status,200);assert.equal(json.mfaRequired,true);
  assert.match(json.challenge,/^[a-f0-9]{64}$/);
  assert.equal(b.headers.get('set-cookie'),null);
  assert.match(insert,/human_mfa_challenges/);
});
test('MFA settings limited to Super Admin, even when a client is signed in',async()=>{
  const res=await handleMfaSettings(new Request('https://example.test/v1/human/mfa'),{}, {globalRole:'user'},null);
  assert.equal(res.status,403);
});
test('password success with enabled MFA issues challenge but no human_sessions insert',async()=>{
  const creds=await makePassword('valid strong password 123!');
  const sqls=[];
  const db={prepare(sql){sqls.push(sql);return {bind(){return {
    async first(){
      if(sql.includes('human_ip_login_limits'))return {attempt_count:1,blocked_until:0};
      if(sql.includes('FROM human_login_limits'))return null;
      if(sql.includes('FROM human_users'))return {id:'admin1',email:'admin@example.com',status:'active',global_role:'super_admin',
        password_salt:creds.salt,password_hash:creds.hash,password_iterations:creds.iterations};
      if(sql.includes('FROM human_mfa_settings'))return {enabled_at:'2026-11-18T00:00:00Z'};
      return null;
    },
    async run(){return {meta:{changes:1}}}
  }}}}};
  const request=new Request('https://example.test/v1/human/login',{method:'POST',
    headers:{origin:'https://example.test','cf-connecting-ip':'203.0.113.6','content-type':'application/json'},
    body:JSON.stringify({email:'admin@example.com',password:'valid strong password 123!'})});
  const response=await worker.fetch(request,{CONTROL_DB:db,LOGIN_RATE_LIMIT_SECRET:'some long ip login secret 1234567891234',
    MFA_ENCRYPTION_KEY:env.MFA_ENCRYPTION_KEY});
  assert.equal(response.status,200);
  assert.equal((await response.json()).mfaRequired,true);
  assert.equal(response.headers.get('set-cookie'),null);
  assert.ok(sqls.some(s=>s.includes('human_mfa_challenges')));
  assert.ok(!sqls.some(s=>s.includes('INSERT INTO human_sessions')));
});
test('MFA login cannot be verified without same-origin request and trusted IP',async()=>{
  const r=await worker.fetch(new Request('https://example.test/v1/human/login/mfa',{method:'POST',
    body:JSON.stringify({challenge:'a'.repeat(64),code:'123456'})}),{CONTROL_DB:{prepare(){throw Error('not queried')}}});
  assert.equal(r.status,403);
  const r2=await worker.fetch(new Request('https://example.test/v1/human/login/mfa',{method:'POST',
    headers:{origin:'https://example.test','content-type':'application/json'},
    body:JSON.stringify({challenge:'a'.repeat(64),code:'123456'})}),{
      CONTROL_DB:{prepare(){throw Error('not queried')}},LOGIN_RATE_LIMIT_SECRET:'long enough secret to pass configuration 123456'
    });
  assert.equal(r2.status,503);
});
