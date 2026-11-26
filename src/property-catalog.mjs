// Client-owned inventory and private marketing media. Does not change calling scripts,
// create customer permission, fetch arbitrary URLs, or send external messages.
import {requireMembership,mutationOriginAllowed} from './human-auth.mjs';
import {resolveCrmDb,normalizeIndianPhone,parseJsonBody,sha256hex} from './core.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PATHS=new Set(['/v1/human/properties','/v1/human/property-assets','/v1/human/property-assets/retire','/v1/human/campaign-properties']);
const HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const TEXT_FIELDS={name:160,city:120,locality:160,address:500,mapUrl:2000,description:3000,amenities:1500,contactName:160,contactPhone:32,websiteUrl:2000};
const FIELDS=[...Object.keys(TEXT_FIELDS),'propertyType','cityAliases','localityAliases','priceMinInr','priceMaxInr','priceBasis','sizeMin','sizeMax','sizeUnit','bhk','status'];
const COLUMNS=['name','property_type','city','city_aliases_json','locality','locality_aliases_json','address','map_url','price_min_inr','price_max_inr','price_basis','size_min','size_max','size_unit','bhk','description','amenities','contact_name','contact_phone','website_url','status'];
const VALUES=['name','propertyType','city','cityAliases','locality','localityAliases','address','mapUrl','priceMinInr','priceMaxInr','priceBasis','sizeMin','sizeMax','sizeUnit','bhk','description','amenities','contactName','contactPhone','websiteUrl','status'];
const SELECT='p.id,p.name,p.property_type AS propertyType,p.city,p.city_aliases_json AS cityAliasesJson,p.locality,p.locality_aliases_json AS localityAliasesJson,p.address,p.map_url AS mapUrl,'+
 'p.price_min_inr AS priceMinInr,p.price_max_inr AS priceMaxInr,p.price_basis AS priceBasis,'+
 'p.size_min AS sizeMin,p.size_max AS sizeMax,p.size_unit AS sizeUnit,p.bhk,p.description,p.amenities,'+
 'p.contact_name AS contactName,p.contact_phone AS contactPhone,p.website_url AS websiteUrl,p.status,'+
 'p.revision,p.created_at AS createdAt,p.updated_at AS updatedAt';
