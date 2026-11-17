export const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1120"><title>AR3D AI Calling</title><link rel="stylesheet" href="/app/assets/style.css"></head><body><div id="app" role="main"><p>Loading AR3D AI Calling…</p></div><script src="/app/assets/app.js" defer></script></body></html>`;
export const css=`:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#e9eef9;background:#0b1120}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(115deg,#0b1120,#101d31)}button,input,select,textarea{font:inherit}button{cursor:pointer}.layout{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:100vh}.sidebar{background:#111c2c;border-right:1px solid #27334a;padding:28px 18px}.brand{font-size:1.28rem;font-weight:800;letter-spacing:-.025em}.brand small{display:block;font-size:.78rem;color:#7ca6fe;font-weight:550;letter-spacing:.1em;margin-top:4px}.muted{color:#91a4be}.navitem{padding:12px 14px;border-radius:10px;background:#1c3049;margin:22px 0}.main{padding:32px;min-width:0;max-width:1280px;width:100%;margin:auto}h1,h2,h3{margin-top:0;letter-spacing:-.035em}h1{font-size:clamp(1.6rem,3vw,2.4rem)}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.between{justify-content:space-between}.card{border:1px solid #2a3a54;background:#132139;border-radius:16px;padding:22px;margin:16px 0;box-shadow:0 12px 32px #0002}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:12px}.metric strong{font-size:2rem;display:block;color:white;margin-top:8px}.label{display:block;font-weight:650;font-size:.88rem;margin-bottom:6px}.field{padding:11px 12px;min-width:170px;max-width:100%;border:1px solid #40506a;background:#0d192c;color:#fff;border-radius:9px}textarea.field{min-height:95px;resize:vertical}.btn{border:0;border-radius:10px;padding:11px 16px;background:#578cff;color:#091323;font-weight:750}.btn:hover{background:#82aaff}.btn.secondary{background:#293c58;color:#e1e9f9}.btn:disabled{opacity:.5;cursor:not-allowed}.formrow{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}.formrow label{flex:1;min-width:170px}.formrow .field{width:100%}.tablewrap{overflow-x:auto}.table{width:100%;border-collapse:collapse;font-size:.9rem}.table th,.table td{padding:12px;text-align:left;border-bottom:1px solid #283a54}.table th{color:#9eacc4;font-weight:600}.pill{display:inline-block;background:#203e51;border-radius:100px;padding:4px 8px;color:#b4e4e3;font-size:.78rem}.note{border-left:3px solid #7ca6fe;padding:8px 12px;color:#bccae1;background:#1a2c45;border-radius:4px}.err{color:#ffb0b0}.success{color:#8ff0ba}.auth{min-height:100vh;display:grid;place-items:center;padding:24px}.auth .card{width:min(460px,100%)}.stack{display:grid;gap:14px}.stack label .field{width:100%}.banner{padding:12px 14px;border:1px solid #355c7b;background:#17324d;border-radius:8px;margin:16px 0;overflow-wrap:anywhere}a{color:#8eb5ff}pre{white-space:pre-wrap;overflow-wrap:anywhere}.foot{margin-top:20px;font-size:.8rem;color:#8a9db7}@media(max-width:760px){.layout{display:block}.sidebar{padding:14px 18px;border-bottom:1px solid #27334a}.navitem{margin:8px 0}.main{padding:18px}.card{padding:15px}.formrow{display:grid}.formrow label{min-width:0}}`;
export const js=String.raw`'use strict';
const root=document.getElementById('app');
const state={me:null,tenant:null,notice:''};
const node=(tag,props={},children=[])=>{const n=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')n.className=v;else if(k==='value')n.value=v;else if(k==='type')n.type=v;else if(k==='onclick')n.addEventListener('click',v);else if(k==='onsubmit')n.addEventListener('submit',v);else if(k==='text')n.textContent=v;else n.setAttribute(k,String(v))}for(const ch of (Array.isArray(children)?children:[children])){if(ch!==null&&ch!==undefined)n.append(ch instanceof Node?ch:document.createTextNode(String(ch)))}return n};
const div=(className,...ch)=>node('div',{class:className},ch);
const title=(s,tag='h2')=>node(tag,{text:s});
const btn=(label,fn,secondary=false)=>node('button',{class:'btn'+(secondary?' secondary':''),type:'button',onclick:fn,text:label});
const input=(name,type='text',placeholder='')=>node('input',{class:'field',name,type,placeholder,required:'required'});
const lab=(text,control)=>node('label',{},[node('span',{class:'label',text}),control]);
function notice(msg,isError=false){state.notice=msg;const old=document.getElementById('notice');if(old)old.remove();const area=document.getElementById('notice-anchor')||root;area.prepend(node('div',{id:'notice',class:'banner '+(isError?'err':'success'),text:msg}))}
async function api(path,method='GET',payload){const r=await fetch(path,{method,credentials:'same-origin',headers:payload?{'Content-Type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data}
function asError(e){notice(e instanceof Error?e.message:'Unexpected error',true)}
function table(headers,rows){const t=node('table',{class:'table'});const h=node('tr');headers.forEach(v=>h.append(node('th',{text:v})));t.append(node('thead',{},h));const b=node('tbody');rows.forEach(row=>{const tr=node('tr');row.forEach(v=>tr.append(node('td',{text:String(v??'—')})));b.append(tr)});t.append(b);return div('tablewrap',t)}
async function load(){try{state.me=await api('/v1/human/me');dashboard()}catch{login()}}
function login(){root.replaceChildren();const email=input('email','email','you@company.com'),pass=input('password','password','Minimum 12 characters');email.autocomplete='username';pass.autocomplete='current-password';const form=node('form',{class:'stack'},[lab('Email address',email),lab('Password',pass),node('button',{class:'btn',type:'submit',text:'Sign in'})]);form.addEventListener('submit',async e=>{e.preventDefault();try{await api('/v1/human/login','POST',{email:email.value,password:pass.value});await load()}catch(err){asError(err)}});root.append(div('auth',div('card',title('AR3D AI Calling','h1'),node('p',{class:'muted',text:'Secure Super Admin & Client Login'}),div('stack',form),node('p',{class:'foot',text:'Human login is separate from backend API keys.'}))));if(location.hash.startsWith('#invite='))inviteView(location.hash.slice(8))}
function inviteView(token){root.replaceChildren();const email=input('email','email','invited@company.com'),pass=input('password','password','At least 12 characters');pass.autocomplete='new-password';const form=node('form',{class:'stack'},[lab('Invited email',email),lab('Create password',pass),node('button',{class:'btn',type:'submit',text:'Activate client account'})]);form.addEventListener('submit',async e=>{e.preventDefault();try{await api('/v1/human/accept-invite','POST',{token,email:email.value,password:pass.value});history.replaceState(null,'','/app');await load()}catch(err){asError(err)}});root.append(div('auth',div('card',title('Accept client invitation','h1'),node('p',{class:'muted',text:'Only accept an invitation you were expecting.'}),form)))}
async function logout(){try{await api('/v1/human/logout','POST',{})}finally{state.me=null;login()}}
function dashboard(){root.replaceChildren();const aside=div('sidebar',node('div',{class:'brand',text:'AR3D AI Calling'},node('small',{text:'MULTI-TENANT PLATFORM'})),div('navitem',state.me.superAdmin?'Super Admin':'Client Dashboard'),node('p',{class:'muted',text:state.me.email}),btn('Sign out',logout,true));const main=div('main',div('row between',title(state.me.superAdmin?'Super Admin':'Personal AI Calling','h1'),node('span',{class:'pill',text:'Development / No live calls'})),div('',node('div',{id:'notice-anchor'})));root.append(div('layout',aside,main));if(state.me.superAdmin)superAdmin(main);if(state.me.tenants.length)clientPanel(main)}
async function superAdmin(main){const panel=div('card',title('Subscription Clients'));main.append(panel);const list=div('');panel.append(list);async function refresh(){try{const d=await api('/v1/human/tenants');list.replaceChildren(table(['Client','Plan','Storage','Status','Members'],d.tenants.map(t=>[t.display_name,t.plan_code,t.storage_mode,t.status,t.member_count])))}catch(e){asError(e)}}await refresh();const name=input('name','text','Builder company'),slug=input('slug','text','builder-company');const plan=node('select',{class:'field',name:'plan'},['starter','growth','enterprise'].map(p=>node('option',{value:p,text:p})));const mode=node('select',{class:'field'},['shared','dedicated'].map(p=>node('option',{value:p,text:p})));const f=node('form',{class:'formrow'},[lab('Company',name),lab('Slug',slug),lab('Subscription plan',plan),lab('Storage',mode),node('button',{class:'btn',type:'submit',text:'Add client'})]);f.addEventListener('submit',async e=>{e.preventDefault();try{const d=await api('/v1/human/tenants','POST',{displayName:name.value,slug:slug.value,plan:plan.value,storageMode:mode.value});notice('Client created: '+d.slug);f.reset();await refresh();await inviteSection(main)}catch(err){asError(err)}});panel.append(title('Create client','h3'),f);await inviteSection(main)}
async function inviteSection(main){const previous=document.getElementById('invite-card');if(previous)previous.remove();const card=div('card');card.id='invite-card';card.append(title('Invite client admin','h2'),node('p',{class:'muted',text:'Invitation link shown once. Share privately with the intended client.'}));const select=node('select',{class:'field'},[node('option',{value:'',text:'Choose company'})]);const tenants=await api('/v1/human/tenants');tenants.tenants.forEach(t=>select.append(node('option',{value:t.id,text:t.display_name})));const email=input('email','email','client@builder.com');const role=node('select',{class:'field'},['client_admin','viewer'].map(x=>node('option',{value:x,text:x})));const f=node('form',{class:'formrow'},[lab('Company',select),lab('Client email',email),lab('Role',role),node('button',{type:'submit',class:'btn',text:'Create invitation'})]);f.addEventListener('submit',async e=>{e.preventDefault();try{const d=await api('/v1/human/invitations','POST',{tenantId:select.value,email:email.value,role:role.value});const share=node('input',{class:'field',value:d.inviteUrl,readonly:'readonly',style:'width:100%'});card.append(div('banner',node('p',{text:'Share this one-time link securely:'}),share));notice('Invitation generated for '+email.value)}catch(err){asError(err)}});card.append(f);main.append(card)}
async function clientPanel(main){const panel=div('card',title('Personal CRM & AI Agent'));main.append(panel);const select=node('select',{class:'field'},state.me.tenants.map(t=>node('option',{value:t.id,text:t.name+' — '+t.plan})));const content=div('');panel.append(lab('Your company',select),content);select.addEventListener('change',()=>renderClient(select.value,content));await renderClient(select.value,content)}
async function renderClient(id,content){content.replaceChildren(node('p',{class:'muted',text:'Loading client dashboard…'}));try{const d=await api('/v1/human/overview?tenantId='+encodeURIComponent(id));content.replaceChildren();const cards=div('cards',...[['Leads',d.metrics.leads],['Draft AI Agents',d.metrics.agents],['Calls',d.metrics.calls],['Site Visits',d.metrics.siteVisits]].map(([name,val])=>div('card metric',node('span',{class:'muted',text:name}),node('strong',{text:String(val)}))));content.append(cards);content.append(node('p',{class:'note',text:'Calling is not enabled. Imported and manually added leads remain consent/DND unknown until verified.'}));const leadCard=div('card',title('Leads','h3'),table(['Name','Mobile','Source','Consent'],d.leads.map(l=>[l.name,l.mobile,l.sourceType,l.consentStatus])));content.append(leadCard);const name=input('name','text','Customer name'),mobile=input('mobile','tel','9876543210');const leadForm=node('form',{class:'formrow'},[lab('Name',name),lab('Mobile',mobile),node('button',{class:'btn',type:'submit',text:'Add lead'})]);leadForm.addEventListener('submit',async e=>{e.preventDefault();try{await api('/v1/human/leads','POST',{tenantId:id,name:name.value,mobile:mobile.value});notice('Lead saved without calling consent');await renderClient(id,content)}catch(err){asError(err)}});if(d.role==='client_admin')leadCard.append(leadForm);const agentCard=div('card',title('AI Agents','h3'),table(['Name','Language','Status'],d.agents.map(a=>[a.displayName,a.languageMode,a.status])));content.append(agentCard);if(d.role==='client_admin'){const agentName=input('displayName','text','Sales Agent'),language=node('select',{class:'field'},['hi-en','hi','en'].map(x=>node('option',{value:x,text:x}))),q=node('textarea',{class:'field',placeholder:'One question per line',rows:4});const agentForm=node('form',{class:'stack'},[lab('AI Agent Name',agentName),lab('Language',language),lab('Questions (one per line)',q),node('button',{class:'btn',type:'submit',text:'Save draft AI Agent'})]);agentForm.addEventListener('submit',async e=>{e.preventDefault();try{await api('/v1/human/agents','POST',{tenantId:id,displayName:agentName.value,languageMode:language.value,questions:q.value.split('\n').map(s=>s.trim()).filter(Boolean)});notice('Draft AI Agent saved');await renderClient(id,content)}catch(err){asError(err)}});agentCard.append(agentForm)}await crmWorkflow(id,content,d.role)}catch(e){content.replaceChildren();asError(e)}}
// CRM workflows: CSV/XLSX Preview/Import, statuses, notes and requested site visits.
async function crmWorkflow(tenantId,content,role){
  const editable=role==='client_admin';
  const workflow=div('card',title('Lead Workflow & Excel Import','h3'));
  workflow.append(node('p',{class:'note',text:'Excel .xlsx या CSV UTF-8 अपलोड करें (अधिकतम 200 leads)। Import से calling consent नहीं मिलता; consent/DND unknown रहेगा।'}));
  content.append(workflow);
  if(editable){
    const picker=node('input',{class:'field',type:'file',accept:'.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),previewBox=div(''),csvBox=div('formrow',lab('Excel .xlsx or CSV file',picker));
    let importData=null;
    async function makeImportPayload(file){
      const lower=file.name.toLowerCase();
      if(lower.endsWith('.csv')){
        if(file.size>160000)throw Error('Choose a CSV file under 160 KB');
        return {tenantId,csv:await file.text(),format:'csv'};
      }
      if(!lower.endsWith('.xlsx')||file.size>1048576)throw Error('Choose an .xlsx under 1 MB or .csv under 160 KB');
      const bytes=new Uint8Array(await file.arrayBuffer());
      let raw='';for(let i=0;i<bytes.length;i+=16384)raw+=String.fromCharCode(...bytes.subarray(i,i+16384));
      return {tenantId,format:'xlsx',xlsxBase64:btoa(raw)};
    }
    const previewBtn=btn('Validate & Preview',async()=>{
      try{
        const file=picker.files?.[0];if(!file)throw Error('Choose an Excel or CSV file');
        importData=await makeImportPayload(file);
        const result=await api('/v1/human/import/preview','POST',importData);
        previewBox.replaceChildren(node('p',{class:'success',text:result.rows+' valid rows. Existing numbers will be skipped.'}),
          table(['Name','Mobile','Location','Max budget'],result.preview.map(r=>[r.name,r.mobile,r.location,r.budgetMaxInr])));
        commitBtn.disabled=false;
      }catch(e){importData=null;commitBtn.disabled=true;previewBox.replaceChildren();asError(e)}
    });
    const commitBtn=btn('Import to CRM',async()=>{
      if(importData===null)return;
      commitBtn.disabled=true;
      try{const result=await api('/v1/human/import/commit','POST',importData);
        notice('Import finished: '+result.inserted+' new, '+result.skipped+' duplicates. No calls placed.');
        await renderClient(tenantId,content);
      }catch(e){asError(e);commitBtn.disabled=false}
    });commitBtn.disabled=true;
    picker.addEventListener('change',()=>{importData=null;commitBtn.disabled=true;previewBox.replaceChildren()});
    csvBox.append(previewBtn,commitBtn);workflow.append(csvBox,previewBox);
  }
  const search=input('search','search','Name, number or location');search.required=false;
  const filter=node('select',{class:'field'},['','new','contacted','interested','followup','not_interested','converted']
    .map(s=>node('option',{value:s,text:s||'All statuses'})));
  const searchBtn=btn('Search',()=>refresh().catch(asError),true);
  const tableArea=div(''),details=div(''),visitArea=div('');
  workflow.append(div('formrow',lab('Search leads',search),lab('Interest status',filter),searchBtn),tableArea,details);
  const schedule=div('card',title('Site Visits','h3'));workflow.append(schedule,visitArea);
  async function visitList(){
    const result=await api('/v1/human/visits?tenantId='+encodeURIComponent(tenantId));
    visitArea.replaceChildren(table(['Lead','Scheduled','Status','Note'],result.visits.map(v=>[
      v.leadName,new Date(v.scheduledAt).toLocaleString(),v.status,v.note
    ])));
  }
  function selectLead(lead){
    details.replaceChildren(title('Lead: '+(lead.name||lead.mobile),'h3'),node('p',{class:'muted',text:'Consent: '+lead.consentStatus+' · DND: '+lead.dndStatus}));
    const editStatus=node('select',{class:'field'},['new','contacted','interested','followup','not_interested','converted']
      .map(s=>node('option',{value:s,text:s})));
    editStatus.value=lead.interestStatus;
    const loc=input('location','text','Preferred location');loc.required=false;loc.value=lead.preferredLocation||'';
    const min=input('min','number','Budget minimum INR'),max=input('max','number','Budget maximum INR');
    min.required=false;max.required=false;
    min.min='0';max.min='0';min.value=lead.budgetMinInr??'';max.value=lead.budgetMaxInr??'';
    const follow=input('follow','datetime-local');follow.required=false;
    if(lead.followupAt){const d=new Date(lead.followupAt); const localDate=new Date(d.getTime()-d.getTimezoneOffset()*60000);follow.value=localDate.toISOString().slice(0,16)}
    const form=node('form',{class:'formrow'},[lab('Status',editStatus),lab('Location',loc),lab('Min budget',min),lab('Max budget',max),lab('Follow-up',follow)]);
    if(editable){form.append(node('button',{class:'btn',type:'submit',text:'Update lead'}));
      form.addEventListener('submit',async e=>{e.preventDefault();try{
        await api('/v1/human/leads/'+lead.id,'PATCH',{tenantId,interestStatus:editStatus.value,preferredLocation:loc.value,
          budgetMinInr:min.value===''?null:Number(min.value),budgetMaxInr:max.value===''?null:Number(max.value),
          followupAt:follow.value?new Date(follow.value).toISOString():null});
        notice('Lead updated');await refresh();
      }catch(err){asError(err)}})}else{form.querySelectorAll('input,select').forEach(el=>el.disabled=true)}
    details.append(form);
    const notesArea=div('');details.append(title('Private Notes','h3'),notesArea);
    const fetchNotes=async()=>{const notes=await api('/v1/human/notes?tenantId='+encodeURIComponent(tenantId)+'&leadId='+lead.id);
      notesArea.replaceChildren(table(['Note','Added'],notes.notes.map(n=>[n.text,new Date(n.createdAt).toLocaleString()])))};
    fetchNotes().catch(asError);
    if(editable){
      const note=input('note','text','Short private note');note.required=true;
      const f=node('form',{class:'formrow'},[lab('New Note',note),node('button',{class:'btn',type:'submit',text:'Save note'})]);
      f.addEventListener('submit',async e=>{e.preventDefault();try{
        await api('/v1/human/notes','POST',{tenantId,leadId:lead.id,text:note.value});note.value='';await fetchNotes();notice('Note saved')
      }catch(err){asError(err)}});details.append(f);
      const at=input('visit','datetime-local');const visitNote=input('note','text','Location / meeting point');visitNote.required=false;
      const vf=node('form',{class:'formrow'},[lab('Site visit date/time',at),lab('Visit note',visitNote),node('button',{type:'submit',class:'btn',text:'Request visit'})]);
      vf.addEventListener('submit',async e=>{e.preventDefault();try{
        if(!at.value)throw Error('Choose a visit date/time');
        await api('/v1/human/visits','POST',{tenantId,leadId:lead.id,scheduledAt:new Date(at.value).toISOString(),note:visitNote.value});
        notice('Site visit request saved');await visitList();
      }catch(err){asError(err)}});details.append(vf)
    }
  }
  async function refresh(){
    const params=new URLSearchParams({tenantId,limit:'50',status:filter.value,q:search.value.trim()});
    const result=await api('/v1/human/leads?'+params.toString());
    const tbl=node('table',{class:'table'});const head=node('tr');
    ['Name','Mobile','Location','Budget','Status','Action'].forEach(t=>head.append(node('th',{text:t})));
    tbl.append(node('thead',{},head));const body=node('tbody');
    for(const lead of result.leads){const row=node('tr');
      [lead.name,lead.mobile,lead.preferredLocation,lead.budgetMaxInr,lead.interestStatus].forEach(t=>row.append(node('td',{text:String(t??'—')})));
      row.append(node('td',{},btn('Details',()=>selectLead(lead),true)));body.append(row)}
    tbl.append(body);tableArea.replaceChildren(node('p',{class:'muted',text:result.total+' matching leads (first '+result.leads.length+' shown)'}),div('tablewrap',tbl));
    details.replaceChildren();
  }
  await Promise.all([refresh(),visitList()]);
}

load();`;
