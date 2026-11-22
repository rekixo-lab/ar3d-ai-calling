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
 await page.goto(origin+'/app');
 await page.getByRole('tab',{name:'Calling',exact:true}).click();
 await page.getByRole('heading',{name:'Exotel Customer Calling',exact:true}).waitFor();
 await page.getByRole('tab',{name:'Company / AI',exact:true}).click();
 await page.getByRole('heading',{name:'Your Company / AI',exact:true}).waitFor();
 await page.getByRole('heading',{name:'Request Changes',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Save company information'}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Save new script version'}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Publish AI agent for calls'}).count(),0);
 if(viewport.width===1440){
  await page.getByLabel('What should AR3D update?').fill('Please update our fictional Raipur plot price from 12 lakh to 14 lakh.');
  await page.getByRole('button',{name:'Send change request'}).click();
  await page.getByText(/Request sent to AR3D/).waitFor();
 }
 await page.getByText('Please update our fictional Raipur plot price from 12 lakh to 14 lakh.').waitFor();
 await page.getByRole('heading',{name:'Request Changes'}).locator('..').screenshot({path:'artifacts/script-editor-'+viewport.width+'.png'});

 await page.getByRole('tab',{name:'Customers / Excel',exact:true}).click();
 await page.getByRole('button',{name:'Download customer Excel template (CSV)',exact:true}).waitFor();
 const file=page.locator('input[type=file]');await file.setInputFiles({name:'customers.csv',mimeType:'text/csv',buffer:Buffer.from('Name,Mobile\r\nFictional buyer,9000000001\r\n')});
 await page.getByRole('button',{name:'Validate & Preview',exact:true}).click();await page.getByText(/1 valid rows; 1 existing in CRM/).waitFor();
 await page.getByRole('button',{name:'Import to CRM',exact:true}).click();await page.getByText('Import finished: 0 new, 1 duplicates. No calls placed.',{exact:true}).waitFor();
 await page.getByRole('tab',{name:'Calling',exact:true}).click();
 await page.locator('[name=callCampaignName]').fill('Acceptance '+viewport.width);
 await page.getByRole('button',{name:'Create campaign with selected CRM customers',exact:true}).click();await page.getByText('1 customers added, 0 already selected. No calls placed. Review approvals before Start.',{exact:true}).waitFor();
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
 await adminPage.getByText('3. Calling & Exotel Setup',{exact:true}).click();
 await adminPage.getByText('Customer Calling Approval — after gateway verification',{exact:true}).click();
 await adminPage.getByRole('heading',{name:'Client Calling Setup',exact:true}).waitFor();
 // Client AI details open only when specifically selected.
 await adminPage.getByText('2. Client AI Setup & Publish',{exact:true}).click();
 await adminPage.getByRole('heading',{name:'Client Company & AI Setup',exact:true}).waitFor();
 await adminPage.getByRole('heading',{name:'Quick AI Setup — Master Templates',exact:true}).waitFor();
 await adminPage.getByPlaceholder('Optional project name').fill('Demo Heights');
 await adminPage.getByPlaceholder('Approved city / location').fill('Raipur, Chhattisgarh');
 await adminPage.getByPlaceholder('Optional approved price or price range').fill('12-18 lakh');
 await adminPage.getByRole('button',{name:'Preview generated AI'}).click();
 await adminPage.getByRole('heading',{name:'Generated AI Preview'}).waitFor();
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM calling_script_versions').get().n,0);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM calling_agent_publications').get().n,0);
 adminPage.once('dialog',dialog=>dialog.accept());
 await adminPage.getByRole('button',{name:'Generate AI Draft (no calls)'}).click();
 await adminPage.getByText(/Master AI draft generated/).waitFor();
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM company_profile_versions').get().n,1);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM calling_script_versions').get().n,1);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM calling_agent_publications').get().n,0);
 // Optional price updates are hidden until requested.
 await adminPage.getByText('Optional: change approved price only',{exact:true}).click();
 await adminPage.getByPlaceholder('Approved price or range').fill('14-19 lakh');
 adminPage.once('dialog',dialog=>dialog.accept());
 await adminPage.getByRole('button',{name:'Save price change (draft only)'}).click();
 await adminPage.getByText(/Approved price saved as a new company version/).waitFor();
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM company_profile_versions').get().n,2);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM calling_script_versions').get().n,1);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM calling_agent_publications').get().n,0);
 const latestPricing=JSON.parse(f.c.db.prepare('SELECT config_json FROM company_profile_versions WHERE tenant_id=? ORDER BY revision DESC LIMIT 1').get(tid).config_json).pricing;
 assert.equal(latestPricing,'14-19 lakh');
 const generatedScript=JSON.parse(f.c.db.prepare('SELECT config_json FROM calling_script_versions WHERE tenant_id=? ORDER BY revision DESC LIMIT 1').get(tid).config_json);
 assert.ok(!JSON.stringify(generatedScript).includes('12-18 lakh'));
 await adminPage.getByText('Advanced: Company Knowledge & AI Questions',{exact:true}).click();
 await adminPage.getByRole('heading',{name:'AI Questions & Answers',exact:true}).waitFor();
 await adminPage.getByRole('button',{name:'Publish AI agent for calls'}).waitFor();
 await adminPage.locator('[name=company-companyName]').fill('Fictional Builder');
 await adminPage.getByRole('button',{name:'Save company information',exact:true}).click();
 await adminPage.getByText('Company information saved',{exact:true}).waitFor();
 await adminPage.locator('[name=scriptName]').fill('Admin approved script');
 await adminPage.getByRole('button',{name:'Save new script version',exact:true}).click();
 await adminPage.getByText(/Script version .* saved. Live calls have not changed./).waitFor();
 await adminPage.getByText('Client change requests (optional)',{exact:true}).click();
 await adminPage.getByRole('heading',{name:'Client Change Requests',exact:true}).waitFor();
 await adminPage.getByText('Please update our fictional Raipur plot price from 12 lakh to 14 lakh.').waitFor();

 await adminPage.getByLabel('Exotel Voicebot Flow ID',{exact:true}).fill('123456');
 await adminPage.getByLabel('Provider approval reference',{exact:true}).fill('browser-reviewed-provider-reference');
 await adminPage.getByRole('button',{name:'Save company calling approval',exact:true}).click();
 await adminPage.getByText('Company approval saved.',{exact:true}).waitFor();
 await adminPage.getByLabel('Consent evidence reference',{exact:true}).fill('browser-consent-reference');
 await adminPage.getByLabel('DND verification reference',{exact:true}).fill('browser-dnd-reference');
 await adminPage.getByLabel('Fictional buyer — '+lead.slice(0,8),{exact:true}).check();
 await adminPage.getByRole('button',{name:'Approve selected customers',exact:true}).click();
 await adminPage.getByText('1 customer approvals saved.',{exact:true}).waitFor();
 await adminPage.getByRole('heading',{name:'Shared Calling Gateway',exact:true}).waitFor();
 await adminPage.getByLabel('Shared gateway bot').waitFor();
 assert.equal(await adminPage.getByLabel('Shared gateway bot').inputValue(),'66cbf4f6-a52d-4df0-abf0-db5e3b365836');
 assert.equal(await adminPage.getByLabel('Shared gateway flow').inputValue(),'1393135');
 assert.equal(await adminPage.getByLabel('Authenticated webhook template').inputValue(),'c3c7ca7c-b06d-4b3d-b661-ef121f751021');
 assert.equal(await adminPage.getByLabel('I verified in Exotel that the copied Flow targets this shared Voicebot').isChecked(),false);
 await adminPage.getByText('Advanced developer diagnostics (optional)',{exact:true}).click();
 await adminPage.getByRole('button',{name:'Call my verified test phone once',exact:true}).click();
 await adminPage.getByRole('alertdialog',{name:'Confirm verified test call'}).waitFor();assert.equal(operatorRequests,0);
 await adminPage.getByRole('button',{name:'Cancel test call',exact:true}).click();assert.equal(operatorRequests,0);
 await adminPage.getByRole('button',{name:'Call my verified test phone once',exact:true}).click();
 await adminPage.getByRole('button',{name:'Confirm one test call',exact:true}).click();
 await adminPage.getByText(/Exotel request: submitted/).waitFor();assert.equal(operatorRequests,1);
 await adminPage.getByText('Advanced developer diagnostics (optional)',{exact:true}).click();
 // A locked Gateway shows independently verified Bot allocation and Guard observations.
 f.c.db.prepare("INSERT INTO shared_voice_gateway(id,bot_id,flow_id,template_assistant_id,template_version,guard_assistant_id,state,error_code,updated_by,updated_at) VALUES(1,?,?,?,?,?,'unknown','bot_agent_fix_unknown','admin',?)")
  .run('66cbf4f6-a52d-4df0-abf0-db5e3b365836','1393135','66666666-6666-4666-8666-666666666666','v2',
   '55555555-5555-4555-8555-555555555555',new Date().toISOString());
 let reviews=0;
 await adminPage.route('**/v1/human/voice-gateway',async route=>{
  if(route.request().method()==='GET')return route.continue();
  assert.deepEqual(route.request().postDataJSON(),{action:'repair-review'});
  reviews++;
  await route.fulfill({json:{outcome:'shared_voicebot_version_read_unverified_stop',
   savedErrorCode:'bot_agent_fix_unknown',sharedVoicebot:{stableVersion:'v2',latestVersion:'v3',
    stableTrafficPercent:100,latestTrafficPercent:0,trafficStatus:'latest_omitted_from_full_stable_allocation',
    stableTrafficPreserved:true,latestUsesRecordedGuard:null,
    versionResponses:{latest:{selectedVersion:null,hasRequestedVersionMap:false,rootAssistantVersion:'v2'}}},
   guard:{stableVersion:'v4',latestVersion:'v4',stable:{agentCount:'one',strictGuardVerified:true}}}});
 });
 await adminPage.getByRole('button',{name:'Refresh saved gateway status (read-only)',exact:true}).click();
 await adminPage.getByText(/EXOTEL AGENT-ONLY WRITE UNCERTAIN/).waitFor();
 assert.equal(await adminPage.getByRole('button',{name:'Try single-agent Guard fix (one time, no calls)'}).count(),0);
 await adminPage.getByRole('button',{name:'Review last Guard repair (read-only)',exact:true}).click();
 await adminPage.getByRole('row',{name:'Latest Voicebot traffic 0%'}).waitFor();
 await adminPage.getByRole('row',{name:'Stable Voicebot traffic 100%'}).waitFor();
 await adminPage.getByRole('row',{name:'Stable Guard agent count one'}).waitFor();
 await adminPage.getByRole('row',{name:'Latest Voicebot uses recorded Guard Not confirmed'}).waitFor();
 await adminPage.getByRole('row',{name:'Assistant version at response root for latest GET v2'}).waitFor();
 assert.equal(reviews,1);
 await adminPage.evaluate(()=>window.scrollTo(0,0));await adminPage.screenshot({path:'artifacts/premium-super-admin.png',fullPage:true});
 await adminContext.close();console.log('Super Admin UI: current MFA session, company policy and selected customer clearances PASS');
}catch(e){console.error(await lastPage?.locator('body').innerText());await lastPage?.screenshot({path:'/tmp/ar3d-calling-failure.png',fullPage:true});throw e}finally{await browser.close();server.close();f.close()}
