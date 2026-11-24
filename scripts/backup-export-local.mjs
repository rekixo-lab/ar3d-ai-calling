// Explicit local operator command; never run from CI or a Worker.
import {mkdtempSync,readFileSync,writeFileSync,rmSync,statSync,realpathSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {getCredentials,inspectCloudflare,verifiedSchemaState} from './main-cloudflare.mjs';
import {sealBackup,openBackup} from './backup-archive.mjs';
const repo=realpathSync(fileURLToPath(new URL('..',import.meta.url))),MAX=64*1024*1024;
function privateOutside(path,dir){
 const p=realpathSync(path),s=statSync(p);
 if(p===repo||p.startsWith(repo+sep)||(s.mode&0o077)!==0||!(dir?s.isDirectory():s.isFile()))throw Error('Use a private location outside the repo');
 return p;
}
export async function exportCallingBackup({directory,keyPath,environment=process.env,inspect=inspectCloudflare,spawn=spawnSync}){
 if(environment.CI||environment.GITHUB_ACTIONS)throw Error('Production backups are local operator tasks, never CI');
 const dest=privateOutside(directory,true),keyFile=privateOutside(keyPath,false);
 if(statSync(keyFile).size!==32)throw Error('Backup key must be 32 random bytes');
 const key=readFileSync(keyFile),credentials=getCredentials(environment),template=JSON.parse(readFileSync(join(repo,'wrangler.example.jsonc'),'utf8'));
 const {config,modes}=await inspect({credentials,mode:'ready',template});
 if(verifiedSchemaState(modes)!=='ready')throw Error('Calling schema must be ready');
 // Account and exact IDs were checked read-only before any CLI export.
 const temp=mkdtempSync(join(dest,'.calling-export-'));
 try{
  const cfg=join(temp,'wrangler.jsonc');
  writeFileSync(cfg,JSON.stringify({...config,account_id:credentials.account}),{mode:0o600,flag:'wx'});
  const parts=[];
  for(const [binding,name] of [['CONTROL_DB','control.sql'],['CRM_DB','crm.sql']]){
   const output=join(temp,name);
   const r=spawn('wrangler',['d1','export',binding,'--remote','--config',cfg,'--output',output],{cwd:temp,env:{...environment,CLOUDFLARE_ACCOUNT_ID:credentials.account},stdio:'ignore',timeout:180000});
   if(r.error||r.status!==0)throw Error('Calling export failed');
   const s=statSync(output);if(!s.isFile()||s.size<1||s.size>MAX)throw Error('Unsupported export size');
   parts.push(readFileSync(output));
  }
  const archive=sealBackup(parts[0],parts[1],key);
  const {manifest}=openBackup(archive,key);
  const output=join(dest,'calling-'+manifest.createdAt.replace(/[:.]/g,'-')+'.enc');
  writeFileSync(output,archive,{mode:0o600,flag:'wx'});
  return {archivePath:output,createdAt:manifest.createdAt};
 }finally{key.fill(0);rmSync(temp,{recursive:true,force:true})}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [confirm,directory,keyPath,...rest]=process.argv.slice(2);
 if(confirm!=='EXPORT_TWO_VERIFIED_CALLING_DATABASES'||!directory||!keyPath||rest.length){
  console.error('Usage: node scripts/backup-export-local.mjs EXPORT_TWO_VERIFIED_CALLING_DATABASES <private-dir> <private-key>');
  process.exitCode=1;
 }else{
  process.umask(0o077);
  exportCallingBackup({directory,keyPath}).then(r=>console.log('Encrypted Calling backup authenticated: '+r.createdAt)).catch(()=>{console.error('Backup failed; verify account, credentials, schema, private paths and local Wrangler installation.');process.exitCode=1});
 }
}
