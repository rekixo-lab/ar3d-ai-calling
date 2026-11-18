import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecoveryCodes,validRecoveryCode,normalizeRecoveryCode,recoveryHash,codeStatements} from '../src/mfa-recovery.mjs';
import {encryptSecret,totpAt,finishMfaLogin,handleMfaSettings} from '../src/mfa.mjs';
import {makePassword} from '../src/human-auth.mjs';

const env={MFA_ENCRYPTION_KEY:'the test-only stable random mfa secret 9876543210',LOGIN_RATE_LIMIT_SECRET:'the test-only stable ip guard secret 9876543210'};
const user={id:'11111111-1111-4111-8111-111111111111',globalRole:'super_admin',email:'admin@example.test'};
const loginReq=new Request('https://example.test/v1/human/login/mfa',{method:'POST',headers:{'cf-connecting-ip':'203.0.113.21',origin:'https://example.test'}});

test('8 cryptographically random, unique, 128-bit recovery codes; strict normalization',()=>{
  const codes=createRecoveryCodes();
  assert.equal(codes.length,8);assert.equal(new Set(codes).size,8);
  assert.ok(codes.every(validRecoveryCode));
  assert.match(codes[0],/^AR3D-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);
  assert.equal(normalizeRecoveryCode(codes[0].toLowerCase()),codes[0]);
  for(const bad of ['123456','AR3D-ABC','AR3D-'+('1'.repeat(32)),'AR3D-1234-5678-TEST'])assert.equal(validRecoveryCode(bad),false);
});
test('recovery HMAC cannot be reused by another user or secret',async()=>{
  const code=createRecoveryCodes(1)[0],digest=await recoveryHash(env,user.id,code);
  assert.match(digest,/^[0-9a-f]{64}$/);assert.ok(!digest.includes(code));
  assert.notEqual(digest,await recoveryHash(env,'different-user',code));
  assert.notEqual(digest,await recoveryHash({...env,MFA_ENCRYPTION_KEY:env.MFA_ENCRYPTION_KEY+'2'},user.id,code));
  await assert.rejects(recoveryHash({},user.id,code));
});
test('recovery inserts save only digests under a matched generation',async()=>{
  const logs=[],db={prepare(sql){return {bind(...args){logs.push({sql,args});return {sql,args}}}}};
  const codes=createRecoveryCodes(3);
  const out=await codeStatements(db,env,user.id,codes,'gen1','now');
  assert.equal(out.length,3);
  assert.ok(logs.every(x=>x.sql.includes('recovery_generation_id=?')));
  assert.ok(logs.every(x=>x.args[0].length===64&&x.args[2]===user.id&&x.args[3]==='gen1'));
  assert.ok(logs.every(x=>!codes.some(code=>x.args.includes(code))));
});
test('valid backup code completes password-issued MFA challenge with one-time consume and secure cookie',async()=>{
  const code=createRecoveryCodes(1)[0],sqls=[];
  const db={prepare(sql){sqls.push(sql);return {bind(){return {
    async first(){
      if(sql.includes('human_ip_login_limits'))return {attempt_count:1,blocked_until:0};
      if(sql.includes('FROM human_mfa_challenges'))return {user_id:user.id,attempts:0,last_used_step:-1};
      return null;
    },async run(){return {meta:{changes:1}}}
  }}}},async batch(){return [{meta:{changes:1}},{meta:{changes:1}}]}};
  const res=await finishMfaLogin(loginReq,{...env,CONTROL_DB:db},{challenge:'a'.repeat(64),recoveryCode:code});
  assert.equal(res.status,200);assert.match(res.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
  assert.ok(sqls.some(x=>x.includes('SET used_at=?')));
  assert.ok(sqls.some(x=>x.includes('INSERT INTO human_sessions')));
  assert.ok(!sqls.some(x=>x.includes('UPDATE human_mfa_settings SET last_used_step')));
});
test('used backup code fails without creating session and counts as bad challenge attempt',async()=>{
  const code=createRecoveryCodes(1)[0],sqls=[];
  const db={prepare(sql){sqls.push(sql);return {bind(){return {
    async first(){
      if(sql.includes('human_ip_login_limits'))return {attempt_count:1,blocked_until:0};
      if(sql.includes('FROM human_mfa_challenges'))return {user_id:user.id,attempts:0,last_used_step:-1};
      return null;
    },async run(){return {meta:{changes:1}}}
  }}}},async batch(){return [{meta:{changes:0}},{meta:{changes:1}}]}};
  const res=await finishMfaLogin(loginReq,{...env,CONTROL_DB:db},{challenge:'b'.repeat(64),recoveryCode:code});
  assert.equal(res.status,401);assert.equal(res.headers.get('set-cookie'),null);
  assert.ok(sqls.some(x=>x.includes('attempts=attempts+1')));
  assert.ok(!sqls.some(x=>x.includes('INSERT INTO human_sessions')));
});
test('enabled MFA returns one-time codes and stores only their hashes',async()=>{
  const seed=new TextEncoder().encode('12345678901234567890'),cipher=await encryptSecret(seed,env);
  const code=await totpAt(seed,Math.floor(Date.now()/30000)),statements=[];
  const db={prepare(sql){return {bind(...args){statements.push({sql,args});return {
    async first(){return sql.includes('FROM human_mfa_settings')?{...cipher,last_used_step:-1}:null;},
    async run(){return {meta:{changes:1}}}
  }}}},async batch(items){return items.map(()=>({meta:{changes:1}}))}};
  const req=new Request('https://example.test/v1/human/mfa/enable',{method:'POST'});
  const res=await handleMfaSettings(req,{...env,CONTROL_DB:db},user,{code});
  assert.equal(res.status,200);
  const payload=await res.json();assert.equal(payload.recoveryCodes.length,8);
  assert.ok(payload.recoveryCodes.every(validRecoveryCode));
  assert.ok(statements.filter(x=>x.sql.includes('human_mfa_recovery_codes')).every(x=>x.args[0].length===64));
});
test('recovery rotation requires correct password and current TOTP, invalidates old codes',async()=>{
  const password='strong recovery rotation password 123!';
  const hash=await makePassword(password),seed=new TextEncoder().encode('12345678901234567890');
  const cipher=await encryptSecret(seed,env),code=await totpAt(seed,Math.floor(Date.now()/30000));
  const statements=[];
  const db={prepare(sql){return {bind(...args){statements.push({sql,args});return {
    async first(){
      if(sql.includes('human_ip_login_limits'))return {attempt_count:1,blocked_until:0};
      if(sql.includes('FROM human_users'))return {password_salt:hash.salt,password_hash:hash.hash,password_iterations:hash.iterations};
      if(sql.includes('FROM human_mfa_settings'))return {...cipher,last_used_step:-1};
      return null;
    },async run(){return {meta:{changes:1}}}
  }}}},async batch(items){return items.map(()=>({meta:{changes:1}}))}};
  const req=new Request('https://example.test/v1/human/mfa/recovery/regenerate',{method:'POST',headers:{'cf-connecting-ip':'203.0.113.21'}});
  const res=await handleMfaSettings(req,{...env,CONTROL_DB:db},user,{password,code});
  assert.equal(res.status,200);assert.equal((await res.json()).recoveryCodes.length,8);
  assert.ok(statements.some(x=>x.sql.includes('DELETE FROM human_mfa_recovery_codes')));
  assert.ok(statements.some(x=>x.sql.includes('last_used_step<?')));
});
test('client is forbidden from any recovery code operation',async()=>{
  const req=new Request('https://example.test/v1/human/mfa/recovery/regenerate',{method:'POST'});
  const res=await handleMfaSettings(req,{}, {...user,globalRole:'user'},{});
  assert.equal(res.status,403);
});
