import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {js,css} from '../src/app-assets.mjs';
test('workspace exposes actual campaign controls and bounded customer browsing',()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  assert.match(js,/Campaign controls/);
  assert.match(js,/Previous results/);
  assert.match(js,/Next results/);
  assert.match(js,/offset:String\(offset\)/);
  assert.doesNotMatch(js,/Calling Campaign Drafts|AR3D Project Links/);
});

test('dashboard has role-specific navigation and separate account actions',()=>{
  assert.match(css,/\.sidebar-footer\s*\{\s*margin-top: auto/);
  assert.match(css,/:focus-visible/);
  assert.match(js,/\['security','Security','shield'/);
  assert.match(js,/\['calling','Calling Setup','phone'/);
  assert.match(js,/btn\('Sign out',logout,true\)/);
});

import {smoke,validateSmokeBase} from '../scripts/smoke-main.mjs';

test('public production smoke accepts only calling hosts and rejects external targets',()=>{
  assert.equal(validateSmokeBase('https://aicalling.ar3dstudio.in/'),'https://aicalling.ar3dstudio.in');
  assert.equal(validateSmokeBase('https://ar3d-ai-calling.ai-8f3.workers.dev'),'https://ar3d-ai-calling.ai-8f3.workers.dev');
  for(const url of [
    'http://aicalling.ar3dstudio.in','https://admin.rekixo.com',
    'https://aicalling.ar3dstudio.in.evil.example',
    'https://aicalling.ar3dstudio.in/app',
    'https://aicalling.ar3dstudio.in/?api_key=secret',
    'https://user:pass@aicalling.ar3dstudio.in',
    'https://ar3d-ai-calling.ai-8f3.workers.dev:8080'
  ]) assert.throws(()=>validateSmokeBase(url));
});

test('public smoke checks health, login UI, sidebar fix and 401 without writes or credentials',async()=>{
  const responses=new Map([
    ['/health',[200,'application/json',JSON.stringify({service:'AR3D AI Calling',status:'foundation'})]],
    ['/app',[200,'text/html','<title>AR3D AI Calling</title>']],
    ['/app/assets/style.css',[200,'text/css',css]],
    ['/app/assets/app.js',[200,'text/javascript','Calling Setup /v1/human/scripted-phone-pilot Sign out']],
    ['/v1/human/me',[401,'application/json',JSON.stringify({error:'sign in required'})]],
    ['/v1/human/scripted-phone-pilot',[401,'application/json',JSON.stringify({error:'sign in required'})]],
    ['/v1/provider/exotel/voicebot',[410,'application/json',JSON.stringify({error:'provider_route_retired'})]],
    ['/v1/human/leads/33333333-3333-4333-8333-333333333333/qualification',[401,'application/json',JSON.stringify({error:'sign in required'})]],
    ['/v1/human/call-intent-proposals',[401,'application/json',JSON.stringify({error:'sign in required'})]],
    ['/v1/human/voice-preview',[401,'application/json',JSON.stringify({error:'sign in required'})]]
  ]);
  const seen=[];
  const fetchFn=async (url,opts)=>{
    seen.push([url.pathname,opts]);
    const [status,contentType,body]=responses.get(url.pathname);
    return new Response(body,{status,headers:{'Content-Type':contentType}});
  };
  assert.equal(await smoke('https://aicalling.ar3dstudio.in',fetchFn),true);
  assert.deepEqual(seen.map(x=>x[0]),[...responses.keys()]);
  assert.ok(seen.every(([path,opts])=>opts.method==='GET'&&opts.redirect==='error'&&opts.cache==='no-store'));
});

test('public smoke fails closed on an unsafe redirect, broken content or wrong response',async()=>{
  const result=await smoke('https://aicalling.ar3dstudio.in',async()=>new Response('Not found',{status:404,headers:{'Content-Type':'text/html'}}));
  assert.equal(result,false);
});
