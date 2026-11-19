/**
 * Real Chromium browser E2E for the *isolated synthetic* Super Admin UI.
 * Local 127.0.0.1 fixture only. No Worker credentials, real user details,
 * Cloudflare D1 writes, telecom request, call, paid charge or external network.
 * Requires npm install --no-save playwright@1.56.1 + npx playwright install chromium.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {html,css,js} from '../src/app-assets.mjs';
import {productionReadiness} from '../src/release-gates.mjs';
import {runSyntheticPilot} from '../src/sandbox-pilot.mjs';

const SESSION='synthetic-browser-session-only';
const TEST_EMAIL='sandbox-operator@example.invalid';
const TEST_PASSWORD='FictionalBrowserTestPassword2026!';
let pilotRuns=0,invalidRequests=0;
const respond=(res,code,body,type='application/json',extra={})=>{
  res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store',...extra});
  res.end(typeof body==='string'?body:JSON.stringify(body));
};
async function readBounded(req){
  let bytes=0,raw='';
  for await(const chunk of req){
    bytes+=chunk.length;
    if(bytes>1000)throw Error('oversized synthetic request');
    raw+=chunk.toString('utf8');
  }
  return JSON.parse(raw);
}
const server=http.createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://127.0.0.1').pathname;
    const authenticated=(req.headers.cookie||'').includes('sandbox_session='+SESSION);
    if(req.method==='GET'&&path==='/app')
      return respond(res,200,html,'text/html; charset=utf-8');
    if(req.method==='GET'&&path==='/app/assets/app.js')
      return respond(res,200,js,'text/javascript; charset=utf-8');
    if(req.method==='GET'&&path==='/app/assets/style.css')
      return respond(res,200,css,'text/css; charset=utf-8');
    if(req.method==='POST'&&path==='/v1/human/login'){
      const data=await readBounded(req);
      if(data.email!==TEST_EMAIL||data.password!==TEST_PASSWORD)
        return respond(res,401,{error:'invalid synthetic credentials'});
      return respond(res,200,{ok:true},'application/json',{
        'Set-Cookie':'sandbox_session='+SESSION+'; Path=/; HttpOnly; SameSite=Strict'
      });
    }
    if(req.method==='GET'&&path==='/v1/human/me')
      return authenticated?respond(res,200,{
        id:'synthetic-admin',email:TEST_EMAIL,superAdmin:true,tenants:[]
      }):respond(res,401,{error:'sign in required'});
    if(req.method==='POST'&&path==='/v1/human/logout')
      return respond(res,200,{ok:true},'application/json',{
        'Set-Cookie':'sandbox_session=; Path=/; HttpOnly; Max-Age=0'
      });
    if(!authenticated)return respond(res,401,{error:'sign in required'});
    if(req.method==='GET'&&path==='/v1/human/mfa')
      return respond(res,200,{enabled:false,configured:true});
    if(req.method==='GET'&&path==='/v1/human/tenants')
      return respond(res,200,{tenants:[]});
    if(req.method==='GET'&&path==='/v1/human/engineering/status')
      return respond(res,200,productionReadiness());
    if(req.method==='POST'&&path==='/v1/human/engineering/pilot'){
      if(req.headers.origin!=='http://127.0.0.1:'+server.address().port)
        return respond(res,403,{error:'origin required'});
      const params=await readBounded(req);
      pilotRuns++;
      return respond(res,200,runSyntheticPilot(params));
    }
    invalidRequests++;
    return respond(res,404,{error:'not found'});
  }catch{
    invalidRequests++;
    return respond(res,400,{error:'synthetic fixture rejected request'});
  }
});

server.listen(0,'127.0.0.1');
await once(server,'listening');
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
  // GitHub's ubuntu-24.04 image includes stable Google Chrome; avoid the
  // large Playwright-managed Chromium download and unsupported runner detection.
  browser=await chromium.launch({headless:true,channel:'chrome'});
  for(const viewport of [
    {name:'desktop',width:1440,height:900},
    {name:'tablet',width:768,height:1024},
    {name:'mobile',width:390,height:844}
  ]){
    const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height}});
    // Hard-block all external requests from synthetic tests. No real Worker URL.
    await context.route('**/*',route=>{
      if(new URL(route.request().url()).origin!==origin)return route.abort();
      return route.continue();
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(String(error.message).slice(0,120)));
    await page.goto(origin+'/app',{waitUntil:'load'});
    await page.getByRole('heading',{name:'AR3D AI Calling',exact:true}).waitFor();
    await page.getByPlaceholder('you@company.com').fill(TEST_EMAIL);
    await page.getByPlaceholder('Minimum 12 characters').fill(TEST_PASSWORD);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('heading',{name:'Super Admin',exact:true}).waitFor();
    await page.getByRole('heading',{name:'Production Readiness & Safe AI Calling Pilot'}).waitFor();
    const nav=page.getByRole('link',{name:'Test AI Conversation'});
    const signout=page.getByRole('button',{name:'Sign out'});
    await nav.waitFor();await signout.waitFor();
    const navBox=await nav.boundingBox(),logoutBox=await signout.boundingBox();
    assert.ok(navBox&&logoutBox,viewport.name+' sidebar controls invisible');
    assert.ok(navBox.y+navBox.height+3<=logoutBox.y,
      viewport.name+' navigation and Sign out overlap');
    await page.getByRole('button',{name:'Run 100 Synthetic Calls (no dialing)'}).click();
    await page.getByText('Synthetic calls: 100 | Real calls: 0 | Audio generated: 0').waitFor();
    await page.getByText(/Real billing: disabled \| Payment collected: no/).waitFor();
    const body=await page.locator('body').innerText();
    assert.ok(body.includes('Commercial go-live blocked:'));
    assert.ok(!body.includes('Start real calls'));
    assert.deepEqual(errors,[],viewport.name+' browser JavaScript errors');
    await signout.click();
    await page.getByRole('heading',{name:'AR3D AI Calling',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Sign in'}).count(),1);
    await context.close();
    console.log(viewport.name+': authenticated browser E2E + 100 fake calls + signout + sidebar PASS');
  }
  assert.equal(pilotRuns,3);
  // Missing favicon requests are harmless and never reach remote services.
  assert.ok(invalidRequests<=3,'unexpected fixture requests');
  console.log('Browser E2E PASS: 3 responsive viewports, no real calls/DB/customer data');
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
