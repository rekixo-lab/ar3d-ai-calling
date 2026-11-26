import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {REQUIRED_TABLES,REQUIRED_COLUMNS,PROPERTY_TABLES,WHATSAPP_TABLES,CONTROL_WHATSAPP_TABLES,
  checkTables,checkColumns,verifiedSchemaState,makeMainConfig,getCredentials} from '../scripts/main-cloudflare.mjs';

test('only the complete reviewed property/WhatsApp groups can upgrade the existing deployment',()=>{
 const control=REQUIRED_TABLES.CONTROL_DB.filter(x=>!CONTROL_WHATSAPP_TABLES.includes(x));
 const crm=REQUIRED_TABLES.CRM_DB.filter(x=>![...PROPERTY_TABLES,...WHATSAPP_TABLES].includes(x));
 assert.equal(checkTables(control,'CONTROL_DB','preflight'),'control_whatsapp_upgrade');
 const queueUpgrade=[...control,'whatsapp_connections','whatsapp_webhook_batches'];
 assert.equal(checkTables(queueUpgrade,'CONTROL_DB','preflight'),'control_whatsapp_queue_upgrade');
 assert.equal(verifiedSchemaState({CONTROL_DB:'control_whatsapp_queue_upgrade',CRM_DB:'ready'}),'whatsapp_queue_upgrade');
 assert.equal(checkTables(crm,'CRM_DB','preflight'),'crm_property_whatsapp_upgrade');
 assert.equal(verifiedSchemaState({CONTROL_DB:'control_whatsapp_upgrade',CRM_DB:'crm_property_whatsapp_upgrade'}),'property_whatsapp_upgrade');
 for(const c of ['ready','control_whatsapp_upgrade']){
  for(const r of ['crm_property_upgrade','crm_whatsapp_upgrade','crm_property_whatsapp_upgrade'])
   assert.equal(verifiedSchemaState({CONTROL_DB:c,CRM_DB:r}),'property_whatsapp_upgrade');
 }
 assert.equal(verifiedSchemaState({CONTROL_DB:'control_whatsapp_upgrade',CRM_DB:'ready'}),'property_whatsapp_upgrade');
 assert.equal(checkTables([...crm,...PROPERTY_TABLES],'CRM_DB','preflight'),'crm_whatsapp_upgrade');
 assert.equal(checkTables([...crm,...WHATSAPP_TABLES],'CRM_DB','preflight'),'crm_property_upgrade');
 assert.throws(()=>checkTables([...crm,'properties'],'CRM_DB','preflight'),/partial schema/);
 assert.throws(()=>checkTables([...control,'whatsapp_connections'],'CONTROL_DB','preflight'),/partial schema/);
 assert.throws(()=>checkTables([...control,'whatsapp_webhook_batches'],'CONTROL_DB','preflight'),/partial schema/);
 assert.throws(()=>checkTables(control.filter(x=>x!=='human_sessions'),'CONTROL_DB','preflight'),/partial schema/);
 assert.throws(()=>checkTables(crm.filter(x=>x!=='leads'),'CRM_DB','preflight'),/partial schema/);
 assert.throws(()=>checkTables(crm,'CRM_DB','ready'),/missing tables/);
 assert.throws(()=>verifiedSchemaState({CONTROL_DB:'control_funding_settings_upgrade',CRM_DB:'crm_whatsapp_upgrade'}),/mixed/);
});

test('fresh migrations satisfy every new deployment column guard and can be reapplied without seeding sends',()=>{
 for(const [kind,binding,files,tableNames] of [
  ['control','CONTROL_DB',['0032_whatsapp_connections.sql','0033_whatsapp_dispatch_ticks.sql'],CONTROL_WHATSAPP_TABLES],
  ['crm','CRM_DB',['0023_property_catalog.sql','0024_whatsapp_followups.sql'],[...PROPERTY_TABLES,...WHATSAPP_TABLES]],
 ]){
  const db=new DatabaseSync(':memory:');
  try{
   for(const file of readdirSync('migrations/'+kind).filter(x=>x.endsWith('.sql')).sort())
    db.exec(readFileSync('migrations/'+kind+'/'+file,'utf8'));
   for(const table of tableNames){
    checkColumns(db.prepare('PRAGMA table_info('+table+')').all().map(x=>x.name),binding,table);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table+' should not be seeded');
   }
   if(kind==='crm')db.prepare("INSERT INTO leads(tenant_id,id,mobile_e164,source_type,created_at,updated_at) VALUES('tenant','lead','+919000000001','excel','2026-11-26','2026-11-26')").run();
   for(const file of files)db.exec(readFileSync('migrations/'+kind+'/'+file,'utf8'));
   if(kind==='crm')assert.equal(db.prepare('SELECT COUNT(*) n FROM leads').get().n,1);
   assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close()}
 }
});

test('one existing schedule and the bounded WhatsApp queue are required; unrelated resources are refused',()=>{
 const template=JSON.parse(readFileSync('wrangler.example.jsonc','utf8'));
 const creds=getCredentials({CLOUDFLARE_API_TOKEN:'synthetic-token-for-tests-only',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),
  CONTROL_DB_ID:'11111111-1111-4111-8111-111111111111',CRM_DB_ID:'22222222-2222-4222-8222-222222222222'});
 assert.deepEqual(makeMainConfig(template,creds).triggers.crons,['* * * * *']);
 assert.equal(makeMainConfig(template,creds).queues.consumers[0].queue,'ar3d-calling-whatsapp');
 for(const crons of [[],['*/2 * * * *'],['* * * * *','* * * * *'],['* * * * *','*/2 * * * *']])
  assert.throws(()=>makeMainConfig({...template,triggers:{crons}},creds),/Unsafe/);
 for(const change of [
  t=>{delete t.queues;},
  t=>{t.queues.producers[0].queue='another-app';},
  t=>{t.queues.consumers[0].queue='another-app';},
  t=>{t.queues.consumers[0].max_batch_size=100;},
  t=>{t.queues.consumers[0].max_concurrency=10;},
  t=>{t.queues.consumers.push({...t.queues.consumers[0]});},
 ]){const t=structuredClone(template);change(t);assert.throws(()=>makeMainConfig(t,creds),/Unsafe/);}
 const workflow=readFileSync('.github/workflows/deploy-production.yml','utf8');
 for(const file of ['0032_whatsapp_connections.sql','0023_property_catalog.sql','0024_whatsapp_followups.sql'])
  assert.equal(workflow.split(file).length-1,2,'fresh initialization and reviewed upgrade both need '+file);
 assert.match(workflow,/property_whatsapp_upgrade[\s\S]*0032_whatsapp_connections\.sql[\s\S]*0023_property_catalog\.sql[\s\S]*0024_whatsapp_followups\.sql/);
 assert.equal(workflow.split('0033_whatsapp_dispatch_ticks.sql').length-1,3,'tick storage supports new, existing and full feature upgrades');
 assert.match(workflow,/ensure-whatsapp-queue\.mjs[\s\S]*Deploy only the new AR3D AI Calling Worker/);
});
