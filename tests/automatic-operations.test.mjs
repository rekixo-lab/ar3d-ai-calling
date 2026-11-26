import {css} from '../src/app-assets.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/index.mjs';
import {AUTH_MAINTENANCE_CRON,pruneExpiredAuth} from '../src/auth-maintenance.mjs';
import {handleCallingCron} from '../src/calling-schedule.mjs';
import {monitor} from '../scripts/monitor-production.mjs';

const ORIGIN='https://aicalling.ar3dstudio.in';
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
  return {env:{CONTROL_DB:db,CRM_DB:{prepare(){throw Error('CRM was touched')}}},calls};
}
test('Cloudflare scheduled cleanup uses four auth tables and leaves CRM alone',async()=>{
  const {env,calls}=dbFixture({changes:2});
  const output=await worker.scheduled({cron:AUTH_MAINTENANCE_CRON,scheduledTime:NOW},env);
  assert.equal(output.rowsDeleted,8);
  assert.equal(output.tablesChecked,4);
  assert.equal(output.consentTouched,false);
  assert.equal(output.crmTouched,false);
  assert.equal(output.recordingsTouched,false);
  assert.equal(output.billingTouched,false);
  assert.equal(calls.length,4);
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
  await assert.rejects(worker.scheduled({cron:'*/3 * * * *',scheduledTime:NOW},f.env),/unknown/);
  await assert.rejects(pruneExpiredAuth(f.env,{cron:'every minute',now:NOW}),/unauthorized/);
  await assert.rejects(pruneExpiredAuth({}, {now:NOW}),/unauthorized/);
  await assert.rejects(pruneExpiredAuth(f.env,{now:-2}),/unauthorized/);
  assert.equal(f.calls.length,0);
  await assert.rejects(pruneExpiredAuth(dbFixture({changes:101}).env,{now:NOW}),/unconfirmed/);
  await assert.rejects(pruneExpiredAuth(dbFixture({changes:NaN}).env,{now:NOW}),/unconfirmed/);
  await assert.rejects(pruneExpiredAuth(dbFixture({throwOn:'human_invitations'}).env,{now:NOW}),/internal-db-failure/);
});
test('Maintenance never requires providers, payments or extra operator secrets',async()=>{
  const f=dbFixture({changes:0});
  const out=await handleCallingCron({cron:AUTH_MAINTENANCE_CRON,scheduledTime:NOW},f.env);
  assert.equal(out.rowsDeleted,0);
  assert.equal(out.service,'ar3d-ai-calling');
  assert.ok(!JSON.stringify(out).includes('token_hash'));
});

test('Periodic monitor is secretless, GET-only and checks the exact Calling origin',async()=>{
  const content={
    '/health':[200,'application/json',JSON.stringify({service:'AR3D AI Calling',status:'foundation'})],
    '/app':[200,'text/html','<html>AR3D AI Calling</html>'],
    '/app/assets/style.css':[200,'text/css',css],
    '/app/assets/app.js':[200,'text/javascript','Calling Setup /v1/human/scripted-phone-pilot Sign out']
  };
  content['/v1/provider/unknown-transport']=[404,'application/json',JSON.stringify({error:'not found'})];
  for(const path of ['/v1/human/me','/v1/human/scripted-phone-pilot',
    '/v1/human/leads/33333333-3333-4333-8333-333333333333/qualification',
    '/v1/human/call-intent-proposals',
    '/v1/human/voice-preview',
    '/v1/human/operations/report',
    '/v1/human/launch-readiness',
    '/v1/human/exports/leads',
    '/v1/human/audit',
    '/v1/human/ai-test-crm'])
    content[path]=[401,'application/json',JSON.stringify({error:'sign in required'})];
  const seen=[];
  const result=await monitor({fetchFn:async(url,opts)=>{
    seen.push([url.toString(),opts]);
    const [code,type,body]=content[url.pathname];
    return new Response(body,{status:code,headers:{'Content-Type':type}});
  }});
  assert.equal(result.healthy,true);
  assert.equal(seen.length,Object.keys(content).length);
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
test('one minute cron slot dispatches safely and preserves six-hour cleanup',async()=>{
 const f=dbFixture({changes:0});
 const between=Date.parse('2026-11-20T06:01:00Z');
 const idle=await handleCallingCron({cron:'* * * * *',scheduledTime:between},f.env);
 assert.equal(idle.processed,0);assert.equal(f.calls.length,0);
 const due=await handleCallingCron({cron:'* * * * *',scheduledTime:Date.parse('2026-11-20T06:00:00Z')},f.env);
 assert.equal(due.processed,0);assert.equal(due.maintenance.tablesChecked,4);
 assert.equal(f.calls.length,4);
});

test('hourly bounded auth cleanup improves 1000+ client hygiene without touching CRM or provider',async()=>{
 const f=dbFixture({changes:100});
 const hour=Date.parse('2026-11-20T07:00:00Z'); // not a six-hour boundary
 const result=await handleCallingCron({cron:'* * * * *',scheduledTime:hour},f.env);
 assert.equal(result.processed,0);
 assert.equal(result.maintenance.tablesChecked,4);
 assert.equal(result.maintenance.rowsDeleted,400);
 assert.equal(f.calls.length,4);
 assert.ok(f.calls.every(x=>x.params.at(-1)===100));
 assert.ok(f.calls.every(x=>x.sql.startsWith('DELETE FROM human_')));
 const notHour=await handleCallingCron({cron:'* * * * *',scheduledTime:hour+60000},f.env);
 assert.equal(notHour.processed,0);
 assert.equal(notHour.maintenance,undefined);
 assert.equal(f.calls.length,4);
 for(const invalid of [-1,NaN,Infinity,1.5])
  await assert.rejects(handleCallingCron({cron:'* * * * *',scheduledTime:invalid},f.env),
   /invalid Calling Worker schedule time/);
 assert.equal(f.calls.length,4);
});
test('hourly cleanup refuses an unexpected expired-row count and cannot continue with a false success',async()=>{
 const f=dbFixture({changes:101});
 await assert.rejects(handleCallingCron({
  cron:'* * * * *',scheduledTime:Date.parse('2026-11-20T07:00:00Z')
 },f.env),/unconfirmed expired session cleanup/);
 assert.ok(f.calls.every(x=>!/(INSERT INTO calls|UPDATE leads|DELETE FROM leads|recording)/i.test(x.sql)));
});
