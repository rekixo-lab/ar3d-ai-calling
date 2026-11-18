import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {LOGIN_WINDOW_MS,LOGIN_MAX_ATTEMPTS,reserveLoginAttempt,validCloudflareIp,anonymizeIp} from '../src/login-guard.mjs';

const secret='this is an isolated worker secret 1234567890';
function req(ip='203.0.113.45',origin='https://example.test'){
  return new Request('https://example.test/v1/human/login',{method:'POST',
    headers:{origin,'cf-connecting-ip':ip,'content-type':'application/json'},
    body:JSON.stringify({email:'demo@example.com',password:'incorrect1234567'})});
}
function mockIpStore(){
  const rows=new Map(),queries=[];
  const db={prepare(sql){return {bind(...params){queries.push({sql,params});return {
    async first(){
      if(!sql.includes('INSERT INTO human_ip_login_limits'))throw Error('unexpected SQL');
      const [hash,timestamp,cutoff]=params,previous=rows.get(hash);
      let count=previous&&previous.windowStart>cutoff?previous.count+1:1;
      let blocked=previous&&previous.blocked>timestamp?previous.blocked:
        previous&&previous.windowStart>cutoff&&previous.count>=LOGIN_MAX_ATTEMPTS?timestamp+LOGIN_WINDOW_MS:0;
      const next={count,blocked,windowStart:previous&&previous.windowStart>cutoff?previous.windowStart:timestamp};
      rows.set(hash,next);
      return {attempt_count:count,blocked_until:blocked};
    }
  }}}}};
  return {db,rows,queries};
}
test('only the Cloudflare IP header is accepted, not a forwarded IP list',()=>{
  for(const ip of ['203.0.113.45','2001:db8::a','::1'])assert.equal(validCloudflareIp(ip),true);
  for(const ip of ['','evil.example','300.1.2.3','192.0.2.2, 5.6.7.8','::1%eth0'])
    assert.equal(validCloudflareIp(ip),false);
});
test('HMAC key changes with IP or secret; no raw IP stored',async()=>{
  const a=await anonymizeIp('203.0.113.45',secret);
  assert.match(a,/^[a-f0-9]{64}$/);
  assert.notEqual(a,await anonymizeIp('203.0.113.46',secret));
  assert.notEqual(a,await anonymizeIp('203.0.113.45',secret+'different'));
  assert.ok(!a.includes('203.0.113'));
});
test('missing secret or verified address fails closed without database writes',async()=>{
  const {db,queries}=mockIpStore();
  const noSecret=await reserveLoginAttempt(req(),{CONTROL_DB:db},1000);
  assert.equal(noSecret.allowed,false);assert.equal(noSecret.status,503);
  const noHeader=await reserveLoginAttempt(new Request('https://example.test'),{CONTROL_DB:db,LOGIN_RATE_LIMIT_SECRET:secret},1000);
  assert.equal(noHeader.allowed,false);
  assert.equal(queries.length,0);
});
test('60 attempts within one window accepted; 61st denied for one hashed IP',async()=>{
  const {db,queries}=mockIpStore(),env={CONTROL_DB:db,LOGIN_RATE_LIMIT_SECRET:secret};
  for(let i=0;i<LOGIN_MAX_ATTEMPTS;i++)
    assert.equal((await reserveLoginAttempt(req(),env,100000+i)).allowed,true);
  const blocked=await reserveLoginAttempt(req(),env,100000+LOGIN_MAX_ATTEMPTS);
  assert.equal(blocked.allowed,false);assert.equal(blocked.status,429);
  assert.equal(queries.length,LOGIN_MAX_ATTEMPTS+1);
  assert.ok(queries.every(q=>q.params[0].length===64));
  assert.ok(queries.every(q=>q.sql.includes('ON CONFLICT(ip_hash) DO UPDATE')));
});
test('different Cloudflare IP uses an independent budget and old window resets',async()=>{
  const {db}=mockIpStore(),env={CONTROL_DB:db,LOGIN_RATE_LIMIT_SECRET:secret};
  await reserveLoginAttempt(req('203.0.113.45'),env,100000);
  await reserveLoginAttempt(req('203.0.113.45'),env,100001);
  const other=await reserveLoginAttempt(req('203.0.113.46'),env,100002);
  assert.equal(other.allowed,true);
  assert.equal((await reserveLoginAttempt(req('203.0.113.45'),env,100000+LOGIN_WINDOW_MS+1)).allowed,true);
});
test('login Worker blocks unconfigured edge limits before checking credentials',async()=>{
  const r=await worker.fetch(req(),{CONTROL_DB:{prepare(){throw Error('DB should not be used')}}});
  assert.equal(r.status,503);
});
test('login Worker rate limit returns 429 without password check',async()=>{
  const log=[];
  const env={LOGIN_RATE_LIMIT_SECRET:secret,CONTROL_DB:{prepare(sql){
    log.push(sql);
    return {bind(){return {async first(){return {attempt_count:61,blocked_until:Date.now()+120000}}}}};
  }}};
  const r=await worker.fetch(req(),env);
  assert.equal(r.status,429);
  assert.equal(log.length,1);
  assert.ok(log[0].includes('human_ip_login_limits'));
});
test('IP reservation uses no X-Forwarded-For even when one is supplied',async()=>{
  const env={LOGIN_RATE_LIMIT_SECRET:secret,CONTROL_DB:{prepare(){throw Error('no SQL expected')}}};
  const r=new Request('https://example.test/v1/human/login',{headers:{'x-forwarded-for':'203.0.113.45'}});
  assert.equal((await reserveLoginAttempt(r,env)).allowed,false);
});
