// Real app routes + migrated SQLite, synthetic customers, stubbed Exotel only.
import http from 'node:http';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import worker from '../src/index.mjs';
import {newSession,COOKIE} from '../src/human-auth.mjs';
import {fixture,route,tid,lead,admin,accepted} from '../tests/helpers/calling-fixture.mjs';
import {tickTenant} from '../src/campaign-dispatch.mjs';
await mkdir('artifacts',{recursive:true});
const f=fixture();
const token=await newSession(f.env.CONTROL_DB,'client');
const expiresAt=new Date(Date.now()+7*86400000).toISOString();
assert.equal((await route(f,'policy',{tenantId:tid,enabled:true,flowId:'123456',approvalReference:'fictional-provider-reference',expiresAt,dailyLimit:10,maxSeconds:120},admin)).status,200);
assert.equal((await route(f,'clearances',{tenantId:tid,leadIds:[lead],purpose:'property_information',consentReference:'fictional-consent',dndReference:'fictional-dnd',expiresAt},admin)).status,200);
let origin;
const server=http.createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
  const response=await worker.fetch(request,f.env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('{}')}
});
server.listen(0,'127.0.0.1');await once(server,'listening');origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CI?{channel:'chrome'}:{})});
let lastPage;
try{
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
 const context=await browser.newContext({viewport});await context.addCookies([{name:COOKIE,value:token,url:origin}]);
 const page=await context.newPage(),errors=[];lastPage=page;page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/app');await page.getByRole('heading',{name:'Exotel Customer Calling',exact:true}).waitFor();
 await page.getByRole('button',{name:'Download customer Excel template (CSV)',exact:true}).waitFor();
 await page.getByRole('heading',{name:'AI Questions & Answers',exact:true}).waitFor();
 await page.locator('[name=scriptName]').fill('Survey '+viewport.width);
 await page.getByLabel('Call questions',{exact:true}).fill('आपका बजट क्या है?\nआप कब विजिट करना चाहते हैं?');
 await page.getByLabel('Conversation rules',{exact:true}).fill('पहले बजट पूछें, फिर सुविधाजनक समय पूछें।');
 await page.getByRole('button',{name:'Add approved answer',exact:true}).click();
 await page.locator('[name=faqQuestion]').last().fill('क्या कीमत तय है?');
 await page.getByPlaceholder('Approved answer',{exact:true}).last().fill('टीम से पुष्टि करेंगे।');
 await page.getByRole('button',{name:'Save new script version',exact:true}).click();
 await page.getByText(/Script version .* saved. Live calls have not changed./).waitFor();
 await page.getByRole('button',{name:'Load v1',exact:true}).click();
 await page.getByText(/Loaded v1. Save to create a new version/).waitFor();
 await page.getByRole('heading',{name:'AI Questions & Answers',exact:true}).locator('..').screenshot({path:'artifacts/script-editor-'+viewport.width+'.png'});

 const file=page.locator('input[type=file]');await file.setInputFiles({name:'customers.csv',mimeType:'text/csv',buffer:Buffer.from('Name,Mobile\r\nFictional buyer,9000000001\r\n')});
 await page.getByRole('button',{name:'Validate & Preview',exact:true}).click();await page.getByText(/1 valid rows; 1 existing in CRM/).waitFor();
 await page.getByRole('button',{name:'Import to CRM',exact:true}).click();await page.getByText('Import finished: 0 new, 1 duplicates. No calls placed.',{exact:true}).waitFor();
 await page.locator('[name=callCampaignName]').fill('Acceptance '+viewport.width);
 await page.getByRole('button',{name:'Create campaign with first 200 CRM customers',exact:true}).click();await page.getByText('1 customers added. Review the campaign before Start.',{exact:true}).waitFor();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Start / Resume calling',exact:true}).click();await page.getByText('Campaign running. Results refresh below.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Pause campaign',exact:true}).click();await page.getByText('Paused. A call already sent to Exotel may finish.',{exact:true}).waitFor();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Start / Resume calling',exact:true}).click();await page.getByText('Campaign running. Results refresh below.',{exact:true}).waitFor();
 // First viewport dispatches a single stubbed call. No second call without rereview.
 const when=new Date();when.setUTCDate(when.getUTCDate()+1);when.setUTCHours(4,30,0,0);
 let count=0;
 await tickTenant(f.env,f.r.wrap,tid,{now:when.getTime(),apiFetch:async()=>{count++;return accepted()}});
 await page.getByRole('button',{name:'Refresh call results',exact:true}).click();await page.getByRole('heading',{name:'Exotel Customer Calling',exact:true}).scrollIntoViewIfNeeded();
 await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/calling-'+viewport.width+'.png',fullPage:true});await page.getByRole('heading',{name:'Exotel Customer Calling',exact:true}).locator('..').screenshot({path:'artifacts/calling-panel-'+viewport.width+'.png'});
 assert.deepEqual(errors,[]);assert.ok(count<=1);await context.close();
 console.log('Calling UI '+viewport.width+': Excel duplicate import, campaign creation, Start/Pause/Resume, actual SQL routes PASS');
 }
 const adminContext=await browser.newContext({viewport:{width:1440,height:1000}});
 const adminToken=await newSession(f.env.CONTROL_DB,'admin');await adminContext.addCookies([{name:COOKIE,value:adminToken,url:origin}]);
 const adminPage=await adminContext.newPage();lastPage=adminPage;adminPage.setDefaultTimeout(10000);
 let operatorRequests=0;
 await adminPage.route('**/v1/human/engineering/exotel-self-test',async route=>{
  const post=route.request().method()==='POST';if(post)operatorRequests++;
  await route.fulfill({contentType:'application/json',body:JSON.stringify(post?{state:'submitted',requestId:'fictional-operator-request'}:{configured:true,mfaEnabled:true,recent:[],voicebotFlowId:'123456',destinationLast4:'0001'})});
 });
 await adminPage.goto(origin+'/app');
 await adminPage.getByRole('heading',{name:'Client Calling Setup',exact:true}).waitFor();
 await adminPage.getByRole('heading',{name:'Questions & Conversation Logic',exact:true}).waitFor();
 await adminPage.getByText('Exotel connection',{exact:true}).click();
 await adminPage.getByLabel('Voicebot ID',{exact:true}).fill('44444444-4444-4444-8444-444444444444');
 await adminPage.getByLabel('Dedicated assistant ID',{exact:true}).fill('55555555-5555-4555-8555-555555555555');
 await adminPage.getByLabel('Exact assistant source version',{exact:true}).fill('v2');
 await adminPage.getByRole('button',{name:'Save Exotel script connection',exact:true}).click();
 await adminPage.getByText('Exotel script connection saved.',{exact:true}).waitFor();

 await adminPage.getByLabel('Exotel Voicebot Flow ID',{exact:true}).fill('123456');
 await adminPage.getByLabel('Provider approval reference',{exact:true}).fill('browser-reviewed-provider-reference');
 await adminPage.getByRole('button',{name:'Save company calling approval',exact:true}).click();
 await adminPage.getByText('Company approval saved.',{exact:true}).waitFor();
 await adminPage.getByLabel('Consent evidence reference',{exact:true}).fill('browser-consent-reference');
 await adminPage.getByLabel('DND verification reference',{exact:true}).fill('browser-dnd-reference');
 await adminPage.getByLabel('Fictional buyer — '+lead.slice(0,8),{exact:true}).check();
 await adminPage.getByRole('button',{name:'Approve selected customers',exact:true}).click();
 await adminPage.getByText('1 customer approvals saved.',{exact:true}).waitFor();
 await adminPage.getByText('Engineering tools and diagnostics',{exact:true}).click();
 await adminPage.getByRole('button',{name:'Call my verified test phone once',exact:true}).click();
 await adminPage.getByRole('alertdialog',{name:'Confirm verified test call'}).waitFor();assert.equal(operatorRequests,0);
 await adminPage.getByRole('button',{name:'Cancel test call',exact:true}).click();assert.equal(operatorRequests,0);
 await adminPage.getByRole('button',{name:'Call my verified test phone once',exact:true}).click();
 await adminPage.getByRole('button',{name:'Confirm one test call',exact:true}).click();
 await adminPage.getByText(/Exotel request: submitted/).waitFor();assert.equal(operatorRequests,1);
 await adminPage.getByText('Engineering tools and diagnostics',{exact:true}).click();
 await adminPage.evaluate(()=>window.scrollTo(0,0));await adminPage.screenshot({path:'artifacts/premium-super-admin.png',fullPage:true});
 await adminContext.close();console.log('Super Admin UI: current MFA session, company policy and selected customer clearances PASS');
}catch(e){console.error(await lastPage?.locator('body').innerText());await lastPage?.screenshot({path:'/tmp/ar3d-calling-failure.png',fullPage:true});throw e}finally{await browser.close();server.close();f.close()}