const ASSET_SELECT='a.id,a.property_id AS propertyId,a.kind,a.file_name AS fileName,a.content_type AS contentType,a.size_bytes AS sizeBytes';
const json=(value,status=200)=>Response.json(value,{status,headers:HEADERS});
const fail=(error,status=400)=>json({error},status);
const reject=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0;
const at=now=>new Date(now).toISOString();
function keys(value,allowed){if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k)))reject('invalid_fields')}
function query(url,allowed){
 if([...url.searchParams.keys()].some(k=>!allowed.includes(k)||url.searchParams.getAll(k).length!==1))reject('invalid_query');
 return Object.fromEntries(url.searchParams);
}
async function bytes(req,maximum){
 if(!req.body)reject('request_body_required');
 const length=req.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maximum))reject('file_or_request_too_large',413);
 const reader=req.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
  if(size>maximum){await reader.cancel();reject('file_or_request_too_large',413)}chunks.push(value)}}
 finally{reader.releaseLock()}
 if(!size)reject('request_body_required');
 const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength}return out;
}
async function read(req){
 if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')reject('invalid_json');
 return parseJsonBody(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(req,18000)),18000);
}
function cleanText(value,label,max){
 if(value===undefined||value===null)return '';
 if(typeof value!=='string'||value.length>max||/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value))reject('invalid_'+label);
 return value.trim();
}
export function propertyHttpsUrl(value,label='url'){
 if(!value)return '';
 if(typeof value!=='string'||value.length>2000||/[\u0000-\u0020\u007f<>]/u.test(value))reject('invalid_'+label);
 let u;try{u=new URL(value)}catch{reject('invalid_'+label)}
 // URLs are links only; nothing here fetches client-provided hosts.
 if(u.protocol!=='https:'||u.username||u.password||u.hostname==='localhost'||
  /(?:^|\.)(?:localhost|local|internal)$/i.test(u.hostname)||!u.hostname.includes('.')||
  /^[\d.]+$/.test(u.hostname)||u.hostname.includes(':'))reject('invalid_'+label);
 return u.href;
}
function number(value,label,{integer=false,maximum=1e12}={}){
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>maximum||integer&&!Number.isSafeInteger(value))reject('invalid_'+label);
 return value;
}
export function validateProperty(input){
 keys(input,FIELDS);const p={};
 for(const [field,max] of Object.entries(TEXT_FIELDS))p[field]=cleanText(input[field],field,max);
 if(!p.name||!p.city)reject('property_name_and_city_required');
 if(!['plot','flat','house'].includes(input.propertyType))reject('invalid_property_type');
 p.propertyType=input.propertyType;
 for(const [field,max] of [['cityAliases',120],['localityAliases',160]]){
  const aliases=input[field]??[];
  if(!Array.isArray(aliases)||aliases.length>5)reject('invalid_'+field);
  p[field]=aliases.map(alias=>cleanText(alias,field,max));
  if(p[field].some(alias=>!alias)||new Set(p[field].map(comparable)).size!==p[field].length)reject('invalid_'+field);
 }
 p.priceBasis=input.priceBasis??'on_request';
 p.sizeUnit=input.sizeUnit??'sqft';p.status=input.status??'available';
 if(!['total','per_sqft','per_sqm','on_request'].includes(p.priceBasis)||
  !['sqft','sqm','sqyd','acre'].includes(p.sizeUnit)||!['available','paused','sold'].includes(p.status))reject('invalid_property_options');
 p.priceMinInr=number(input.priceMinInr,'price_min',{integer:true});
 p.priceMaxInr=number(input.priceMaxInr??input.priceMinInr,'price_max',{integer:true});
 if(p.priceBasis==='on_request'?(p.priceMinInr!==null||p.priceMaxInr!==null):
  p.priceMinInr===null||p.priceMaxInr===null||p.priceMaxInr<p.priceMinInr)reject('invalid_price_range');
 p.sizeMin=number(input.sizeMin,'size_min',{maximum:1e8});p.sizeMax=number(input.sizeMax??input.sizeMin,'size_max',{maximum:1e8});
 if((p.sizeMin===null)!==(p.sizeMax===null)||p.sizeMin!==null&&p.sizeMax<p.sizeMin)reject('invalid_size_range');
 p.bhk=number(input.bhk,'bhk',{integer:true,maximum:20});
 if(p.propertyType==='plot'&&p.bhk!==null)reject('bhk_not_applicable_to_plot');
 p.mapUrl=propertyHttpsUrl(p.mapUrl,'map_url');p.websiteUrl=propertyHttpsUrl(p.websiteUrl,'website_url');
 if(p.contactPhone){try{p.contactPhone=normalizeIndianPhone(p.contactPhone)}catch{reject('invalid_contact_phone')}}
 return p;
}

