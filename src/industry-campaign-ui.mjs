export const industryCampaignJs=String.raw`
// Production-only School campaigns. No start/dial control until funded runtime exists.
function industryCampaignPanel(tenantId,content,{admin=false,editable=false}={}){
 const card=div('card',title('School production campaigns','h3'),
  node('p',{class:'note',text:'Select a reviewed frozen School agent, add existing CRM contacts, and review each guardian’s permission for School Admission. These records do not start calls or reserve credits.'}));
 content.append(card);
 const area=div('stack'),status=node('p',{class:'muted',role:'status'}),campaign=node('select',{class:'field','aria-label':'Industry campaign'});
 const launch=node('select',{class:'field','aria-label':'Reviewed frozen School agent'}),name=input('industryCampaignName','text','Campaign name');name.maxLength=80;
 const body=div('stack'),chooseBox=div('stack'),list=div('stack'),queueBox=div('stack'),search=input('industryLeadSearch','search','Search name or mobile');search.maxLength=80;
 let campaigns=[],offset=0,recipientOffset=0,leadOffset=0,seq=0,leadSeq=0,loading=false;
 const base='/v1/human/industry-campaigns',query='?tenantId='+encodeURIComponent(tenantId);
 const callPath=()=>base+'/'+encodeURIComponent(campaign.value);
 function active(id,stamp){return card.isConnected&&campaign.value===id&&stamp===seq}
 async function loadRecipients(){
  const id=campaign.value,stamp=++seq;
  list.replaceChildren();chooseBox.replaceChildren();queueBox.replaceChildren();
  if(!id)return;
  const r=await api(callPath()+'/recipients'+query+'&offset='+recipientOffset);
  if(!active(id,stamp))return;
  const archived=!!r.campaign.archivedAt;
  list.append(title('Campaign recipients','h3'),
   node('p',{class:'muted',text:archived?'Campaign archived.':'Recipient review is not live calling approval.'}));
  for(const x of r.recipients){
   const item=div('card',node('p',{text:(x.name||'CRM contact')+' · ••••'+x.destinationLast4}),
    node('p',{class:'muted',text:x.status.replaceAll('_',' ')+' · review v'+x.revision+(x.expiresAt?' · expires '+new Date(x.expiresAt).toLocaleString():'')}));
   if(!archived&&(admin||editable)){
    const reason=node('textarea',{class:'field',rows:2,maxlength:160,'aria-label':'Revocation reason'});
    if(x.revision>0&&x.status!=='revoked'){
     const revoke=btn('Revoke recipient permission',async()=>{
      if(!active(id,stamp)||reason.value.trim().length<4)return asError(Error('Enter a revocation reason.'));
      revoke.disabled=true;
      try{await api(base+'/'+encodeURIComponent(id)+'/review','POST',{tenantId,leadId:x.leadId,baseRevision:x.revision,decision:'revoked',reason:reason.value.trim()});if(active(id,stamp))await loadRecipients()}
      catch(e){asError(e)}finally{revoke.disabled=false}
     },true);
     item.append(lab('Reason for revocation',reason),revoke);
    }
    if(admin&&!['suppressed_or_missing','unsupported_destination'].includes(x.status)){
     const consent=input('industryConsent-'+x.leadId,'text','School consent evidence reference');consent.maxLength=160;
     const dnd=input('industryDnd-'+x.leadId,'text','DND clearance reference');dnd.maxLength=160;
     const expiry=input('industryExpiry-'+x.leadId,'datetime-local','Permission expires');
     const ack=node('input',{type:'checkbox'});
     const review=btn('Record School recipient clearance',async()=>{
      if(!active(id,stamp))return;
      const expiryMs=new Date(expiry.value).getTime();
      if(!ack.checked||consent.value.trim().length<4||dnd.value.trim().length<4||!Number.isFinite(expiryMs))
       return asError(Error('Review guardian permission and DND evidence, then enter expiry.'));
      review.disabled=true;
      try{
       await api(base+'/'+encodeURIComponent(id)+'/review','POST',{tenantId,leadId:x.leadId,baseRevision:x.revision,decision:'cleared',
        consentReference:consent.value.trim(),dndReference:dnd.value.trim(),expiresAt:new Date(expiryMs).toISOString(),
        reviewTarget:x.reviewTarget,acknowledgeGuardianAndPurpose:true});
       if(active(id,stamp))await loadRecipients();
      }catch(e){asError(e)}finally{review.disabled=false}
     });
     item.append(lab('School consent reference',consent),lab('DND evidence reference',dnd),lab('Expires at',expiry),
      node('label',{class:'row'},[ack,'I verified guardian permission for this School purpose, exact recipient, and DND clearance.']),review);
    }
   }
   list.append(item);
  }
  let jobOffset=0,queueLoading=false;
  const loadJobs=async()=>{
   if(!active(id,stamp)||queueLoading)return;
   queueLoading=true;showQueue.disabled=true;
   try{
    const baseQueue='/v1/human/industry-queue/'+encodeURIComponent(id),out=await api(baseQueue+query+'&offset='+jobOffset);
    if(!active(id,stamp))return;
    const controls=div('stack'),eligible=r.recipients.filter(x=>x.status==='review_current'&&!x.preparationBlocked&&!out.jobs.some(j=>j.leadId===x.leadId&&(j.state==='prepared'||j.reviewRevision===x.revision)));
    queueBox.replaceChildren(title('Prepared calling jobs','h3'),node('p',{class:'note',text:'Preparation only. No carrier submission, credit reservation or automatic future dialing.'}),
     node('p',{class:'muted',text:out.manifestSha256?'Approved audio manifest recorded · '+out.manifestSha256.slice(0,12):'Approved audio pack is required before preparing jobs.'}),controls);
    for(const j of out.jobs){
     const x=r.recipients.find(x=>x.leadId===j.leadId);
     const line=div('card',node('p',{text:(x?.name||'CRM contact '+j.leadId.slice(0,8))+' · '+j.state+(j.terminalState==='settled'?' · settled / capacity released':j.state==='prepared'&&!j.current?' · stale / not eligible':'')+' · review v'+j.reviewRevision+' · funding admission '+j.admissionState.replaceAll('_',' ')}));
     if(admin&&j.state==='prepared'&&j.current&&j.admissionState==='not_released'){
      const reference=input('industryAdmission-'+j.id,'text','Reviewed funding authorization reference');reference.maxLength=160;
      const duration=node('select',{class:'field','aria-label':'Maximum call duration'},[90,120,150,180].map(n=>node('option',{value:String(n),text:String(n)+' seconds'})));duration.value='180';
      const expiry=input('industryAdmissionExpiry-'+j.id,'datetime-local','Funding admission expires');
      const authorize=btn('Authorize funding admission (no calls)',async()=>{
       if(!active(id,stamp)||reference.value.trim().length<10||!expiry.value)return asError(Error('Enter reviewed funding reference and expiry.'));
       if(!confirm('Authorize only a future bounded funding reservation for this exact reviewed job. This does not start a call or grant permission to dial.'))return;
       authorize.disabled=true;try{await api('/v1/human/industry-admission/'+encodeURIComponent(j.id),'POST',{tenantId,jobId:j.id,manifestSha256:out.manifestSha256,maxSeconds:Number(duration.value),expiresAt:new Date(expiry.value).toISOString(),approvalReference:reference.value.trim(),acknowledgeFundingOnly:true});if(active(id,stamp))await loadRecipients()}catch(e){asError(e)}finally{authorize.disabled=false}
      },true);
      line.append(lab('Funding review reference',reference),lab('Maximum call duration',duration),lab('Admission expiry (within one hour)',expiry),authorize);
     }
     if((admin||editable)&&j.state==='prepared'&&!['claiming','funded','unknown'].includes(j.admissionState)){
      const why=input('industryCancel-'+j.id,'text','Reason for cancelling prepared job');why.maxLength=160;
      const cancel=btn('Cancel prepared job',async()=>{
       if(!active(id,stamp)||why.value.trim().length<4)return asError(Error('Enter a cancellation reason.'));
       cancel.disabled=true;try{await api(baseQueue+'/cancel','POST',{tenantId,jobId:j.id,reason:why.value.trim()});if(active(id,stamp))await loadRecipients()}catch(e){asError(e)}finally{cancel.disabled=false}
      },true);
      line.append(lab('Cancellation reason',why),cancel);
     }
     controls.append(line);
    }
    const previousJobs=btn('Previous prepared jobs',()=>{if(!queueLoading){jobOffset=Math.max(0,jobOffset-50);loadJobs().catch(asError)}},true);
    const nextJobs=btn('Next prepared jobs',()=>{if(!queueLoading){jobOffset+=50;loadJobs().catch(asError)}},true);
    previousJobs.disabled=jobOffset===0;nextJobs.disabled=!out.hasMore;
    controls.append(node('p',{class:'muted',text:'Showing '+out.jobs.length+' job(s) · page '+(Math.floor(jobOffset/50)+1)+'. Current status means local evidence and recorded audio approval, not fresh R2 byte verification.'}),div('formrow',previousJobs,nextJobs));
    if(editable&&!admin&&!archived&&out.tenantActive&&out.manifestSha256&&eligible.length){
     const selected=new Map();
     for(const x of eligible){
      const check=node('input',{type:'checkbox'});check.addEventListener('change',()=>check.checked?selected.set(x.leadId,{leadId:x.leadId,reviewRevision:x.revision}):selected.delete(x.leadId));
      controls.append(node('label',{class:'row'},[check,'Prepare '+(x.name||'CRM contact')+' · ••••'+x.destinationLast4]));
     }
     const prepare=btn('Prepare selected calling jobs (no calls)',async()=>{
      if(!active(id,stamp)||!selected.size)return asError(Error('Select at least one currently reviewed recipient.'));
      if(!confirm('Prepare these exact reviewed recipients and audio version? No calls or credit reservation will occur.'))return;
      prepare.disabled=true;
      try{const response=await api(baseQueue+'/prepare','POST',{tenantId,manifestSha256:out.manifestSha256,recipients:[...selected.values()],acknowledgePreparationOnly:true});notice(response.prepared+' jobs prepared. No calls started.');if(active(id,stamp))await loadRecipients()}catch(e){asError(e)}finally{prepare.disabled=false}
     },true);
     controls.append(prepare);
    }
   }catch(e){asError(e)}finally{queueLoading=false;showQueue.disabled=false}
  };
  const showQueue=btn('Load prepared calling jobs',loadJobs,true);
  list.append(showQueue);
  if(!r.recipients.length)list.append(node('p',{class:'muted',text:'No recipients added.'}));
  const prev=btn('Previous recipients',()=>{recipientOffset=Math.max(0,recipientOffset-50);loadRecipients().catch(asError)},true),next=btn('Next recipients',()=>{recipientOffset+=50;loadRecipients().catch(asError)},true);
  prev.disabled=recipientOffset===0;next.disabled=!r.hasMore;list.append(div('formrow',prev,next));
  if(editable&&!admin&&!archived){
   chooseBox.append(title('Add existing CRM contacts','h3'),div('formrow',lab('Search contacts',search),btn('Find contacts',()=>{leadOffset=0;loadAvailable().catch(asError)},true)),div('stack'));
   await loadAvailable();
  }
 }
 async function loadAvailable(){
  const id=campaign.value,stamp=seq,request=++leadSeq,container=chooseBox.lastElementChild;
  if(!id||!container)return;
  const r=await api(callPath()+'/available-leads'+query+'&offset='+leadOffset+'&q='+encodeURIComponent(search.value.trim()));
  if(!active(id,stamp)||request!==leadSeq||chooseBox.lastElementChild!==container)return;
  const selected=new Set();
  const rows=r.leads.map(x=>{
   const check=node('input',{type:'checkbox'});check.addEventListener('change',()=>check.checked?selected.add(x.id):selected.delete(x.id));
   return node('label',{class:'row'},[check,(x.name||'CRM contact')+' · ••••'+x.destinationLast4]);
  });
  const add=btn('Add selected contacts',async()=>{
   if(!active(id,stamp)||!selected.size)return asError(Error('Select at least one CRM contact.'));
   add.disabled=true;
   try{await api(base+'/'+encodeURIComponent(id)+'/recipients','POST',{tenantId,leadIds:[...selected]});if(active(id,stamp)){leadOffset=0;recipientOffset=0;await loadCampaigns(id)}}
   catch(e){asError(e)}finally{add.disabled=false}
  });
  const prev=btn('Previous contacts',()=>{leadOffset=Math.max(0,leadOffset-50);loadAvailable().catch(asError)},true),next=btn('Next contacts',()=>{leadOffset+=50;loadAvailable().catch(asError)},true);
  prev.disabled=leadOffset===0;next.disabled=!r.hasMore;
  container.replaceChildren(...rows,...(!rows.length?[node('p',{class:'muted',text:'No available contacts on this page.'})]:[]),div('formrow',prev,next,add));
 }
 async function loadCampaigns(wanted=campaign.value){
  const stamp=++seq;
  const r=await api(base+query+'&offset='+offset);
  if(!card.isConnected||stamp!==seq)return;
  campaigns=r.campaigns;
  campaign.replaceChildren(node('option',{value:'',text:'Choose a campaign'}),...campaigns.map(c=>node('option',{value:c.id,text:c.name+' · '+c.recipientCount+' contacts'+(c.archivedAt?' · archived':'')})));
  campaign.value=campaigns.some(c=>c.id===wanted)?wanted:campaigns[0]?.id||'';
  status.textContent=campaigns.length+' campaign(s) on this page. Calling remains disabled.';
  previous.disabled=offset===0;following.disabled=!r.hasMore;
  archive.disabled=admin||!editable||!campaign.value||!!campaigns.find(c=>c.id===campaign.value)?.archivedAt;
  await loadRecipients();
 }
 const previous=btn('Previous campaigns',()=>{offset=Math.max(0,offset-50);recipientOffset=0;leadOffset=0;loadCampaigns('').catch(asError)},true);
 const following=btn('Next campaigns',()=>{offset+=50;recipientOffset=0;leadOffset=0;loadCampaigns('').catch(asError)},true);
 const archive=btn('Archive selected campaign',async()=>{
  const id=campaign.value;if(!id||!confirm('Archive this campaign and invalidate its recipient readiness?'))return;
  archive.disabled=true;
  try{await api(base+'/'+encodeURIComponent(id)+'/archive','POST',{tenantId,confirm:true});await loadCampaigns(id)}catch(e){asError(e)}finally{archive.disabled=!!campaigns.find(c=>c.id===campaign.value)?.archivedAt}
 },true);
 archive.disabled=true;
 campaign.addEventListener('change',()=>{recipientOffset=0;leadOffset=0;archive.disabled=admin||!editable||!campaign.value||!!campaigns.find(c=>c.id===campaign.value)?.archivedAt;loadRecipients().catch(asError)});
 const create=btn('Create School campaign',async()=>{
  if(!launch.value||!name.value.trim())return asError(Error('Choose a reviewed School agent and enter a campaign name.'));
  create.disabled=true;
  try{const out=await api(base,'POST',{tenantId,launchRequestId:launch.value,name:name.value.trim()});name.value='';offset=0;recipientOffset=0;leadOffset=0;await loadCampaigns(out.id)}catch(e){asError(e)}finally{create.disabled=false}
 });
 const open=btn('Open industry campaigns',async()=>{
  if(loading)return;loading=true;open.disabled=true;
  try{
   if(editable&&!admin){
    const r=await api('/v1/human/industry-launch-requests'+query);
    launch.replaceChildren(node('option',{value:'',text:'Choose a reviewed version'}),...r.requests.filter(x=>x.state==='configuration_reviewed').map(x=>node('option',{value:x.id,text:'School · '+x.digest.slice(0,12)+' · '+new Date(x.requestedAt).toLocaleDateString()})));
    create.disabled=!r.requests.some(x=>x.state==='configuration_reviewed');
   }
   body.hidden=false;await loadCampaigns();
  }catch(e){asError(e)}finally{loading=false;open.disabled=false}
 },true);
 body.hidden=true;
 if(editable&&!admin)body.append(div('formrow',lab('Reviewed School agent',launch),lab('Campaign name',name),create));
 body.append(lab('Campaign',campaign),div('formrow',previous,following,editable&&!admin?archive:null),status,list,queueBox,chooseBox);
 card.append(open,body);
}
`;
