import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';

const site='https://ar3d-ai-calling.demo.workers.dev';
test('only simulator page can request browser microphone permission',async()=>{
  const app=await worker.fetch(new Request(site+'/app'));
  const simulator=await worker.fetch(new Request(site+'/app/simulator'));
  assert.equal(app.status,200);
  assert.equal(simulator.status,200);
  assert.match(app.headers.get('permissions-policy')||'',/microphone=\(\)/);
  assert.match(simulator.headers.get('permissions-policy')||'',/microphone=\(self\)/);
  assert.match(simulator.headers.get('content-security-policy')||'',/script-src 'self'/);
  assert.match(simulator.headers.get('content-security-policy')||'',/frame-ancestors 'none'/);
});
test('bootstrap handles terminal-pasted outer whitespace but never accepts a different token',async()=>{
  let reads=0;
  const env={ADMIN_BOOTSTRAP_TOKEN:'\n  '+'K'.repeat(44)+' \n',
    CONTROL_DB:{prepare(){reads++;return {first:async()=>({n:1})}}}};
  const base={
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:'demo@example.test',password:'unused-validpass-123'})
  };
  const good=await worker.fetch(new Request(site+'/v1/human/bootstrap',{
    ...base,headers:{...base.headers,Authorization:'Bearer '+'K'.repeat(44)}
  }),env);
  assert.equal(good.status,409);
  assert.equal(reads,1);
  const wrong=await worker.fetch(new Request(site+'/v1/human/bootstrap',{
    ...base,headers:{...base.headers,Authorization:'Bearer '+'J'.repeat(44)}
  }),env);
  assert.equal(wrong.status,401);
  assert.equal(reads,1);
});
test('bootstrap makes a compatible V2 password hash and atomic singleton claim',async()=>{
  const secret='S'.repeat(48),prepared=[];
  let batches=0;
  const db={
    prepare(sql){
      return {
        async first(){
          assert.match(sql,/SELECT COUNT/);
          return {n:0};
        },
        bind(...args){prepared.push({sql,args});return {sql,args}}
      };
    },
    async batch(items){
      batches++;
      assert.equal(items.length,2);
      return [{success:true},{success:true}];
    }
  };
  const req=new Request(site+'/v1/human/bootstrap',{
    method:'POST',
    headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},
    body:JSON.stringify({email:'admin@example.test',password:'CorrectHorseBattery123!'})
  });
  const res=await worker.fetch(req,{ADMIN_BOOTSTRAP_TOKEN:secret,CONTROL_DB:db});
  assert.equal(res.status,201,JSON.stringify(await res.clone().json()));
  assert.equal(batches,1);
  const statement=prepared.find(x=>x.sql.includes('INSERT INTO human_users'));
  assert.ok(statement);
  assert.equal(statement.args[4],300000);
  assert.match(statement.args[3],/^[a-f0-9]{64}$/);
  assert.notEqual(statement.args[3],'CorrectHorseBattery123!');
});

test('one-time bootstrap streaming request rejects >16 KiB BEFORE D1 access',async()=>{
  let dbReads=0;
  const secret='B'.repeat(48);
  const env={ADMIN_BOOTSTRAP_TOKEN:secret,CONTROL_DB:{prepare(){dbReads++;throw Error('DB must not be called')}}};
  const response=await worker.fetch(new Request(site+'/v1/human/bootstrap',{
    method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},
    body:JSON.stringify({email:'demo@example.test',password:'P'.repeat(17000)})
  }),env);
  assert.equal(response.status,400);
  assert.equal(dbReads,0);
  assert.match((await response.json()).error,/body/i);
});
