// Strict source-tree regression: only Plivo is supported by the current
// Calling application. Historical provider integrations must not reappear.
// This test does not inspect git history or mutate any database/provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

const retired=String.fromCharCode(101,120,111,116,101,108);
const skip=new Set(['.git','node_modules','.wrangler','coverage','.venv','__pycache__']);
function files(root='.'){
 const found=[];
 for(const entry of readdirSync(root,{withFileTypes:true})){
  if(skip.has(entry.name))continue;
  const path=join(root,entry.name);
  if(entry.isDirectory())found.push(...files(path));
  else if(entry.isFile()&&/\.(mjs|js|json|jsonc|yml|yaml|sql|py|md|conf|txt)$/.test(entry.name))
   found.push(path);
 }
 return found;
}
test('all current source, docs, migrations, tests and CI are free of the retired provider name',()=>{
 const bad=[];
 for(const path of files()){
  if(readFileSync(path,'utf8').toLowerCase().includes(retired))bad.push(path);
  if(path.toLowerCase().includes(retired))bad.push(path);
 }
 assert.deepEqual([...new Set(bad)],[],'obsolete carrier references are forbidden');
});
test('Plivo calling remains intact, gated and unknown provider webhooks are rejected',()=>{
 const index=readFileSync('src/index.mjs','utf8');
 const pilot=readFileSync('src/scripted-phone-pilot.mjs','utf8');
 const campaign=readFileSync('src/scripted-campaign-dispatch.mjs','utf8');
 const migrations=readFileSync('migrations/crm/0011_scripted_campaign_dispatch.sql','utf8');
 const schema=readFileSync('scripts/main-cloudflare.mjs','utf8');
 const workflow=readFileSync('.github/workflows/deploy-production.yml','utf8');
 assert.match(index,/path\.startsWith\('\/v1\/provider\/'\)\)return fail\('not found',404\)/);
 assert.match(pilot,/https:\/\/api\.plivo\.com\/v1\/Account\//);
 assert.match(pilot,/verifiedPlivoGet/);
 assert.match(campaign,/AR3D_SCRIPTED_CAMPAIGNS_ENABLED!==['"]enabled['"]/);
 assert.match(campaign,/CAMPAIGN_WORK_LIMIT=2/);
 assert.match(migrations,/CREATE TABLE calling_jobs/);
 assert.match(migrations,/CREATE UNIQUE INDEX calling_one_inflight/);
 assert.match(schema,/trg_no_call_launch/);
 assert.match(workflow,/0011_scripted_campaign_dispatch\.sql/);
 assert.doesNotMatch(workflow,/d1 execute[^\n]*(?:0008_[^\/]*receipts|0009_operator_self_test_calls|0010_[^\/]*status_checks|0009_voicebot_review_queue|0012_verified_voicebot_turns)/);
});
