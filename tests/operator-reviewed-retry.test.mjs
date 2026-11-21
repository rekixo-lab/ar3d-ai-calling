import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,admin,now,at,accepted} from './helpers/calling-fixture.mjs';
import {handleExotelOperatorTest} from '../src/exotel-operator-test-routes.mjs';
const failed='77777777-7777-4777-8777-777777777777';
function setup(owner=admin.id){const f=fixture();Object.assign(f.env,{EXOTEL_OPERATOR_TEST_ENABLED:'enabled',EXOTEL_VOICE_AI_FLOW_ID:'123456',EXOTEL_VERIFIED_TEST_NUMBER:'+919000000001'});
 f.c.db.prepare("INSERT INTO exotel_operator_test_calls VALUES(?,?,?,'CAfictionalfailed','submitted',NULL,?,?)").run(failed,owner,'normal-slot',at,at);
 f.c.db.prepare("INSERT INTO exotel_operator_test_calls VALUES(?,?,?,NULL,'unknown','unconfirmed_provider_response',?,?)").run('88888888-8888-4888-8888-888888888888',admin.id,'other-slot',at,at);
 f.c.db.prepare("INSERT INTO exotel_operator_status_checks(id,call_request_id,actor_user_id,check_slot,state,provider_status,duration_seconds,created_at,finished_at) VALUES(?,?,?,'check-slot','verified','failed',31,?,?)").run('99999999-9999-4999-8999-999999999999',failed,owner,at,at);return f;}
function req(data){return new Request('https://app.example.invalid/v1/human/engineering/exotel-self-test',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://app.example.invalid'},body:JSON.stringify(data)})}
const retry={confirm:'RETRY_MY_FAILED_VERIFIED_TEST_ONCE',failedRequestId:failed};
test('one reviewed failure retry after normal quota is atomic and cannot be repeated',async()=>{const f=setup();try{let n=0;const options={now,apiFetch:async()=>{n++;return accepted()}};
 assert.equal((await handleExotelOperatorTest(req({confirm:'CALL_MY_VERIFIED_NUMBER_ONCE'}),f.env,admin,options)).status,429);
 const results=await Promise.all([handleExotelOperatorTest(req(retry),f.env,admin,options),handleExotelOperatorTest(req(retry),f.env,admin,options)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[202,429]);assert.equal(n,1);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM exotel_operator_test_calls').get().n,3);
 assert.equal(f.c.db.prepare('SELECT state FROM exotel_operator_test_calls WHERE id=?').get(failed).state,'submitted');
}finally{f.close()}});
test('reviewed retry cannot use unknown, unverified, other-admin, or completed call evidence',async()=>{for(const type of ['unknown','completed','unverified','other-admin']){const f=setup(type==='other-admin'?'client':admin.id);try{
 if(type==='unknown')retry.failedRequestId='88888888-8888-4888-8888-888888888888';
 else if(type==='other-admin'){}
 else if(type==='completed')f.c.db.prepare("INSERT INTO exotel_operator_status_checks(id,call_request_id,actor_user_id,check_slot,state,provider_status,duration_seconds,created_at,finished_at) VALUES(?,?,?,'new-check','verified','completed',90,?,?)").run(crypto.randomUUID(),failed,admin.id,'2026-11-20T06:31:00.000Z',at);
 else f.c.db.prepare("INSERT INTO exotel_operator_status_checks(id,call_request_id,actor_user_id,check_slot,state,error_code,created_at,finished_at) VALUES(?,?,?,'new-check','unknown','provider_unavailable',?,?)").run(crypto.randomUUID(),failed,admin.id,'2026-11-20T06:31:00.000Z',at);
 let n=0;const r=await handleExotelOperatorTest(req(retry),f.env,admin,{now,apiFetch:async()=>{n++;return accepted()}});assert.ok([403,429].includes(r.status));assert.equal(n,0);
 }finally{retry.failedRequestId=failed;f.close()}}});
