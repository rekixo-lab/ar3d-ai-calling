export const industryAgentJs=String.raw`// Draft-only client Industry Agent Builder. Runs after shared dashboard helpers.
// This is an editor/preview, not a callable agent and not a simulator of actual speech.
function industryAgentPanel(tenantId,content,role){
 const editable=role==='client_admin';
 const card=div('card',div('row between',title('My AI Agents'),
  node('span',{class:'badge pending',text:'Draft only · No calls'})),
  node('p',{class:'note',text:'Choose an industry, build your AI instructions and save a draft. None of these agents is connected to live calling, Plivo, CRM outcomes or WhatsApp. Real Estate calling remains unchanged.'}));
 const profileBox=div('card'),listBox=div('card'),editBox=div('card');
 content.append(card,profileBox,listBox,editBox);
 let templates=[],drafts=[],activeId='',activeDraft=null,profileRevision=0,sequence=0;
 let snapshots=[],snapshotSequence=0;
 let launchSequence=0;
 const enabled=()=>card.isConnected&&content.isConnected;
 const choose=node('select',{class:'field','aria-label':'New AI template'});
 const business=node('select',{class:'field','aria-label':'Business industry'});
 const existing=node('select',{class:'field','aria-label':'Saved AI agent drafts'});
 const status=node('p',{class:'note',role:'status',text:'Loading industry templates and drafts…'});
 const profileStatus=node('p',{class:'muted',role:'status',text:'Industry is a draft preference, not calling approval.'});
 const saveProfile=btn('Save industry draft',async()=>{
  saveProfile.disabled=true;
  try{
   const result=await api('/v1/human/industry-profiles','PATCH',{tenantId,industryCode:business.value,baseRevision:profileRevision});
   if(!enabled())return;
   profileRevision=result.revision;profileStatus.textContent='Industry preference saved as draft. Real calls are unchanged.';
  }catch(err){if(enabled())asError(err)}finally{saveProfile.disabled=!editable}
 });
 const newButton=btn('Create AI draft',async()=>{
  if(!editable)return;
  const t=templates.find(x=>x.id===choose.value);if(!t)return;
  newButton.disabled=true;
  try{
   const config={templateId:t.id,name:t.label,mode:t.mode,language:'hi-en',
    greeting:t.greeting,questions:[...t.questions],closing:t.closing};
   const r=await api('/v1/human/ai-flows','POST',{tenantId,config});
   if(!enabled())return;
   await load(r.draft.id);
   if(enabled())status.textContent='AI draft created. It cannot make calls; edit and save below.';
  }catch(err){if(enabled())asError(err)}finally{newButton.disabled=!editable}
 });
 const createLine=div('formrow',lab('Choose a reviewed template',choose),editable?newButton:null);
 listBox.append(title('Draft AI Agents','h3'),createLine,lab('Select saved draft',existing),status);
 existing.addEventListener('change',()=>{activeId=existing.value;showEditor()});
 const name=input('industryAgentName','text','AI Agent name');name.maxLength=120;
 const mode=node('select',{class:'field','aria-label':'AI Call Mode'});
 const language=node('select',{class:'field','aria-label':'AI Language'},
  [['hi','Hindi'],['en','English'],['hi-en','Hindi / English']].map(([v,t])=>node('option',{value:v,text:t})));
 const greeting=node('textarea',{class:'field',rows:'3','aria-label':'AI Greeting',maxlength:'650'});
 const questions=node('textarea',{class:'field',rows:'6','aria-label':'AI questions, one per line',maxlength:'3400'});
 const closing=node('textarea',{class:'field',rows:'2','aria-label':'AI Closing',maxlength:'450'});
 const questionLabel=lab('Questions (one per line, up to 12)',questions);
 const preview=div('card');
 const fictionalAnswers=node('textarea',{class:'field',rows:'3','aria-label':'Fictional conversation answers',maxlength:'2000'});
 const simulation=div('card');
 const snapshotsBox=div('card');
 const frozenChoice=node('select',{class:'field','aria-label':'Frozen AI versions'});
 const frozenNotice=node('p',{class:'muted',role:'status',text:'Choose a saved draft to view frozen versions.'});
 const frozenResult=div('card');
 const launchBox=div('card'),launchStatus=node('p',{class:'muted',role:'status'});
 const launchRequestButton=btn('Request production configuration review',async()=>{
  const version=frozenChoice.value,draftId=activeDraft?.id;
  if(!editable||!version||activeDraft?.config.templateId!=='school_admission_v1')return;
  launchRequestButton.disabled=true;
  try{
   await api('/v1/human/industry-launch-requests','POST',{tenantId,snapshotId:version,acknowledgeProductionReview:true});
   if(enabled()&&activeDraft?.id===draftId&&frozenChoice.value===version)await refreshLaunchReview();
  }catch(e){if(enabled())asError(e);await refreshLaunchReview()}
 },true);
 async function refreshLaunchReview(){
  const seq=++launchSequence,version=frozenChoice.value,draft=activeDraft;
  launchBox.hidden=draft?.config.templateId!=='school_admission_v1';
  launchRequestButton.disabled=true;
  if(launchBox.hidden)return;
  launchStatus.textContent='Choose the latest frozen School version.';
  if(!version)return;
  try{
   const out=await api('/v1/human/industry-launch-requests?tenantId='+encodeURIComponent(tenantId));
   if(seq!==launchSequence||!enabled()||frozenChoice.value!==version)return;
   const r=out.requests.find(x=>x.snapshotId===version),snap=snapshots.find(x=>x.id===version);
   const latest=snap?.draftRevision===draft.revision;
   launchStatus.textContent=r?'Production configuration review: '+r.state.replaceAll('_',' ')+'. Customer calling is not enabled.':latest?'Request review of this exact School script. Calling remains unavailable until consent, dispatch and runtime are connected.':'Freeze your latest saved draft before requesting review.';
   launchRequestButton.disabled=!editable||!latest||!!r||draft.config.mode!=='interactive'||draft.config.questions.length>3;
  }catch(e){if(seq===launchSequence&&enabled())launchStatus.textContent='Production review status unavailable.'}
 }
 launchBox.hidden=true;
 launchBox.append(title('Production calling preparation','h3'),node('p',{class:'note',text:'School Admission first. Review is for production configuration only; it never starts a call or spends credits.'}),launchStatus,editable?launchRequestButton:null);
 const virtualTurnBox=div('card');
 const virtualTurnResult=div('card');
 const virtualTurnStatus=node('p',{class:'muted',role:'status',text:'Choose a frozen version and enter fictional answers to preview each virtual voice turn.'});
 const saveButton=btn('Save AI draft',async()=>{
  if(!editable||!activeDraft)return;
  let config;
  try{config=editorValue()}catch(err){asError(err);return;}
  saveButton.disabled=true;
  try{
   const result=await api('/v1/human/ai-flows/'+encodeURIComponent(activeDraft.id),'PATCH',
    {tenantId,baseRevision:activeDraft.revision,config});
   if(!enabled())return;
   activeDraft={...activeDraft,config,revision:result.revision};
   drafts=drafts.map(x=>x.id===activeDraft.id?activeDraft:x);
   status.textContent='Draft saved (revision '+result.revision+'). It is still not published or callable.';
   updatePreview();
   fillDraftOptions();
  }catch(err){
   if(enabled())asError(err);
   if(err?.status===409&&enabled())status.textContent='Someone edited this agent. Refresh drafts to avoid overwriting their work.';
  }finally{saveButton.disabled=!editable}
 });
 const simulateButton=btn('Run fictional conversation (no calls)',async()=>{
  if(!activeDraft)return;
  let draft;
  try{draft=editorValue()}catch(err){asError(err);return}
  if(JSON.stringify(draft)!==JSON.stringify(activeDraft.config)){
   asError(Error('Save draft changes first, then run the fictional conversation.'));return;
  }
  const answers=fictionalAnswers.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(answers.length>12||answers.some(x=>x.length>160)){
   asError(Error('Use up to 12 fictional answers (160 characters each).'));return;
  }
  const expected=activeDraft.id;
  simulateButton.disabled=true;
  try{
   const out=await api('/v1/human/ai-flows/'+encodeURIComponent(expected)+'/simulate','POST',{tenantId,answers});
   if(!enabled()||activeDraft?.id!==expected)return;
   simulation.replaceChildren(title('Fictional conversation result','h3'),
    node('p',{class:'note',text:out.notice||'Text-only simulation: no calls.'}),
    node('p',{class:'muted',text:'Status: '+out.status+' · answers used: '+out.answersUsed}),
    ...(out.transcript||[]).map(t=>node('p',{class:'muted',text:(t.speaker==='draft_ai'?'Draft AI: ':'Fictional customer: ')+t.text})),
    ...(out.effects||[]).map(e=>node('p',{class:'muted',text:'Would do (not executed): '+e})));
  }catch(err){if(enabled())asError(err)}
  finally{simulateButton.disabled=false}
 },true);
 const freezeButton=btn('Freeze draft for simulation review',async()=>{
  if(!editable||!activeDraft)return;
  try{
   if(JSON.stringify(editorValue())!==JSON.stringify(activeDraft.config))
    throw Error('Save your latest edits before freezing.');
  }catch(err){asError(err);return}
  const source=activeDraft.id;freezeButton.disabled=true;
  try{
   const r=await api('/v1/human/ai-flow-snapshots','POST',
    {tenantId,flowId:source,baseRevision:activeDraft.revision});
   if(!enabled()||activeDraft?.id!==source)return;
   await loadSnapshots(source,r.snapshot.id);
  }catch(err){if(enabled())asError(err)}
  finally{freezeButton.disabled=!editable}
 },true);
 const frozenRehearsal=btn('Rehearse frozen version (no calls)',async()=>{
  if(!editable||!activeDraft||!frozenChoice.value)return;
  const expected=activeDraft.id,version=frozenChoice.value;
  const answers=fictionalAnswers.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(answers.length>12||answers.some(x=>x.length>160)){
   asError(Error('Enter up to 12 fictional replies of 160 characters each.'));return;
  }
  frozenRehearsal.disabled=true;
  try{
   const r=await api('/v1/human/ai-flow-snapshots/'+encodeURIComponent(version)+'/simulate',
    'POST',{tenantId,answers});
   if(!enabled()||activeDraft?.id!==expected||frozenChoice.value!==version)return;
   frozenResult.replaceChildren(title('Frozen fictional rehearsal','h3'),
    node('p',{class:'note',text:'Simulation only · '+r.status+' · Draft r'+r.snapshot.draftRevision}),
    ...r.transcript.map(x=>node('p',{class:'muted',
     text:(x.speaker==='draft_ai'?'Draft AI: ':'Fictional person: ')+x.text})),
    node('p',{class:'muted',text:'No phone call, AI provider, account lookup or wallet charge.'}));
  }catch(err){if(enabled())asError(err)}
  finally{frozenRehearsal.disabled=!editable||!frozenChoice.value}
 },true);
 const virtualTurnButton=btn('Preview virtual voice turns (no calls)',async()=>{
  if(!editable||!activeDraft||!frozenChoice.value)return;
  const draftId=activeDraft.id,version=frozenChoice.value;
  const answers=fictionalAnswers.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(answers.length>12||answers.some(x=>x.length>160)){
   asError(Error('Use up to 12 fictional answers of 160 characters each.'));return;
  }
  virtualTurnButton.disabled=true;
  try{
   const out=await api('/v1/human/ai-flow-snapshots/'+encodeURIComponent(version)+'/voice-turn-preview',
    'POST',{tenantId,answers});
   if(!enabled()||activeDraft?.id!==draftId||frozenChoice.value!==version)return;
   virtualTurnStatus.textContent='Virtual voice preview: '+out.status+' · '+out.answersUsed+
    ' fictional answers · '+out.providerRequests+' real provider requests';
   virtualTurnResult.replaceChildren(title('Virtual voice adapter commands (text only)','h3'),
    node('p',{class:'muted',text:out.notice}),
    ...(out.commands||[]).map(cmd=>node('p',{class:'muted',text:
     cmd.kind==='would_speak_reviewed_text'?'AI would speak: '+cmd.text:
     cmd.kind==='await_fictional_reply'?'Waiting for fictional reply #'+cmd.questionIndex:
     'Virtual preview would end here.'})),
    ...(out.effects||[]).map(x=>node('p',{class:'muted',text:'Not executed: '+x})));
  }catch(err){if(enabled())asError(err)}
  finally{virtualTurnButton.disabled=!editable||!frozenChoice.value}
 },true);
 virtualTurnButton.disabled=true;
 virtualTurnBox.append(title('Virtual voice-turn preview — NO CALLS','h3'),
  node('p',{class:'muted',text:'Add one fictional answer per line above, then preview the next voice turn. This is a virtual adapter contract only: no Plivo, Sarvam, R2, audio, CRM or credits are used.'}),
  virtualTurnButton,virtualTurnStatus,virtualTurnResult);
 const refreshSnapshots=btn('Refresh frozen versions',()=>{
  if(activeDraft)loadSnapshots(activeDraft.id).catch(asError);
 },true);
 function renderSnapshots(selectId){
  const keep=selectId||frozenChoice.value;
  frozenChoice.replaceChildren(node('option',{value:'',text:'Choose a frozen version'}),
   ...snapshots.map(x=>node('option',{value:x.id,
    text:'Draft r'+x.draftRevision+' · '+x.review+' · '+x.digest.slice(0,8)})));
  frozenChoice.value=snapshots.some(x=>x.id===keep)?keep:'';
  frozenRehearsal.disabled=!editable||!frozenChoice.value;
  virtualTurnButton.disabled=!editable||!frozenChoice.value;
  refreshLaunchReview();
 }
 async function loadSnapshots(draftId,selectId){
  const version=++snapshotSequence;
  const out=await api('/v1/human/ai-flow-snapshots?tenantId='+encodeURIComponent(tenantId)+
   '&flowId='+encodeURIComponent(draftId));
  if(version!==snapshotSequence||!enabled()||activeDraft?.id!==draftId)return;
  snapshots=out.snapshots||[];
  renderSnapshots(selectId);
  frozenNotice.textContent=snapshots.length+' immutable simulation version(s). None may make live calls.';
 }
 frozenChoice.addEventListener('change',()=>{
  frozenRehearsal.disabled=!editable||!frozenChoice.value;
  virtualTurnButton.disabled=!editable||!frozenChoice.value;
  frozenResult.replaceChildren();virtualTurnResult.replaceChildren();refreshLaunchReview();
 });
 snapshotsBox.append(title('Immutable simulation versions','h3'),
  node('p',{class:'muted',text:'Freeze a draft revision for review. Even a reviewed version cannot dial customers.'}),
  editable?freezeButton:null,lab('Frozen versions',frozenChoice),
  div('formrow',editable?frozenRehearsal:null,refreshSnapshots),
  frozenNotice,frozenResult,launchBox,virtualTurnBox);
 const refreshButton=btn('Refresh AI drafts',()=>load().catch(asError),true);
 const previewButton=btn('Preview AI script (no call)',()=>{updatePreview();preview.scrollIntoView({block:'nearest'})},true);
 const controls=div('formrow',previewButton,editable?saveButton:null,refreshButton);
 const advisory=node('p',{class:'muted',text:'This text preview uses no AI provider, customer data, microphone, phone call or CRM write. Finance/banking agents are demonstration drafts requiring separate compliance and recipient-verification work.'});
 editBox.append(title('Draft editor','h3'),lab('Agent name',name),div('formrow',lab('Mode',mode),lab('Language',language)),
  lab('Greeting',greeting),questionLabel,lab('Closing',closing),controls,advisory,preview,
  lab('Fictional answers (one per line; no customer information)',fictionalAnswers),
  simulateButton,simulation,snapshotsBox);
 function editorValue(){
  const raw=questions.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(raw.length>12||raw.some(x=>x.length>250))throw Error('Enter no more than 12 questions of 250 characters each.');
  if(mode.value==='announcement'&&raw.length)throw Error('Announcement mode has no questions. Clear the question lines first.');
  if(mode.value!=='announcement'&&!raw.length)throw Error('Interactive or hybrid mode needs at least one question.');
  return {templateId:activeDraft.config.templateId,name:name.value.trim(),
   mode:mode.value,language:language.value,greeting:greeting.value.trim(),questions:raw,closing:closing.value.trim()};
 }
 function updatePreview(){
  if(!activeDraft){preview.replaceChildren(node('p',{class:'muted',text:'Create or select a draft to preview its script.'}));return}
  const t=templates.find(x=>x.id===activeDraft.config.templateId);
  const text=[greeting.value.trim(),...questions.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),closing.value.trim()];
  preview.replaceChildren(title('Text preview — no call','h3'),
   node('p',{class:'muted',text:(t?.label||'AI Agent')+' · '+mode.value+' · '+language.value+(t?.regulated?' · Regulated: Demo only':'')}),
   ...text.filter(Boolean).map((line,i)=>node('p',{class:i===0?'note':'muted',text:line})),
   node('p',{class:'note',text:'No voice was generated. No customer, CRM or provider data was read.'}));
 }
 function fillDraftOptions(){
  const wanted=activeId;
  existing.replaceChildren(node('option',{value:'',text:'Choose an AI draft'}),
    ...drafts.map(d=>node('option',{value:d.id,text:d.config.name+' · '+d.industry+' · draft v'+d.revision})));
  if(drafts.some(x=>x.id===wanted))existing.value=wanted;else existing.value='';
 }
 function showEditor(){
  activeDraft=drafts.find(x=>x.id===activeId)||null;
  fictionalAnswers.value='';simulation.replaceChildren();frozenResult.replaceChildren();virtualTurnResult.replaceChildren();
  snapshots=[];snapshotSequence++;launchSequence++;frozenChoice.replaceChildren();launchBox.hidden=true;
  editBox.hidden=!activeDraft;
  if(!activeDraft)return;
  const c=activeDraft.config,t=templates.find(x=>x.id===c.templateId);
  name.value=c.name;greeting.value=c.greeting;questions.value=c.questions.join('\n');closing.value=c.closing;
  language.value=c.language;
  mode.replaceChildren(...(t?.allowedModes||[c.mode]).map(v=>node('option',{value:v,text:v==='announcement'?'Announcement — information only':v==='interactive'?'Interactive — questions':'Hybrid — information and questions'})));
  mode.value=c.mode;
  const readonly=!editable;
  for(const field of [name,mode,language,greeting,questions,closing])field.disabled=readonly;
  saveButton.disabled=readonly;
  simulateButton.disabled=readonly;
  freezeButton.disabled=readonly;frozenChoice.disabled=readonly;virtualTurnButton.disabled=readonly;
  fictionalAnswers.disabled=readonly;
  questionLabel.hidden=mode.value==='announcement';
  mode.onchange=()=>{questionLabel.hidden=mode.value==='announcement';updatePreview()};
  for(const field of [name,language,greeting,questions,closing])field.oninput=updatePreview;
  updatePreview();
  loadSnapshots(activeDraft.id).catch(err=>{if(enabled())frozenNotice.textContent='Could not load frozen versions.'});
 }
 async function load(selectId){
  const version=++sequence;
  status.textContent='Loading drafts…';
  const query='?tenantId='+encodeURIComponent(tenantId);
  const [catalog,profile,list]=await Promise.all([
   api('/v1/human/industry-templates'+query),
   api('/v1/human/industry-profiles'+query),
   api('/v1/human/ai-flows'+query)
  ]);
  if(version!==sequence||!enabled())return;
  templates=catalog.templates||[];drafts=list.drafts||[];
  profileRevision=profile.profile?.revision||0;
  business.replaceChildren(...(profile.availableIndustries||[]).map(v=>node('option',{value:v,text:v.replaceAll('_',' ')})));
  if(profile.profile)business.value=profile.profile.industryCode;
  choose.replaceChildren(...templates.map(t=>node('option',{value:t.id,
   text:t.label+(t.regulated?' (Demo only)':'')})));
  saveProfile.disabled=!editable;
  if(selectId)activeId=selectId;
  else if(!drafts.some(x=>x.id===activeId))activeId=drafts[0]?.id||'';
  fillDraftOptions();showEditor();
  status.textContent=drafts.length+' draft agent(s). None can dial customers.';
 }
 profileBox.append(title('Business category','h3'),node('p',{class:'muted',text:'Changing this preference never changes any live calling or existing property data.'}),
  div('formrow',lab('Industry',business),editable?saveProfile:null),profileStatus);
 if(!editable){choose.disabled=true;newButton.disabled=true;saveProfile.disabled=true}
 editBox.hidden=true;
 load().catch(error=>{if(enabled()){status.textContent='Could not load AI drafts.';asError(error)}});
}
`;
