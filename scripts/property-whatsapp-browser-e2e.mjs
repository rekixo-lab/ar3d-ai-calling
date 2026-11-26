/** Synthetic localhost-only UI checks. No real credentials, messages or provider requests. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {html,css,js} from '../src/app-assets.mjs';
const {chromium}=await import('playwright').catch(()=>import(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright/index.mjs'));
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',P='33333333-3333-4333-8333-333333333333',C='44444444-4444-4444-8444-444444444444',L='55555555-5555-4555-8555-555555555555';
const properties=[{id:P,revision:1,name:'River Garden',propertyType:'plot',city:'Raipur',cityAliases:['रायपुर'],locality:'Central',localityAliases:[],priceMinInr:2000000,priceMaxInr:2500000,priceBasis:'total',sizeMin:1000,sizeMax:1200,sizeUnit:'sqft',status:'available',description:'Fictional property for browser verification.',createdAt:'2026-11-26T10:00:00Z',updatedAt:'2026-11-26T10:00:00Z',assets:[]}];
let mapping={revision:0,propertyIds:[]},savedRules=null,connected=false;
const writes=[];
const reply=(res,status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(typeof body==='string'?body:JSON.stringify(body))};
const server=http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,'http://127.0.0.1'),path=u.pathname,admin=(req.headers.cookie||'').includes('scenario=admin');
  if(path==='/app')return reply(res,200,html,'text/html');
  if(path==='/app/assets/app.js')return reply(res,200,js,'text/javascript');
  if(path==='/app/assets/style.css')return reply(res,200,css,'text/css');
  if(path==='/favicon.ico')return reply(res,204,'');
  const tenants=[{id:A,name:'Fictional Builder',display_name:'Fictional Builder',role:'client_admin',status:'active'},{id:B,name:'Viewer Company',display_name:'Viewer Company',role:'viewer',status:'active'}];
  if(path==='/v1/human/me')return reply(res,200,{id:'synthetic-user',email:'synthetic@example.invalid',superAdmin:admin,tenants:admin?[]:tenants});
  if(path==='/v1/human/tenants')return reply(res,200,{tenants:[tenants[0]]});
  let body={};if(req.method==='POST'){let data='';for await(const chunk of req)data+=chunk;body=JSON.parse(data);writes.push({path,body});}
  const tid=body.tenantId||u.searchParams.get('tenantId')||A;
  if(path==='/v1/human/overview')return reply(res,200,{tenant:{id:tid,name:tid===A?'Fictional Builder':'Viewer Company'},role:tid===A?'client_admin':'viewer',metrics:{leads:1,calls:0,siteVisits:0}});
  if(path==='/v1/human/credits/minute-ledger')return reply(res,200,{uncommittedSeconds:1200,spendableSeconds:1200});
  if(path==='/v1/human/operations/report')return reply(res,200,{jobs:{completed:0},leadPipeline:{interested:1}});
  if(path==='/v1/human/properties'){
   if(req.method==='POST'){
    assert.equal(tid,A);assert.equal(body.expectedRevision,0);assert.equal(body.property.name,'Lake View');assert.deepEqual(body.property.cityAliases,['रायपुर']);
    const property={...body.property,id:'66666666-6666-4666-8666-666666666666',revision:1,assets:[],createdAt:'2026-11-26T12:00:00Z',updatedAt:'2026-11-26T12:00:00Z'};properties.push(property);return reply(res,201,{saved:true,property});
   }
   const list=tid===A?properties:[{...properties[0],id:'77777777-7777-4777-8777-777777777777',name:'Viewer property',city:'Durg'}];
   return reply(res,200,{tenantId:tid,properties:u.searchParams.get('id')?list.filter(x=>x.id===u.searchParams.get('id')):list,canEdit:admin||tid===A,hasMore:false,campaigns:[{id:C,name:'November enquiries'}]});
  }
  if(path==='/v1/human/campaign-properties'){
   if(req.method==='POST'){assert.equal(tid,A);assert.deepEqual(body.propertyIds,[P]);mapping={revision:1,propertyIds:body.propertyIds};}
   return reply(res,200,{tenantId:tid,campaignId:C,...mapping,properties:properties.filter(p=>mapping.propertyIds.includes(p.id))});
  }
  if(path==='/v1/human/whatsapp'){
   if(req.method==='POST'){
    assert.equal(tid,A);
    if(body.action==='save_rules'){assert.equal(body.rules.enabled,false);savedRules={...body.rules,revision:1};return reply(res,200,{saved:true});}
    if(body.action==='connect'){assert.equal(admin,true);assert.equal(body.accessToken,'synthetic-token-no-provider-access');connected=true;return reply(res,200,{saved:true,verifyToken:'synthetic-verify-token-shown-once',webhookUrl:'https://example.invalid/v1/provider/whatsapp'});}
    throw Error('Unexpected synthetic mutation '+body.action);
   }
   return reply(res,200,{canEdit:admin||tid===A,connection:{status:connected?'connected':'not_connected',displayPhone:connected?'+919999999999':'',webhookVerified:false,revision:connected?1:0},templates:[],rules:savedRules||{enabled:false,firstDelayMinutes:10,secondDelayHours:48,secondEnabled:false,visitReminderEnabled:false,templateName:'',templateLanguage:'hi',dailyLimit:100,revision:0},messages:[{id:'88888888-8888-4888-8888-888888888888',leadId:L,leadName:'Synthetic buyer',kind:'property_details',status:'submitted',dueAt:'2026-11-26T13:00:00Z'}],inbox:[],permissions:[],leads:[{id:L,name:'Synthetic buyer',mobile:'+919999999990',interestStatus:'interested'}],campaigns:[{id:C,name:'November enquiries'}],visits:[],setup:{canConnect:admin,webhookUrl:'https://example.invalid/v1/provider/whatsapp',requirements:[]}});
  }
  return reply(res,404,{error:'Unsupported synthetic endpoint '+path});
 }catch(e){reply(res,500,{error:e.message});}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CI?{channel:'chrome'}:existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{})});
const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1366,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.goto(origin+'/app#properties');
 await page.getByRole('button',{name:'Add property',exact:true}).waitFor();
 await page.getByRole('button',{name:'Add property',exact:true}).click();
 await page.locator('[name=property-name]').fill('Lake View');
 await page.locator('[name=property-city]').fill('Raipur');
 await page.locator('[name=property-cityAliases]').fill('रायपुर');
 await page.locator('[name=property-priceBasis]').selectOption('total');
 await page.locator('[name=property-priceMinInr]').fill('1800000');
 await page.getByRole('button',{name:'Save property',exact:true}).click();
 await page.getByRole('button',{name:'Edit Lake View',exact:true}).waitFor();
 assert.equal(properties.length,2);
 await page.getByRole('button',{name:'Close editor'}).click();
 await page.locator('[name=propertyCampaign]').selectOption(C);
 await page.getByRole('checkbox',{name:/River Garden/}).check();
 await page.getByRole('button',{name:'Save campaign properties',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('notice')?.textContent.includes('Campaign properties saved'));
 assert.deepEqual(mapping.propertyIds,[P]);
 await page.getByRole('link',{name:'WhatsApp',exact:true}).click();
 await page.getByText('WhatsApp setup is pending.',{exact:false}).waitFor();
 assert.equal(await page.locator('[name=whatsappAccessToken]').count(),0);
 assert.equal(await page.locator('[name=whatsappEnabled]').isDisabled(),true);
 assert.equal(await page.getByText('Submitted to WhatsApp',{exact:true}).count(),1);
 assert.equal(await page.getByText('Delivered',{exact:true}).count(),0);
 await page.locator('[name=whatsappFirstDelay]').fill('15');
 await page.getByRole('button',{name:'Save follow-up rules',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('notice')?.textContent.includes('rules saved'));
 assert.equal(savedRules.firstDelayMinutes,15);assert.equal(savedRules.enabled,false);
 await page.screenshot({path:'/tmp/ar3d-whatsapp-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('link',{name:'My Properties',exact:true}).click();
 await page.getByRole('button',{name:'Add property',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'mobile page must not overflow');
 await page.screenshot({path:'/tmp/ar3d-properties-mobile.png',fullPage:true});
 await page.getByLabel('Company',{exact:true}).selectOption(B);
 await page.getByRole('heading',{name:'Viewer property',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Add property',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:/Edit River Garden/}).count(),0);
 assert.equal(await page.getByText('Lake View',{exact:true}).count(),0);
 const adminContext=await browser.newContext();await adminContext.addCookies([{name:'scenario',value:'admin',url:origin}]);
 const admin=await adminContext.newPage();admin.on('pageerror',e=>errors.push(e.message));
 await admin.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await admin.goto(origin+'/app#whatsapp');
 await admin.locator('[name=whatsappAccessToken]').waitFor();
 assert.equal(await admin.locator('[name=whatsappAccessToken]').getAttribute('type'),'password');
 await admin.locator('[name=whatsappAccountId]').fill('123456789');
 await admin.locator('[name=whatsappPhoneNumberId]').fill('987654321');
 await admin.locator('[name=whatsappAccessToken]').fill('synthetic-token-no-provider-access');
 await admin.locator('[name=whatsappAppSecret]').fill('abcdef1234567890abcdef1234567890');
 await admin.getByRole('button',{name:'Verify and connect account',exact:true}).click();
 await admin.getByText('Account verified. Complete the webhook setup in Meta.',{exact:true}).waitFor();
 assert.equal(await admin.locator('[name=whatsappAccessToken]').inputValue(),'');
 assert.equal(await admin.locator('[name=whatsappAppSecret]').inputValue(),'');
 assert.equal(await admin.getByText('synthetic-token-no-provider-access',{exact:true}).count(),0);
 assert.equal(await admin.getByLabel('One-time webhook verify token').inputValue(),'synthetic-verify-token-shown-once');
 await admin.getByRole('button',{name:'Refresh WhatsApp',exact:true}).click();
 await admin.getByText('Account connected. Finish webhook verification',{exact:false}).waitFor();
 assert.equal(await admin.locator('[name=whatsappEnabled]').isDisabled(),true,'connected without signed webhook still blocks automation');
 assert.deepEqual(errors,[]);assert.equal(writes.some(w=>/calling\/runs|calls\/start/.test(w.path)),false);
 console.log('Property + WhatsApp browser flow passed: create, campaign mapping, draft rules, viewer isolation, mobile layout, secret handling, truthful delivery.');
}finally{await browser.close();server.close();await once(server,'close');}
