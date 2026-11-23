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
 await page.getByText(/Calling disabled/).waitFor();
 const selected=f.r.db.prepare(`SELECT l.id,l.name FROM call_campaign_candidates c JOIN leads l
   ON l.tenant_id=c.tenant_id AND l.id=c.lead_id WHERE c.tenant_id=? AND c.campaign_id=?`).all(tid,draft.id);
 assert.deepEqual(selected.map(x=>x.name),['Uploaded buyer']);
 const run=crypto.randomUUID(),job=crypto.randomUUID(),at=new Date().toISOString();
 f.r.db.prepare("INSERT INTO calling_runs(tenant_id,id,campaign_id,state,created_by,created_at,updated_at) VALUES(?,?,?,'completed','client',?,?)").run(tid,run,draft.id,at,at);
 f.r.db.prepare("INSERT INTO calling_jobs(tenant_id,id,run_id,lead_id,state,provider_status,duration_seconds,created_at,updated_at) VALUES(?,?,?,?,'completed','completed',50,?,?)").run(tid,job,run,selected[0].id,at,at);
 f.r.db.prepare("INSERT INTO scripted_call_results VALUES(?,?,?,?,1,?)").run(tid,job,crypto.randomUUID(),
  JSON.stringify({propertyType:'flat',location:'Raipur',area:'Shankar Nagar',size:'3BHK',budgetInr:3500000,interest:'interested',visitDate:'2027-01-12'}),at);
 await page.getByRole('link',{name:'Results / CRM',exact:true}).click();
 await page.getByRole('heading',{name:'Campaign results & customer answers'}).waitFor();
 await page.getByRole('button',{name:'Refresh customer answers'}).waitFor();
 await page.getByRole('combobox',{name:'Filter results by campaign'}).selectOption(draft.id);
 await page.getByRole('row',{name:new RegExp('Uploaded buyer Acceptance '+viewport.width+'.*Saved to lead')}).waitFor();
 await page.getByRole('row',{name:new RegExp('Uploaded buyer Acceptance '+viewport.width)}).getByRole('button',{name:'View answers'}).click();
 await page.getByRole('heading',{name:'Uploaded buyer — call answers'}).waitFor();
 await page.getByText('3BHK',{exact:true}).waitFor();
 assert.equal(await page.getByRole('row',{name:/Fictional buyer/}).count(),0);
 await page.screenshot({path:'artifacts/calling-results-'+viewport.width+'.png',fullPage:true});
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
 assert.equal(await multiPage.locator('input[type=file]').count(),0);
 assert.equal(await multiPage.getByText('Secondary-only buyer',{exact:true}).count(),0);
 await multiPage.locator('.company-switch select').selectOption(otherTenant);
 await multiPage.locator('.workspace-role').getByText('Client Admin',{exact:true}).waitFor();
 await overview.getByText('Secondary Builder',{exact:true}).waitFor();
 await multiPage.getByText('Secondary-only buyer',{exact:true}).waitFor();
 assert.equal(await multiPage.getByText('Fictional buyer',{exact:true}).count(),0);
 assert.equal(await multiPage.locator('input[type=file]').count(),1);
 assert.equal(await overview.getByText('1',{exact:true}).count(),1);
 // Confirm the previously broken manual add-customer form really persists
 // only to the selected tenant, with consent and DND still unknown.
 await multiPage.getByText('Add one customer manually',{exact:true}).click();
 await multiPage.locator('input[name=customerName]').fill('Secondary manual buyer');
 await multiPage.locator('input[name=customerMobile]').fill('9000000079');
 await multiPage.getByRole('button',{name:'Add customer',exact:true}).click();
 await multiPage.getByText('Secondary manual buyer',{exact:true}).waitFor();
 assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM leads WHERE tenant_id=?').get(otherTenant).n,2);
 assert.equal(f.r.db.prepare("SELECT consent_status,dnd_status FROM leads WHERE tenant_id=? AND name='Secondary manual buyer'").get(otherTenant).consent_status,'unknown');
 assert.equal(await overview.getByText('2',{exact:true}).count(),1);
 await multiPage.screenshot({path:'artifacts/client-tenant-switch-mobile.png',fullPage:true});
 await multiPage.locator('.company-switch select').selectOption(tid);
 await multiPage.locator('.workspace-role').getByText('Client viewer',{exact:true}).waitFor();
 await overview.getByText('Demo',{exact:true}).waitFor();
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
 await adminPage.screenshot({path:'artifacts/calling-admin-clients.png',fullPage:true});
 await adminPage.getByRole('link',{name:'Calling Setup'}).click();
 await adminPage.getByRole('heading',{name:'Client calling approval',exact:true}).waitFor();
 assert.ok(await adminPage.getByRole('button',{name:'Call the verified internal number once'}).isDisabled());
 assert.equal(await adminPage.getByRole('combobox',{name:'Recorded prompt language'}).inputValue(),'en');
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
 const dashboard=()=>loginPage.getByRole('heading',{name:'Customers / Excel',exact:true}).waitFor();
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
