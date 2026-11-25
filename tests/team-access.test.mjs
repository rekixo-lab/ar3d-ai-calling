import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/calling-fixture.mjs';
import {handleHumanRequest} from '../src/human-routes.mjs';
import {makePassword,newSession,randomSecret,COOKIE} from '../src/human-auth.mjs';
import {sha256hex} from '../src/core.mjs';
import {encryptSecret,totpAt} from '../src/mfa.mjs';

test('existing client proves password and TOTP before promotion, with a single atomic claim and new session',async t=>{
 const f=fixture();t.after(()=>f.close());
 const db=f.c.db,env=f.env,origin='https://calling.example.invalid';
 env.MFA_ENCRYPTION_KEY='synthetic-team-test-encryption-key';
 env.LOGIN_RATE_LIMIT_SECRET='synthetic-team-test-login-limit-key';
 const request=(route,body,cookie)=>handleHumanRequest(new Request(origin+'/v1/human/'+route,{
  method:body?'POST':'GET',headers:{origin,'cf-connecting-ip':'127.0.0.1','content-type':'application/json',cookie:cookie?COOKIE+'='+cookie:''},
  body:body?JSON.stringify(body):undefined
 }),env);
 const password='Existing-client-password',email='client@example.invalid',token=randomSecret();
 const pw=await makePassword(password);
 db.prepare("UPDATE human_users SET password_salt=?,password_hash=?,password_iterations=? WHERE id='client'").run(pw.salt,pw.hash,pw.iterations);
 const clientSession=await newSession(env.CONTROL_DB,'client');
 const secret=crypto.getRandomValues(new Uint8Array(20)),cipher=await encryptSecret(secret,env);
 db.prepare("INSERT INTO team_invitations VALUES('invite',?,?,'admin',?,?,NULL,?,?)")
   .run(email,await sha256hex(token),new Date().toISOString(),Date.now()-1,cipher.secret_iv,cipher.secret_ciphertext);
 const details={email,password,token};
 assert.equal((await request('team/setup',details)).status,409);
 db.prepare("UPDATE team_invitations SET expires_at=?").run(Date.now()+600000);
 assert.equal((await request('team/setup',{...details,email:'someone@example.invalid'})).status,409);
 assert.equal((await request('team/setup',{...details,password:'incorrect'})).status,403);
 assert.equal((await request('team/setup',details)).status,200);
 assert.equal((await request('team',null,clientSession)).status,403);
 assert.equal((await request('team/invite',{email:'another@example.invalid',code:'123456'},clientSession)).status,403);
 const code=await totpAt(secret,Math.floor(Date.now()/30000));
 const attempts=await Promise.all([request('team/accept',{...details,code}),request('team/accept',{...details,code})]);
 const [accepted,rejected]=attempts.map(r=>r.status).sort();
 assert.equal(accepted,200);
 assert.ok([403,409].includes(rejected),'The losing request must be denied even when it sees the newly enabled MFA.');
 assert.equal((await request('me',null,clientSession)).status,401);
 await assert.rejects(newSession(env.CONTROL_DB,'client',{passwordOnly:true}),/Authenticator required/);
 const login=await request('login',{email,password});
 assert.equal(login.headers.get('set-cookie'),null);
 assert.equal((await login.json()).mfaRequired,true);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM tenant_memberships WHERE user_id='client' AND status='active'").get().n,1);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM human_mfa_recovery_codes WHERE user_id='client'").get().n,8);
});
