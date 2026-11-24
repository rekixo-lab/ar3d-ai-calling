import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Cloudflare Workers RequestInit does not implement redirect:'error'.
// Unlike Node's fetch(), attempting that mode in a deployed Worker throws
// TypeError *before* any Plivo request is made. This is an expensive failure
// that is invisible to node-only synthetic upstream mocks.
const src=join(dirname(fileURLToPath(import.meta.url)),'..','src');
test('every deployed Cloudflare Worker module avoids unsupported error redirects',()=>{
 let count=0;
 for(const name of readdirSync(src).filter(n=>n.endsWith('.mjs'))){
  const s=readFileSync(join(src,name),'utf8');
  assert.doesNotMatch(s,/redirect\s*:\s*['"]error['"]/,
   name+': Workers must use manual redirects, then reject non-2xx provider responses');
  count++;
 }
 assert.ok(count>10,'must check actual deployed source modules');
});

test('all seven Plivo network call sites use manual redirect with no token forwarding',()=>{
 const files={
  'credit-wallet-routes.mjs':3,
  'plivo-cost-reconcile-routes.mjs':1,
  'plivo-cdr-routes.mjs':1,
  'scripted-phone-pilot.mjs':2
 };
 for(const [name,total] of Object.entries(files)){
  const s=readFileSync(join(src,name),'utf8');
  const manual=[...s.matchAll(/redirect\s*:\s*['"]manual['"]/g)].length;
  assert.ok(manual>=total,name+' should use manual redirect for every Plivo request');
  assert.doesNotMatch(s,/redirect\s*:\s*['"]follow['"]/,
   name+' must not forward HTTP Basic Auth to redirected domains');
 }
});
