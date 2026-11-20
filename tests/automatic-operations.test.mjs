import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/index.mjs';
import {AUTH_MAINTENANCE_CRON,pruneExpiredAuth,pruneExpiredExotelWebhookReceipts,
  handleCallingCron} from '../src/automatic-auth-maintenance.mjs';
import {probeExotelConnectivity} from '../src/provider-connectivity.mjs';
import {monitor} from '../scripts/monitor-production.mjs';

const ORIGIN='https://aicalling.ar3dstudio.in';
const cookie='ar3d_calling_session='+'a'.repeat(64);
const NOW=1800000000000;
function dbFixture({changes=1,throwOn=null}={}){
  const calls=[];
  const db={prepare(sql){
    if(throwOn&&sql.includes(throwOn))throw Error('internal-db-failure');
    return {bind(...params){
      calls.push({sql,params});
      return {run:async()=>({meta:{changes}})};
    }};
  }};
  return {env:{CONTROL_DB:db,CRM_DB:{prepare(){throw Error('CRM touched')}}},calls};
}
test('Cloudflare scheduled cleanup uses four auth tables and isolated Exotel receipt expiry',async()=>{
  const {env,calls}=dbFixture({changes:2});
  const output=await worker.scheduled({cron:AUTH_MAINTENANCE_CRON,scheduledTime:NOW},env);
  assert.equal(output.rowsDeleted,8);
  assert.equal(output.tablesChecked,4);
  assert.equal(output.webhookReceiptsDeleted,2);
  assert.equal(output.consentTouched,false);
  assert.equal(output.crmTouched,false);
  assert.equal(output.recordingsTouched,false);
  assert.equal(output.billingTouched,false);
  assert.equal(calls.length,5);
  assert.ok(calls.some(x=>x.sql.includes('DELETE FROM exotel_voicebot_event_receipts')&&x.params.includes(NOW)));
  assert.ok(calls.every(x=>x.params.at(-1)===100));
  const sql=calls.map(x=>x.sql).join(' ');
  assert.ok(sql.includes('DELETE FROM human_sessions'));
  assert.ok(sql.includes('DELETE FROM human_mfa_challenges'));
  assert.ok(sql.includes('DELETE FROM human_invitations'));
  assert.ok(sql.includes('DELETE FROM human_ip_login_limits'));
  assert.doesNotMatch(sql,/leads|consent|opt_out|recording|billing|crm_audit|conversation_simulations|customer|UPDATE |INSERT /i);
  assert.ok(calls.some(x=>x.params.includes(NOW)));
});
test('Unknown schedules and DBs fail closed before touching customer data',async()=>{
  const f=dbFixture();
  await assert.rejects(worker.scheduled({cron:'* * * * *',scheduledTime:NOW},f.env),/unknown/);
  await assert.rejects(pruneExpiredAuth(f.env,{cron:'every minute',now:NOW}),/unauthorized/);
  await assert.rejects(pruneExpiredAuth({}, {now:NOW}),/unauthorized/);
  await assert.rejects(pruneExpiredAuth(f.env,{now:-2}),/unauthorized/);
  await assert.rejects(pruneExpiredExotelWebhookReceipts(f.env,{now:-2}),/unauthorized/);
  await assert.rejects(pruneExpiredExotelWebhookReceipts(f.env,{cron:'* * * * *',now:NOW}),/unauthorized/);
  assert.equal(f.calls.length,0);
  await assert.rejects(pruneExpiredAuth(dbFixture({changes:101}).env,{now:NOW}),/unconfirmed/);
  await assert.rejects(pruneExpiredAuth(dbFixture({changes:NaN}).env,{now:NOW}),/unconfirmed/);
  await assert.rejects(pruneExpiredAuth(dbFixture({throwOn:'human_invitations'}).env,{now:NOW}),/internal-db-failure/);
});
test('Maintenance never requires providers, payments or extra operator secrets',async()=>{
  const f=dbFixture({changes:0});
  const out=await handleCallingCron({cron:AUTH_MAINTENANCE_CRON,scheduledTime:NOW},f.env);
  assert.equal(out.rowsDeleted,0);
  assert.equal(out.webhookReceiptsDeleted,0);
  assert.equal(out.service,'ar3d-ai-calling');
  assert.ok(!JSON.stringify(out).includes('token_hash'));
});

