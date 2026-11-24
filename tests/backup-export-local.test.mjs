import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {exportCallingBackup} from '../scripts/backup-export-local.mjs';
import {openBackup} from '../scripts/backup-archive.mjs';
test('local backup command gates identity, exports only two configured bindings and cleans temporary plaintext',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ar3d-local-backup-')),key=join(dir,'key.bin'),bytes=randomBytes(32);
 writeFileSync(key,bytes,{mode:0o600});
 const environment={CLOUDFLARE_API_TOKEN:'a'.repeat(32),CLOUDFLARE_ACCOUNT_ID:'b'.repeat(32),CONTROL_DB_ID:'11111111-1111-4111-8111-111111111111',CRM_DB_ID:'22222222-2222-4222-8222-222222222222'};
 const calls=[];
 const inspect=async({mode})=>{assert.equal(mode,'ready');return {config:{name:'ar3d-ai-calling'},modes:{CONTROL_DB:'ready',CRM_DB:'ready'}}};
 const spawn=(cmd,args)=>{assert.equal(cmd,'wrangler');assert.deepEqual(args.slice(0,2),['d1','export']);assert.ok(args.includes('--remote'));calls.push(args[2]);writeFileSync(args.at(-1),'synthetic '+args[2],{mode:0o600});return {status:0}};
 try{
  await assert.rejects(exportCallingBackup({directory:dir,keyPath:key,environment:{...environment,CI:'true'},inspect,spawn}),/local operator/);
  await assert.rejects(exportCallingBackup({directory:dir,keyPath:key,environment,inspect:async()=>{throw Error('identity mismatch')},spawn}),/identity mismatch/);assert.equal(calls.length,0);
  const r=await exportCallingBackup({directory:dir,keyPath:key,environment,inspect,spawn});
  assert.deepEqual(calls,['CONTROL_DB','CRM_DB']);assert.equal(statSync(r.archivePath).mode&0o777,0o600);
  assert.deepEqual(openBackup(readFileSync(r.archivePath),bytes).parts.map(x=>x.toString()),['synthetic CONTROL_DB','synthetic CRM_DB']);
  await assert.rejects(exportCallingBackup({directory:dir,keyPath:key,environment,inspect,spawn:()=>({status:1})}),/export failed/);
  assert.ok(readdirSync(dir).every(x=>x==='key.bin'||x.endsWith('.enc')));
 }finally{rmSync(dir,{recursive:true,force:true})}
});
