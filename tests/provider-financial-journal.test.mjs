import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,admin,client} from './helpers/calling-fixture.mjs';
import {handleCreditWalletRequest} from '../src/credit-wallet-routes.mjs';
test('provider journals are MFA-only, immutable, currency-scoped, and retry safe',async()=>{
 const f=fixture();try{
 const now=Date.now();f.c.db.prepare("UPDATE human_sessions SET created_at=?,expires_at=? WHERE user_id='admin'").run(new Date(now).toISOString(),now+3600000);
 const req=(user,body)=>handleCreditWalletRequest(new Request('https://app.example.invalid/v1/human/credits/provider-journal',{method:body?'POST':'GET',headers:{origin:'https://app.example.invalid','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),f.env,user);
 const entry=(n,provider,currency,kind,amountMicros,evidenceRef)=>({id:'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),provider,currency,kind,amountMicros,evidenceRef,reason:'Synthetic invoice evidence'});
 const a=entry(1,'plivo','USD','opening',10000000,'opening-1'),b=entry(2,'plivo','USD','expense',2000000,'cdr-1'),c=entry(3,'sarvam','INR','topup',500000000,'receipt-1');
 assert.equal((await req(client)).status,403);assert.equal((await req(client,a)).status,403);
 for(const x of [a,b,c])assert.equal((await req(admin,x)).status,201);
 assert.equal((await (await req(admin,a)).json()).replayed,true);
 assert.equal((await req(admin,{...b,amountMicros:3})).status,409);
 assert.equal((await req(admin,{...b,id:c.id})).status,409);
 assert.equal((await req(admin,entry(5,'plivo','INR','expense',160000000,'cdr-1'))).status,409);
 assert.equal((await req(admin,entry(4,'sarvam','INR','opening',1,'opening-late'))).status,409);
 const data=await (await req(admin)).json();
 assert.equal(data.accounts.find(x=>x.provider==='plivo').recordedNetMicros,8000000);
 assert.equal(data.accounts.find(x=>x.provider==='sarvam').recordedNetMicros,500000000);
 assert.equal(data.dispatchEnabledByJournal,false);assert.equal(data.liveBalanceVerified,false);
 assert.throws(()=>f.c.db.exec("UPDATE provider_financial_journal SET amount_micros=1"),/immutable/);
 assert.throws(()=>f.c.db.exec("DELETE FROM provider_financial_journal"),/immutable/);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_minute_ledger').get().n,0);
 }finally{f.close()}
});

test('Sarvam dashboard sync sets the recorded INR balance exactly to Credits Left',async()=>{
 const f=fixture();try{
 const now=Date.now();f.c.db.prepare("UPDATE human_sessions SET created_at=?,expires_at=? WHERE user_id='admin'").run(new Date(now).toISOString(),now+3600000);
 const req=(user,body)=>handleCreditWalletRequest(new Request('https://app.example.invalid/v1/human/credits/sarvam-balance',{method:body?'POST':'GET',headers:{origin:'https://app.example.invalid','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),f.env,user);
 const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
 assert.equal((await req(client)).status,403);
 assert.equal((await req(client,{id:id(1),creditsLeftMicros:1})).status,403);
 let s=await (await req(admin)).json();assert.equal(s.available,false);assert.equal(s.balanceMicros,null);
 assert.equal((await req(admin,{id:id(1),creditsLeftMicros:0})).status,400);
 assert.equal((await req(admin,{id:id(1),creditsLeftMicros:-5})).status,400);
 let r=await req(admin,{id:id(2),creditsLeftMicros:950500000});assert.equal(r.status,201);
 s=await r.json();assert.equal(s.balanceMicros,950500000);assert.ok(s.lastSyncAt);assert.equal(s.dispatchEnabledByJournal,false);
 // Usage lowers the dashboard value: an expense entry for the exact difference.
 s=await (await req(admin,{id:id(3),creditsLeftMicros:900000000})).json();assert.equal(s.balanceMicros,900000000);
 // A recharge raises it: a top-up for the exact difference.
 s=await (await req(admin,{id:id(4),creditsLeftMicros:1900000000})).json();assert.equal(s.balanceMicros,1900000000);
 const same=await req(admin,{id:id(5),creditsLeftMicros:1900000000});assert.equal(same.status,200);assert.equal((await same.json()).changed,false);
 const kinds=f.c.db.prepare("SELECT kind,amount_micros AS a FROM provider_financial_journal WHERE provider='sarvam' ORDER BY sequence").all().map(x=>x.kind+':'+x.a);
 assert.deepEqual(kinds,['opening:950500000','expense:50500000','topup:1000000000']);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM tenant_minute_ledger').get().n,0);
 }finally{f.close()}
});