async function access(env,user,tenantId,write,now){
 if(!UUID.test(tenantId||''))reject('invalid_tenant');
 if(user?.globalRole==='super_admin'){
  const fresh=await env.CONTROL_DB.prepare('SELECT m.enabled_at FROM human_mfa_settings m JOIN human_sessions s ON s.user_id=m.user_id WHERE m.user_id=? AND s.token_hash=? AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1')
   .bind(user.id,user.token_hash,now).first();
  if(!fresh)reject('current_super_admin_mfa_required',403);
  const tenant=await env.CONTROL_DB.prepare("SELECT id AS tenant_id,storage_mode,dedicated_binding,status FROM tenants WHERE id=? AND status IN('trial','active')")
   .bind(tenantId).first();if(!tenant)reject('tenant_unavailable',404);
  return {tenant,db:resolveCrmDb(env,tenant),canEdit:true};
 }
 const tenant=await requireMembership(env.CONTROL_DB,user,tenantId,write);
 if(!tenant)reject('forbidden',403);
 return {tenant,db:resolveCrmDb(env,tenant),canEdit:tenant.role==='client_admin'};
}
async function tenantDb(env,tenantId){
 if(!UUID.test(tenantId||''))reject('invalid_tenant');
 const tenant=await env.CONTROL_DB.prepare("SELECT id AS tenant_id,storage_mode,dedicated_binding,status FROM tenants WHERE id=? AND status IN('trial','active')")
  .bind(tenantId).first();if(!tenant)reject('tenant_unavailable',404);return resolveCrmDb(env,tenant);
}
function assetValue(row,tenantId){
 return {id:row.id,kind:row.kind,fileName:row.fileName,contentType:row.contentType,sizeBytes:row.sizeBytes,
  downloadUrl:'/v1/human/property-assets?'+new URLSearchParams({tenantId,assetId:row.id})};
}
async function withAssets(db,tenantId,rows){
 if(!rows.length)return [];
 const assets=[];
 // Keep each statement below D1's binding limit even on the largest list page.
 for(let offset=0;offset<rows.length;offset+=80){
  const ids=rows.slice(offset,offset+80).map(r=>r.id),result=await db.prepare('SELECT '+ASSET_SELECT+' FROM property_assets a WHERE a.tenant_id=? AND a.active=1 AND a.property_id IN('+ids.map(()=>'?').join(',')+') ORDER BY a.created_at,a.id')
   .bind(tenantId,...ids).all();assets.push(...result.results);
 }
 return rows.map(row=>{
  const {cityAliasesJson,localityAliasesJson,...p}=row;
  return {...p,cityAliases:JSON.parse(cityAliasesJson||'[]'),localityAliases:JSON.parse(localityAliasesJson||'[]'),
   assets:assets.filter(a=>a.propertyId===row.id).map(a=>assetValue(a,tenantId))};
 });
}
export async function getProperty(db,tenantId,propertyId){
 const row=await db.prepare('SELECT '+SELECT+' FROM properties p WHERE p.tenant_id=? AND p.id=?').bind(tenantId,propertyId).first();
 return row?(await withAssets(db,tenantId,[row]))[0]:null;
}
export async function getCampaignProperties(db,tenantId,campaignId,{availableOnly=true}={}){
 const result=await db.prepare('SELECT '+SELECT+' FROM campaign_properties cp JOIN properties p ON p.tenant_id=cp.tenant_id AND p.id=cp.property_id WHERE cp.tenant_id=? AND cp.campaign_id=?'+
  (availableOnly?" AND p.status='available'":'')+' ORDER BY cp.position LIMIT 3').bind(tenantId,campaignId).all();
 return withAssets(db,tenantId,result.results);
}
async function propertyRoute(req,env,user,url,now){
 const d=req.method==='GET'?query(url,['tenantId','id','limit','offset']):await read(req);
 keys(d,req.method==='GET'?['tenantId','id','limit','offset']:['tenantId','id','expectedRevision','property']);
 if(d.id!==undefined&&!UUID.test(d.id))reject('invalid_property_id');
 const {db,canEdit}=await access(env,user,d.tenantId,req.method==='POST',now),tid=d.tenantId;
 if(req.method==='GET'){
  if(d.id){const property=await getProperty(db,tid,d.id);if(!property)reject('property_not_found',404);return json({tenantId:tid,properties:[property],property,canEdit,hasMore:false})}
  const limit=d.limit===undefined?50:Number(d.limit),offset=d.offset===undefined?0:Number(d.offset);
  if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>100000)reject('invalid_pagination');
  const rows=await db.prepare('SELECT '+SELECT+' FROM properties p WHERE p.tenant_id=? ORDER BY p.updated_at DESC,p.id LIMIT ? OFFSET ?').bind(tid,limit+1,offset).all();
  const campaigns=await db.prepare('SELECT id,name FROM call_campaign_drafts WHERE tenant_id=? ORDER BY created_at DESC,id LIMIT 100').bind(tid).all();
  return json({tenantId:tid,properties:await withAssets(db,tid,rows.results.slice(0,limit)),campaigns:campaigns.results,canEdit,hasMore:rows.results.length>limit});
 }
 if(!revision(d.expectedRevision)||(!d.id&&d.expectedRevision!==0)||(d.id&&d.expectedRevision<1))reject('invalid_revision');
 const p=validateProperty(d.property),id=d.id||crypto.randomUUID(),op=crypto.randomUUID(),time=at(now);
 let statement;
 if(d.id){
  const exists=await db.prepare('SELECT id FROM properties WHERE tenant_id=? AND id=?').bind(tid,id).first();if(!exists)reject('property_not_found',404);
  statement=db.prepare('UPDATE properties SET '+COLUMNS.map(c=>c+'=?').join(',')+',revision=revision+1,last_write_id=?,updated_by=?,updated_at=? WHERE tenant_id=? AND id=? AND revision=?')
   .bind(...VALUES.map(v=>Array.isArray(p[v])?JSON.stringify(p[v]):p[v]),op,user.id,time,tid,id,d.expectedRevision);
 }else statement=db.prepare('INSERT INTO properties(tenant_id,id,'+COLUMNS.join(',')+',revision,last_write_id,created_by,updated_by,created_at,updated_at) VALUES('+Array(COLUMNS.length+8).fill('?').join(',')+')')
  .bind(tid,id,...VALUES.map(v=>Array.isArray(p[v])?JSON.stringify(p[v]):p[v]),1,op,user.id,user.id,time,time);
 const result=await db.batch([statement,
  db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) SELECT tenant_id,?,'human:'||?,'property.saved',id,? FROM properties WHERE tenant_id=? AND id=? AND last_write_id=?")
   .bind(crypto.randomUUID(),user.id,time,tid,id,op)]);
 if(Number(result[0]?.meta?.changes)!==1)reject('property_changed_refresh_first',409);
 return json({saved:true,property:await getProperty(db,tid,id)},d.id?200:201);
}
async function campaignRoute(req,env,user,url,now){
 const d=req.method==='GET'?query(url,['tenantId','campaignId']):await read(req);
 keys(d,req.method==='GET'?['tenantId','campaignId']:['tenantId','campaignId','expectedRevision','propertyIds']);
 if(!UUID.test(d.campaignId||''))reject('invalid_campaign_id');
 const {db}=await access(env,user,d.tenantId,req.method==='POST',now),tid=d.tenantId,cid=d.campaignId;
 if(!await db.prepare('SELECT id FROM call_campaign_drafts WHERE tenant_id=? AND id=?').bind(tid,cid).first())reject('campaign_not_found',404);
 if(req.method==='POST'){
  if(!revision(d.expectedRevision)||!Array.isArray(d.propertyIds)||d.propertyIds.length>3||d.propertyIds.some(id=>!UUID.test(id))||new Set(d.propertyIds).size!==d.propertyIds.length)reject('invalid_campaign_properties');
  const ids=d.propertyIds,op=crypto.randomUUID(),time=at(now);
  // Validation is repeated inside the compare-and-swap statement so a property
  // becoming sold/paused between the preview and the write cannot be selected.
  const availability=ids.length?' AND (SELECT COUNT(*) FROM properties WHERE tenant_id=? AND id IN('+ids.map(()=>'?').join(',')+") AND status='available')=?":'';
  const args=ids.length?[tid,...ids,ids.length]:[];
  const settings=db.prepare('INSERT INTO campaign_property_settings(tenant_id,campaign_id,revision,last_write_id,updated_by,updated_at) SELECT ?,?,1,?,?,? WHERE (?=0 OR EXISTS(SELECT 1 FROM campaign_property_settings WHERE tenant_id=? AND campaign_id=? AND revision=?))'+availability+
   ' ON CONFLICT(tenant_id,campaign_id) DO UPDATE SET revision=campaign_property_settings.revision+1,last_write_id=excluded.last_write_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at WHERE campaign_property_settings.revision=?')
   .bind(tid,cid,op,user.id,time,d.expectedRevision,tid,cid,d.expectedRevision,...args,d.expectedRevision);
  const guard='EXISTS(SELECT 1 FROM campaign_property_settings s WHERE s.tenant_id=? AND s.campaign_id=? AND s.last_write_id=?)';
  const rows=[settings,db.prepare('DELETE FROM campaign_properties WHERE tenant_id=? AND campaign_id=? AND '+guard).bind(tid,cid,tid,cid,op)];
  ids.forEach((id,i)=>rows.push(db.prepare('INSERT INTO campaign_properties(tenant_id,campaign_id,property_id,position) SELECT ?,?,?,? WHERE '+guard).bind(tid,cid,id,i,tid,cid,op)));
  rows.push(db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) SELECT ?,?,'human:'||?,'campaign.properties_saved',?,? WHERE "+guard).bind(tid,crypto.randomUUID(),user.id,cid,time,tid,cid,op));
  const results=await db.batch(rows);if(Number(results[0]?.meta?.changes)!==1)reject('campaign_or_property_changed_refresh_first',409);
 }
 const settings=await db.prepare('SELECT revision FROM campaign_property_settings WHERE tenant_id=? AND campaign_id=?').bind(tid,cid).first();
 const properties=await getCampaignProperties(db,tid,cid,{availableOnly:false});
 return json({tenantId:tid,campaignId:cid,revision:settings?.revision||0,propertyIds:properties.map(p=>p.id),properties,...(req.method==='POST'?{saved:true}:{})});
}