const exotelEnv={
  EXOTEL_ACCOUNT_SID:'fictional_account',
  EXOTEL_API_KEY:'synthetic_private_api_key_123',
  EXOTEL_API_TOKEN:'synthetic_private_api_token_123',
  EXOTEL_REGION:'india'
};
test('Exotel connectivity without secrets is ready for manual config but makes no network calls',async()=>{
  let called=0;
  const r=await probeExotelConnectivity({},{
    apiFetch:async()=>{called++;throw Error('must never call');}
  });
  assert.equal(r.configured,false);
  assert.equal(r.verified,false);
  assert.equal(r.outboundCallsEnabled,false);
  assert.equal(called,0);
});
test('Exotel connectivity uses only read-only India GET and returns no private account data',async()=>{
  const calls=[];
  const r=await probeExotelConnectivity(exotelEnv,{apiFetch:async(url,opts)=>{
    calls.push({url,opts});
    return Response.json({Calls:[],Metadata:{Total:0}});
  }});
  assert.equal(r.configured,true);
  assert.equal(r.verified,true);
  assert.equal(r.outboundCallsEnabled,false);
  assert.equal(r.voiceStreamingEnabled,false);
  assert.equal(calls.length,1);
  assert.equal(calls[0].opts.method,'GET');
  assert.equal(calls[0].opts.redirect,'manual');
  assert.equal(calls[0].opts.cache,'no-store');
  assert.equal(calls[0].url,'https://api.in.exotel.com/v1/Accounts/fictional_account/Calls.json?PageSize=1');
  assert.ok(!JSON.stringify(r).includes(exotelEnv.EXOTEL_API_KEY));
  assert.ok(!JSON.stringify(r).includes(exotelEnv.EXOTEL_API_TOKEN));
  assert.ok(!JSON.stringify(r).includes(exotelEnv.EXOTEL_ACCOUNT_SID));
});
test('Exotel connectivity fails closed and never echoes vendor errors or credentials',async()=>{
  const r=await probeExotelConnectivity(exotelEnv,{
    apiFetch:async()=>{throw Error('private credential was invalid: '+exotelEnv.EXOTEL_API_TOKEN)}
  });
  assert.equal(r.verified,false);
  assert.equal(r.configured,true);
  assert.equal(r.outboundCallsEnabled,false);
  assert.ok(!JSON.stringify(r).includes('synthetic_private'));
});
function sessionEnv(role='super_admin'){
  const queried=[];
  const db={prepare(sql){
    queried.push(sql);
    if(!sql.includes('FROM human_sessions'))throw Error('unexpected DB access');
    return {bind(){return {first:async()=>({id:'fakeoperator',
      email:'fictional@example.invalid',globalRole:role,token_hash:'fake'})}}};
  }};
  return {env:{CONTROL_DB:db},queried};
}
function request(input,{method='POST',origin=ORIGIN}={}){
  return new Request(ORIGIN+'/v1/human/engineering/provider-connectivity',{
    method,headers:{cookie,...(method==='POST'?{origin,'Content-Type':'application/json'}:{})},
    ...(method==='POST'?{body:JSON.stringify(input)}:{})
  });
}
test('Only an active Super Admin can access authenticated Exotel connectivity; no login/PII leaks',async()=>{
  const admin=sessionEnv();
  const ok=await worker.fetch(request({}),admin.env);
  assert.equal(ok.status,200);
  const body=await ok.json();
  assert.equal(body.configured,false);
  assert.equal(body.verified,false);
  assert.equal(body.outboundCallsEnabled,false);
  assert.ok(admin.queried.every(q=>q.includes('FROM human_sessions')));
  assert.equal((await worker.fetch(request({}),sessionEnv('user').env)).status,403);
  const unauth=await worker.fetch(new Request(ORIGIN+'/v1/human/engineering/provider-connectivity'),
    {CONTROL_DB:{prepare(){throw Error('should not query invalid cookie')}}});
  assert.equal(unauth.status,401);
  assert.equal((await worker.fetch(request(null,{method:'GET'}),admin.env)).status,405);
  assert.equal((await worker.fetch(request({}, {origin:'https://other.example'}),admin.env)).status,403);
  assert.equal((await worker.fetch(request({mobile:'+919000000001'}),admin.env)).status,400);
  assert.equal((await worker.fetch(request({token:'secret'}),admin.env)).status,400);
});

test('Periodic monitor is secretless, GET-only and checks the exact Calling origin',async()=>{
  const content={
    '/health':[200,'application/json',JSON.stringify({service:'AR3D AI Calling',status:'foundation'})],
    '/app':[200,'text/html','<html>AR3D AI Calling</html>'],
    '/app/assets/style.css':[200,'text/css','.sidebar .navitem{display:block;margin:0'],
    '/app/assets/app.js':[200,'text/javascript','Test AI Conversation Sign out']
  };
  for(const path of ['/v1/human/me','/v1/human/engineering/status',
    '/v1/human/engineering/provider-pilot','/v1/human/engineering/media-protocol',
    '/v1/human/engineering/provider-connectivity',
    '/v1/human/engineering/exotel-trial-setup',
    '/v1/human/engineering/own-sip-setup',
    '/v1/human/engineering/voicebot-fixture',
    '/v1/human/engineering/voicebot-qualification',
    '/v1/human/leads/33333333-3333-4333-8333-333333333333/qualification',
    '/v1/human/voicebot-reviews',
    '/v1/human/call-intent-proposals',
    '/v1/human/voice-preview'])
    content[path]=[401,'application/json',JSON.stringify({error:'sign in required'})];
  const seen=[];
  const result=await monitor({fetchFn:async(url,opts)=>{
    seen.push([url.toString(),opts]);
    const [code,type,body]=content[url.pathname];
    return new Response(body,{status:code,headers:{'Content-Type':type}});
  }});
  assert.equal(result.healthy,true);
  assert.equal(seen.length,17);
  assert.ok(seen.every(([u,o])=>u.startsWith(ORIGIN+'/')&&
    o.method==='GET'&&o.redirect==='error'&&o.cache==='no-store'));
  const yaml=readFileSync('.github/workflows/monitor-production.yml','utf8');
  assert.match(yaml,/schedule:/);
  assert.match(yaml,/cron: '23 \*\/6 \* \* \*'/);
  assert.match(yaml,/contents: read/);
  assert.doesNotMatch(yaml,/secrets\.|wrangler deploy|d1 execute|authorization:|curl .*POST/i);
});
test('Monitoring refuses other AR3D sites, malicious paths and unhealthy health results',async()=>{
  await assert.rejects(monitor({base:'https://admin.rekixo.com'}),/isolated Calling Worker/);
  await assert.rejects(monitor({base:ORIGIN+'/api/tenant'}),/isolated Calling Worker/);
  const result=await monitor({fetchFn:async()=>new Response('Not found',{status:404})});
  assert.equal(result.healthy,false);
});
