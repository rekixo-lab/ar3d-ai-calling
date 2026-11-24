import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const retired=['razorpay-webhook-verification','release-gates','sandbox-pilot','sandbox-usage'];
function* walk(root){
 for(const entry of readdirSync(root,{withFileTypes:true})){
  const path=join(root,entry.name);
  if(entry.isDirectory())yield* walk(path);
  else if(/\.(?:mjs|js|py|json|toml|yaml|yml)$/.test(path))yield path;
 }
}
test('retired gateways and synthetic-only helpers remain absent from runtime and deploy code',()=>{
 for(const name of retired)assert.equal(existsSync('src/'+name+'.mjs'),false,name);
 for(const root of ['src','scripts','.github/workflows']){
  for(const path of walk(root)){
   const source=readFileSync(path,'utf8');
   for(const name of retired)assert.ok(!source.includes(name+'.mjs'),path+' references retired module '+name);
  }
 }
});
test('synthetic fixtures remain test-only and live launch readiness stays present',()=>{
 assert.ok(existsSync('tests/helpers/sandbox-pilot.mjs'));
 assert.ok(existsSync('tests/helpers/sandbox-usage.mjs'));
 assert.ok(existsSync('src/launch-readiness-routes.mjs'));
 assert.ok(existsSync('src/plivo-cost-reconcile-routes.mjs'));
 assert.ok(existsSync('src/minute-holds.mjs'));
});
