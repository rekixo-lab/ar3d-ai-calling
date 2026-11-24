// Source-tree regression. Historical Git commits and existing database records
// are intentionally outside this check; no destructive data migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const forbidden=[
 ['whis','per'],['deep','gram'],['no','va','-3'],['no','va','_3'],['lla','ma'],['qw','en'],
 ['workers',' ai'],['workers','-ai'],['speech','recognition'],['ar3d_campaign_','speech_engine'],
 ['@','cf/'],['streaming','-speech.mjs'],['transcribe','scriptedanswer'],['transcribe','novarecordedanswer'],
 ['media-','diagnostics']
].map(parts=>parts.join(''));
const skipped=new Set(['.git','node_modules','.wrangler','coverage','.venv','__pycache__']);
function* walk(root='.'){
 for(const e of readdirSync(root,{withFileTypes:true})){
  if(skipped.has(e.name))continue;
  const path=join(root,e.name);
  if(e.isDirectory())yield* walk(path);
  else if(e.isFile()&&/\.(mjs|js|json|jsonc|yml|yaml|sql|py|md|conf|txt)$/.test(path))yield path;
 }
}
test('no retired speech or contextual model, selector, route or binding anywhere in the current source tree',()=>{
 const hits=[];
 for(const path of walk()){
  const source=readFileSync(path,'utf8').toLowerCase();
  for(const name of forbidden)if(source.includes(name)||path.toLowerCase().includes(name))hits.push(path+': '+name);
  if(/\benv\s*\.\s*ai\b/i.test(source)||/["']ai["']\s*:\s*\{\s*["']binding["']/i.test(source))hits.push(path+': retired inference binding');
 }
 assert.deepEqual(hits,[]);
 assert.equal(existsSync('src/'+['streaming','speech.mjs'].join('-')),false);
 const config=JSON.parse(readFileSync('wrangler.example.jsonc','utf8').replace(/^\s*\/\/.*$/gm,''));
 assert.equal(Object.hasOwn(config,'ai'),false);
});
test('single provider recognition and contextual adapters are explicit, not inferred from legacy settings',()=>{
 const phone=readFileSync('src/scripted-phone-pilot.mjs','utf8');
 const speech=readFileSync('src/scripted-speech.mjs','utf8');
 const preview=readFileSync('src/fixed-voice-preview-routes.mjs','utf8');
 const contextual=readFileSync('src/sarvam-contextual.mjs','utf8');
 assert.match(phone,/const engine='sarvam'/);
 assert.match(phone,/step!=='hangup'&&\(!isSarvam\(row\)/);
 assert.match(speech,/https:\/\/api\.sarvam\.ai\/speech-to-text/);
 assert.match(preview,/X-AR3D-Speech-Consent/);
 assert.match(contextual,/sarvam-105b-conversations/);
});