function validMagic(data,type){
 if(type==='application/pdf')return new TextDecoder().decode(data.subarray(0,5))==='%PDF-';
 if(type==='image/jpeg')return data[0]===255&&data[1]===216&&data[2]===255;
 if(type==='image/png')return [137,80,78,71,13,10,26,10].every((b,i)=>data[i]===b);
 return type==='image/webp'&&new TextDecoder().decode(data.subarray(0,4))==='RIFF'&&new TextDecoder().decode(data.subarray(8,12))==='WEBP';
}
function assetKey(tid,pid,aid){return 'tenant-properties/'+tid+'/'+pid+'/'+aid}
async function readAsset(env,db,tid,aid){
 const row=await db.prepare('SELECT '+ASSET_SELECT+',a.object_key AS objectKey FROM property_assets a WHERE a.tenant_id=? AND a.id=? AND a.active=1').bind(tid,aid).first();
 if(!row||row.objectKey!==assetKey(tid,row.propertyId,aid))reject('asset_not_found',404);
 const object=await env.RECORDINGS?.get(row.objectKey);if(!object)reject('asset_not_found',404);
 return {row,object};
}
function mediaResponse(row,object,head=false){
 return new Response(head?null:object.body,{headers:{...HEADERS,'Content-Type':row.contentType,
  'Content-Length':String(row.sizeBytes),'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(row.fileName),
  'Content-Security-Policy':"default-src 'none'; sandbox"}});
}
async function assetRoute(req,env,user,url,now){
 const d=query(url,req.method==='GET'?['tenantId','assetId']:['tenantId','propertyId','expectedRevision','kind','fileName']);
 const {db}=await access(env,user,d.tenantId,req.method==='POST',now),tid=d.tenantId;
 if(req.method==='GET'){
  if(!UUID.test(d.assetId||''))reject('invalid_asset_id');
  const {row,object}=await readAsset(env,db,tid,d.assetId);return mediaResponse(row,object);
 }
 if(!UUID.test(d.propertyId||'')||!['brochure','photo'].includes(d.kind)||!/^\d+$/.test(d.expectedRevision||''))reject('invalid_asset_request');
 const expected=Number(d.expectedRevision);if(!revision(expected)||expected<1)reject('invalid_revision');
 const fileName=cleanText(d.fileName,'file_name',120);
 if(!fileName||/[\\/\r\n]/.test(fileName))reject('invalid_file_name');
 const contentType=req.headers.get('content-type')?.split(';')[0].trim();
 if(d.kind==='brochure'?contentType!=='application/pdf':!['image/jpeg','image/png','image/webp'].includes(contentType))reject('unsupported_media_type',415);
 const property=await db.prepare('SELECT revision FROM properties WHERE tenant_id=? AND id=?').bind(tid,d.propertyId).first();
 if(!property)reject('property_not_found',404);if(property.revision!==expected)reject('property_changed_refresh_first',409);
 if(!env.RECORDINGS?.put)reject('property_storage_unavailable',503);
 const data=await bytes(req,d.kind==='brochure'?10*1024*1024:3*1024*1024);
 if(!validMagic(data,contentType))reject('file_content_does_not_match_type',415);
 const id=crypto.randomUUID(),op=crypto.randomUUID(),key=assetKey(tid,d.propertyId,id),time=at(now);
 let committed=false;
 try{
  await env.RECORDINGS.put(key,data,{httpMetadata:{contentType},customMetadata:{tenantId:tid,propertyId:d.propertyId,assetId:id}});
  const guard='EXISTS(SELECT 1 FROM properties p WHERE p.tenant_id=? AND p.id=? AND p.last_write_id=?)';
  const rows=[db.prepare('UPDATE properties SET revision=revision+1,last_write_id=?,updated_by=?,updated_at=? WHERE tenant_id=? AND id=? AND revision=?'+
   (d.kind==='photo'?" AND (SELECT COUNT(*) FROM property_assets WHERE tenant_id=? AND property_id=? AND kind='photo' AND active=1)<5":''))
   .bind(op,user.id,time,tid,d.propertyId,expected,...(d.kind==='photo'?[tid,d.propertyId]:[]))];
  if(d.kind==='brochure')rows.push(db.prepare("UPDATE property_assets SET active=0 WHERE tenant_id=? AND property_id=? AND kind='brochure' AND active=1 AND "+guard).bind(tid,d.propertyId,tid,d.propertyId,op));
  rows.push(db.prepare('INSERT INTO property_assets(tenant_id,id,property_id,kind,file_name,content_type,size_bytes,object_key,active,created_by,created_at) SELECT ?,?,?,?,?,?,?,?,1,?,? WHERE '+guard)
   .bind(tid,id,d.propertyId,d.kind,fileName,contentType,data.byteLength,key,user.id,time,tid,d.propertyId,op));
  rows.push(db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) SELECT ?,?,'human:'||?,'property.media_uploaded',?,? WHERE "+guard).bind(tid,crypto.randomUUID(),user.id,d.propertyId,time,tid,d.propertyId,op));
  const results=await db.batch(rows);if(Number(results[0]?.meta?.changes)!==1)reject('property_changed_or_photo_limit_reached',409);
  committed=true;
  return json({asset:assetValue({id,kind:d.kind,fileName,contentType,sizeBytes:data.byteLength},tid),revision:expected+1},201);
 }finally{if(!committed)try{await env.RECORDINGS.delete(key)}catch{}}
}

