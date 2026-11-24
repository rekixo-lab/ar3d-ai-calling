import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {sealBackup,openBackup} from '../scripts/backup-archive.mjs';
test('offline encrypted D1 archive round-trips both distinct dumps, rejects damage and wrong keys',()=>{
 const key=randomBytes(32),a=Buffer.from('CREATE TABLE control_demo (id);'),b=Buffer.from('CREATE TABLE crm_demo (id);');
 const enc=sealBackup(a,b,key),r=openBackup(enc,key);
 assert.deepEqual(r.parts,[a,b]);assert.equal(r.manifest.files.length,2);
 assert.equal(enc.includes(a),false);assert.notDeepEqual(sealBackup(a,b,key),enc);
 const corrupt=Buffer.from(enc);corrupt[corrupt.length-1]^=1;
 assert.throws(()=>openBackup(corrupt,key),/authentication/);assert.throws(()=>openBackup(enc,randomBytes(32)),/authentication/);
 assert.throws(()=>sealBackup(Buffer.alloc(0),b,key),/dump/);assert.throws(()=>openBackup(enc,Buffer.alloc(31)),/key/);
});
