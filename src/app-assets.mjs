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
function login(){root.replaceChildren();const email=input('email','email','you@company.com'),pass=input('password','password','Minimum 12 characters');email.autocomplete='username';pass.autocomplete='current-password';const form=node('form',{class:'stack'},[lab('Email address',email),lab('Password',pass),node('button',{class:'btn',type:'submit',text:'Sign in'})]);form.addEventListener('submit',async e=>{e.preventDefault();try{const res=await api('/v1/human/login','POST',{email:email.value,password:pass.value});if(res.mfaRequired){mfaChallengeView(res.challenge);return}await load()}catch(err){asError(err)}});root.append(div('auth',div('card',title('AR3D AI Calling','h1'),node('p',{class:'muted',text:'Secure Super Admin & Client Login'}),div('stack',form),node('p',{class:'foot',text:'Human login is separate from backend API keys.'}))));if(location.hash.startsWith('#invite='))inviteView(location.hash.slice(8))}
function mfaChallengeView(challenge){
  root.replaceChildren();
  const mode=node('select',{class:'field'},[
    node('option',{value:'totp',text:'Authenticator 6-digit code'}),
    node('option',{value:'recovery',text:'One-time recovery code'})
  ]);
  const code=input('otp','text','6-digit code');
  code.autocomplete='one-time-code';code.inputMode='numeric';code.maxLength=6;
  mode.addEventListener('change',()=>{
    code.value='';
    if(mode.value==='totp'){code.placeholder='6-digit code';code.maxLength=6;code.inputMode='numeric'}
    else{code.placeholder='AR3D-XXXX-... backup code';code.maxLength=45;code.inputMode='text'}
  });
  const f=node('form',{class:'stack'},[
    lab('Verification method',mode),lab('Verification code',code),
    node('button',{class:'btn',type:'submit',text:'Verify and sign in'})
  ]);
  f.addEventListener('submit',async e=>{
    e.preventDefault();
    try{
      const payload={challenge};
      if(mode.value==='totp')payload.code=code.value;
      else payload.recoveryCode=code.value;
      await api('/v1/human/login/mfa','POST',payload);
      await load();
    }catch(err){asError(err)}
  });
  root.append(div('auth',div('card',title('Two-factor verification','h1'),
    node('p',{class:'muted',text:'Use your authenticator or an unused recovery code. The challenge expires after 5 minutes.'}),
    f,btn('Back to login',login,true))));
}
function inviteView(token){root.replaceChildren();const email=input('email','email','invited@company.com'),pass=input('password','password','At least 12 characters');pass.autocomplete='new-password';const form=node('form',{class:'stack'},[lab('Invited email',email),lab('Create password',pass),node('button',{class:'btn',type:'submit',text:'Activate client account'})]);form.addEventListener('submit',async e=>{e.preventDefault();try{await api('/v1/human/accept-invite','POST',{token,email:email.value,password:pass.value});history.replaceState(null,'','/app');await load()}catch(err){asError(err)}});root.append(div('auth',div('card',title('Accept client invitation','h1'),node('p',{class:'muted',text:'Only accept an invitation you were expecting.'}),form)))}
async function logout(){try{await api('/v1/human/logout','POST',{})}finally{state.me=null;login()}}
function dashboard(){root.replaceChildren();const aside=div('sidebar',node('div',{class:'brand',text:'AR3D AI Calling'},node('small',{text:'MULTI-TENANT PLATFORM'})),div('navitem',state.me.superAdmin?'Super Admin':'Client Dashboard'),node('p',{class:'muted',text:state.me.email}),node('a',{href:'/app/simulator',class:'navitem',text:'Test AI Conversation'}),btn('Sign out',logout,true));const main=div('main',div('row between',title(state.me.superAdmin?'Super Admin':'Personal AI Calling','h1'),node('span',{class:'pill',text:'Development / No live calls'})),div('',node('div',{id:'notice-anchor'})));root.append(div('layout',aside,main));if(state.me.superAdmin){mfaPanel(main);superAdmin(main)}if(state.me.tenants.length)clientPanel(main)}
function showRecoveryCodes(target,codes){
  target.replaceChildren(node('p',{class:'success',text:'Save these one-time recovery codes now. Each works only once. They will not be displayed again.'}));
  const box=node('textarea',{class:'field',rows:'8',readonly:'readonly'});
  box.value=codes.join('\n');
  target.append(lab('Recovery codes — keep offline and private',box),
    node('p',{class:'note',text:'Do not send these codes in messages or screenshots. Store them in a trusted password manager or secure offline record.'}));
}
async function mfaPanel(main){
  const card=div('card',title('Super Admin Two-Factor Authentication'));
  main.append(card);
  try{
    const status=await api('/v1/human/mfa');
    const section=div('stack');card.append(section);
    if(status.enabled){
      section.append(node('p',{class:'success',text:'Authenticator MFA enabled. Each new login needs an authenticator or an unused recovery code.'}),
        node('p',{class:'note',text:'Generate a new set of backup codes using your password and current authenticator. All previous backup codes will stop working.'}));
      const pass=input('password','password','Current password');
      const otp=input('otp','text','6-digit authenticator code');
      otp.inputMode='numeric';otp.maxLength=6;otp.pattern='[0-9]{6}';otp.autocomplete='one-time-code';
      const output=div('stack');
      const form=node('form',{class:'stack'},[lab('Current password',pass),lab('Current authenticator code',otp),
        node('button',{class:'btn',type:'submit',text:'Replace recovery codes'})]);
      form.addEventListener('submit',async e=>{
        e.preventDefault();
        if(!confirm('Replace all existing recovery codes? Old recovery codes will stop working.'))return;
        try{
          const data=await api('/v1/human/mfa/recovery/regenerate','POST',{password:pass.value,code:otp.value});
          pass.value='';otp.value='';
          showRecoveryCodes(output,data.recoveryCodes);
        }catch(err){asError(err)}
      });
      section.append(form,output);
      return;
    }
    section.append(node('p',{class:'note',text:'Set up an authenticator, confirm its code, then save the one-time recovery codes shown after activation.'}));
    if(!status.configured){
      section.append(node('p',{class:'err',text:'MFA_ENCRYPTION_KEY must be configured as a Cloudflare Worker secret before setup.'}));
      return;
    }
    const start=btn('Set up Authenticator',async()=>{
      try{
        const data=await api('/v1/human/mfa/setup','POST',{});
        section.replaceChildren(node('p',{class:'note',text:'Add this secret manually to your authenticator (TOTP SHA1, 6 digits, 30 seconds). Never share it.'}));
        const seed=node('input',{class:'field',value:data.secret,readonly:'readonly'});
        section.append(lab('One-time setup secret',seed));
        const otp=input('otp','text','6-digit code');
        otp.inputMode='numeric';otp.maxLength=6;otp.pattern='[0-9]{6}';otp.autocomplete='one-time-code';
        const form=node('form',{class:'formrow'},[
          lab('Confirm authenticator code',otp),
          node('button',{class:'btn',type:'submit',text:'Enable MFA'})
        ]);
        form.addEventListener('submit',async e=>{
          e.preventDefault();
          try{
            const result=await api('/v1/human/mfa/enable','POST',{code:otp.value});
            const codes=result.recoveryCodes;
            if(!Array.isArray(codes)||codes.length!==8)throw Error('Recovery codes missing — contact administrator before relying on MFA');
            showRecoveryCodes(section,codes);
          }catch(err){asError(err)}
        });
        section.append(form);
      }catch(err){asError(err)}
    });
    section.append(start);
  }catch(err){asError(err)}
}
async function superAdmin(main){const panel=div('card',title('Subscription Clients'));main.append(panel);const list=div('');panel.append(list);async function refresh(){try{const d=await api('/v1/human/tenants');list.replaceChildren(table(['Client','Plan','Storage','Status','Members'],d.tenants.map(t=>[t.display_name,t.plan_code,t.storage_mode,t.status,t.member_count])))}catch(e){asError(e)}}await refresh();const name=input('name','text','Builder company'),slug=input('slug','text','builder-company');const plan=node('select',{class:'field',name:'plan'},['starter','growth','enterprise'].map(p=>node('option',{value:p,text:p})));const mode=node('select',{class:'field'},['shared','dedicated'].map(p=>node('option',{value:p,text:p})));const f=node('form',{class:'formrow'},[lab('Company',name),lab('Slug',slug),lab('Subscription plan',plan),lab('Storage',mode),node('button',{class:'btn',type:'submit',text:'Add client'})]);f.addEventListener('submit',async e=>{e.preventDefault();try{const d=await api('/v1/human/tenants','POST',{displayName:name.value,slug:slug.value,plan:plan.value,storageMode:mode.value});notice('Client created: '+d.slug);f.reset();await refresh();await inviteSection(main)}catch(err){asError(err)}});panel.append(title('Create client','h3'),f);await inviteSection(main)}
async function inviteSection(main){const previous=document.getElementById('invite-card');if(previous)previous.remove();const card=div('card');card.id='invite-card';card.append(title('Invite client admin','h2'),node('p',{class:'muted',text:'Invitation link shown once. Share privately with the intended client.'}));const select=node('select',{class:'field'},[node('option',{value:'',text:'Choose company'})]);const tenants=await api('/v1/human/tenants');tenants.tenants.forEach(t=>select.append(node('option',{value:t.id,text:t.display_name})));const email=input('email','email','client@builder.com');const role=node('select',{class:'field'},['client_admin','viewer'].map(x=>node('option',{value:x,text:x})));const f=node('form',{class:'formrow'},[lab('Company',select),lab('Client email',email),lab('Role',role),node('button',{type:'submit',class:'btn',text:'Create invitation'})]);f.addEventListener('submit',async e=>{e.preventDefault();try{const d=await api('/v1/human/invitations','POST',{tenantId:select.value,email:email.value,role:role.value});const share=node('input',{class:'field',value:d.inviteUrl,readonly:'readonly',style:'width:100%'});card.append(div('banner',node('p',{text:'Share this one-time link securely:'}),share));notice('Invitation generated for '+email.value)}catch(err){asError(err)}});card.append(f);main.append(card)}
async function clientPanel(main){const panel=div('card',title('Personal CRM & AI Agent'));main.append(panel);const select=node('select',{class:'field'},state.me.tenants.map(t=>node('option',{value:t.id,text:t.name+' — '+t.plan})));const content=div('');panel.append(lab('Your company',select),content);select.addEventListener('change',()=>renderClient(select.value,content));await renderClient(select.value,content)}
async function renderClient(id,content){content.replaceChildren(node('p',{class:'muted',text:'Loading client dashboard…'}));try{const d=await api('/v1/human/overview?tenantId='+encodeURIComponent(id));content.replaceChildren();const cards=div('cards',...[['Leads',d.metrics.leads],['Draft AI Agents',d.metrics.agents],['Calls',d.metrics.calls],['Site Visits',d.metrics.siteVisits]].map(([name,val])=>div('card metric',node('span',{class:'muted',text:name}),node('strong',{text:String(val)}))));content.append(cards);content.append(node('p',{class:'note',text:'Calling is not enabled. Imported and manually added leads remain consent/DND unknown until verified.'}));const leadCard=div('card',title('Leads','h3'),table(['Name','Mobile','Source','Consent'],d.leads.map(l=>[l.name,l.mobile,l.sourceType,l.consentStatus])));content.append(leadCard);const name=input('name','text','Customer name'),mobile=input('mobile','tel','9876543210');const leadForm=node('form',{class:'formrow'},[lab('Name',name),lab('Mobile',mobile),node('button',{class:'btn',type:'submit',text:'Add lead'})]);leadForm.addEventListener('submit',async e=>{e.preventDefault();try{await api('/v1/human/leads','POST',{tenantId:id,name:name.value,mobile:mobile.value});notice('Lead saved without calling consent');await renderClient(id,content)}catch(err){asError(err)}});if(d.role==='client_admin')leadCard.append(leadForm);const agentCard=div('card',title('AI Agents','h3'),table(['Name','Language','Status'],d.agents.map(a=>[a.displayName,a.languageMode,a.status])));content.append(agentCard);if(d.role==='client_admin'){const agentName=input('displayName','text','Sales Agent'),language=node('select',{class:'field'},['hi-en','hi','en'].map(x=>node('option',{value:x,text:x}))),q=node('textarea',{class:'field',placeholder:'One question per line',rows:4});const agentForm=node('form',{class:'stack'},[lab('AI Agent Name',agentName),lab('Language',language),lab('Questions (one per line)',q),node('button',{class:'btn',type:'submit',text:'Save draft AI Agent'})]);agentForm.addEventListener('submit',async e=>{e.preventDefault();try{await api('/v1/human/agents','POST',{tenantId:id,displayName:agentName.value,languageMode:language.value,questions:q.value.split('\n').map(s=>s.trim()).filter(Boolean)});notice('Draft AI Agent saved');await renderClient(id,content)}catch(err){asError(err)}});agentCard.append(agentForm);await agentEditor(id,agentCard)}await crmWorkflow(id,content,d.role);await planningPanels(id,content,d.role);await usageAndExport(id,content,d.role);if(d.role==='client_admin')await auditPanel(id,content)}catch(e){content.replaceChildren();asError(e)}}

