import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture,admin,client,tid,cid,now,at} from './helpers/calling-fixture.mjs';
import {handlePropertyCatalog,handlePublicPropertyMedia,createPropertyAssetShare,
 getCampaignProperties,getProperty,matchCampaignProperties,validateProperty} from '../src/property-catalog.mjs';
const origin='https://app.example.invalid';
const other='99999999-9999-4999-8999-999999999999';
const otherCampaign='88888888-8888-4888-8888-888888888888';
const property={name:'Green Gardens',propertyType:'plot',city:'Raipur',locality:'Daldal Seoni',
 priceBasis:'total',priceMinInr:1500000,priceMaxInr:1800000,sizeMin:1000,sizeMax:1400,sizeUnit:'sqft',
 mapUrl:'https://maps.example.invalid/project',websiteUrl:'https://builder.example.invalid/green',
 contactName:'Sales desk',contactPhone:'9000000001',description:'Available residential plots',status:'available'};
function setup(){
 const f=fixture(),data=new Map();let pending=Promise.resolve();
 // D1 serializes batches. The shared synchronous SQLite fixture needs the
 // same behavior for meaningful concurrent compare-and-swap route tests.
 const batch=f.env.CRM_DB.batch.bind(f.env.CRM_DB);
 f.env.CRM_DB.batch=queries=>{const result=pending.then(()=>batch(queries));pending=result.catch(()=>{});return result};
 f.env.RECORDINGS={
  async put(key,value){data.set(key,new Uint8Array(value))},
  async get(key){const value=data.get(key);return value?{body:new Uint8Array(value)}:null},
  async delete(key){data.delete(key)}
 };f.media=data;
 return f;
}
function req(path,method,data,{requestOrigin=origin}={}){
 return new Request(origin+path,{method,headers:{Origin:requestOrigin,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
}
function call(f,path,method='GET',data,user=client,options={}){
 return handlePropertyCatalog(req(path,method,data,options),f.env,user,{now});
}
async function make(f,input=property,tenantId=tid,user=client){
 const r=await call(f,'/v1/human/properties','POST',{tenantId,expectedRevision:0,property:input},user);
 const body=await r.json();assert.equal(r.status,201,JSON.stringify(body));return body.property;
}
function fields(p){return Object.fromEntries(Object.entries(p).filter(([k])=>!['id','revision','createdAt','updatedAt','assets'].includes(k)))}
async function edit(f,p,changes,user=client,tenantId=tid){
 return call(f,'/v1/human/properties','POST',{tenantId,id:p.id,expectedRevision:p.revision,property:{...fields(p),...changes}},user);
}
function secondTenant(f){
 f.c.db.prepare("INSERT INTO tenants(id,slug,display_name,plan_code,storage_mode,status,created_at,updated_at) VALUES(?,'second','Second','starter','shared','active',?,?)").run(other,at,at);
 f.c.db.prepare("INSERT INTO tenant_memberships(tenant_id,user_id,role,created_at) VALUES(?,'client','client_admin',?)").run(other,at);
 f.r.db.prepare("INSERT INTO call_campaign_drafts(tenant_id,id,name,language_mode,purpose,created_by,created_at,updated_at) VALUES(?,?,'Other','hi','property_information','client',?,?)").run(other,otherCampaign,at,at);
}
async function upload(f,p,{kind='brochure',type='application/pdf',fileName='brochure.pdf',data=new TextEncoder().encode('%PDF-1.7\nSynthetic brochure'),tenantId=tid,user=client}={}){
 const url=origin+'/v1/human/property-assets?'+new URLSearchParams({tenantId,propertyId:p.id,expectedRevision:String(p.revision),kind,fileName});
 return handlePropertyCatalog(new Request(url,{method:'POST',headers:{Origin:origin,'Content-Type':type},body:data}),f.env,user,{now});
}

test('client-owned properties persist typed facts, preserve tenant isolation, and do not modify leads/calls',async()=>{
 const f=setup();try{
  const p=await make(f);assert.equal(p.revision,1);assert.equal(p.contactPhone,'+919000000001');assert.deepEqual(p.assets,[]);
  const list=await (await call(f,'/v1/human/properties?tenantId='+tid)).json();assert.equal(list.canEdit,true);assert.equal(list.properties.length,1);assert.equal(list.campaigns[0].id,cid);
  assert.equal((await call(f,'/v1/human/properties?tenantId='+tid,'GET',null,{id:'outsider',globalRole:'user'})).status,403);
  assert.equal((await call(f,'/v1/human/properties?tenantId='+tid,'GET',null,{id:'viewer',globalRole:'user'})).status,200);
  assert.equal((await makeReadOnlyAttempt(f)).status,403);
  assert.equal((await call(f,'/v1/human/properties','DELETE')).status,405);
  secondTenant(f);assert.equal((await call(f,'/v1/human/properties?tenantId='+other+'&id='+p.id)).status,404);
  assert.equal((await edit(f,p,{name:'Stolen'},client,other)).status,404);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM calls').get().n,0);
  assert.equal(f.r.db.prepare('SELECT interest_status,consent_status FROM leads WHERE tenant_id=?').get(tid).interest_status,'new');
 }finally{f.close()}
});
function makeReadOnlyAttempt(f){return call(f,'/v1/human/properties','POST',{tenantId:tid,expectedRevision:0,property},{id:'viewer',globalRole:'user'})}

test('super admin property access requires a current MFA session and same-origin writes',async()=>{
 const f=setup();try{
  await make(f,property,tid,admin);
  assert.equal((await call(f,'/v1/human/properties?tenantId='+tid,'GET',null,{...admin,token_hash:'b'.repeat(64)})).status,403);
  assert.equal((await call(f,'/v1/human/properties','POST',{tenantId:tid,expectedRevision:0,property},client,{requestOrigin:'https://evil.invalid'})).status,403);
  assert.equal((await call(f,'/v1/human/properties?tenantId='+tid+'&tenantId='+other)).status,400);
 }finally{f.close()}
});

test('property validation rejects executable URLs, markup, wrong units and price assumptions',async()=>{
 const f=setup();try{
  for(const change of [{name:'<script>alert(1)</script>'},{description:'<img src=x onerror=alert(1)>'},
   {mapUrl:'javascript:alert(1)'},{websiteUrl:'http://example.invalid'},{mapUrl:'https://u:p@example.invalid'},
   {websiteUrl:'https://127.0.0.1/private'},{websiteUrl:'https://localhost/path'},
   {cityAliases:['Raipur',' raipur ']},{cityAliases:['<script>']},{localityAliases:Array(6).fill('area')},
   {priceMaxInr:1},{priceMinInr:1.5},{priceBasis:'on_request'},{sizeUnit:'BHK'},{sizeMin:1401},{bhk:2},{status:'draft'}]){
   const r=await call(f,'/v1/human/properties','POST',{tenantId:tid,expectedRevision:0,property:{...property,...change}});
   assert.equal(r.status,400,JSON.stringify(change));
  }
  const p=validateProperty({name:'Project',propertyType:'flat',city:'Pune',bhk:2});
  assert.equal(p.priceBasis,'on_request');assert.equal(p.priceMinInr,null);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM properties').get().n,0);
 }finally{f.close()}
});

test('concurrent property edits use revision comparison and create one matching audit record',async()=>{
 const f=setup();try{
  const p=await make(f);
  const results=await Promise.all([edit(f,p,{name:'First'}),edit(f,p,{name:'Second'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const saved=await getProperty(f.env.CRM_DB,tid,p.id);assert.equal(saved.revision,2);assert.ok(['First','Second'].includes(saved.name));
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='property.saved'").get().n,2);
  assert.equal((await edit(f,saved,{status:'sold'})).status,200);
 }finally{f.close()}
});

test('campaign mapping is tenant-scoped, bounded, available-only and revision protected',async()=>{
 const f=setup();try{
  const p=await make(f),p2=await make(f,{...property,name:'Second project'});secondTenant(f);
  const foreign=await make(f,property,other);
  const update=(expectedRevision,propertyIds,campaignId=cid)=>call(f,'/v1/human/campaign-properties','POST',{tenantId:tid,campaignId,expectedRevision,propertyIds});
  assert.equal((await update(0,[foreign.id])).status,409);
  assert.equal((await update(0,[p.id],otherCampaign)).status,404);
  assert.equal((await update(0,[p.id,p.id])).status,400);
  assert.equal((await update(0,Array.from({length:4},()=>crypto.randomUUID()))).status,400);
  assert.equal((await update(0,[p.id,p2.id])).status,200);
  assert.equal((await update(0,[p.id])).status,409);
  assert.equal((await update(1,[foreign.id])).status,409);
  assert.deepEqual((await getCampaignProperties(f.env.CRM_DB,tid,cid)).map(p=>p.name),['Green Gardens','Second project']);
  await edit(f,p,{status:'paused'});
  assert.equal((await update(1,[p.id])).status,409);
  assert.equal((await getCampaignProperties(f.env.CRM_DB,tid,cid)).length,1);
  const current=await (await call(f,'/v1/human/campaign-properties?tenantId='+tid+'&campaignId='+cid)).json();
  assert.equal(current.revision,1);assert.equal(current.properties.length,2);assert.equal(current.properties[0].status,'paused');
  assert.equal((await update(1,[])).status,200);
  assert.deepEqual(await getCampaignProperties(f.env.CRM_DB,tid,cid),[]);
 }finally{f.close()}
});

test('composite database keys reject foreign property/campaign mappings',async()=>{
 const f=setup();try{
  const p=await make(f);secondTenant(f);const foreign=await make(f,property,other);
  await call(f,'/v1/human/campaign-properties','POST',{tenantId:tid,campaignId:cid,expectedRevision:0,propertyIds:[p.id]});
  assert.throws(()=>f.r.db.prepare('INSERT INTO campaign_properties VALUES(?,?,?,1)').run(tid,cid,foreign.id),/FOREIGN KEY/);
  assert.throws(()=>f.r.db.prepare('INSERT INTO campaign_properties VALUES(?,?,?,1)').run(tid,otherCampaign,p.id),/FOREIGN KEY/);
  assert.throws(()=>f.r.db.prepare('UPDATE properties SET price_min_inr=NULL,price_max_inr=NULL WHERE tenant_id=?').run(tid),/CHECK/);
  f.r.db.exec(readFileSync('migrations/crm/0023_property_catalog.sql','utf8'));
  assert.equal((await getProperty(f.env.CRM_DB,tid,p.id)).name,property.name);
 }finally{f.close()}
});

test('private media validates type/content, requires tenant write access, and reports no R2 keys',async()=>{
 const f=setup();try{
  const p=await make(f);
  assert.equal((await upload(f,p,{data:new TextEncoder().encode('<html>fake pdf</html>')})).status,415);
  assert.equal((await upload(f,p,{kind:'photo',type:'image/svg+xml',data:new TextEncoder().encode('<svg/>')})).status,415);
  assert.equal((await upload(f,p,{fileName:'../private.pdf'})).status,400);
  assert.equal((await upload(f,p,{user:{id:'viewer',globalRole:'user'}})).status,403);
  const response=await upload(f,p);assert.equal(response.status,201);const {asset,revision}=await response.json();assert.equal(revision,2);
  assert.equal(asset.kind,'brochure');assert.equal('objectKey' in asset,false);assert.equal(f.media.size,1);
  const view=await call(f,asset.downloadUrl);assert.equal(view.status,200);assert.equal(view.headers.get('Content-Type'),'application/pdf');assert.match(view.headers.get('Content-Disposition'),/^attachment/);
  assert.match(await view.text(),/^%PDF-/);
  secondTenant(f);assert.equal((await call(f,'/v1/human/property-assets?tenantId='+other+'&assetId='+asset.id)).status,404);
  assert.equal((await upload(f,p)).status,409);
 }finally{f.close()}
});

test('oversized media stops reading before storage and never changes inventory revision',async()=>{
 const f=setup();try{
  const p=await make(f);
  const response=await upload(f,p,{kind:'photo',type:'image/png',fileName:'photo.png',data:new Uint8Array(3*1024*1024+1)});
  assert.equal(response.status,413);assert.equal(f.media.size,0);assert.equal((await getProperty(f.env.CRM_DB,tid,p.id)).revision,1);
 }finally{f.close()}
});

test('photo cap and upload compare-and-swap clean only the unsuccessful new blob',async()=>{
 const f=setup();try{
  let p=await make(f);const image=Uint8Array.from([137,80,78,71,13,10,26,10,1]);
  for(let i=0;i<5;i++){
   const response=await upload(f,p,{kind:'photo',type:'image/png',fileName:'photo.png',data:image});assert.equal(response.status,201);
   p=await getProperty(f.env.CRM_DB,tid,p.id);
  }
  assert.equal((await upload(f,p,{kind:'photo',type:'image/png',fileName:'photo.png',data:image})).status,409);
  assert.equal(f.media.size,5);assert.equal(p.assets.length,5);
  const original=f.env.RECORDINGS.put;let once=true;
  f.env.RECORDINGS.put=async(key,value)=>{await original(key,value);if(once){once=false;await edit(f,p,{name:'Changed during upload'})}};
  assert.equal((await upload(f,p)).status,409);assert.equal(f.media.size,5);
  assert.equal(f.r.db.prepare('SELECT COUNT(*) AS n FROM property_assets').get().n,5);
 }finally{f.close()}
});

test('provider shares expose only one active property asset, expire, and stop when property is paused',async()=>{
 const f=setup();try{
  let p=await make(f);const body=await (await upload(f,p)).json();
  const share=await createPropertyAssetShare(f.env,{tenantId:tid,assetId:body.asset.id,origin,ttlSeconds:60},{now});
  const u=new URL(share.url),stored=f.r.db.prepare('SELECT token_hash FROM property_media_shares').get();
  assert.notEqual(stored.token_hash,u.searchParams.get('token'));
  assert.equal((await handlePublicPropertyMedia(new Request(share.url),f.env,{now})).status,200);
  assert.equal((await handlePublicPropertyMedia(new Request(share.url,{method:'HEAD'}),f.env,{now})).status,200);
  assert.equal((await handlePublicPropertyMedia(new Request(share.url),f.env,{now:now+60000})).status,404);
  u.searchParams.set('assetId',crypto.randomUUID());assert.equal((await handlePublicPropertyMedia(new Request(u),f.env,{now})).status,404);
  u.searchParams.set('tenantId',other);assert.equal((await handlePublicPropertyMedia(new Request(u),f.env,{now})).status,404);
  p=await getProperty(f.env.CRM_DB,tid,p.id);await edit(f,p,{status:'paused'});
  assert.equal((await handlePublicPropertyMedia(new Request(share.url),f.env,{now})).status,404);
  await assert.rejects(()=>createPropertyAssetShare(f.env,{tenantId:tid,assetId:body.asset.id,origin},{now}),/available_property_media_not_found/);
 }finally{f.close()}
});

test('brochure replacement revokes the previous asset and share while keeping previous private file',async()=>{
 const f=setup();try{
  let p=await make(f);const first=await (await upload(f,p)).json();
  const share=await createPropertyAssetShare(f.env,{tenantId:tid,assetId:first.asset.id,origin},{now});
  p=await getProperty(f.env.CRM_DB,tid,p.id);const second=await (await upload(f,p,{fileName:'revised.pdf'})).json();
  assert.notEqual(first.asset.id,second.asset.id);assert.equal(f.media.size,2);
  assert.equal((await handlePublicPropertyMedia(new Request(share.url),f.env,{now})).status,404);
  assert.equal((await call(f,first.asset.downloadUrl)).status,404);
  const updated=await getProperty(f.env.CRM_DB,tid,p.id);assert.equal(updated.assets.length,1);assert.equal(updated.assets[0].fileName,'revised.pdf');
 }finally{f.close()}
});

test('retiring media is tenant scoped, revision guarded, audited, and revokes links without deleting private files',async()=>{
 const f=setup();try{
  let p=await make(f);const first=await (await upload(f,p)).json();p=await getProperty(f.env.CRM_DB,tid,p.id);
  const share=await createPropertyAssetShare(f.env,{tenantId:tid,assetId:first.asset.id,origin},{now});
  const data={tenantId:tid,propertyId:p.id,assetId:first.asset.id,expectedRevision:p.revision};
  assert.equal((await call(f,'/v1/human/property-assets/retire','POST',{...data,expectedRevision:1})).status,409);
  secondTenant(f);assert.equal((await call(f,'/v1/human/property-assets/retire','POST',{...data,tenantId:other})).status,404);
  assert.equal((await call(f,'/v1/human/property-assets/retire','POST',data,{id:'viewer',globalRole:'user'})).status,403);
  const result=await call(f,'/v1/human/property-assets/retire','POST',data);assert.equal(result.status,200);assert.equal((await result.json()).revision,3);
  assert.equal((await getProperty(f.env.CRM_DB,tid,p.id)).assets.length,0);assert.equal(f.media.size,1);
  assert.equal((await handlePublicPropertyMedia(new Request(share.url),f.env,{now})).status,404);
  assert.equal(f.r.db.prepare("SELECT COUNT(*) AS n FROM crm_audit_events WHERE action='property.media_retired'").get().n,1);
 }finally{f.close()}
});

test('city and locality aliases are explicit client inventory data, preserved and matched without guessing translations',async()=>{
 const f=setup();try{
  const p=await make(f,{...property,cityAliases:['रायपुर'],localityAliases:['दलदल सिवनी']});
  assert.deepEqual(p.cityAliases,['रायपुर']);assert.deepEqual(p.localityAliases,['दलदल सिवनी']);
  const buyer={propertyType:'plot',location:'रायपुर',area:'दलदल सिवनी',size:'1200 sqft',budgetInr:2000000};
  assert.equal(matchCampaignProperties([p],buyer).length,1);
  assert.equal(matchCampaignProperties([p],{...buyer,location:'कोरबा'}).length,0);
  assert.equal(matchCampaignProperties([{...p,cityAliases:[]}],buyer).length,0);
  assert.equal(matchCampaignProperties([{...p,localityAliases:[]}],buyer).length,0);
 }finally{f.close()}
});

test('matching uses actual selected inventory and declines budget, locality or size assumptions',()=>{
 const p={...validateProperty(property),id:'one'};
 const buyer={propertyType:'plot',location:'Raipur',area:'Daldal Seoni',size:'1200 वर्गफुट',budgetInr:2000000};
 assert.equal(matchCampaignProperties([p],buyer).length,1);
 for(const change of [{budgetInr:1600000},{location:'Pune'},{area:'Unknown area'},{size:'1200'},
  {size:'1200 sqm'},{propertyType:'flat'},{budgetInr:'2000000'}])assert.equal(matchCampaignProperties([p],{...buyer,...change}).length,0,JSON.stringify(change));
 assert.equal(matchCampaignProperties([{...p,priceBasis:'per_sqft',priceMinInr:1500,priceMaxInr:1800}],buyer).length,0);
 assert.equal(matchCampaignProperties([{...p,status:'sold'}],buyer).length,0);
 const flat={...p,propertyType:'flat',bhk:2};
 assert.equal(matchCampaignProperties([flat],{...buyer,propertyType:'flat',size:'2BHK'}).length,1);
 assert.equal(matchCampaignProperties([flat],{...buyer,propertyType:'flat',size:'3BHK'}).length,0);
});
