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
import {fixedPropertyQuestions,PROPERTY_TYPES,normalizePropertySurvey} from '../src/fixed-property-survey.mjs';
import {beginFixedVoicePreview,advanceFixedVoicePreview} from '../src/fixed-voice-turns.mjs';
import {buildPlivoReadinessSnapshot} from '../src/launch-readiness-routes.mjs';

const SESSION='synthetic-browser-session-only';
const TEST_EMAIL='sandbox-operator@example.invalid';
const TEST_PASSWORD='FictionalBrowserTestPassword2026!';
let invalidRequests=0;
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
    if(req.method==='GET'&&['/v1/human/credits/provider','/v1/human/credits/sarvam-balance'].includes(path))
      return respond(res,200,{available:false});
    if(req.method==='GET'&&path==='/v1/human/credits/admin-dashboard')
      return respond(res,200,{clients:{total:0,active:0},position:{},internal:{ended:0},campaign:{ended:0},transactions:[]});
    if(req.method==='GET'&&path==='/v1/human/mfa')
      return respond(res,200,{enabled:false,configured:true});
    if(req.method==='GET'&&path==='/v1/human/launch-readiness')
      return respond(res,200,buildPlivoReadinessSnapshot({}));
    if(req.method==='GET'&&path==='/v1/human/tenants')
      return respond(res,200,{tenants:[]});
    if(req.method==='GET'&&path==='/v1/human/scripted-phone-pilot')return respond(res,200,{configured:false});
    if(req.method==='POST'&&path==='/v1/human/voice-preview'){
      if(req.headers.origin!=='http://127.0.0.1:'+server.address().port)
        return respond(res,403,{error:'origin required'});
      const input=await readBounded(req);
      if(input.action==='start')
        return respond(res,200,beginFixedVoicePreview({language:input.language}));
      if(input.action==='turn')
        return respond(res,200,advanceFixedVoicePreview(input.state,{
          transcript:input.transcript,confidence:input.confidence}));
      return respond(res,400,{error:'invalid preview request'});
    }
    if(path==='/v1/human/leads/33333333-3333-4333-8333-333333333333/qualification'){
      if(req.method==='GET')
        return respond(res,200,{
          leadId:'33333333-3333-4333-8333-333333333333',
          updatedAt:'2026-11-19T10:00:00.000Z',survey:null,voiceConnected:false,
          questionSets:Object.fromEntries(PROPERTY_TYPES.map(type=>[type,{
            hi:fixedPropertyQuestions(type,'hi'),en:fixedPropertyQuestions(type,'en')
          }]))
        });
      if(req.method==='POST'){
        if(req.headers.origin!=='http://127.0.0.1:'+server.address().port)
          return respond(res,403,{error:'origin required'});
        const data=await readBounded(req);
        if(data.expectedUpdatedAt!=='2026-11-19T10:00:00.000Z'||
           data.tenantId!=='22222222-2222-4222-8222-222222222222')
          return respond(res,409,{error:'stale or foreign tenant'});
        const input={...data};delete input.tenantId;delete input.expectedUpdatedAt;
        const reviewed=normalizePropertySurvey(input);
        if(reviewed.propertyType!=='flat'||reviewed.size!=='3BHK'||
           reviewed.location!=='Raipur'||reviewed.budgetInr!==3500000)
          return respond(res,400,{error:'unexpected fictional questionnaire'});
        return respond(res,200,{ok:true,voiceConnected:false,visitRequested:false,
          notice:'Saved into local fictional fixture; no call placed'});
      }
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
    await page.getByPlaceholder('Enter your password').fill(TEST_PASSWORD);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByText('Super Admin',{exact:true}).waitFor();
    await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
    await page.getByRole('link',{name:'Calling Setup',exact:true}).click();
    await page.getByText('Internal test and platform settings',{exact:true}).click();
    await page.getByRole('heading',{name:'Internal phone test'}).waitFor();
    await page.getByText('Advanced diagnostics · Plivo go-live readiness',{exact:true}).click();
    await page.getByRole('heading',{name:'Plivo Go-Live Readiness'}).waitFor();
    await page.getByText('Not yet production-ready. Plivo KYC alone is not the remaining step.').waitFor();
    await page.getByRole('button',{name:'Refresh go-live checks'}).click();
    await page.getByText('Waiting for Plivo: approve a caller number and configure the internal test.',{exact:true}).waitFor();
    const nav=page.getByRole('link',{name:'Security',exact:true});
    const signout=page.getByRole('button',{name:'Sign out'});
    await nav.waitFor();await signout.waitFor();
    const navBox=await nav.boundingBox(),logoutBox=await signout.boundingBox();
    assert.ok(navBox&&logoutBox,viewport.name+' sidebar controls invisible');
    assert.ok(navBox.y+navBox.height+3<=logoutBox.y,
      viewport.name+' navigation and Sign out overlap');
    // Real DOM exercise of the shipped fixed questionnaire without real
    // customer data, vendor speech recognition, telephone or D1.
    await page.evaluate(()=>{
      const lead={id:'33333333-3333-4333-8333-333333333333',
        name:'Fictional Excel Customer',mobile:'98XXXXXXXX'};
      const tenant='22222222-2222-4222-8222-222222222222';
      document.getElementById('app').append(
        fixedSurveyPanel(tenant,lead,async()=>{}));
    });
    await page.getByRole('button',{name:'Open Fixed Questionnaire'}).click();
    await page.getByText(/Name: Fictional Excel Customer/).waitFor();
    await page.getByRole('button',{name:'Start 7-question voice preview'}).click();
    await page.getByText(/Question 1 of 7/).waitFor();
    const spokenAnswers=['flat','Raipur','Shankar Nagar','3BHK','35 lakh','yes','2027-01-12'];
    for(let n=0;n<spokenAnswers.length;n++){
      await page.getByPlaceholder('Type or dictate the answer').fill(spokenAnswers[n]);
      await page.getByRole('button',{name:'Next fixed question'}).click();
      if(n<6)await page.getByText(new RegExp('Question '+(n+2)+' of 7')).waitFor();
    }
    await page.getByText('Seven questions completed — answers filled into the CRM form for your review.').waitFor();
    assert.equal(await page.locator('[name=surveyPropertyType]').inputValue(),'flat');
    assert.equal(await page.locator('[name=surveyCity]').inputValue(),'Raipur');
    assert.equal(await page.locator('[name=surveyBudget]').inputValue(),'3500000');
    await page.locator('[name=surveyPropertyType]').selectOption('flat');
    await page.locator('[name=surveyCity]').fill('Raipur');
    await page.locator('[name=surveyArea]').fill('Shankar Nagar');
    await page.locator('[name=surveyBudget]').fill('3500000');
    await page.getByRole('combobox',{name:/BHK/}).first().selectOption('3BHK');
    await page.locator('[name=surveyInterest]').selectOption('interested');
    await page.locator('[name=surveyVisit]').fill('2027-01-12');
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'Save Reviewed Answers to CRM'}).click();
    await page.getByText(/CRM updated\. Visit preference is not a confirmed booking/).waitFor();
    const body=await page.locator('body').innerText();
    assert.ok(!body.includes('Start real calls'));
    // Existing Super Admin cookie must not hide an invitation link in this profile.
    const invitePage=await context.newPage();
    await invitePage.goto(origin+'/app#invite='+'a'.repeat(64),{waitUntil:'load'});
    await invitePage.getByRole('heading',{name:'Client invitation — separate login'}).waitFor();
    assert.equal(await invitePage.getByRole('heading',{name:'Super Admin'}).count(),0);
    await invitePage.close();
    assert.deepEqual(errors,[],viewport.name+' browser JavaScript errors');
    await signout.click();
    await page.getByRole('heading',{name:'AR3D AI Calling',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Sign in'}).count(),1);
    await context.close();
    console.log(viewport.name+': authenticated browser E2E + signout + sidebar PASS');
  }
  // Missing favicon requests are harmless and never reach remote services.
  assert.ok(invalidRequests<=3,'unexpected fixture requests');
  console.log('Browser E2E PASS: 3 responsive viewports, no real calls/DB/customer data/vendor network');
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