async function planningPanels(tenantId,content,role){
  const editable=role==='client_admin';
  const campaignCard=div('card',title('Calling Campaign Drafts — not executable','h3'),
    node('p',{class:'note',text:'Planning only. No call launch, verified consent or telecom provider is available.'}));
  content.append(campaignCard);
  const campaignList=div('');campaignCard.append(campaignList);
  async function refreshCampaigns(){
    const result=await api('/v1/human/campaigns?tenantId='+encodeURIComponent(tenantId));
    campaignList.replaceChildren(table(['Campaign','Language','Purpose','Status'],result.campaigns.map(c=>
      [c.name,c.languageMode,c.purpose,c.status])));
    return result.campaigns;
  }
  const campaignData=await refreshCampaigns();
  if(editable){
    const name=input('campaignName','text','Site visit follow-up');
    name.maxLength=80;
    const language=node('select',{class:'field'},['hi-en','hi','en'].map(value=>node('option',{value,text:value})));
    const purpose=node('select',{class:'field'},['property_information','site_visit'].map(value=>node('option',{value,text:value})));
    const form=node('form',{class:'formrow'},[lab('Name',name),lab('Language',language),lab('Purpose',purpose),
      node('button',{class:'btn',type:'submit',text:'Create draft'})]);
    form.addEventListener('submit',async e=>{e.preventDefault();try{
      await api('/v1/human/campaigns','POST',{tenantId,name:name.value,languageMode:language.value,purpose:purpose.value});
      name.value='';await loadPicks();await refreshCandidateList();notice('Draft saved. Calls are still disabled.');
    }catch(err){asError(err)}});
    campaignCard.append(form);
    const campaignPick=node('select',{class:'field'});
    const candidatePick=node('select',{class:'field'});
    const pickForm=node('form',{class:'formrow'},[lab('Draft campaign',campaignPick),lab('Candidate lead',candidatePick),
      node('button',{class:'btn secondary',type:'submit',text:'Add candidate (no calling)'})]);
    const loadPicks=async()=>{
      const campaigns=await refreshCampaigns(),leads=await api('/v1/human/leads?tenantId='+encodeURIComponent(tenantId)+'&limit=50');
      campaignPick.replaceChildren(...campaigns.map(c=>node('option',{value:c.id,text:c.name})));
      candidatePick.replaceChildren(...leads.leads.filter(l=>l.consentStatus!=='denied'&&l.dndStatus!=='blocked')
        .map(l=>node('option',{value:l.id,text:l.name+' · '+l.mobile})));
    };
    await loadPicks();
    const currentCandidate=node('select',{class:'field'});
    const removeCandidate=btn('Remove from draft',async()=>{
      if(!campaignPick.value||!currentCandidate.value)return;
      try{
        const result=await api('/v1/human/campaigns/'+campaignPick.value+'/candidates/'+currentCandidate.value+
          '?tenantId='+encodeURIComponent(tenantId),'DELETE');
        notice(result.removed?'Candidate removed from draft; no call started.':'Candidate was already absent.');
        await refreshCandidateList();
      }catch(err){asError(err)}
    },true);
    const refreshCandidateList=async()=>{
      currentCandidate.replaceChildren();
      if(!campaignPick.value){removeCandidate.disabled=true;return}
      const d=await api('/v1/human/campaigns/'+campaignPick.value+'/candidates?tenantId='+encodeURIComponent(tenantId));
      currentCandidate.replaceChildren(...d.candidates.map(c=>
        node('option',{value:c.leadId,text:c.name+' — '+c.consentStatus+'/'+c.dndStatus})));
      removeCandidate.disabled=d.candidates.length===0;
    };
    campaignPick.addEventListener('change',()=>refreshCandidateList().catch(asError));
    const candidateActions=div('formrow',lab('Candidates in selected draft',currentCandidate),removeCandidate);
    campaignCard.append(candidateActions);
    await refreshCandidateList();
    pickForm.addEventListener('submit',async e=>{e.preventDefault();try{
      if(!campaignPick.value||!candidatePick.value)throw Error('Create a draft and a lead first');
      const result=await api('/v1/human/campaigns/'+campaignPick.value+'/candidates','POST',
        {tenantId,leadIds:[candidatePick.value]});
      notice('Candidate references added: '+result.inserted+'. No call started.');await refreshCandidateList();
    }catch(err){asError(err)}});
    campaignCard.append(pickForm);
  }
  const projectCard=div('card',title('AR3D Project Links — pending verification','h3'),
    node('p',{class:'note',text:'Metadata only. No Platform/Engine data is fetched.'}));
  content.append(projectCard);
  const links=div('');projectCard.append(links);
  async function refreshLinks(){
    const result=await api('/v1/human/project-links?tenantId='+encodeURIComponent(tenantId));
    links.replaceChildren(table(['Source','Project ID','Slug','Status'],result.links.map(link=>
      [link.source,link.externalProjectId,link.externalSlug,link.status])));
  }
  await refreshLinks();
  if(editable){
    const source=node('select',{class:'field'},['ar3d-platform','ar3d-engine'].map(value=>node('option',{value,text:value})));
    const id=input('projectId','text','External project ID');
    const slug=input('projectSlug','text','External project slug');
    const form=node('form',{class:'formrow'},[lab('Source',source),lab('Project ID',id),lab('Slug',slug),
      node('button',{class:'btn secondary',type:'submit',text:'Register pending link'})]);
    form.addEventListener('submit',async e=>{e.preventDefault();try{
      await api('/v1/human/project-links','POST',{tenantId,source:source.value,externalProjectId:id.value,externalSlug:slug.value});
      id.value='';slug.value='';await refreshLinks();notice('Pending project link recorded; not verified.');
    }catch(err){asError(err)}});
    projectCard.append(form);
  }
}

