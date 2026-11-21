import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,client,now,at,setup as setupCampaign} from './helpers/calling-fixture.mjs';
import {gatewayBot,setupPublication,publicationProvider,publishForTest} from './helpers/publication-fixture.mjs';
import {registerVoiceCall} from '../src/shared-voice-gateway.mjs';
import {handleVoiceGatewaySession} from '../src/voice-gateway-session.mjs';
import {tickTenant} from '../src/campaign-dispatch.mjs';
const sid='CAregisteredcall1234';
async function prepared(){const f=fixture();await setupCampaign(f);const s=await setupPublication(f),p=publicationProvider();await publishForTest(f,s,p);
 const job=f.r.db.prepare('SELECT * FROM calling_jobs').get();
 f.r.db.prepare("UPDATE calling_jobs SET state='submitted',reserved_at=?,account_sid=?,caller_id=?,flow_id='123456',destination='+919000000001',provider_call_sid=? WHERE id=?").run(at,f.env.EXOTEL_ACCOUNT_SID,f.env.EXOTEL_CALLER_ID,sid,job.id);
 const pub=f.c.db.prepare('SELECT * FROM calling_agent_publications').get();await registerVoiceCall(f.env,{tenantId:tid,publicationId:pub.id,jobId:job.id,callSid:sid,now});return {f,p,pub,job};
}
function request(f,patch={},headers={}){return new Request('https://app.example.invalid/v1/provider/exotel/voicebot/session-start',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+f.env.EXOTEL_VOICEBOT_WEBHOOK_TOKEN,...headers},body:JSON.stringify({session_id:'77777777-7777-4777-8777-777777777777',account_id:f.env.EXOTEL_ACCOUNT_SID,bot_id:gatewayBot,external_id:sid,session_state:'session_start',network_type:'pstn',metadata:{call_sid:sid},...patch})})}
function fetcher(f,p,override={}){return async(url,options)=>{
 if(String(url).includes('/Calls/'))return Response.json({Call:{Sid:sid,AccountSid:f.env.EXOTEL_ACCOUNT_SID,PhoneNumberSid:f.env.EXOTEL_CALLER_ID,Direction:'outbound-api',Status:'in-progress',From:'09000000001',Duration:null,...override}});
 return p.fetcher(url,options);
}}
test('only registered authenticated in-progress call resolves its own immutable publication',async()=>{const {f,p,pub}=await prepared();try{
 f.c.db.prepare("UPDATE shared_voice_gateway SET state='staged'").run();
 const r=await handleVoiceGatewaySession(request(f,{tenant_id:'attacker-supplied-ignored',conversation_assistant_id:'attacker-supplied-ignored'}),f.env,{now,apiFetch:fetcher(f,p)});assert.equal(r.status,200,await r.clone().text());
 const data=await r.json();assert.equal(data.response.data.conversation_assistant_id,pub.provider_assistant_id);assert.equal(data.response.data.greeting_message.text,pub.greeting);
 assert.equal(f.c.db.prepare('SELECT state FROM shared_voice_gateway').get().state,'ready');
 assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM leads').get().n,1);
 assert.throws(()=>f.c.db.exec("UPDATE voice_call_routes SET tenant_id='wrong'"),/immutable/);
}finally{f.close()}});
test('gateway rejects forged origin, token, bot/account references, unknown call SID, expired mapping, wrong destination and completed calls',async()=>{const {f,p}=await prepared();try{
 let count=0;const api=async(...args)=>{count++;return fetcher(f,p)(...args)};
 assert.equal((await handleVoiceGatewaySession(request(f,{}, {Origin:'https://evil.invalid'}),f.env,{now,apiFetch:api})).status,403);
 assert.equal((await handleVoiceGatewaySession(request(f,{}, {Authorization:'Bearer '+'b'.repeat(64)}),f.env,{now,apiFetch:api})).status,401);
 assert.equal((await handleVoiceGatewaySession(request(f,{bot_id:'wrong'}),f.env,{now,apiFetch:api})).status,400);
 assert.equal((await handleVoiceGatewaySession(request(f,{account_id:'other-account'}),f.env,{now,apiFetch:api})).status,400);
 assert.equal((await handleVoiceGatewaySession(request(f,{metadata:{call_sid:'other-call'}}),f.env,{now,apiFetch:api})).status,400);
 assert.equal((await handleVoiceGatewaySession(request(f,{external_id:'CAunknowncall',metadata:{call_sid:'CAunknowncall'}}),f.env,{now,apiFetch:api})).status,404);
 assert.equal(count,0);
 assert.equal((await handleVoiceGatewaySession(request(f),f.env,{now:now+21*60000,apiFetch:api})).status,404);
 assert.equal((await handleVoiceGatewaySession(request(f),f.env,{now,apiFetch:fetcher(f,p,{From:'09000000002'})})).status,503);
 assert.equal((await handleVoiceGatewaySession(request(f),f.env,{now,apiFetch:fetcher(f,p,{Status:'completed'})})).status,409);
}finally{f.close()}});
test('existing queued campaigns cannot dispatch while shared gateway or latest publication is missing',async()=>{const f=fixture();try{await setupCampaign(f);f.env.EXOTEL_REQUIRE_PUBLISHED_AGENT='enabled';let calls=0;
 const r=await tickTenant(f.env,f.r.wrap,tid,{now,apiFetch:async()=>{calls++;throw Error('must not dial')}});assert.equal(r.state,'agent_publication_required');assert.equal(calls,0);assert.equal(f.r.db.prepare('SELECT state FROM calling_jobs').get().state,'queued');
}finally{f.close()}});
