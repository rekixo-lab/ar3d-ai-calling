// Real app routes + migrated SQLite, synthetic customers, dialing disabled.
import http from 'node:http';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import worker from '../src/index.mjs';
import {newSession,COOKIE,randomSecret} from '../src/human-auth.mjs';
import {sha256hex} from '../src/core.mjs';
import {fixture,tid,lead} from '../tests/helpers/calling-fixture.mjs';
await mkdir('artifacts',{recursive:true});
const f=fixture();
// Explicit test allocation without enabling any calling or provider credentials.
f.c.db.prepare("INSERT INTO tenant_minute_ledger(id,tenant_id,kind,delta_seconds,previous_seconds,balance_seconds,actor,reason,created_at) VALUES('browser-wallet-test',?,'allocation',6000,0,6000,'admin','Synthetic browser credit allocation',?)").run(tid,new Date().toISOString());
f.env.LOGIN_RATE_LIMIT_SECRET='synthetic-browser-test-rate-limit-secret';
const token=await newSession(f.env.CONTROL_DB,'client');
let origin;
const server=http.createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  // Emulate the Cloudflare-provided client IP on the isolated localhost Worker.
  const headers={...req.headers,'cf-connecting-ip':'192.0.2.17'};
  const request=new Request(origin+req.url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
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
 const sidebar=page.locator('#client-sidebar-wallet');
 await sidebar.locator('.sidebar-credit-value').getByText('100m 00s',{exact:true}).waitFor();
 assert.equal(await page.locator('.provider-balances').count(),0);
 await sidebar.getByRole('button',{name:'Refresh balance'}).click();
 await sidebar.locator('.sidebar-credit-value').getByText('100m 00s',{exact:true}).waitFor();
 if(viewport.width===1440){
  // Verify a real ledger change crosses the foreground refresh boundary.
  const add=f.c.db.prepare("INSERT INTO tenant_minute_ledger(id,tenant_id,kind,delta_seconds,previous_seconds,balance_seconds,actor,reason,created_at) VALUES(?,?,?,?,?,?,'admin','Synthetic browser refresh check',?)");
  add.run('browser-live-allocation',tid,'allocation',60,6000,6060,new Date().toISOString());
  await sidebar.locator('.sidebar-credit-value').getByText('101m 00s',{exact:true}).waitFor({timeout:25000});
  await page.locator('.client-summary').getByText('101m 00s',{exact:true}).first().waitFor();
  await sidebar.getByRole('button',{name:'Wallet',exact:true}).click();
  await page.getByRole('heading',{name:'Calling credit ledger',exact:true}).waitFor();
  add.run('browser-live-recovery',tid,'recovery',-60,6060,6000,new Date().toISOString());
  await sidebar.locator('.sidebar-credit-value').getByText('100m 00s',{exact:true}).waitFor({timeout:25000});
  await page.locator('.minute-wallet').first().getByText('100m 00s',{exact:true}).first().waitFor();
 }
 // AI Testing uses an authenticated browser preview, never live phone or CRM.
 const aiLeadCount=f.r.db.prepare('SELECT COUNT(*) AS n FROM leads').get().n;
 const aiCallsBefore=f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n;
 await page.getByRole('link',{name:'AI Testing',exact:true}).click();
 await page.getByRole('heading',{name:'7-question AI test (no calls)',exact:true}).waitFor();
 const aiLang=viewport.width===1440?'en':'hi';
 await page.getByLabel('AI test language',{exact:true}).selectOption(aiLang);
 await page.getByRole('button',{name:'Start AI test',exact:true}).click();
 const aiAnswer=page.getByLabel('AI test answer',{exact:true});
 const step=async(answer,index)=>{
  await page.getByText('Question '+(index+1)+' of 7 —',{exact:false}).waitFor();
  await aiAnswer.fill(answer);
  await page.getByRole('button',{name:'Submit test answer',exact:true}).click();
 };
 await step('invalid property response',0);
 await page.getByText(/Please clarify: unclear property type/).waitFor();
 const sample=aiLang==='hi'?
  ['फ्लैट','रायपुर','शंकर नगर','3BHK','35 लाख','हाँ','2027-01-12']:
  ['flat','Raipur','Shankar Nagar','3BHK','35 lakh','yes','2027-01-12'];
 for(let i=0;i<sample.length;i++)await step(sample[i],i);
 await page.getByText('AI test completed — review the recognized answers below.').waitFor();
 await page.getByRole('heading',{name:'Test result',exact:true}).waitFor();
 await page.getByRole('row',{name:/Budget \(INR\) 3500000/}).waitFor();
 await page.getByRole('row',{name:/Visit date 2027-01-12/}).waitFor();
 await page.screenshot({path:'artifacts/ai-testing-'+viewport.width+'.png',fullPage:true});
 assert.ok(await page.getByRole('button',{name:'Submit test answer',exact:true}).isDisabled());
 assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM leads').get().n,aiLeadCount);
 assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,aiCallsBefore);
 await page.getByRole('button',{name:'Start AI test',exact:true}).click();
 await aiAnswer.fill(aiLang==='hi'?'कॉल मत करना':'do not call');
 await page.getByRole('button',{name:'Submit test answer',exact:true}).click();
 await page.getByText(/Stop-calling request detected/).waitFor();
 assert.ok(await page.getByRole('button',{name:'Submit test answer',exact:true}).isDisabled());
 // Task 5: explicitly choose a synthetic CRM customer and enable auto-save.
 // The standalone preview above must still have written zero rows.
 const autoId=viewport.width===1440?
  'eeeeeeee-1111-4111-8111-111111111111':'eeeeeeee-2222-4222-8222-222222222222';
 const autoName='AI Auto Test '+viewport.width,atAuto=new Date().toISOString();
 f.r.db.prepare(`INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,requirements_json,created_at,updated_at)
  VALUES(?,?,?,?,'excel',?,?,?)`)
  .run(tid,autoId,autoName,viewport.width===1440?'+919000000087':'+919000000088',
   JSON.stringify({raw:'Do not overwrite Excel notes'}),atAuto,atAuto);
 await page.getByLabel('Search CRM customer').fill(autoName);
 await page.getByRole('button',{name:'Find CRM customer'}).click();
 await page.getByLabel('Select CRM customer').selectOption(autoId);
 await page.getByLabel('Auto-save AI test answers to selected customer CRM').check();
 await page.getByRole('button',{name:'Start AI test',exact:true}).click();
 const visitDay=new Date(Date.now()+10*86400000+330*60000).toISOString().slice(0,10);
 const autoAnswers=aiLang==='hi'?
  ['फ्लैट','रायपुर','शंकर नगर','3BHK','35 लाख','हाँ',visitDay]:
  ['flat','Raipur','Shankar Nagar','3BHK','35 lakh','yes',visitDay];
 for(let i=0;i<autoAnswers.length;i++)await step(autoAnswers[i],i);
 await page.getByRole('status').getByText(/Auto-saved to/).waitFor();
 const saved=f.r.db.prepare('SELECT * FROM leads WHERE tenant_id=? AND id=?').get(tid,autoId);
 assert.equal(saved.budget_max_inr,3500000);
 assert.equal(saved.plot_size_preference,'3BHK');
 assert.equal(saved.consent_status,'unknown');
 assert.equal(saved.dnd_status,'unknown');
 assert.equal(JSON.parse(saved.requirements_json).raw,'Do not overwrite Excel notes');
 assert.equal(JSON.parse(saved.requirements_json).propertySurvey.simulated,true);
 assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM crm_audit_events WHERE tenant_id=? AND target_id=? AND action=?')
  .get(tid,autoId,'lead.ai_test_auto_saved').n,1);
 assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,aiCallsBefore);
 assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM site_visits').get().n,0);
 await page.screenshot({path:'artifacts/ai-auto-crm-'+viewport.width+'.png',fullPage:true});
 await page.getByRole('link',{name:'Calling',exact:true}).click();
 await page.getByRole('heading',{name:'Campaign controls',exact:true}).waitFor();
 await page.getByRole('link',{name:'Company details',exact:true}).click();
 await page.getByRole('heading',{name:'Company information',exact:true}).waitFor();
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

 await page.getByRole('link',{name:'Customers / Excel',exact:true}).click();
 await page.getByRole('button',{name:'Download customer Excel template (CSV)',exact:true}).waitFor();
 await page.screenshot({path:'artifacts/calling-customers-'+viewport.width+'.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const file=page.locator('input[type=file]');await file.setInputFiles({name:'customers.csv',mimeType:'text/csv',buffer:Buffer.from('Name,Mobile\r\nFictional buyer,9000000001\r\n')});
 await page.getByRole('button',{name:'Validate & Preview',exact:true}).click();await page.getByText(/1 valid rows; 1 existing in CRM/).waitFor();
 await page.getByRole('button',{name:'Import to CRM',exact:true}).click();await page.getByText('Import finished: 0 new, 1 duplicates. No calls placed.',{exact:true}).waitFor();
 await page.locator('input[type=file]').setInputFiles({name:'campaign.csv',mimeType:'text/csv',
  buffer:Buffer.from('Name,Mobile\r\nUploaded buyer,9000000005\r\n')});
 await page.getByRole('button',{name:'Validate & Preview',exact:true}).click();
 await page.getByLabel('Campaign name for this file').fill('Acceptance '+viewport.width);
 await page.getByRole('button',{name:'Import & prepare campaign'}).click();
 await page.getByText(/Campaign prepared with 1 customers from this file/).waitFor();
 const picker=page.getByRole('combobox',{name:'Calling campaign',exact:true});
 const draft=f.r.db.prepare('SELECT id FROM call_campaign_drafts WHERE tenant_id=? AND name=?').get(tid,'Acceptance '+viewport.width);
 await picker.locator('option[value="'+draft.id+'"]').waitFor({state:'attached'});
 assert.equal(await picker.inputValue(),draft.id);
 assert.ok(await page.getByRole('button',{name:'Start calling',exact:true}).isDisabled());
 await page.getByText(/AI calling is being prepared by AR3D/).waitFor();
 const selected=f.r.db.prepare(`SELECT l.id,l.name FROM call_campaign_candidates c JOIN leads l
   ON l.tenant_id=c.tenant_id AND l.id=c.lead_id WHERE c.tenant_id=? AND c.campaign_id=?`).all(tid,draft.id);
 assert.deepEqual(selected.map(x=>x.name),['Uploaded buyer']);
 const run=crypto.randomUUID(),job=crypto.randomUUID(),at=new Date().toISOString();
 f.r.db.prepare("INSERT INTO calling_runs(tenant_id,id,campaign_id,state,created_by,created_at,updated_at) VALUES(?,?,?,'completed','client',?,?)").run(tid,run,draft.id,at,at);
 f.r.db.prepare("INSERT INTO calling_jobs(tenant_id,id,run_id,lead_id,state,provider_status,duration_seconds,created_at,updated_at) VALUES(?,?,?,?,'completed','completed',50,?,?)").run(tid,job,run,selected[0].id,at,at);
 f.r.db.prepare("INSERT INTO scripted_call_results VALUES(?,?,?,?,1,?)").run(tid,job,crypto.randomUUID(),
  JSON.stringify({propertyType:'flat',location:'Raipur',area:'Shankar Nagar',size:'3BHK',budgetInr:3500000,interest:'interested',visitDate:'2027-01-12'}),at);
 await page.getByRole('link',{name:'Results / CRM',exact:true}).click();
 await page.getByRole('heading',{name:'Operations & Security Report'}).waitFor();
 const outcomes=page.getByRole('region',{name:'Call job outcomes · recorded counts'});
 await outcomes.waitFor();
 assert.equal(await outcomes.locator('meter[aria-label="Completed"]').getAttribute('value'),'1');
 const required=page.getByRole('region',{name:'Action required'});
 await required.getByText('Unknown provider outcomes requiring manual review: 0',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Refresh operations report'}).click();
 await page.getByRole('heading',{name:'Campaign results & customer answers'}).waitFor();
 await page.getByRole('button',{name:'Refresh customer answers'}).waitFor();
 await page.getByRole('combobox',{name:'Filter results by campaign'}).selectOption(draft.id);
 await page.getByRole('row',{name:new RegExp('Uploaded buyer Acceptance '+viewport.width+'.*Saved to lead')}).waitFor();
 await page.getByRole('row',{name:new RegExp('Uploaded buyer Acceptance '+viewport.width)}).getByRole('button',{name:'View answers'}).click();
 await page.getByRole('heading',{name:'Uploaded buyer — call answers'}).waitFor();
 await page.getByText('3BHK',{exact:true}).waitFor();
 assert.equal(await page.getByRole('row',{name:/Fictional buyer/}).count(),0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'results page overflow');
 assert.ok(await page.evaluate(()=>Array.from(document.querySelectorAll('.metric-heading')).filter(e=>e.getClientRects().length).every(e=>{
  const icon=e.querySelector('.metric-symbol'),label=e.querySelector('.muted');
  if(!icon||!label)return false;
  const a=icon.getBoundingClientRect(),b=label.getBoundingClientRect();
  return a.width>0&&a.right<=b.left+1&&b.right<=e.getBoundingClientRect().right+1;
 })),'metric icons overlap text');
 await page.screenshot({path:'artifacts/calling-results-'+viewport.width+'.png',fullPage:true});
 // A review snapshot is shown separately from a completed CRM save.
 f.r.db.prepare("UPDATE scripted_call_results SET answers_json=?,saved_to_lead=0 WHERE tenant_id=? AND job_id=?")
  .run(JSON.stringify({propertyType:'flat',location:'Raipur',__partial:true}),tid,job);
 f.r.db.prepare("UPDATE calling_jobs SET state='failed',provider_status='needs_review' WHERE tenant_id=? AND id=?").run(tid,job);
 await page.getByRole('button',{name:'Close answers'}).click();
 await page.getByRole('button',{name:'Refresh customer answers'}).click();
 await page.getByRole('row',{name:/Uploaded buyer.*Partial · review needed/}).waitFor();
 await page.getByRole('button',{name:'View partial answers'}).click();
 await page.getByText(/Incomplete conversation. Review accepted answers before filling blank CRM fields/).waitFor();
 await page.getByRole('heading',{name:'Uploaded buyer — partial call answers'}).waitFor();
 const beforePartial=f.r.db.prepare('SELECT * FROM leads WHERE tenant_id=? AND id=?').get(tid,selected[0].id);
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Review & fill blank CRM fields',exact:true}).click();
 await page.getByRole('row',{name:/Uploaded buyer.*Partial · reviewed/}).waitFor();
 const afterPartial=f.r.db.prepare('SELECT * FROM leads WHERE tenant_id=? AND id=?').get(tid,selected[0].id);
 assert.equal(afterPartial.preferred_location,beforePartial.preferred_location??'Raipur');
 assert.equal(afterPartial.consent_status,beforePartial.consent_status);
 assert.equal(afterPartial.dnd_status,beforePartial.dnd_status);
 assert.equal(JSON.parse(afterPartial.requirements_json).reviewedPartialCall.jobId,job);
 assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM crm_audit_events WHERE tenant_id=? AND target_id=? AND action=?').get(tid,job,'calling.partial_reviewed').n,1);
 const resultDownload=page.waitForEvent('download');
 await page.getByRole('button',{name:'Export this page (CSV)',exact:true}).click();
 assert.match((await resultDownload).suggestedFilename(),/^ar3d-campaign-results-\d+\.csv$/);
 await page.screenshot({path:'artifacts/partial-crm-'+viewport.width+'.png',fullPage:true});
 assert.deepEqual(errors,[]);await context.close();
 console.log('Calling UI '+viewport.width+': CSV-only campaign, disabled calling guard, saved answers in Results / CRM PASS');
 }
 // Multi-company Client Dashboard regression: a viewer in Demo is an admin only
 // of Secondary Builder. No previous tenant's data or controls may survive a switch.
 const otherTenant='77777777-7777-4777-8777-777777777777';
 const otherLead='88888888-8888-4888-8888-888888888888';
 f.c.db.prepare(`INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at)
  VALUES(?,'secondary-builder','Secondary Builder','starter','shared','active',?,?)`).run(otherTenant,'2020-01-01T00:00:00Z','2020-01-01T00:00:00Z');
 f.c.db.prepare("INSERT INTO tenant_memberships(tenant_id,user_id,role,created_at) VALUES(?,'viewer','client_admin',?)")
  .run(otherTenant,new Date().toISOString());
 f.r.db.prepare(`INSERT INTO leads(tenant_id,id,name,mobile_e164,source_type,created_at,updated_at)
  VALUES(?,?,'Secondary-only buyer','+919000000080','excel',?,?)`)
  .run(otherTenant,otherLead,new Date().toISOString(),new Date().toISOString());
 const multiContext=await browser.newContext({viewport:{width:390,height:844}});
 const multiToken=await newSession(f.env.CONTROL_DB,'viewer');
 await multiContext.addCookies([{name:COOKIE,value:multiToken,url:origin}]);
 const multiPage=await multiContext.newPage(),multiErrors=[];
 lastPage=multiPage;multiPage.setDefaultTimeout(10000);
 multiPage.on('pageerror',e=>multiErrors.push(e.message));
 await multiPage.goto(origin+'/app');
 await multiPage.locator('.workspace-role').getByText('Client viewer',{exact:true}).waitFor();
 const overview=multiPage.locator('.client-summary');
 await overview.getByText('Demo',{exact:true}).waitFor();
 await multiPage.getByRole('link',{name:'Home',exact:true}).waitFor();
 assert.equal(await multiPage.locator('input[type=file]').count(),0);
 assert.equal(await multiPage.getByText('Secondary-only buyer',{exact:true}).count(),0);
 await multiPage.locator('.company-switch select').selectOption(otherTenant);
 await multiPage.locator('.workspace-role').getByText('Client Admin',{exact:true}).waitFor();
 await overview.getByText('Secondary Builder',{exact:true}).waitFor();
 await multiPage.locator('#client-sidebar-wallet .sidebar-credit-value').getByText('0m 00s',{exact:true}).waitFor();
 assert.equal(await overview.getByText('1',{exact:true}).count(),1);
 await multiPage.getByRole('link',{name:'Customers / Excel',exact:true}).click();
 await multiPage.getByText('Secondary-only buyer',{exact:true}).waitFor();
 assert.equal(await multiPage.getByText('Fictional buyer',{exact:true}).count(),0);
 assert.equal(await multiPage.locator('input[type=file]').count(),1);
 // Confirm the previously broken manual add-customer form really persists
 // only to the selected tenant, with consent and DND still unknown.
 await multiPage.getByText('Add one customer manually',{exact:true}).click();
 await multiPage.locator('input[name=customerName]').fill('Secondary manual buyer');
 await multiPage.locator('input[name=customerMobile]').fill('9000000079');
 await multiPage.getByRole('button',{name:'Add customer',exact:true}).click();
 await multiPage.getByText('Secondary manual buyer',{exact:true}).waitFor();
 assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM leads WHERE tenant_id=?').get(otherTenant).n,2);
 assert.equal(f.r.db.prepare("SELECT consent_status,dnd_status FROM leads WHERE tenant_id=? AND name='Secondary manual buyer'").get(otherTenant).consent_status,'unknown');
 // Manual number straight into a new calling campaign.
 await multiPage.getByRole('link',{name:'Customers / Excel',exact:true}).click();
 await multiPage.getByText('Add one customer manually',{exact:true}).click();
 await multiPage.locator('input[name=customerName]').fill('Secondary campaign buyer');
 await multiPage.locator('input[name=customerMobile]').fill('9000000078');
 await multiPage.getByLabel('Add to calling campaign',{exact:true}).selectOption('new');
 await multiPage.getByLabel('Call language for new campaign',{exact:true}).selectOption('en');
 await multiPage.getByRole('button',{name:'Add customer',exact:true}).click();
 await multiPage.getByText(/Customer added to campaign “Manual numbers/).waitFor();
 await multiPage.getByRole('heading',{name:'Campaign controls',exact:true}).waitFor();
 const manualCampaign=f.r.db.prepare("SELECT d.id,d.language_mode AS lang FROM call_campaign_drafts d JOIN call_campaign_candidates c ON c.tenant_id=d.tenant_id AND c.campaign_id=d.id JOIN leads l ON l.tenant_id=c.tenant_id AND l.id=c.lead_id WHERE d.tenant_id=? AND l.name='Secondary campaign buyer'").get(otherTenant);
 assert.equal(manualCampaign.lang,'en');
 assert.equal(await multiPage.getByRole('combobox',{name:'Calling campaign',exact:true}).inputValue(),manualCampaign.id);
 await multiPage.getByRole('link',{name:'Home',exact:true}).click();
 await overview.getByText('3',{exact:true}).waitFor();
 assert.equal(await overview.getByText('3',{exact:true}).count(),1);
 await multiPage.screenshot({path:'artifacts/client-tenant-switch-mobile.png',fullPage:true});
 await multiPage.locator('.company-switch select').selectOption(tid);
 await multiPage.locator('.workspace-role').getByText('Client viewer',{exact:true}).waitFor();
 await overview.getByText('Demo',{exact:true}).waitFor();
 assert.ok(await multiPage.locator('#client-sidebar-wallet').isHidden());
 assert.equal(await multiPage.locator('#client-sidebar-wallet').innerText(),'');
 await multiPage.getByRole('link',{name:'Customers / Excel',exact:true}).click();
 await multiPage.getByText('Fictional buyer',{exact:true}).waitFor();
 assert.equal(await multiPage.getByText('Secondary-only buyer',{exact:true}).count(),0);
 assert.equal(await multiPage.locator('input[type=file]').count(),0);
 assert.ok(await multiPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(multiErrors,[]);
 await multiContext.close();
 console.log('Client Dashboard: multi-company role switch, separate CRM records, viewer restrictions and mobile layout PASS');
 const adminContext=await browser.newContext({viewport:{width:1440,height:1000}});
 const adminToken=await newSession(f.env.CONTROL_DB,'admin');await adminContext.addCookies([{name:COOKIE,value:adminToken,url:origin}]);
 const adminPage=await adminContext.newPage();lastPage=adminPage;adminPage.setDefaultTimeout(10000);
 await adminPage.goto(origin+'/app');
 await adminPage.getByRole('heading',{name:'Client directory'}).waitFor();
 // Stub only the external account result; actual authorization is covered in route tests.
 await adminPage.route('**/v1/human/credits/provider',r=>r.fulfill({json:{available:true,cashCredits:'12.34',cashCreditsCurrency:'USD',accountType:'developer',checkedAt:new Date().toISOString()}}));
 await adminPage.getByRole('link',{name:'Dashboard',exact:true}).click();
 const providers=adminPage.getByRole('region',{name:'Provider balances'});
 await providers.getByText('₹987.20',{exact:true}).waitFor();
 await providers.getByText(/Plivo API reports \$12.34/).waitFor();
 await providers.getByText('Not synced',{exact:true}).waitFor();
 adminPage.once('dialog',d=>d.accept('₹1,250.75'));
 await providers.getByRole('button',{name:'Sync with Sarvam dashboard'}).click();
 await providers.getByText('₹1,250.75',{exact:true}).waitFor();
 await providers.getByText(/Synced with Sarvam dashboard/).waitFor();
 assert.equal(f.c.db.prepare("SELECT amount_micros FROM provider_financial_journal WHERE provider='sarvam' AND kind='opening'").get().amount_micros,1250750000);
 await providers.getByText('Client allocated minutes',{exact:true}).waitFor();
 await providers.getByText('100m 00s',{exact:true}).waitFor();
 await providers.getByText(/Trial account/).waitFor();
 assert.equal(await adminPage.locator('#client-sidebar-wallet').count(),0);
 await adminPage.unroute('**/v1/human/credits/provider');
 await adminPage.route('**/v1/human/credits/provider',r=>r.fulfill({json:{available:false}}));
 await providers.getByRole('button',{name:'Refresh Plivo balance'}).click();
 await providers.getByText('Unavailable',{exact:true}).waitFor();
 await adminPage.getByRole('link',{name:'Clients',exact:true}).click();
 await adminPage.getByRole('heading',{name:'Client directory'}).waitFor();
 await adminPage.screenshot({path:'artifacts/calling-admin-clients.png',fullPage:true});
 await adminPage.getByRole('link',{name:'Minutes & Wallet',exact:true}).click();
 await adminPage.getByText(/^Provider costs & reports/).click();
 await adminPage.getByRole('heading',{name:'Provider financial journal',exact:true}).waitFor();
 await adminPage.getByRole('heading',{name:'Client financial position',exact:true}).waitFor();
 await adminPage.getByRole('button',{name:'Export financial page (CSV)',exact:true}).waitFor();
 const reportTable=adminPage.locator('table[aria-label="Client financial position records"]');
 await reportTable.locator('thead th').first().waitFor();
 assert.equal(await reportTable.locator('thead th').count(),16);
 assert.equal(await reportTable.locator('tbody tr').first().locator('td').count(),16);
 await adminPage.route('**/v1/human/credits/provider-usage-summary?days=7',r=>r.fulfill({json:{available:true,currency:'INR',totalSpend:123.456,fromDate:'2026-11-17',toDate:'2026-11-24',checkedAt:new Date().toISOString()}}));
 await adminPage.getByRole('button',{name:'Check Plivo spend',exact:true}).click();
 await adminPage.getByText('INR 123.456',{exact:true}).waitFor();
 await adminPage.unroute('**/v1/human/credits/provider-usage-summary?days=7');
 await adminPage.getByRole('row',{name:/Sarvam dashboard sync: Credits Left INR 1250.75/}).waitFor();
 await adminPage.locator('[name="providerJournalAmount"],#providerJournalAmount').first().fill('12.50');
 await adminPage.locator('[name="providerJournalReference"],#providerJournalReference').first().fill('browser-receipt-1');
 await adminPage.locator('[name="providerJournalReason"],#providerJournalReason').first().fill('Synthetic browser receipt evidence');
 adminPage.once('dialog',d=>d.accept());
 await adminPage.getByRole('button',{name:'Record provider transaction',exact:true}).click();
 await adminPage.getByRole('row',{name:/browser-receipt-1/}).waitFor();
 assert.equal(f.c.db.prepare("SELECT amount_micros FROM provider_financial_journal WHERE evidence_ref='browser-receipt-1'").get().amount_micros,12500000);
 await adminPage.getByRole('combobox',{name:'Minute wallet company'}).selectOption(tid);
 await adminPage.getByText('Connected time',{exact:true}).waitFor();
 const ledger=adminPage.locator('.minute-wallet').filter({has:adminPage.getByRole('heading',{name:'Calling credit ledger',exact:true})});
 await ledger.getByText('100m 00s',{exact:true}).first().waitFor();
 await ledger.getByLabel('Received INR',{exact:true}).fill('1000.00');
 await ledger.getByLabel('Purchased calling minutes',{exact:true}).fill('500');
 await ledger.getByLabel('Payment receipt reference',{exact:true}).fill('browser-client-purchase-500');
 adminPage.once('dialog',d=>d.accept());
 await ledger.getByRole('button',{name:'Record payment & allocate credits',exact:true}).click();
 await ledger.getByRole('row',{name:/BROWSER-CLIENT-PURCHASE-500/}).waitFor();
 assert.equal(f.c.db.prepare("SELECT paid_paise FROM tenant_credit_purchases WHERE receipt_ref='BROWSER-CLIENT-PURCHASE-500'").get().paid_paise,100000);
 assert.equal(f.c.db.prepare("SELECT balance_seconds FROM tenant_minute_ledger WHERE tenant_id=? ORDER BY sequence DESC LIMIT 1").get(tid).balance_seconds,36000);
 await ledger.getByText('600m 00s',{exact:true}).first().waitFor();
 await adminPage.getByRole('heading',{name:'Recorded collections by date',exact:true}).waitFor();
 const todayIst=new Date(Date.now()+330*60000).toISOString().slice(0,10);
 await adminPage.getByLabel('From (IST)',{exact:true}).fill(todayIst);
 await adminPage.getByLabel('To (IST)',{exact:true}).fill(todayIst);
 await adminPage.getByRole('button',{name:'Load collections',exact:true}).click();
 const collectionsCard=adminPage.locator('.card').filter({has:adminPage.getByRole('heading',{name:'Recorded collections by date',exact:true})}).last();
 await collectionsCard.getByRole('row',{name:/BROWSER-CLIENT-PURCHASE-500/}).waitFor();
 assert.ok(await collectionsCard.getByRole('button',{name:'Export receipt page (CSV)',exact:true}).isEnabled());
 // Real browser reconciliation against an isolated, synthetic settled hold.
 const costJob='98765432-aaaa-4aaa-8aaa-111111111111',costAt=new Date().toISOString();
 f.c.db.prepare("INSERT INTO provider_cost_reservations(tenant_id,job_id,reserved_seconds,plivo_currency,plivo_micros,sarvam_currency,sarvam_micros,created_at) VALUES(?,?,60,'USD',60000,'INR',200000,?)").run(tid,costJob,costAt);
 f.c.db.prepare("UPDATE tenant_minute_holds SET state='settled',charged_seconds=30,evidence_ref='browser-cdr',closed_at=? WHERE tenant_id=? AND job_id=?").run(costAt,tid,costJob);
 f.c.db.prepare("INSERT INTO provider_financial_journal(id,provider,currency,kind,amount_micros,evidence_ref,reason,actor,created_at) VALUES('browser-cost','plivo','USD','expense',20000,'browser-cdr-line','Synthetic per-call evidence','admin',?)").run(costAt);
 await adminPage.getByRole('heading',{name:'Provider expense reconciliation',exact:true}).waitFor();
 await adminPage.getByRole('button',{name:'Refresh expense attribution',exact:true}).click();
 const costRow=adminPage.getByRole('row',{name:new RegExp(costJob)});
 await costRow.getByRole('button',{name:'Link plivo expense',exact:true}).waitFor();
 const confirmCost=async d=>{if(d.type()==='prompt')await d.accept('browser-cdr-line');else await d.accept();};
 adminPage.on('dialog',confirmCost);
 try{await costRow.getByRole('button',{name:'Link plivo expense',exact:true}).click();await costRow.getByText('Actual USD 0.020000',{exact:true}).waitFor();}
 finally{adminPage.off('dialog',confirmCost)}
 assert.equal(f.c.db.prepare("SELECT actual_micros FROM provider_cost_reconciliations WHERE job_id=? AND provider='plivo'").get(costJob).actual_micros,20000);
 assert.equal(f.c.db.prepare("SELECT charged_seconds FROM tenant_minute_holds WHERE job_id=?").get(costJob).charged_seconds,30);

 await adminPage.getByRole('heading',{name:'Historical budget transaction history',exact:true}).waitFor();
 await adminPage.getByRole('heading',{name:'All credit transactions',exact:true}).waitFor();
 await adminPage.getByRole('combobox',{name:'Transaction type',exact:true}).selectOption('settled');
 await adminPage.getByRole('button',{name:'Refresh transactions',exact:true}).waitFor();
 await adminPage.screenshot({path:'artifacts/admin-minute-wallet.png',fullPage:true});
 await adminPage.getByRole('link',{name:'Calling Setup'}).click();
 await adminPage.getByRole('heading',{name:'Client calling approval',exact:true}).waitFor();
 assert.ok(await adminPage.getByRole('button',{name:'Call the verified internal number once'}).isDisabled());
 assert.equal(await adminPage.getByRole('combobox',{name:'Recorded prompt language'}).inputValue(),'hi');
 await adminPage.getByRole('combobox',{name:'Recorded prompt language'}).selectOption('en');
 await adminPage.getByRole('link',{name:'Company details'}).click();
 await adminPage.getByRole('heading',{name:'Company profile',exact:true}).waitFor();
 await adminPage.locator('[name=company-companyName]').fill('Fictional Builder');
 await adminPage.getByRole('button',{name:'Save company information',exact:true}).click();
 await adminPage.getByText('Company information saved',{exact:true}).waitFor();
 assert.equal(await adminPage.getByRole('button',{name:'Save new script version'}).count(),0);
 assert.equal(f.c.db.prepare('SELECT COUNT(*) AS n FROM calling_agent_publications').get().n,0);
 await adminPage.getByRole('heading',{name:'Client Change Requests',exact:true}).waitFor();
 await adminPage.getByText('Please update our fictional Raipur plot price from 12 lakh to 14 lakh.').waitFor();
 await adminPage.getByRole('link',{name:'Calling Setup'}).click();
 assert.equal(await adminPage.getByRole('combobox',{name:'Recorded prompt language'}).inputValue(),'en');

 await adminPage.getByLabel('Provider approval reference',{exact:true}).fill('browser-reviewed-provider-reference');
 await adminPage.getByRole('button',{name:'Save company calling approval',exact:true}).click();
 await adminPage.getByText('Company approval saved.',{exact:true}).waitFor();
 await adminPage.getByLabel('Consent evidence reference',{exact:true}).fill('browser-consent-reference');
 await adminPage.getByLabel('DND verification reference',{exact:true}).fill('browser-dnd-reference');
 await adminPage.getByLabel('Fictional buyer — '+lead.slice(0,8),{exact:true}).check();
 await adminPage.getByRole('button',{name:'Approve selected customers',exact:true}).click();
 await adminPage.getByText('1 customer approvals saved.',{exact:true}).waitFor();
 await adminPage.evaluate(()=>window.scrollTo(0,0));await adminPage.screenshot({path:'artifacts/premium-super-admin.png',fullPage:true});
 await adminContext.close();console.log('Super Admin UI: current MFA session, company policy and selected customer clearances PASS');

 // Real email/password lifecycle against migrated SQLite and the actual Worker.
 const loginContext=await browser.newContext({viewport:{width:390,height:844}});
 const loginPage=await loginContext.newPage();lastPage=loginPage;loginPage.setDefaultTimeout(10000);
 const loginEmail='invited-browser-client@example.invalid',loginPassword='synthetic-client-password-42';
 const invite=randomSecret(),expiredInvite=randomSecret(),start=Date.now();
 const addInvite=f.c.db.prepare("INSERT INTO human_invitations(token_hash,tenant_id,email,role,expires_at,created_by,created_at) VALUES(?,?,?,'client_admin',?,'admin',?)");
 addInvite.run(await sha256hex(invite),tid,loginEmail,start+3600000,new Date(start).toISOString());
 addInvite.run(await sha256hex(expiredInvite),tid,loginEmail,start-1000,new Date(start).toISOString());
 const visitInvite=token=>loginPage.goto(origin+'/app#invite='+token);
 const dashboard=()=>loginPage.getByRole('heading',{name:'Home',exact:true}).waitFor();
 const logout=async()=>{
  await loginPage.getByRole('button',{name:'Sign out',exact:true}).click();
  await loginPage.getByRole('button',{name:'Sign in',exact:true}).waitFor();
 };
 const fillInvitation=async password=>{
  await loginPage.getByLabel('Invited email',{exact:true}).fill(loginEmail);
  await loginPage.getByLabel('Create password',{exact:true}).fill(password);
  await loginPage.getByRole('button',{name:'Activate client account',exact:true}).click();
 };
 const signIn=async()=>{
  await loginPage.getByLabel('Email address',{exact:true}).fill(loginEmail);
  await loginPage.getByLabel('Password',{exact:true}).fill(loginPassword);
  await loginPage.getByRole('button',{name:'Sign in',exact:true}).click();
  await dashboard();
  assert.equal(loginPage.url(),origin+'/app');
  assert.equal(await loginPage.getByRole('heading',{name:'Super Admin',exact:true}).count(),0);
 };
 await visitInvite(invite);
 await fillInvitation(loginPassword);
 await dashboard();
 assert.equal(loginPage.url(),origin+'/app');
 await logout();
 await visitInvite(invite);
 await fillInvitation('different-password-must-not-replace-existing');
 await loginPage.getByText(/This invitation has already been used, expired/).waitFor();
 assert.equal(loginPage.url(),origin+'/app');
 assert.equal(await loginPage.getByLabel('Email address',{exact:true}).inputValue(),loginEmail);
 assert.equal(await loginPage.getByLabel('Password',{exact:true}).inputValue(),'');
 await signIn();
 await logout();
 await visitInvite(expiredInvite);
 await fillInvitation('different-password-must-not-replace-existing');
 await loginPage.getByText(/This invitation has already been used, expired/).waitFor();
 await signIn();
 await logout();
 await visitInvite(invite);
 await loginPage.getByRole('button',{name:'Sign in with email and password',exact:true}).click();
 await signIn();
 await logout();
 await loginPage.goto(origin+'/app');
 await signIn();
 await logout();
 await visitInvite('malformed');
 await loginPage.getByRole('button',{name:'Sign in',exact:true}).waitFor();
 assert.equal(loginPage.url(),origin+'/app');
 await loginContext.close();
 console.log('Client login: activation, reused and expired invitation recovery, direct sign-in, and repeated sign-in with the existing password PASS');
}catch(e){console.error(await lastPage?.locator('body').innerText());await lastPage?.screenshot({path:'/tmp/ar3d-calling-failure.png',fullPage:true});throw e}finally{await browser.close();server.close();f.close()}