async function agentEditor(tenantId,card){
  const result=await api('/v1/human/agents?tenantId='+encodeURIComponent(tenantId));
  if(!result.agents.length)return;
  const select=node('select',{class:'field'},result.agents.map(a=>node('option',{value:a.id,text:a.displayName+' ('+a.status+')'})));
  const name=input('editAgentName','text','Agent display name');name.maxLength=120;
  const language=node('select',{class:'field'},['hi-en','hi','en'].map(s=>node('option',{value:s,text:s})));
  const status=node('select',{class:'field'},['draft','paused'].map(s=>node('option',{value:s,text:s})));
  const questions=node('textarea',{class:'field',placeholder:'One question per line',rows:5});
  const form=node('form',{class:'stack'},[lab('Agent',select),lab('Name',name),lab('Language',language),
    lab('Status',status),lab('Questions (1–25)',questions),
    node('button',{class:'btn secondary',type:'submit',text:'Save agent changes'})]);
  function loadSelected(){
    const a=result.agents.find(x=>x.id===select.value);if(!a)return;
    name.value=a.displayName;language.value=a.languageMode;
    status.value=a.status==='paused'?'paused':'draft';questions.value=a.questions.join('\n');
    form.querySelector('button[type=submit]').disabled=a.status==='active';
  }
  select.addEventListener('change',loadSelected);loadSelected();
  form.addEventListener('submit',async e=>{e.preventDefault();try{
    const q=questions.value.split('\n').map(x=>x.trim()).filter(Boolean);
    await api('/v1/human/agents/'+select.value,'PATCH',{tenantId,displayName:name.value,
      languageMode:language.value,questions:q,status:status.value});
    notice('Agent saved as a non-calling draft/paused agent.');
    const a=result.agents.find(x=>x.id===select.value);
    if(a){a.displayName=name.value;a.languageMode=language.value;a.questions=q;a.status=status.value}
  }catch(err){asError(err)}});
  card.append(title('Edit or pause an AI Agent','h3'),
    node('p',{class:'note',text:'No active/live AI agents are permitted yet.'}),form);
}
async function auditPanel(tenantId,content){
  const card=div('card',title('CRM Audit History','h3'),
    node('p',{class:'note',text:'Read-only company actions; no customer transcripts.'}));
  content.append(card);
  const area=div('');card.append(area);let offset=0;
  async function loadHistory(){
    const q=new URLSearchParams({tenantId,limit:'25',offset:String(offset)});
    const result=await api('/v1/human/audit?'+q);
    const prev=btn('← Previous',()=>{offset=Math.max(0,offset-25);loadHistory().catch(asError)},true);
    const next=btn('Next →',()=>{offset+=25;loadHistory().catch(asError)},true);
    prev.disabled=offset===0;next.disabled=offset+result.events.length>=result.total;
    area.replaceChildren(table(['Action','Actor','Date'],result.events.map(a=>
      [a.action,a.actor,new Date(a.createdAt).toLocaleString()])),
      div('formrow',prev,node('span',{class:'muted',text:result.total+' events · page '+(Math.floor(offset/25)+1)}),next));
  }
  await loadHistory();
}