async function retireAsset(req,env,user,now){
 const d=await read(req);keys(d,['tenantId','propertyId','assetId','expectedRevision']);
 if(!UUID.test(d.propertyId||'')||!UUID.test(d.assetId||'')||!revision(d.expectedRevision)||d.expectedRevision<1)reject('invalid_asset_request');
 const {db}=await access(env,user,d.tenantId,true,now),tid=d.tenantId,op=crypto.randomUUID(),time=at(now);
 const asset=await db.prepare('SELECT id FROM property_assets WHERE tenant_id=? AND property_id=? AND id=? AND active=1').bind(tid,d.propertyId,d.assetId).first();
 if(!asset)reject('asset_not_found',404);
 const guard='EXISTS(SELECT 1 FROM properties p WHERE p.tenant_id=? AND p.id=? AND p.last_write_id=?)';
 const rows=await db.batch([
  db.prepare('UPDATE properties SET revision=revision+1,last_write_id=?,updated_by=?,updated_at=? WHERE tenant_id=? AND id=? AND revision=? AND EXISTS(SELECT 1 FROM property_assets a WHERE a.tenant_id=? AND a.property_id=? AND a.id=? AND a.active=1)')
   .bind(op,user.id,time,tid,d.propertyId,d.expectedRevision,tid,d.propertyId,d.assetId),
  db.prepare('UPDATE property_assets SET active=0 WHERE tenant_id=? AND property_id=? AND id=? AND active=1 AND '+guard)
   .bind(tid,d.propertyId,d.assetId,tid,d.propertyId,op),
  db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) SELECT ?,?,'human:'||?,'property.media_retired',?,? WHERE "+guard)
   .bind(tid,crypto.randomUUID(),user.id,d.propertyId,time,tid,d.propertyId,op)
 ]);
 if(Number(rows[0]?.meta?.changes)!==1||Number(rows[1]?.meta?.changes)!==1)reject('property_changed_refresh_first',409);
 return json({retired:true,assetId:d.assetId,revision:d.expectedRevision+1});
}

