import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tid,admin,client} from './helpers/calling-fixture.mjs';
import {handleCreditWalletRequest} from '../src/credit-wallet-routes.mjs';
test('confirmed purchase allocates once atomically; duplicate receipt and stale balance cannot mint credits',async()=>{
 const f=fixture();try{
 const now=Date.now();f.c.db.prepare("UPDATE human_sessions SET created_at=?,expires_at=? WHERE user_id='admin'").run(new Date(now).toISOString(),now+3600000);
 const req=(path,user,body)=>handleCreditWalletRequest(new Request('https://app.example.invalid/v1/human/credits/'+path,{method:body?'POST':'GET',headers:{origin:'https://app.example.invalid','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),f.env,user);
 const d={id:'12345678-1111-4111-8111-111111111111',tenantId:tid,paidPaise:100000,purchasedSeconds:30000,expectedBalanceSeconds:0,receiptRef:'receipt-500'};
 assert.equal((await req('client-purchase',client,d)).status,403);
 const foreign='99999999-9999-4999-8999-999999999999';
 f.c.db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,'foreign','Foreign','starter','shared','active',?,?)").run(foreign,new Date().toISOString(),new Date().toISOString());
 const pair=await Promise.all([req('client-purchase',admin,d),req('client-purchase',admin,d)]);
 assert.deepEqual(pair.map(r=>r.status).sort(),[200,201]);
 const b={...d,id:'12345678-2222-4222-8222-222222222222'};
 assert.equal((await req('client-purchase',admin,{...b,receiptRef:'RECEIPT-500',expectedBalanceSeconds:30000})).status,409);
 assert.equal((await req('client-purchase',admin,{...b,receiptRef:'receipt-600'})).status,409);
 assert.equal((await req('client-purchase',admin,{...b,tenantId:foreign})).status,409);
 assert.equal((await req('minute-ledger?tenantId='+foreign,client)).status,403);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_credit_purchases').get().n,1);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_minute_ledger').get().n,1);
 const ledger=await (await req('minute-ledger?tenantId='+tid,client)).json();
 assert.equal(ledger.uncommittedSeconds,30000);assert.equal(ledger.transactions[0].kind,'purchase');assert.equal(ledger.transactions[0].paidPaise,100000);
 assert.equal(ledger.transactions[0].receiptRef,'RECEIPT-500');assert.equal(Object.hasOwn(ledger.transactions[0],'actor'),false);
 assert.throws(()=>f.c.db.prepare("INSERT INTO tenant_credit_purchases(id,tenant_id,receipt_ref,paid_paise,purchased_seconds,previous_seconds,actor,created_at) VALUES('stale',?,'STALE-RECEIPT',1,60,0,'admin',?)").run(tid,new Date().toISOString()),/stale minute balance/);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_credit_purchases').get().n,1);
 assert.throws(()=>f.c.db.exec('DELETE FROM tenant_credit_purchases'),/immutable/);
 assert.throws(()=>f.c.db.exec('UPDATE tenant_credit_purchases SET paid_paise=1'),/immutable/);
 const dashboard=await (await req('admin-dashboard',admin)).json();
 assert.equal(dashboard.purchases.collectedPaise,100000);assert.equal(dashboard.purchases.purchasedSeconds,30000);assert.equal(dashboard.externalPaymentsRecorded,true);
 }finally{f.close()}
});
