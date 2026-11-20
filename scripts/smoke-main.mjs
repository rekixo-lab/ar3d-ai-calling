// Strictly read-only public smoke tests for the standalone AR3D Calling Worker.
// No authenticated session, customer data, secret, POST or live telecom requests.
import { fileURLToPath } from 'node:url';

const PUBLIC_CUSTOM_HOST='aicalling.ar3dstudio.in';
export function validateSmokeBase(raw){
  let url;
  try{url=new URL(raw)}catch{throw Error('invalid smoke target')}
  if(url.protocol!=='https:'||url.username||url.password||url.port||
     url.pathname!=='/'||url.search||url.hash||
     (url.hostname!==PUBLIC_CUSTOM_HOST &&
      !/^ar3d-ai-calling\.[a-z0-9-]+\.workers\.dev$/i.test(url.hostname)))
    throw Error('smoke target must be the isolated Calling Worker or exact calling custom domain');
  return url.origin;
}

export async function smoke(base,fetchFn=fetch){
  const origin=validateSmokeBase(base);
  const checks=[
    ['/health',200,'application/json',async r=>{
      const body=await r.json();return body.service==='AR3D AI Calling'&&body.status==='foundation';
    }],
    ['/app',200,'text/html',async r=>(await r.text()).includes('AR3D AI Calling')],
    ['/app/assets/style.css',200,'text/css',async r=>{
      const css=await r.text();return css.includes('.sidebar .navitem{display:block;margin:0');
    }],
    ['/app/assets/app.js',200,'text/javascript',async r=>{
      const js=await r.text();return js.includes('Test AI Conversation')&&js.includes('Sign out');
    }],
    ['/v1/human/me',401,'application/json',async r=>(await r.json()).error==='sign in required'],
    ['/v1/human/engineering/status',401,'application/json',async r=>(await r.json()).error==='sign in required'],
    ['/v1/human/engineering/provider-pilot',401,'application/json',async r=>(await r.json()).error==='sign in required'],
    ['/v1/human/engineering/media-protocol',401,'application/json',async r=>(await r.json()).error==='sign in required'],
    ['/v1/human/engineering/provider-connectivity',401,'application/json',async r=>(await r.json()).error==='sign in required'],
    ['/v1/human/engineering/exotel-trial-setup',401,'application/json',async r=>(await r.json()).error==='sign in required'],
    ['/v1/human/engineering/own-sip-setup',401,'application/json',async r=>(await r.json()).error==='sign in required'],
    ['/v1/human/engineering/voicebot-fixture',401,'application/json',async r=>(await r.json()).error==='sign in required'],
    ['/v1/human/engineering/voicebot-qualification',401,'application/json',async r=>(await r.json()).error==='sign in required'],
    ['/v1/human/leads/33333333-3333-4333-8333-333333333333/qualification',401,'application/json',async r=>(await r.json()).error==='sign in required'],
    ['/v1/human/voicebot-reviews',401,'application/json',async r=>(await r.json()).error==='sign in required'],
    ['/v1/human/voice-preview',401,'application/json',async r=>(await r.json()).error==='sign in required'],
  ];
  let ok=true;
  for(const [path,status,contentType,check] of checks){
    try{
      const response=await fetchFn(new URL(path,origin),{
        method:'GET',redirect:'error',cache:'no-store'
      });
      const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
      const valid=response.status===status&&type===contentType&&await check(response);
      console.log(path,'HTTP '+response.status,valid?'PASS':'FAIL');
      if(!valid)ok=false;
    }catch{
      // Never print response bodies, internal errors or request metadata.
      console.log(path,'FAIL (network or unexpected response)');
      ok=false;
    }
  }
  return ok;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  try{
    const ok=await smoke(process.argv[2]);
    if(!ok)process.exitCode=1;
  }catch{
    console.error('Usage: node scripts/smoke-main.mjs https://aicalling.ar3dstudio.in');
    process.exitCode=2;
  }
}