export async function handlePropertyCatalog(req,env,user,{now=Date.now()}={}){
 const url=new URL(req.url);if(!PATHS.has(url.pathname))return null;
 if(!['GET','POST'].includes(req.method)||url.pathname.endsWith('/retire')&&req.method!=='POST')return fail('method_not_allowed',405);
 if(req.method==='POST'&&!mutationOriginAllowed(req))return fail('same_origin_required',403);
 try{
  if(!Number.isSafeInteger(now)||now<0)reject('invalid_time');
  if(url.pathname==='/v1/human/properties')return await propertyRoute(req,env,user,url,now);
  if(url.pathname==='/v1/human/campaign-properties')return await campaignRoute(req,env,user,url,now);
  if(url.pathname.endsWith('/retire'))return await retireAsset(req,env,user,now);
  return await assetRoute(req,env,user,url,now);
 }catch(e){
  if(e.status)return fail(e.message,e.status);
  if(/invalid|JSON|request body|expected JSON|encoded data/i.test(e.message))return fail('invalid_request');
  console.error('AR3D property catalogue unavailable');return fail('property_catalog_unavailable',503);
 }
}

// Explicit server-side share issuance for provider media fetches. A random
// 256-bit capability is hashed at rest, scoped to one asset and expires quickly.
// Existing voice recordings are never addressable through these routes.
export async function createPropertyAssetShare(env,{tenantId,assetId,origin,ttlSeconds=3600},{now=Date.now()}={}){
 if(!UUID.test(assetId||'')||!Number.isSafeInteger(now)||!Number.isInteger(ttlSeconds)||ttlSeconds<60||ttlSeconds>86400)reject('invalid_media_share');
 const base=propertyHttpsUrl(origin,'share_origin'),u=new URL(base);
 if(u.origin!==base.replace(/\/$/,''))reject('invalid_share_origin');
 const db=await tenantDb(env,tenantId);
 const row=await db.prepare('SELECT '+ASSET_SELECT+' FROM property_assets a JOIN properties p ON p.tenant_id=a.tenant_id AND p.id=a.property_id WHERE a.tenant_id=? AND a.id=? AND a.active=1 AND p.status=\'available\'')
  .bind(tenantId,assetId).first();if(!row)reject('available_property_media_not_found',404);
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const hash=await sha256hex(token),expires=now+ttlSeconds*1000;
 await db.batch([
  db.prepare('DELETE FROM property_media_shares WHERE tenant_id=? AND expires_at<=?').bind(tenantId,now),
  db.prepare('INSERT INTO property_media_shares(tenant_id,token_hash,asset_id,expires_at,created_at) VALUES(?,?,?,?,?)').bind(tenantId,hash,assetId,expires,now)
 ]);
 const url=new URL('/v1/property-media',u.origin);url.search=new URLSearchParams({tenantId,assetId,token}).toString();
 return {url:url.href,expiresAt:at(expires),asset:assetValue(row,tenantId)};
}
export async function handlePublicPropertyMedia(req,env,{now=Date.now()}={}){
 const url=new URL(req.url);if(url.pathname!=='/v1/property-media')return null;
 if(!['GET','HEAD'].includes(req.method))return fail('method_not_allowed',405);
 try{
  const d=query(url,['tenantId','assetId','token']);
  if(!UUID.test(d.tenantId||'')||!UUID.test(d.assetId||'')||!/^[a-f0-9]{64}$/.test(d.token||''))return fail('media_link_unavailable',404);
  const db=await tenantDb(env,d.tenantId),hash=await sha256hex(d.token);
  const share=await db.prepare('SELECT s.asset_id FROM property_media_shares s JOIN property_assets a ON a.tenant_id=s.tenant_id AND a.id=s.asset_id JOIN properties p ON p.tenant_id=a.tenant_id AND p.id=a.property_id WHERE s.tenant_id=? AND s.token_hash=? AND s.asset_id=? AND s.expires_at>? AND a.active=1 AND p.status=\'available\'')
   .bind(d.tenantId,hash,d.assetId,now).first();if(!share)return fail('media_link_unavailable',404);
  const {row,object}=await readAsset(env,db,d.tenantId,d.assetId);return mediaResponse(row,object,req.method==='HEAD');
 }catch{return fail('media_link_unavailable',404)}
}

