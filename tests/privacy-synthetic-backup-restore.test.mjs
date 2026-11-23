// Exercises REAL SQLite backup/restore on disposable SYNTHETIC databases.
// No Cloudflare credentials, customer records, provider calls, network or live D1.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {readdirSync,readFileSync,mkdtempSync,copyFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

function migrate(db,kind){
 const path='migrations/'+kind;
 for(const name of readdirSync(path).filter(name=>name.endsWith('.sql')).sort())
  db.exec(readFileSync(join(path,name),'utf8'));
}
const at='2026-11-20T10:00:00Z';
function seed(db,kind){
 if(kind==='control'){
  db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,?,'Synthetic Restore Tenant','starter','shared','active',?,?)")
   .run('11111111-1111-4111-8111-111111111111','synthetic-drill',at,at);
 }else{
  const sql="INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at) VALUES(?,?,?,?,'other',?,?)";
  db.prepare(sql).run('11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-333333333333','Synthetic Buyer One','+919000000001',at,at);
  db.prepare(sql).run('22222222-2222-4222-8222-222222222222',
   '44444444-4444-4444-8444-444444444444','Synthetic Buyer Two','+919000000002',at,at);
 }
}
function metrics(db,kind){
 const count=db.prepare('SELECT COUNT(*) AS n FROM '+(kind==='control'?'tenants':'leads')).get().n;
 const schema=db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n;
 const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;
 const fks=db.prepare('PRAGMA foreign_key_check').all();
 return {count,schema,integrity,foreignKeyViolations:fks.length};
}
test('isolated synthetic Control/CRM backup restores both schemas and separate tenant records',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'ar3d-ai-calling-drill-'));
 const dbs=[];
 try{
  for(const kind of ['control','crm']){
   const live=join(folder,kind+'-synthetic-source.sqlite');
   const archive=join(folder,kind+'-synthetic-backup.sqlite');
   const restored=join(folder,kind+'-synthetic-restored.sqlite');
   assert.notEqual(resolve(live),resolve(restored));
   const origin=new DatabaseSync(live);
   dbs.push(origin);
   migrate(origin,kind);
   seed(origin,kind);
   const original=metrics(origin,kind);
   assert.equal(original.integrity,'ok');
   assert.equal(original.foreignKeyViolations,0);
   assert.ok(original.schema>2);
   const pages=await backup(origin,archive);
   assert.ok(pages>0);
   assert.ok(statSync(archive).size>0);
   copyFileSync(archive,restored);
   const clone=new DatabaseSync(restored);
   dbs.push(clone);
   const restoredMetrics=metrics(clone,kind);
   assert.deepEqual(restoredMetrics,original);
   assert.equal(restoredMetrics.count,kind==='control'?1:2);
   if(kind==='crm'){
    const leads=clone.prepare('SELECT tenant_id,mobile_e164 FROM leads ORDER BY tenant_id').all();
    assert.equal(leads.length,2);
    assert.notEqual(leads[0].tenant_id,leads[1].tenant_id);
    assert.equal(leads[0].mobile_e164,'+919000000001');
    assert.equal(leads[1].mobile_e164,'+919000000002');
    clone.prepare("UPDATE leads SET name='Recovered test copy' WHERE tenant_id=? AND id=?")
     .run('11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333');
    const untouched=origin.prepare('SELECT name FROM leads WHERE tenant_id=? AND id=?')
     .get('11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333');
    assert.equal(untouched.name,'Synthetic Buyer One','restored copy must never modify source');
   }
  }
 }finally{
  for(const db of dbs)try{db.close()}catch{}
  rmSync(folder,{recursive:true,force:true});
 }
});
