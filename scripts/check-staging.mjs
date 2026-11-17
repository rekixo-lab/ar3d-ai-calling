import {readFileSync} from 'node:fs';
const file=process.argv[2]||'wrangler.staging.jsonc';
try{
  const text=readFileSync(file,'utf8').replace(/^\s*\/\/.*$/gm,'');
  const data=JSON.parse(text);
  if(data.name!=='ar3d-ai-calling-staging')throw Error('Worker must be staging only');
  if(data.workers_dev!==true)throw Error('Staging must use workers.dev (no production routes)');
  if(data.routes?.length)throw Error('Production/custom routes are not allowed in staging');
  if(!Array.isArray(data.d1_databases)||data.d1_databases.length!==2)throw Error('Two staging D1 bindings required');
  for(const [binding,name] of [['CONTROL_DB','ar3d-calling-control-staging'],['CRM_DB','ar3d-calling-shared-crm-staging']]){
    const row=data.d1_databases.find(x=>x.binding===binding);
    if(!row||row.database_name!==name||!/^[a-f0-9-]{36}$/i.test(row.database_id)||row.database_id.includes('REPLACE'))throw Error('Missing verified staging D1 ID for '+binding);
  }
  if(!data.r2_buckets?.some(x=>x.binding==='RECORDINGS'&&x.bucket_name==='ar3d-calling-recordings-staging'))throw Error('Missing staging R2');
  if(text.includes('tiyansh-production')||text.includes('rekixo-3d-production'))throw Error('Existing AR3D production resources forbidden');
  console.log('Safe staging config verified (IDs and resources); secret/bootstrap review still required.');
}catch(e){console.error('Staging validation failed:',e.message);process.exitCode=1}
