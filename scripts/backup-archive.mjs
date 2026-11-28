// Offline operator utility for two explicitly exported D1 SQL dumps.
// No Cloudflare API, restoration, provider traffic, or GitHub upload.
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,statSync,mkdirSync,realpathSync,rmSync} from 'node:fs';
import {resolve,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const MAGIC=Buffer.from('AR3DBAK1');
const MAX=64*1024*1024,MAX_ARCHIVE=2*MAX+4096;
const sha=b=>createHash('sha256').update(b).digest('hex');
const names=['ar3d-calling-control.sql','ar3d-calling-shared-crm.sql'];
function keyCheck(key){if(!Buffer.isBuffer(key)||key.length!==32)throw Error('Backup key must be 32 random bytes')}
export function sealBackup(control,crm,key){
 keyCheck(key);
 const parts=[control,crm];
 if(parts.some(b=>!Buffer.isBuffer(b)||!b.length||b.length>MAX))throw Error('Invalid or oversized dump');
 const manifest=Buffer.from(JSON.stringify({version:1,createdAt:new Date().toISOString(),files:parts.map((b,i)=>({name:names[i],size:b.length,sha256:sha(b)}))}));
 const len=Buffer.alloc(4);len.writeUInt32BE(manifest.length);
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(MAGIC);
 const ciphertext=Buffer.concat([cipher.update(len),cipher.update(manifest),...parts.map(b=>cipher.update(b)),cipher.final()]);
 return Buffer.concat([MAGIC,iv,cipher.getAuthTag(),ciphertext]);
}
export function openBackup(archive,key){
 keyCheck(key);
 if(!Buffer.isBuffer(archive)||archive.length<41||archive.length>MAX_ARCHIVE||!archive.subarray(0,8).equals(MAGIC))throw Error('Invalid archive');
 const decipher=createDecipheriv('aes-256-gcm',key,archive.subarray(8,20));decipher.setAAD(MAGIC);decipher.setAuthTag(archive.subarray(20,36));
 let body;
 try{body=Buffer.concat([decipher.update(archive.subarray(36)),decipher.final()])}catch{throw Error('Archive authentication failed')}
 const len=body.readUInt32BE(0);if(len<1||len>2048||4+len>=body.length)throw Error('Invalid archive manifest');
 const manifest=JSON.parse(body.subarray(4,4+len).toString('utf8'));
 if(manifest.version!==1||!Number.isFinite(Date.parse(manifest.createdAt))||!Array.isArray(manifest.files)||manifest.files.length!==2)throw Error('Invalid archive manifest');
 let cursor=4+len;
 const parts=manifest.files.map((f,i)=>{
  if(f.name!==names[i]||!Number.isSafeInteger(f.size)||f.size<1||f.size>MAX||cursor+f.size>body.length)throw Error('Invalid archive item');
  const data=body.subarray(cursor,cursor+f.size);cursor+=f.size;
  if(sha(data)!==f.sha256)throw Error('Archive checksum mismatch');
  return data;
 });
 if(cursor!==body.length)throw Error('Unexpected archive bytes');
 return {manifest,parts};
}
const repo=realpathSync(fileURLToPath(new URL('..',import.meta.url)));
function outside(path,existing=true){
 const abs=resolve(path),physical=existing?realpathSync(abs):join(realpathSync(dirname(abs)),abs.split(sep).at(-1));
 if(physical===repo||physical.startsWith(repo+sep))throw Error('Keep backups and keys outside the repository');
 return physical;
}
function privateFile(path,max){
 const p=outside(path),s=statSync(p);
 if(!s.isFile()||s.size<1||s.size>max||(s.mode&0o077)!==0)throw Error('Use a private regular file (0600) of supported size');
 return readFileSync(p);
}
function privateDestination(path){
 const p=outside(path,false),s=statSync(dirname(p));
 if(!s.isDirectory()||(s.mode&0o077)!==0)throw Error('Use a private destination directory (0700)');
 return p;
}
// Run each authenticated dump in a disposable, in-memory database. Only the
// child process receives plaintext. Its diagnostics never include SQL or rows.
export function verifyRestore(parts){
 const script=fileURLToPath(new URL('./verify-restore.py',import.meta.url));
 for(const [index,kind] of ['control','crm'].entries()){
  const run=spawnSync('python3',['-I',script,kind],{input:parts[index],timeout:120000,stdio:['pipe','ignore','ignore']});
  if(run.error||run.status!==0)throw Error('Isolated '+kind+' restore failed');
 }
}
function usage(){throw Error('Usage: seal <control.sql> <crm.sql> <key> <archive> | verify <archive> <key> | verify-restore <archive> <key> | extract <archive> <key> <new-private-dir>')}
function main(args){
 const [command,...a]=args;
 if(command==='seal'&&a.length===4){
  const controlPath=outside(a[0]),crmPath=outside(a[1]);
  if(controlPath===crmPath||statSync(controlPath).ino===statSync(crmPath).ino&&statSync(controlPath).dev===statSync(crmPath).dev)throw Error('Control and CRM must be distinct files');
  const archive=sealBackup(privateFile(controlPath,MAX),privateFile(crmPath,MAX),privateFile(a[2],32));
  const result=openBackup(archive,privateFile(a[2],32));
  writeFileSync(privateDestination(a[3]),archive,{flag:'wx',mode:0o600});
  console.log('Encrypted backup saved and authenticated: '+result.manifest.createdAt);
 }else if((['verify','verify-restore'].includes(command)&&a.length===2)||(command==='extract'&&a.length===3)){
  const result=openBackup(privateFile(a[0],MAX_ARCHIVE),privateFile(a[1],32));
  if(command==='verify-restore'){
   verifyRestore(result.parts);
   console.log('Control and CRM restored in memory; required tables, integrity and foreign keys verified.');
  }
  if(command==='extract'){
   const dest=privateDestination(a[2]);mkdirSync(dest,{mode:0o700});
   try{result.parts.forEach((b,i)=>writeFileSync(join(dest,names[i]),b,{flag:'wx',mode:0o600}));}
   catch(e){rmSync(dest,{recursive:true,force:true});throw e}
  }
  console.log('Backup authenticated; two SQL dumps checked. No live restore performed.');
 }else usage();
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main(process.argv.slice(2))}catch(e){console.error('Backup operation failed; check paths, permissions, key and archive.');process.exitCode=1}
}
