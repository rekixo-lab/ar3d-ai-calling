import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,cid,lead,now,at,until,admin,client,route,setup,accepted} from './helpers/calling-fixture.mjs';
import {tickTenant,campaignConfig,inCallingWindow,runCampaignCron} from '../src/campaign-dispatch.mjs';
test('migrated database: admin approval → client start → exactly one Exotel dispatch → verified status',async()=>{
 const f=fixture();try{
 await setup(f);let posted=0;
 const send=async req=>{posted++;assert.equal(req.method,'POST');const b=new URLSearchParams(await req.text());assert.equal(b.get('From'),'+919000000001');assert.equal(b.get('Record'),'false');assert.match(b.get('Url'),/123456$/);return accepted()};
 const out=await Promise.all([tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:send}),tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:send})]);
 assert.equal(posted,1);assert.ok(out.some(x=>x.state==='submitted'));
 const result=await tickTenant(f.env,f.r.wrap,tid,{now:now+60000,apiFetch:async(url,opts)=>{assert.equal(opts.method,'GET');return Response.json({Call:{Sid:'CAfictional123456',Status:'completed',Direction:'outbound-api',PhoneNumberSid:'08000000000',AccountSid:'fictionalaccount',Duration:'37'}})}});
 assert.equal(result.state,'reconciled');assert.equal(f.r.db.prepare('SELECT state FROM calling_jobs').get().state,'completed');
 await tickTenant(f.env,f.r.wrap,tid,{now:now+120000,apiFetch:send});assert.equal(f.r.db.prepare('SELECT state FROM calling_runs').get().state,'completed');
 await route(f,'runs',{tenantId:tid,campaignId:cid,action:'start'});await tickTenant(f.env,f.r.wrap,tid,{now:now+180000,apiFetch:send});assert.equal(posted,1);
 const state=await (await route(f,'state',{tenantId:tid},client,'GET')).json();assert.equal(state.jobs[0].durationSeconds,37);assert.doesNotMatch(JSON.stringify(state),/CAfictional|fictionaltoken|9000000001/);
 }finally{f.close()}
});
test('timeout/5xx/invalid provider responses never redial; uncertain job locks next dispatch',async()=>{
 for(const provider of [async()=>{throw Error('timeout')},async()=>new Response('upstream failure',{status:503}),async()=>Response.json({Call:{Sid:'wrong'}})]){
 const f=fixture();try{await setup(f);let calls=0;const send=async(...args)=>{calls++;return provider(...args)};
 assert.equal((await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:send})).state,'unknown');
 assert.equal((await tickTenant(f.env,f.r.wrap,tid,{now:now+60000,apiFetch:send})).state,'locked');assert.equal(calls,1);
 }finally{f.close()}}
});
test('pause, expiry, kill switch and hours prevent dispatch; opt-out blocks queued customer',async()=>{
 for(const condition of ['pause','expiry','kill','hours','optout','clearance']){
 const f=fixture();try{await setup(f);let when=now;
 if(condition==='pause')await route(f,'runs',{tenantId:tid,campaignId:cid,action:'pause'});
 if(condition==='expiry')f.r.db.exec("UPDATE calling_policies SET expires_at='2000-01-01T00:00:00.000Z'");
 if(condition==='kill')f.env.EXOTEL_CUSTOMER_CAMPAIGNS_ENABLED='disabled';
 if(condition==='hours')when=Date.parse('2026-11-20T17:00:00Z');
 if(condition==='optout')f.r.db.exec("UPDATE leads SET consent_status='denied',dnd_status='blocked'");
 if(condition==='clearance')f.r.db.exec('DELETE FROM calling_clearances');
 let calls=0;await tickTenant(f.env,f.r.wrap,tid,{now:when,apiFetch:async()=>{calls++;return accepted()}});assert.equal(calls,0,condition);
 }finally{f.close()}}
});
test('client/viewer/cross-tenant cannot grant approvals or start another company',async()=>{
 const f=fixture();try{
 assert.equal((await route(f,'policy',{tenantId:tid},client)).status,403);
 assert.equal((await route(f,'clearances',{tenantId:tid},client)).status,403);
 assert.equal((await route(f,'runs',{tenantId:tid,campaignId:cid,action:'start'},{id:'viewer',globalRole:'user'})).status,403);
 assert.equal((await route(f,'runs',{tenantId:'99999999-9999-4999-8999-999999999999',campaignId:cid,action:'start'})).status,403);
 f.c.db.exec('DELETE FROM human_mfa_settings');assert.equal((await route(f,'policy',{tenantId:tid},admin)).status,403);
 }finally{f.close()}
});
test('cron kill switch touches no database; Indian window boundary is explicit',async()=>{
 assert.deepEqual(await runCampaignCron({}),{processed:0});assert.equal(campaignConfig({}).ready,false);
 assert.equal(inCallingWindow(Date.parse('2026-11-20T03:30:00Z')),true);
 assert.equal(inCallingWindow(Date.parse('2026-11-20T14:30:00Z')),false);
});
test('daily cap is atomic and failed attempts consume quota',async()=>{
 const f=fixture();try{
 await setup(f);f.r.db.exec('UPDATE calling_policies SET daily_limit=1');
 await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:async()=>new Response('',{status:400})});
 const second='44444444-4444-4444-8444-444444444444';
 f.r.db.prepare("INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES(?,?,'Second fictional','+919000000002','excel',?,?)").run(tid,second,at,at);
 f.r.db.prepare("INSERT INTO calling_clearances SELECT tenant_id,?,purpose,consent_reference,dnd_reference,expires_at,reviewed_by,reviewed_at FROM calling_clearances WHERE lead_id=?").run(second,lead);
 const run=f.r.db.prepare('SELECT id FROM calling_runs').get();
 f.r.db.prepare("INSERT INTO calling_jobs(tenant_id,id,run_id,lead_id,state,created_at,updated_at) VALUES(?,'second-job',?,?,'queued',?,?)").run(tid,run.id,second,at,at);
 let posted=0;assert.equal((await tickTenant(f.env,f.r.wrap,tid,{now:now+60000,apiFetch:async()=>{posted++;return accepted()}})).state,'quota_or_concurrent_change');
 assert.equal(posted,0);assert.equal(f.r.db.prepare("SELECT state FROM calling_jobs WHERE id='second-job'").get().state,'queued');
 }finally{f.close()}
});
test('a second campaign cannot recontact a customer on stale approval',async()=>{
 const f=fixture();try{
 await setup(f);await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:async()=>new Response('',{status:400})});
 const another='55555555-5555-4555-8555-555555555555';
 f.r.db.prepare("INSERT INTO call_campaign_drafts SELECT tenant_id,?,'Second campaign',language_mode,purpose,status,created_by,created_at,updated_at FROM call_campaign_drafts WHERE id=?").run(another,cid);
 f.r.db.prepare('INSERT INTO call_campaign_candidates VALUES(?,?,?,?)').run(tid,another,lead,at);
 assert.equal((await route(f,'runs',{tenantId:tid,campaignId:another,action:'start'})).status,202);
 let posted=0;await tickTenant(f.env,f.r.wrap,tid,{now:now+60000,apiFetch:async()=>{posted++;return accepted()}});
 assert.equal(posted,0);assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM calling_jobs WHERE state='blocked'").get().n,1);
 }finally{f.close()}
});
test('only reviewed policy activation promotes a trial tenant, without touching other tenants',async()=>{
 const f=fixture();try{
 f.c.db.exec("UPDATE tenants SET status='trial'");
 await setup(f);assert.equal(f.c.db.prepare('SELECT status FROM tenants').get().status,'active');
 assert.equal(f.c.db.prepare("SELECT COUNT(*) AS n FROM tenant_audit_events WHERE action='tenant.calling_activated'").get().n,1);
 }finally{f.close()}
});