async function usageAndExport(tenantId,content,role){
  const card=div('card',title('CRM Usage & Data Portability','h3'),
    node('p',{class:'note',text:'Record counts only. No paid minutes, billing or real calls are activated.'}));
  content.append(card);
  const usage=await api('/v1/human/usage?tenantId='+encodeURIComponent(tenantId));
  const m=usage.crmStats;
  card.append(table(['Metric','Current total'],[
    ['Plan (not a payment subscription)',usage.planCode],
    ['Leads',String(m.leads)],['AI agent drafts',String(m.agents)],
    ['Draft campaigns',String(m.draftCampaigns)],['Site visits',String(m.siteVisits)],
    ['Synthetic conversation demos',String(m.syntheticDemos)]
  ]));
  if(role!=='client_admin')return;
  const info=node('p',{class:'note',text:'Export leads privately in JSON pages (up to 200 per file). Lead notes and recordings are not included.'});
  const exportBtn=btn('Export next 200 leads (private JSON)',async()=>{
    try{
      const result=await api('/v1/human/exports/leads?tenantId='+encodeURIComponent(tenantId)+
        '&limit=200&offset='+String(offset));
      const file=new Blob([JSON.stringify(result,null,2)],{type:'application/json'});
      const href=URL.createObjectURL(file),anchor=document.createElement('a');
      anchor.href=href;anchor.download='ar3d-leads-'+tenantId.slice(0,8)+'-offset-'+offset+'.json';
      document.body.append(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(href);
      offset+=result.leads.length;
      exportBtn.disabled=offset>=result.total||result.leads.length===0;
      info.textContent='Exported '+result.leads.length+' lead records. '+Math.max(0,result.total-offset)+' left. Keep files private.';
    }catch(e){asError(e)}
  },true);
  let offset=0;
  card.append(info,exportBtn);
}
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
        previewBox.replaceChildren(node('p',{class:'success',text:result.rows+' valid rows; '+result.existingCount+' existing in CRM; '+result.wouldInsert+' potentially new.'}),
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
  let offset=0;
  const searchBtn=btn('Search',()=>{offset=0;refresh().catch(asError)},true);
  const tableArea=div(''),details=div(''),visitArea=div('');
  workflow.append(div('formrow',lab('Search leads',search),lab('Interest status',filter),searchBtn),tableArea,details);
  const schedule=div('card',title('Site Visits','h3'));workflow.append(schedule,visitArea);
  async function visitList(){
    const result=await api('/v1/human/visits?tenantId='+encodeURIComponent(tenantId));
    visitArea.replaceChildren(table(['Lead','Scheduled','Status','Note'],result.visits.map(v=>[
      v.leadName,new Date(v.scheduledAt).toLocaleString(),v.status,v.note
    ])));
    if(editable){
      const pending=result.visits.filter(v=>['requested','confirmed'].includes(v.status));
      if(pending.length){
        const selected=node('select',{class:'field'},pending.map(v=>
          node('option',{value:v.id,text:v.leadName+' — '+new Date(v.scheduledAt).toLocaleString()})));
        const statusSelect=node('select',{class:'field'});
        function statusOptions(){
          const v=pending.find(x=>x.id===selected.value);
          const allowed=v?.status==='requested'?['confirmed','cancelled']:['completed','cancelled'];
          statusSelect.replaceChildren(...allowed.map(s=>node('option',{value:s,text:s})));
        }
        selected.addEventListener('change',statusOptions);statusOptions();
        const form=node('form',{class:'formrow'},[lab('Visit',selected),lab('Status update',statusSelect),
          node('button',{class:'btn secondary',type:'submit',text:'Save visit status'})]);
        form.addEventListener('submit',async e=>{e.preventDefault();try{
          await api('/v1/human/visits/'+selected.value,'PATCH',{tenantId,status:statusSelect.value});
          notice('Visit status saved; no notifications were sent.');await visitList();
        }catch(err){asError(err)}});
        visitArea.append(form);
      }
    }
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

    const blocked=lead.consentStatus==='denied'||lead.dndStatus==='blocked';
    const callPrefs=div('card',title('Calling Preferences / कॉलिंग अनुमति','h3'),
      node('p',{class:'note',text:blocked?'DO NOT CALL — this lead is blocked. No client-side reactivation is available.':
        'Consent is not verified. No outbound calling is available. Record an opt-out if requested.'}));
    if(editable&&!blocked){
      const origin=node('select',{class:'field'},
        [['customer_request','Customer asked not to call'],['admin_action','Manual/internal block'],['other','Other']].map(([value,text])=>node('option',{value,text})));
      const why=input('optOutReason','text','Optional reason (max 500 characters)');why.maxLength=500;why.required=false;
      const stopForm=node('form',{class:'formrow'},[lab('Opt-out source',origin),lab('Reason (optional)',why),
        node('button',{class:'btn secondary',type:'submit',text:'Do Not Call / Block number'})]);
      stopForm.addEventListener('submit',async e=>{
        e.preventDefault();
        if(!confirm('Block this lead from calling? This cannot be undone from the CRM.'))return;
        try{
          await api('/v1/human/leads/'+lead.id+'/opt-out','POST',
            {tenantId,source:origin.value,reason:why.value});
          notice('Calling blocked; audit event saved.');await refresh();
        }catch(err){asError(err)}
      });
      callPrefs.append(stopForm);
    }
    const history=div('');callPrefs.append(history);details.append(callPrefs);
    api('/v1/human/leads/'+lead.id+'/opt-out?tenantId='+encodeURIComponent(tenantId))
      .then(result=>history.replaceChildren(...(result.events.length?
        [title('Opt-out history','h3'),table(['Source','Reason','At'],result.events.map(ev=>
          [ev.source,ev.reason||'—',new Date(ev.createdAt).toLocaleString()]))]:[])))
      .catch(asError);

    const evidenceCard=div('card',title('Consent evidence / अनुमति का रिकॉर्ड','h3'),
      node('p',{class:'note',text:'Evidence references are PENDING REVIEW only. No consent is granted and no DND check has been made.'}));
    const evidenceHistory=div('');evidenceCard.append(evidenceHistory);details.append(evidenceCard);
    const evidenceUrl='/v1/human/leads/'+lead.id+'/consent-evidence';
    const reloadEvidence=async()=>{const out=await api(evidenceUrl+'?tenantId='+encodeURIComponent(tenantId));
      evidenceHistory.replaceChildren(table(['Source','Purpose','Reference','Review'],
        out.items.map(item=>[item.source,item.purpose,item.reference,item.reviewStatus])))};
    reloadEvidence().catch(asError);
    if(editable&&!blocked){
      const evidenceSource=node('select',{class:'field'},
        ['website_form','signed_form','in_person','other'].map(value=>node('option',{value,text:value})));
      const evidencePurpose=node('select',{class:'field'},
        ['property_information','site_visit'].map(value=>node('option',{value,text:value})));
      const evidenceRef=input('reference','text','Internal evidence reference (no personal details)');
      evidenceRef.maxLength=160;
      const evidenceAt=input('capturedAt','datetime-local');evidenceAt.required=true;
      const f=node('form',{class:'stack'},[lab('Evidence origin',evidenceSource),lab('Purpose',evidencePurpose),
        lab('Reference ID (4-160 chars)',evidenceRef),lab('Evidence captured date/time',evidenceAt),
        node('button',{class:'btn',type:'submit',text:'Save pending evidence'})]);
      f.addEventListener('submit',async e=>{e.preventDefault();try{
        if(!evidenceAt.value)throw Error('Choose capture date/time');
        await api(evidenceUrl,'POST',{tenantId,source:evidenceSource.value,purpose:evidencePurpose.value,
          reference:evidenceRef.value,capturedAt:new Date(evidenceAt.value).toISOString()});
        notice('Evidence reference saved as pending; calling is still blocked.');
        evidenceRef.value='';await reloadEvidence();
      }catch(err){asError(err)}});
      evidenceCard.insertBefore(f,evidenceHistory);
    }
    const readiness=div('card',title('Calling readiness','h3'));details.append(readiness);
    api('/v1/human/leads/'+lead.id+'/call-readiness?tenantId='+encodeURIComponent(tenantId))
      .then(result=>readiness.append(node('p',{class:'err',text:'BLOCKED — '+result.reasons.join('; ')})))
      .catch(asError);
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
    const params=new URLSearchParams({tenantId,limit:'50',offset:String(offset),status:filter.value,q:search.value.trim()});
    const result=await api('/v1/human/leads?'+params.toString());
    const tbl=node('table',{class:'table'});const head=node('tr');
    ['Name','Mobile','Location','Budget','Status','Action'].forEach(t=>head.append(node('th',{text:t})));
    tbl.append(node('thead',{},head));const body=node('tbody');
    for(const lead of result.leads){const row=node('tr');
      [lead.name,lead.mobile,lead.preferredLocation,lead.budgetMaxInr,lead.interestStatus].forEach(t=>row.append(node('td',{text:String(t??'—')})));
      row.append(node('td',{},btn('Details',()=>selectLead(lead),true)));body.append(row)}
    tbl.append(body);
    const prev=btn('← Previous',()=>{offset=Math.max(0,offset-50);refresh().catch(asError)},true);
    const next=btn('Next →',()=>{offset+=50;refresh().catch(asError)},true);
    prev.disabled=offset===0;next.disabled=offset+result.leads.length>=result.total;
    tableArea.replaceChildren(node('p',{class:'muted',text:result.total+' matching leads · showing '+
      (result.total?offset+1:0)+'–'+(offset+result.leads.length)}),div('tablewrap',tbl),
      div('formrow',prev,node('span',{class:'muted',text:'Page '+(Math.floor(offset/50)+1)}),next));
    details.replaceChildren();
  }
  await Promise.all([refresh(),visitList()]);
}

load();`;