const comparable=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[\p{P}\p{Z}\s]+/gu,' ').trim();
function requestedSize(value){
 if(typeof value!=='string')return null;
 const match=value.trim().match(/^(\d+(?:\.\d+)?)\s*(sq\.?\s*ft|sqft|square\s+feet|वर्ग\s*फुट|वर्गफुट|sq\.?\s*m|sqm|square\s+met(?:er|re)s?|वर्ग\s*मीटर|sq\.?\s*yd|sqyd|square\s+yards?|acre|acres|एकड़)$/iu);
 if(!match)return null;const unit=comparable(match[2]);
 return {size:Number(match[1]),unit:/acre|एकड़/u.test(unit)?'acre':/yd|yard/u.test(unit)?'sqyd':/sqm|sq m|meter|metre|मीटर/u.test(unit)?'sqm':'sqft'};
}
export function matchCampaignProperties(properties,preferences){
 if(!Array.isArray(properties)||!object(preferences))return [];
 const type=preferences.propertyType,city=comparable(preferences.location??preferences.preferredLocation),area=comparable(preferences.area);
 if(!['plot','flat','house'].includes(type)||!city)return [];
 const max=preferences.budgetInr??preferences.budgetMaxInr??null,min=preferences.budgetMinInr??null;
 if([max,min].some(v=>v!==null&&(!Number.isSafeInteger(v)||v<=0))||max!==null&&min!==null&&min>max)return [];
 const size=preferences.size??preferences.plotSizePreference;
 const bhk=preferences.bhk??(typeof size==='string'&&/^\d{1,2}\s*BHK$/i.test(size.trim())?Number.parseInt(size,10):null);
 const plotSize=type==='plot'&&size?requestedSize(size):null;
 if(type==='plot'&&size&&!plotSize||type!=='plot'&&size&&!bhk)return [];
 return properties.filter(p=>{
  if(p.status!=='available'||p.propertyType!==type||![p.city,...(p.cityAliases||[])].some(v=>comparable(v)===city)||
   area&&![p.locality,...(p.localityAliases||[])].some(v=>comparable(v)===area))return false;
  if((max!==null||min!==null)&&(p.priceBasis!=='total'||p.priceMinInr===null||p.priceMaxInr===null||max!==null&&p.priceMaxInr>max||min!==null&&p.priceMinInr<min))return false;
  if(bhk!==null&&p.bhk!==bhk)return false;
  if(plotSize&&(p.sizeUnit!==plotSize.unit||p.sizeMin===null||p.sizeMax===null||plotSize.size<p.sizeMin||plotSize.size>p.sizeMax))return false;
  return true;
 }).slice(0,3);
}
