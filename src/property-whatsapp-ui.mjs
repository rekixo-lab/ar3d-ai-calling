// Browser functions are included in the existing authenticated app bundle.
// Keep user-provided content as text, and never return provider secrets in UI state.
export const propertyWhatsAppJs=String.raw`
function pwField(name,type='text',placeholder='',required=false){
 const field=input(name,type,placeholder);field.required=required;return field;
}
function pwSelect(name,options,value=''){
 const field=node('select',{class:'field',name});
 field.append(...options.map(([v,t])=>node('option',{value:v,text:t})));
 field.value=value;return field;
}
function pwLink(url,label){
 try{
  const u=new URL(url,location.origin);
  if(u.username||u.password||!(u.protocol==='https:'||(u.origin===location.origin&&u.pathname.startsWith('/v1/human/'))))return node('span',{class:'muted',text:label+' unavailable'});
  return node('a',{href:u.href,target:'_blank',rel:'noopener noreferrer',text:label});
 }catch{return node('span',{class:'muted',text:label+' unavailable'})}
}
function pwIstValue(value){const d=new Date(value);return Number.isFinite(d.getTime())?new Date(d.getTime()+330*60000).toISOString().slice(0,16):''}
function pwIstIso(value){const d=new Date(value+':00+05:30');if(!value||!Number.isFinite(d.getTime()))throw Error('Enter a valid date and time in India time.');return d.toISOString()}
function pwNumber(field){return field.value.trim()===''?null:Number(field.value)}
function pwStatus(value){
 const labels={not_connected:'Setup needed',connected:'Connected',paused:'Paused',available:'Available',sold:'Sold',scheduled:'Scheduled',queued:'Scheduled',pending_setup:'Setup needed',submitted:'Submitted to WhatsApp',delivered:'Delivered',read:'Read',replied:'Customer replied',cancelled:'Cancelled',failed:'Failed',unknown:'Delivery not confirmed',granted:'Permission recorded',revoked:'Permission withdrawn'};
 return node('span',{class:'badge '+(['connected','available','delivered','read','granted'].includes(value)?'positive':['failed','revoked','sold'].includes(value)?'negative':'pending'),text:labels[value]||String(value||'Unknown').replaceAll('_',' ')});
}
function pwError(error){
 const messages={not_connected:'Connect this company’s WhatsApp account first.',webhook_not_verified:'Finish the Meta webhook setup before enabling messages.',permission_required:'Record the customer’s existing message permission first.',consent_required:'Record the customer’s existing message permission first.',template_unavailable:'Choose a compatible approved template.',property_unavailable:'This property is no longer available. Choose an available property.',property_changed:'This property changed. Refresh and review its latest information.',revision_conflict:'Someone changed this record. Refresh and try again.',super_admin_required:'Ask the Super Admin to finish the account connection.',property_changed_refresh_first:'This property changed. Refresh it before saving.',property_changed_or_photo_limit_reached:'Refresh this property. Remove an old photo if five photos are already saved.',campaign_or_property_changed_refresh_first:'The campaign or property changed. Refresh the selection.',file_or_request_too_large:'Choose a file within the displayed size limit.',unsupported_media_type:'Choose a PDF brochure or a JPEG, PNG or WebP photo.',file_content_does_not_match_type:'The file contents do not match its file type.',invalid_file_name:'Use a shorter file name without special characters.',property_storage_unavailable:'Property file storage is temporarily unavailable. Try again.'};
 return messages[error?.code]||messages[error?.message]||error?.message||'Could not complete this action.';
}
function pwFormAction(form,button,task){
 let busy=false;
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!form.reportValidity())return;busy=true;button.disabled=true;
  try{await task()}catch(error){notice(pwError(error),true)}finally{busy=false;button.disabled=false}
 });
}
async function propertyWhatsAppAdminPanel(content,client,section){
 const controls=div('card'),area=div('stack');content.append(controls,area);
 const search=pwField('propertyWhatsAppCompanySearch','search','Find company by name or email');search.maxLength=80;
 const company=pwSelect('propertyWhatsAppCompany',[]);company.setAttribute('aria-label','Property and WhatsApp company');
 let version=0;
 async function open(){
  const id=company.value;area.replaceChildren();if(!id){area.append(node('p',{class:'note',text:'Choose an active client company.'}));return}
  const target=div('stack');area.append(target);
  if(section==='properties')await propertyCatalogPanel(id,target,'super_admin');else await whatsappFollowupPanel(id,target,'super_admin');
 }
 async function find(){
  const seq=++version,previous=company.value;
  const result=client?{tenants:[client]}:await api('/v1/human/tenants?'+new URLSearchParams({q:search.value.trim(),limit:'100'}));
  if(seq!==version||!controls.isConnected)return;
  company.replaceChildren(...result.tenants.filter(t=>['active','trial'].includes(t.status)).map(t=>node('option',{value:t.id,text:t.display_name})));
  if([...company.options].some(x=>x.value===previous))company.value=previous;
  await open();
 }
 if(client){controls.hidden=true;company.append(node('option',{value:client.id,text:client.display_name}));await open();return}
 controls.append(title('Choose a client','h3'),div('formrow',lab('Search clients',search),btn('Find client',()=>find().catch(asError),true)),lab('Client company',company));
 search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();find().catch(asError)}});
 company.addEventListener('change',()=>open().catch(asError));await find();
}
async function propertyCatalogPanel(tenantId,content,role){
 const canManage=['client_admin','super_admin'].includes(role);
 const header=div('card',div('row between',title('My Properties'),node('span',{class:'badge',text:'Your company catalogue'})),
  node('p',{class:'muted',text:'अपनी property की सही कीमत, location और brochure यहाँ रखें। Campaign में इन्हीं properties में से चुनें।'}));
 const editor=div('stack'),listing=div('property-catalog-grid'),paging=div('formrow');
 const catalogue=div('card',title('Property catalogue','h3'),listing,paging);
 const mapping=div('card');content.append(header,editor,catalogue,mapping);
 let records=[],offset=0,canEdit=canManage,sequence=0;
 const add=btn('Add property',()=>editProperty(null)),refresh=btn('Refresh properties',()=>load().catch(asError),true);
 header.append(div('formrow',...(canManage?[add]:[]),refresh));
 const previous=btn('Previous properties',()=>{offset=Math.max(0,offset-50);load().catch(asError)},true);
 const next=btn('Next properties',()=>{offset+=50;load().catch(asError)},true);paging.append(previous,next);
 function price(p){
  if(p.priceBasis==='on_request'||p.priceMinInr==null)return 'Price on request';
  const money=v=>'₹'+Number(v).toLocaleString('en-IN');
  return money(p.priceMinInr)+(p.priceMaxInr!=null&&p.priceMaxInr!==p.priceMinInr?' – '+money(p.priceMaxInr):'')+({per_sqft:' / sqft',per_sqm:' / sqm',total:' total'}[p.priceBasis]||'');
 }
 function render(){
  listing.replaceChildren(...records.map(p=>{
   const photo=(p.assets||[]).find(a=>a.kind==='photo');
   const box=node('article',{class:'property-catalog-item'},[
    ...(photo?[node('img',{src:photo.downloadUrl,alt:p.name+' property photo',loading:'lazy',class:'property-photo'})]:[]),
    div('stack',div('row between',node('h3',{text:p.name}),pwStatus(p.status)),
     node('p',{class:'muted',text:[p.city,p.locality].filter(Boolean).join(' · ')}),
     node('strong',{text:price(p)}),
     node('p',{class:'muted',text:[p.propertyType,p.bhk?p.bhk+' BHK':'',p.sizeMin!=null?p.sizeMin+(p.sizeMax!=null&&p.sizeMax!==p.sizeMin?'–'+p.sizeMax:'')+' '+p.sizeUnit:''].filter(Boolean).join(' · ')}),
     ...(p.description?[node('p',{class:'property-description',text:p.description})]:[]),
     div('formrow',...(p.mapUrl?[pwLink(p.mapUrl,'View location')]:[]),...(p.assets||[]).filter(a=>a.kind==='brochure').map(a=>pwLink(a.downloadUrl,'Brochure PDF'))),
     node('p',{class:'muted',text:'Updated '+formatIst(p.updatedAt)}),
     ...(canEdit?[btn('Edit '+p.name,()=>editProperty(p),true)]:[]))
   ]);return box;
  }));
  if(!records.length)listing.append(node('p',{class:'empty-state',text:'No properties on this page. Add your first project with its current price and location.'}));
 }
 async function load(){
  const seq=++sequence;refresh.disabled=true;
  try{
   const result=await api('/v1/human/properties?'+new URLSearchParams({tenantId,limit:'50',offset:String(offset)}));
   if(seq!==sequence||!catalogue.isConnected)return;
   records=result.properties||[];canEdit=canManage&&result.canEdit!==false;add.disabled=!canEdit;
   previous.disabled=offset===0;next.disabled=!result.hasMore;render();
  }finally{if(seq===sequence)refresh.disabled=false}
 }
 function editProperty(p){
  if(!canEdit)return;
  const controls={};
  const specifications=[
   ['name','Project / property name','text',true],['city','City','text',true],['locality','Locality / area','text',false],
   ['address','Full address','text',false],['mapUrl','Google Maps link','url',false],
   ['priceMinInr','Price from (₹)','number',false],['priceMaxInr','Price up to (₹)','number',false],
   ['sizeMin','Size from','number',false],['sizeMax','Size up to','number',false],['bhk','BHK, for flats / houses','number',false],
   ['contactName','Salesperson name','text',false],['contactPhone','Sales phone','tel',false],['websiteUrl','Property page link','url',false]
  ];
  for(const [key,label,type,required] of specifications){
   controls[key]=pwField('property-'+key,type,label,required);controls[key].value=p?.[key]??'';
   if(type==='number'){controls[key].min='0';controls[key].step=['sizeMin','sizeMax'].includes(key)?'any':'1'}
   if(type==='url')controls[key].placeholder='https://';
  }
  controls.propertyType=pwSelect('property-propertyType',[['plot','Plot'],['flat','Flat'],['house','House']],p?.propertyType||'plot');
  controls.priceBasis=pwSelect('property-priceBasis',[['total','Total property price'],['per_sqft','Rate per square foot'],['per_sqm','Rate per square metre'],['on_request','Price on request']],p?.priceBasis||'on_request');
  controls.sizeUnit=pwSelect('property-sizeUnit',[['sqft','Square feet'],['sqyd','Square yards'],['sqm','Square metres'],['acre','Acres']],p?.sizeUnit||'sqft');
  controls.status=pwSelect('property-status',[['available','Available'],['paused','Paused'],['sold','Sold']],p?.status||'available');
  for(const key of ['cityAliases','localityAliases']){controls[key]=node('textarea',{class:'field',name:'property-'+key,rows:'2',placeholder:'One name per line, up to 5'});controls[key].value=(p?.[key]||[]).join('\n')}
  controls.description=node('textarea',{class:'field',name:'property-description',rows:'3',maxlength:'3000'});controls.description.value=p?.description||'';
  controls.amenities=node('textarea',{class:'field',name:'property-amenities',rows:'2',maxlength:'2000'});controls.amenities.value=p?.amenities||'';
  const updatePriceRequired=()=>{controls.priceMinInr.required=controls.priceBasis.value!=='on_request'};
  controls.priceBasis.addEventListener('change',updatePriceRequired);updatePriceRequired();
  const field=(key,label)=>lab(label,controls[key]);
  const form=node('form',{class:'stack',id:'property-editor'},[
   div('property-form-grid',field('name','Project / property name'),field('propertyType','Property type'),field('city','City'),field('locality','Locality / area'),field('address','Full address'),field('mapUrl','Google Maps link'),field('cityAliases','City names in other languages, e.g. रायपुर'),field('localityAliases','Other names for this locality')),
   title('Price and availability','h3'),node('p',{class:'muted',text:'Enter the actual property price. A per-square-foot rate is different from the customer’s total budget.'}),
   div('property-form-grid',field('priceBasis','Price basis'),field('priceMinInr','Price from (₹)'),field('priceMaxInr','Price up to (₹)'),field('status','Availability'),field('sizeMin','Size from'),field('sizeMax','Size up to'),field('sizeUnit','Size unit'),field('bhk','BHK, if applicable')),
   field('description','Property description / what the price includes'),field('amenities','Amenities and facilities'),
   div('property-form-grid',field('contactName','Salesperson name'),field('contactPhone','Sales phone'),field('websiteUrl','Property page link'))
  ]);
  const save=node('button',{class:'btn',type:'submit',text:p?'Save property changes':'Save property'});
  form.append(div('formrow',save,btn('Close editor',()=>editor.replaceChildren(),true)));
  const box=div('card',title(p?'Edit property':'Add property','h3'),form);editor.replaceChildren(box);
  if(p)propertyAssets(p,box);else box.append(node('p',{class:'note',text:'Save this property first, then upload its brochure PDF and photos.'}));
  pwFormAction(form,save,async()=>{
   const property=Object.fromEntries(Object.entries(controls).map(([k,v])=>[k,['priceMinInr','priceMaxInr','sizeMin','sizeMax','bhk'].includes(k)?pwNumber(v):['cityAliases','localityAliases'].includes(k)?v.value.split(/\n/).map(x=>x.trim()).filter(Boolean):v.value.trim()]));
   const result=await api('/v1/human/properties','POST',{tenantId,...(p?{id:p.id}:{}),expectedRevision:p?.revision||0,property});
   notice('Property saved. Current details are ready to link to a campaign.');await load();editProperty(result.property);
   document.dispatchEvent(new CustomEvent('properties-updated',{detail:tenantId}));
  });
  box.scrollIntoView({block:'start'});
 }
 function propertyAssets(property,box){
  const panel=div('stack property-assets',title('Brochure and photos','h3'));
  panel.append(node('p',{class:'muted',text:'Brochure: PDF up to 10 MB. Photos: JPEG, PNG or WebP up to 3 MB each, maximum 5 photos.'}),
   div('stack',...(property.assets||[]).map(a=>div('row between property-asset-item',pwLink(a.downloadUrl,a.fileName),btn('Remove '+a.fileName,async()=>{
    try{await api('/v1/human/property-assets/retire','POST',{tenantId,propertyId:property.id,assetId:a.id,expectedRevision:property.revision});
     const fresh=await api('/v1/human/properties?'+new URLSearchParams({tenantId,id:property.id}));
     notice('Property file removed.');await load();editProperty(fresh.property||fresh.properties[0]);
    }catch(e){notice(pwError(e),true)}
   },true)))));
  const kind=pwSelect('propertyAssetKind',[['brochure','Brochure PDF'],['photo','Property photo']],'brochure');
  const file=pwField('propertyAsset','file','',true);file.accept='application/pdf';
  kind.addEventListener('change',()=>{file.value='';file.accept=kind.value==='brochure'?'application/pdf':'image/jpeg,image/png,image/webp'});
  const upload=node('button',{class:'btn secondary',type:'submit',text:'Upload file'});
  const form=node('form',{class:'formrow'},[lab('File type',kind),lab('Choose file',file),upload]);panel.append(form);box.append(panel);
  pwFormAction(form,upload,async()=>{
   const selected=file.files[0];if(!selected)throw Error('Choose a file first.');
   const max=kind.value==='brochure'?10*1024*1024:3*1024*1024;
   if(selected.size>max)throw Error(kind.value==='brochure'?'Choose a PDF under 10 MB.':'Choose a photo under 3 MB.');
   const q=new URLSearchParams({tenantId,propertyId:property.id,expectedRevision:String(property.revision),kind:kind.value,fileName:selected.name});
   const response=await fetch('/v1/human/property-assets?'+q,{method:'POST',credentials:'same-origin',headers:{'Content-Type':selected.type},body:selected,cache:'no-store'});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Upload failed.');
   const fresh=await api('/v1/human/properties?'+new URLSearchParams({tenantId,id:property.id}));
   const current=fresh.property||fresh.properties?.[0];if(!current)throw Error('File uploaded, but property refresh is unavailable. Refresh properties.');
   notice('Property file uploaded.');await load();editProperty(current);
  });
 }
 await load();await campaignPropertyPanel(tenantId,mapping,role);
 content.addEventListener('workspace-tab-shown',()=>load().catch(asError));
}
async function campaignPropertyPanel(tenantId,content,role,fixedCampaignId=''){
 const canManage=['client_admin','super_admin'].includes(role);
 const pick=pwSelect('propertyCampaign',[]),choices=div('property-choice-list'),status=node('p',{class:'muted',role:'status'});
 let records=[],mapping={revision:0,propertyIds:[]},sequence=0;
 const save=btn('Save campaign properties',async()=>{
  if(!pick.value)return;
  const propertyIds=[...choices.querySelectorAll('input:checked')].map(x=>x.value);
  if(propertyIds.length>3)return notice('Select up to 3 properties for one campaign.',true);
  save.disabled=true;
  try{
   mapping=await api('/v1/human/campaign-properties','POST',{tenantId,campaignId:pick.value,expectedRevision:mapping.revision||0,propertyIds});
   notice('Campaign properties saved. Calling settings were not changed.');await selectCampaign();
  }catch(error){notice(pwError(error),true)}finally{save.disabled=!canManage||!pick.value}
 });
 const refresh=btn('Refresh campaign properties',()=>load().catch(asError),true);
 content.append(title('Properties for each campaign','h3'),node('p',{class:'muted',text:'Choose up to 3 available properties. Interested customers are matched only to this campaign’s selected properties.'}),
  div('formrow',lab('Campaign',pick),refresh),status,choices,...(canManage?[save]:[]));
 async function selectCampaign(){
  const seq=++sequence;choices.replaceChildren();save.disabled=true;
  if(!pick.value){status.textContent='Prepare a calling campaign to link properties.';return}
  status.textContent='Loading campaign properties…';
  const result=await api('/v1/human/campaign-properties?'+new URLSearchParams({tenantId,campaignId:pick.value}));
  if(seq!==sequence||!content.isConnected)return;mapping=result;
  const all=new Map(records.map(p=>[p.id,p]));for(const p of result.properties||[])all.set(p.id,p);
  choices.replaceChildren(...[...all.values()].map(p=>{
   const check=node('input',{type:'checkbox',value:p.id,name:'campaignProperty'});check.checked=(result.propertyIds||[]).includes(p.id);check.disabled=!canManage||(p.status!=='available'&&!check.checked);
   check.addEventListener('change',()=>{if(choices.querySelectorAll('input:checked').length>3){check.checked=false;notice('Select up to 3 properties.',true)}});
   return node('label',{class:'property-choice'},[check,div('',node('strong',{text:p.name}),node('p',{class:'muted',text:[p.city,p.locality,p.status].filter(Boolean).join(' · ')}))]);
  }));
  status.textContent=all.size?'Only the selected company’s properties are shown.':'Add an available property in My Properties first.';save.disabled=!canManage;
 }
 async function load(){
  const previous=pick.value;refresh.disabled=true;
  try{
   const propertyData=await api('/v1/human/properties?'+new URLSearchParams({tenantId,limit:'100'}));
   const campaignData=Array.isArray(propertyData.campaigns)?{campaigns:propertyData.campaigns}:role==='super_admin'?{campaigns:[]}:await api('/v1/human/campaigns?tenantId='+encodeURIComponent(tenantId));
   if(!content.isConnected)return;records=propertyData.properties||[];
   pick.replaceChildren(node('option',{value:'',text:'Choose a campaign'}),...(campaignData.campaigns||[]).map(c=>node('option',{value:c.id,text:c.name})));
   pick.value=fixedCampaignId||previous;if(pick.selectedIndex<0)pick.value='';pick.disabled=!!fixedCampaignId;
   await selectCampaign();
  }catch(error){status.textContent=pwError(error);throw error}finally{refresh.disabled=false}
 }
 pick.addEventListener('change',()=>selectCampaign().catch(asError));await load();
}
async function whatsappFollowupPanel(tenantId,content,role){
 const manager=['client_admin','super_admin'].includes(role);
 const top=div('card whatsapp-summary'),setup=div('stack'),rules=div('stack'),work=div('stack'),history=div('stack');
 content.append(top,setup,rules,work,history);
 let snapshot=null,refreshing=false,sequence=0,query='';
 const action=async(name,fields={})=>api('/v1/human/whatsapp','POST',{tenantId,action:name,...fields});
 const refresh=btn('Refresh WhatsApp',()=>load().catch(asError),true);
 function ready(){return snapshot?.connection?.status==='connected'&&snapshot.connection.webhookVerified===true}
 async function load(){
  if(refreshing)return;refreshing=true;refresh.disabled=true;const seq=++sequence;
  try{
   const data=await api('/v1/human/whatsapp?'+new URLSearchParams({tenantId,...(query?{q:query}:{})}));
   if(seq!==sequence||!top.isConnected)return;snapshot=data;render();
  }finally{refreshing=false;refresh.disabled=false}
 }
 function render(){
  const c=snapshot.connection||{status:'not_connected'},canEdit=manager&&snapshot.canEdit!==false;
  top.replaceChildren(div('row between',title('WhatsApp Follow-up'),pwStatus(c.status)),
   node('p',{class:'muted',text:'Property details, scheduled follow-ups and customer replies for this company.'}),
   node('p',{class:ready()?'note ready-note':'note',role:'status',text:ready()?'WhatsApp is connected. Choose approved templates and save your follow-up rules.':c.status==='connected'?'Account connected. Finish webhook verification in Meta to receive replies and delivery status.':'WhatsApp setup is pending. You can prepare properties and save your follow-up settings now.'}),
   ...(c.displayPhone?[node('p',{text:'Business number: '+c.displayPhone+(c.verifiedName?' · '+c.verifiedName:'')})]:[]),
   div('formrow',refresh,...(canEdit?[btn('Pause automatic follow-ups',async()=>{
    try{await action('save_rules',{baseRevision:snapshot.rules?.revision||0,rules:{...rulesValue(snapshot.rules),enabled:false}});notice('Automatic follow-ups paused.');await load()}catch(e){notice(pwError(e),true)}
   },true)]:[])));
  renderConnection(c);renderRules(canEdit);renderWork(canEdit);renderHistory(canEdit);
 }
 function rulesValue(r={}){return {
  enabled:!!r.enabled,firstDelayMinutes:r.firstDelayMinutes??10,secondDelayHours:r.secondDelayHours??48,secondEnabled:!!r.secondEnabled,visitReminderEnabled:!!r.visitReminderEnabled,
  templateName:r.templateName||'',templateLanguage:r.templateLanguage||'hi',followupTemplateName:r.followupTemplateName||'',followupTemplateLanguage:r.followupTemplateLanguage||'hi',visitTemplateName:r.visitTemplateName||'',visitTemplateLanguage:r.visitTemplateLanguage||'hi',dailyLimit:r.dailyLimit??100
 }}
 function renderConnection(c){
  setup.replaceChildren();
  const card=div('card',title('Account connection','h3'));
  const requirements=snapshot.setup?.requirements||[];
  if(snapshot.setup?.canConnect&&requirements.length)card.append(node('ul',{},requirements.map(x=>node('li',{text:typeof x==='string'?x:x.label||x.message||''}))));
  const webhook=snapshot.setup?.webhookUrl||'';
  if(webhook)card.append(lab('Meta webhook URL',node('input',{class:'field',value:webhook,readonly:'readonly'})));
  card.append(div('formrow',pwLink('https://business.facebook.com/wa/manage/','Open WhatsApp Manager'),pwLink('https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started','Meta setup guide')));
  if(!snapshot.setup?.canConnect){card.append(node('p',{class:'muted',text:'Your Super Admin connects the company’s Meta account. You can manage properties, message permissions and follow-up settings here.'}));setup.append(card);return}
  card.append(node('details',{},[node('summary',{text:'WhatsApp voice pilot setup'}),node('p',{text:'Link the business number to the Plivo account used for Calling, enable WhatsApp Calling and set AR3D_PLIVO_WHATSAPP_CALLER_NUMBER to its +91 number in the Calling Worker. After the primary internal recipient grants calling permission, open Calling Setup to run the WhatsApp voice test.'}),pwLink('https://www.plivo.com/docs/messaging/concepts/whatsapp/whatsapp-calling','Plivo WhatsApp calling setup')]));
  const details=node('details',{class:'whatsapp-technical'},node('summary',{text:c.status==='not_connected'?'Connect this client’s Meta account':'Connection settings and credentials'}));
  const account=pwField('whatsappAccountId','text','Meta messaging / WhatsApp Business account ID',true);
  const phone=pwField('whatsappPhoneNumberId','text','Meta Phone Number ID',true);
  const token=pwField('whatsappAccessToken','password','Paste the client account access token',true);
  const secret=pwField('whatsappAppSecret','password','Meta app secret',true);
  account.value=c.messagingAccountId||'';phone.value=c.phoneNumberId||'';account.inputMode=phone.inputMode='numeric';token.autocomplete=secret.autocomplete='new-password';
  const submit=node('button',{class:'btn',type:'submit',text:'Verify and connect account'});
  const result=div('stack');
  const form=node('form',{class:'stack'},[
   node('p',{class:'muted',text:'Use this client’s Meta account. Credentials are stored securely and are not displayed after saving.'}),
   div('property-form-grid',lab('Messaging account ID',account),lab('Phone Number ID',phone)),lab('API access token',token),lab('Meta app secret',secret),submit,result
  ]);
  pwFormAction(form,submit,async()=>{
   const data=await action('connect',{messagingAccountId:account.value.trim(),phoneNumberId:phone.value.trim(),accessToken:token.value.trim(),appSecret:secret.value.trim()});
   token.value='';secret.value='';
   result.replaceChildren(node('p',{class:'success',text:'Account verified. Complete the webhook setup in Meta.'}));
   if(data.verifyToken)result.append(node('p',{class:'note',text:'Save this verification token in Meta now. It is shown only once.'}),lab('One-time webhook verify token',node('input',{class:'field',value:data.verifyToken,readonly:'readonly'})));
   if(data.webhookUrl)result.append(lab('Webhook callback URL',node('input',{class:'field',value:data.webhookUrl,readonly:'readonly'})));
   notice('Meta account verified. Complete webhook setup, then refresh WhatsApp.');
  });
  details.append(form);card.append(details);
  if(c.status==='not_connected')details.open=true;
  if(c.status!=='not_connected')card.append(div('formrow',
   btn('Sync approved templates',async()=>{try{await action('sync_templates');notice('Meta templates refreshed.');await load()}catch(e){notice(pwError(e),true)}},true),
   btn(c.status==='paused'?'Resume connection':'Pause connection',async()=>{try{await action(c.status==='paused'?'resume_connection':'pause_connection');notice(c.status==='paused'?'WhatsApp connection resumed.':'WhatsApp connection paused.');await load()}catch(e){notice(pwError(e),true)}},true)));
  setup.append(card);
 }
 function templatePicker(name,selectedName,selectedLanguage,includeDefault=false,utilityOnly=false){
  const templates=snapshot.templates||[];
  const selected=selectedName?selectedName+'|'+selectedLanguage:'';
  const pick=pwSelect(name,[[includeDefault?'':'',includeDefault?'Use the property details template':'Choose an approved template'],...templates.map(t=>[t.name+'|'+t.language,t.name+' · '+t.language+' · '+t.status+(t.supported===false?' · Needs format update':'')])],selected);
  for(let i=1;i<pick.options.length;i++){const t=templates[i-1];pick.options[i].disabled=t.status!=='APPROVED'||t.supported===false||(utilityOnly&&t.category!=='UTILITY')}
  const preview=node('p',{class:'template-preview'});
  function show(){const t=templates.find(x=>x.name+'|'+x.language===pick.value);preview.textContent=t?String(t.body||'')+(t.reason?'\n'+t.reason:''):''}
  pick.addEventListener('change',show);show();return {pick,preview};
 }
 function renderRules(canEdit){
  rules.replaceChildren();const r=rulesValue(snapshot.rules);
  const card=div('card',title('Follow-up rules','h3'));
  const enabled=node('input',{type:'checkbox',name:'whatsappEnabled'});enabled.checked=r.enabled;enabled.disabled=!canEdit||!ready();
  const first=pwField('whatsappFirstDelay','number','10',true);first.min='5';first.max='1440';first.value=String(r.firstDelayMinutes);
  const second=node('input',{type:'checkbox',name:'whatsappSecondEnabled'});second.checked=r.secondEnabled;
  const secondDelay=pwField('whatsappSecondDelay','number','48',true);secondDelay.min='24';secondDelay.max='168';secondDelay.value=String(r.secondDelayHours);
  const visit=node('input',{type:'checkbox',name:'whatsappVisitReminder'});visit.checked=r.visitReminderEnabled;
  const limit=pwField('whatsappDailyLimit','number','100',true);limit.min='1';limit.max='10000';limit.value=String(r.dailyLimit);
  const primary=templatePicker('whatsappPrimaryTemplate',r.templateName,r.templateLanguage);
  const followup=templatePicker('whatsappFollowupTemplate',r.followupTemplateName,r.followupTemplateLanguage,true);
  const visitTemplate=templatePicker('whatsappVisitTemplate',r.visitTemplateName,r.visitTemplateLanguage,false,true);
  const save=node('button',{class:'btn',type:'submit',text:'Save follow-up rules'});
  const form=node('form',{class:'stack'},[
   node('label',{class:'check-line'},[enabled,node('span',{text:'Automatically follow up with eligible interested customers'})]),
   node('p',{class:'muted',text:'Only customers with a recorded message permission and a matching campaign property qualify. Customer replies pause the ordinary follow-up sequence.'}),
   lab('Property details template',primary.pick),primary.preview,
   div('property-form-grid',lab('First message after call (minutes)',first),lab('Maximum outgoing messages per day',limit)),
   node('label',{class:'check-line'},[second,node('span',{text:'Send one follow-up if the customer has not replied'})]),
   div('property-form-grid',lab('Follow-up after (hours)',secondDelay),lab('Follow-up template',followup.pick)),followup.preview,
   node('label',{class:'check-line'},[visit,node('span',{text:'Remind customers 2 hours before a confirmed visit linked to a property'})]),
   node('p',{class:'muted',text:'Choose a confirmed visit and its property once under Schedule a customer message. Rescheduled visits then use their latest confirmed time.'}),lab('Confirmed visit template',visitTemplate.pick),visitTemplate.preview,
   ...(!ready()?[node('p',{class:'note',text:'Save your settings now. Automatic sending becomes available after the account, webhook and templates are ready.'})]:[]),
   ...(canEdit?[save]:[])
  ]);
  if(!canEdit)for(const el of form.querySelectorAll('input,select,button'))el.disabled=true;
  pwFormAction(form,save,async()=>{
   const parse=(x,defaultLanguage='hi')=>{const [name='',language=defaultLanguage]=x.value.split('|');return {name,language}};
   const a=parse(primary.pick),b=parse(followup.pick),v=parse(visitTemplate.pick);
   await action('save_rules',{baseRevision:snapshot.rules?.revision||0,rules:{enabled:ready()&&enabled.checked,firstDelayMinutes:Number(first.value),secondEnabled:second.checked,secondDelayHours:Number(secondDelay.value),visitReminderEnabled:visit.checked,templateName:a.name,templateLanguage:a.language,followupTemplateName:b.name,followupTemplateLanguage:b.language,visitTemplateName:v.name,visitTemplateLanguage:v.language,dailyLimit:Number(limit.value)}});
   notice('WhatsApp follow-up rules saved.');await load();
  });
  const help=node('details',{class:'template-help'},[node('summary',{text:'Template format for your Meta account'}),
   node('p',{class:'muted',text:'Use six text values in the message body: customer, company, property, price (or visit time), location and details/link. A brochure document header is optional.'}),
   node('pre',{class:'template-preview',text:'नमस्ते {{1}} जी, {{2}} की ओर से {{3}} की जानकारी:\n{{4}}\nलोकेशन: {{5}}\n{{6}}\nजवाब देकर हमारी टीम से बात करें।'}),
   node('p',{class:'muted',text:'Templates must be approved in Meta. Call scripts stay unchanged.'})]);
  card.append(form);if(snapshot.setup?.canConnect)card.append(help);rules.append(card);
 }
 function leadPicker(name){return pwSelect(name,[['','Choose a customer'],...(snapshot.leads||[]).map(l=>[l.id,(l.name||'Customer')+' · '+l.mobile+' · '+(l.interestStatus||'new')])],'')}
 function renderWork(canEdit){
  work.replaceChildren();
  const search=pwField('whatsappLeadSearch','search','Search customer name or number');search.value=query;
  const find=btn('Find customer',()=>{query=search.value.trim();load().catch(asError)},true);
  search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();query=search.value.trim();load().catch(asError)}});
  const header=div('card',title('Customer follow-up','h3'),div('formrow',lab('Find a customer',search),find));work.append(header);
  if(!canEdit){header.append(node('p',{class:'muted',text:'Client Admin access is required to manage message permissions and schedules.'}));return}
  const permission=node('details',{class:'card'},node('summary',{text:'Record existing message permission'}));
  const person=leadPicker('whatsappPermissionLead');
  const status=pwSelect('whatsappPermissionStatus',[['granted','Customer has permitted these messages'],['revoked','Customer has withdrawn permission']],'granted');
  const source=pwSelect('whatsappPermissionSource',[['website_form','Website enquiry form'],['ad_form','Advertisement form'],['existing_crm','Existing CRM evidence'],['customer_message','Customer’s own message'],['other','Other documented source']],'website_form');
  const reference=pwField('whatsappPermissionReference','text','Form submission ID or evidence reference',true);reference.maxLength=500;
  const captured=pwField('whatsappPermissionCapturedAt','datetime-local','',true);
  const save=node('button',{class:'btn',type:'submit',text:'Save message permission'});
  const permissionState=node('p',{class:'muted',role:'status'});
  person.addEventListener('change',()=>{
   const p=(snapshot.permissions||[]).find(x=>x.leadId===person.value);
   permissionState.textContent=p?'Current record: '+p.status+' · '+p.source+' · '+formatIst(p.capturedAt):'No existing WhatsApp permission record shown.';
  });
  const form=node('form',{class:'stack'},[node('p',{class:'muted',text:'Record permission already obtained through a form or customer request. Uploading a phone number or marking Interested does not create permission.'}),
   lab('Customer',person),permissionState,lab('Permission status',status),lab('Evidence source',source),lab('Evidence reference',reference),lab('When the customer gave or withdrew permission (India time)',captured),save]);
  pwFormAction(form,save,async()=>{
   if(!person.value)throw Error('Choose a customer.');
   await action('permission',{leadId:person.value,status:status.value,source:source.value,reference:reference.value.trim(),capturedAt:pwIstIso(captured.value)});
   notice('Customer message permission recorded.');await load();
  });permission.append(form);work.append(permission);
  const schedule=node('details',{class:'card'},node('summary',{text:'Schedule a customer message'}));
  const customer=leadPicker('whatsappScheduleLead'),campaign=pwSelect('whatsappScheduleCampaign',[['','Choose a campaign'],...(snapshot.campaigns||[]).map(c=>[c.id,c.name])],'');
  const property=pwSelect('whatsappScheduleProperty',[['','Choose a campaign first']],'');
  const kind=pwSelect('whatsappScheduleKind',[['property_details','Property details'],['followup','One follow-up'],['visit_reminder','Confirmed site visit reminder']],'property_details');
  const visit=pwSelect('whatsappScheduleVisit',[['','Choose a confirmed visit']],'');
  const due=pwField('whatsappScheduleAt','datetime-local','',true);due.value=pwIstValue(Date.now()+10*60000);
  const preview=node('p',{class:'note',role:'status',text:'Select a campaign and one of its available properties.'});
  let availableProperties=[];
  const updateVisits=()=>{visit.replaceChildren(node('option',{value:'',text:'Choose a confirmed visit'}),...(snapshot.visits||[]).filter(v=>v.leadId===customer.value&&v.status==='confirmed').map(v=>node('option',{value:v.id,text:formatIst(v.scheduledAt)})));visit.disabled=kind.value!=='visit_reminder';};
  customer.addEventListener('change',updateVisits);kind.addEventListener('change',updateVisits);updateVisits();
  visit.addEventListener('change',()=>{const selected=(snapshot.visits||[]).find(x=>x.id===visit.value);if(selected)due.value=pwIstValue(Math.max(Date.now()+60000,Date.parse(selected.scheduledAt)-2*60*60000))});
  campaign.addEventListener('change',async()=>{
   property.replaceChildren(node('option',{value:'',text:'Loading campaign properties…'}));availableProperties=[];
   if(!campaign.value){property.replaceChildren(node('option',{value:'',text:'Choose a campaign first'}));return}
   const selected=campaign.value;
   try{
    const d=await api('/v1/human/campaign-properties?'+new URLSearchParams({tenantId,campaignId:selected}));
    if(campaign.value!==selected||!schedule.isConnected)return;availableProperties=(d.properties||[]).filter(p=>p.status==='available');
    property.replaceChildren(node('option',{value:'',text:'Choose an available property'}),...availableProperties.map(p=>node('option',{value:p.id,text:p.name+' · '+p.city})));
    preview.textContent=availableProperties.length?'Choose the property this customer asked about.':'No available properties linked. Add a property and link it to this campaign in My Properties.';
   }catch(e){preview.textContent=pwError(e)}
  });
  property.addEventListener('change',()=>{const p=availableProperties.find(x=>x.id===property.value);preview.textContent=p?[p.name,p.city,p.locality,p.description].filter(Boolean).join(' · '):'Choose a property.'});
  let scheduleRequestId=crypto.randomUUID();
  const submit=node('button',{class:'btn',type:'submit',text:'Schedule message'});
  const scheduleForm=node('form',{class:'stack'},[div('property-form-grid',lab('Customer',customer),lab('Campaign',campaign),lab('Property',property),lab('Message type',kind)),preview,lab('Confirmed visit',visit),lab('Send at (India time)',due),submit]);
  pwFormAction(scheduleForm,submit,async()=>{
   if(!customer.value||!campaign.value||!property.value)throw Error('Choose a customer, campaign and available property.');
   if(kind.value==='visit_reminder'&&!visit.value)throw Error('Choose a confirmed site visit.');
   const result=await action('schedule',{requestId:scheduleRequestId,leadId:customer.value,campaignId:campaign.value,propertyId:property.value,kind:kind.value,dueAt:pwIstIso(due.value),...(kind.value==='visit_reminder'?{visitId:visit.value}:{})});
   scheduleRequestId=crypto.randomUUID();
   notice(result.status==='pending_setup'?'Message saved, waiting for WhatsApp setup.':result.notice||'Message scheduled. Delivery will be shown after WhatsApp confirms it.');await load();
  });schedule.append(scheduleForm);work.append(schedule);
 }
 function renderHistory(canEdit){
  history.replaceChildren();
  const messages=snapshot.messages||[],inbox=snapshot.inbox||[];
  const metrics=div('cards',overviewMetric('Scheduled',String(messages.filter(m=>['queued','scheduled'].includes(m.status)).length),'clock'),overviewMetric('Delivered / Read',String(messages.filter(m=>['delivered','read'].includes(m.status)).length),'mail'),overviewMetric('Customer replies',String(inbox.length),'users'));
  const card=div('card',title('Messages and delivery','h3'),metrics,node('p',{class:'muted',text:'Recent messages. Submitted means WhatsApp accepted the request; Delivered and Read appear only when reported by WhatsApp.'}));
  card.append(table(['Customer','Message','Scheduled (IST)','Status','Details','Action'],messages.map(m=>[
   m.leadName||m.customerName||'Customer',String(m.kind||'').replaceAll('_',' '),formatIst(m.dueAt),pwStatus(m.status),String(m.reason||m.errorCode||'').replaceAll('_',' '),
   canEdit&&['queued','scheduled','pending_setup'].includes(m.status)?btn('Cancel message',async()=>{try{await action('cancel',{messageId:m.id});notice('Scheduled message cancelled.');await load()}catch(e){notice(pwError(e),true)}},true):'—'
  ])));history.append(card);
  const replies=div('card',title('Customer replies','h3'));
  if(!inbox.length)replies.append(node('p',{class:'empty-state',text:'Customer replies will appear here after the account webhook is connected.'}));
  for(const item of inbox){
   const line=div('message-thread-item',div('row between',node('strong',{text:item.leadName||item.customerName||item.from||'Customer'}),node('span',{class:'muted',text:formatIst(item.receivedAt||item.createdAt)})),node('p',{class:'message-text',text:item.text||item.body||'Media or interactive message received.'}));
   if(canEdit&&item.leadId){
    const paused=(snapshot.threads||[]).some(t=>t.leadId===item.leadId&&t.paused);
    line.append(btn(paused?'Resume future follow-ups':'Pause follow-ups for customer',async()=>{try{await action(paused?'resume_lead':'pause_lead',{leadId:item.leadId});notice(paused?'Future follow-ups resumed. Cancelled messages stay cancelled.':'Pending follow-ups paused for this customer.');await load()}catch(e){notice(pwError(e),true)}},true));
    const reply=node('details',{},node('summary',{text:'Reply to customer'}));
    const text=node('textarea',{class:'field',name:'whatsappReply',rows:'3',maxlength:'2000',required:'required'});
    let replyRequestId=crypto.randomUUID();
    const send=node('button',{class:'btn',type:'submit',text:'Send reply'});
    const form=node('form',{class:'stack'},[node('p',{class:'muted',text:'Replies are available within 24 hours of the customer’s latest WhatsApp message. Message charges may apply.'}),lab('Your reply',text),div('formrow',send,btn('Clear reply',()=>{text.value='';replyRequestId=crypto.randomUUID()},true))]);
    pwFormAction(form,send,async()=>{
     const result=await action('reply',{requestId:replyRequestId,leadId:item.leadId,text:text.value.trim()});
     if(!['submitted','delivered','read','replied'].includes(result.status)){notice(result.notice||'Reply delivery is not confirmed. Refresh the message history before creating another reply.',true);return}
     text.value='';replyRequestId=crypto.randomUUID();
     notice(result.notice||'Reply submitted to WhatsApp. Check the delivery status.');await load();
    });reply.append(form);line.append(reply);
   }
   replies.append(line);
  }
  history.append(replies);
 }
 await load();content.addEventListener('workspace-tab-shown',()=>load().catch(asError));
}
`;
