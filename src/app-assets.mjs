export const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1120"><title>AR3D AI Calling</title><link rel="stylesheet" href="/app/assets/style.css"></head><body><div id="app" role="main"><p>Loading AR3D AI Calling…</p></div><script src="/app/assets/app.js" defer></script></body></html>`;
export const css=`:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#e9eef9;background:#0b1120}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(115deg,#0b1120,#101d31)}button,input,select,textarea{font:inherit}button{cursor:pointer}.layout{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:100vh}.sidebar{background:#111c2c;border-right:1px solid #27334a;padding:28px 18px}.brand{font-size:1.28rem;font-weight:800;letter-spacing:-.025em}.brand small{display:block;font-size:.78rem;color:#7ca6fe;font-weight:550;letter-spacing:.1em;margin-top:4px}.muted{color:#91a4be}.navitem{padding:12px 14px;border-radius:10px;background:#1c3049;margin:22px 0}.main{padding:32px;min-width:0;max-width:1280px;width:100%;margin:auto}h1,h2,h3{margin-top:0;letter-spacing:-.035em}h1{font-size:clamp(1.6rem,3vw,2.4rem)}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.between{justify-content:space-between}.card{border:1px solid #2a3a54;background:#132139;border-radius:16px;padding:22px;margin:16px 0;box-shadow:0 12px 32px #0002}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:12px}.metric strong{font-size:2rem;display:block;color:white;margin-top:8px}.label{display:block;font-weight:650;font-size:.88rem;margin-bottom:6px}.field{padding:11px 12px;min-width:170px;max-width:100%;border:1px solid #40506a;background:#0d192c;color:#fff;border-radius:9px}textarea.field{min-height:95px;resize:vertical}.btn{border:0;border-radius:10px;padding:11px 16px;background:#578cff;color:#091323;font-weight:750}.btn:hover{background:#82aaff}.btn.secondary{background:#293c58;color:#e1e9f9}.btn:disabled{opacity:.5;cursor:not-allowed}.formrow{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}.formrow label{flex:1;min-width:170px}.formrow .field{width:100%}.tablewrap{overflow-x:auto}.table{width:100%;border-collapse:collapse;font-size:.9rem}.table th,.table td{padding:12px;text-align:left;border-bottom:1px solid #283a54}.table th{color:#9eacc4;font-weight:600}.pill{display:inline-block;background:#203e51;border-radius:100px;padding:4px 8px;color:#b4e4e3;font-size:.78rem}.note{border-left:3px solid #7ca6fe;padding:8px 12px;color:#bccae1;background:#1a2c45;border-radius:4px}.err{color:#ffb0b0}.success{color:#8ff0ba}.auth{min-height:100vh;display:grid;place-items:center;padding:24px}.auth .card{width:min(460px,100%)}.stack{display:grid;gap:14px}.stack label .field{width:100%}.banner{padding:12px 14px;border:1px solid #355c7b;background:#17324d;border-radius:8px;margin:16px 0;overflow-wrap:anywhere}a{color:#8eb5ff}pre{white-space:pre-wrap;overflow-wrap:anywhere}.foot{margin-top:20px;font-size:.8rem;color:#8a9db7}.sidebar{display:flex;flex-direction:column;align-items:stretch;gap:14px;min-width:0}.sidebar .brand{overflow-wrap:anywhere}.sidebar .navitem{display:block;margin:0;max-width:100%;text-decoration:none;overflow-wrap:anywhere}.sidebar .navitem:hover{background:#293f60}.sidebar p{margin:0;overflow-wrap:anywhere}.sidebar>.btn{align-self:flex-start;max-width:100%;margin-top:4px}.sidebar a:focus-visible,.sidebar button:focus-visible{outline:2px solid #90b7ff;outline-offset:3px}@media(max-width:760px){.layout{display:block}.sidebar{padding:14px 18px;border-bottom:1px solid #27334a}.navitem{margin:8px 0}.main{padding:18px}.card{padding:15px}.formrow{display:grid}.formrow label{min-width:0}}`;
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
function engineeringPanel(main){
  const card=div('card',title('Production Readiness & Safe AI Calling Pilot'));
  const status=div('stack',node('p',{class:'muted',text:'Engineering-only. No telecom provider, real calls or payments are connected.'}));
  const summary=div('stack');
  const launch=btn('Run 100 Synthetic Calls (no dialing)',async()=>{
    launch.disabled=true;summary.replaceChildren(node('p',{class:'muted',text:'Running local-in-Worker mock conversation tests...'}));
    try{
      const result=await api('/v1/human/engineering/pilot','POST',{count:100,scenario:'mixed',quotaCalls:100});
      summary.replaceChildren(
        node('p',{class:'success',text:'Synthetic calls: '+result.count+' | Real calls: '+result.realCallsStarted+' | Audio generated: '+result.realAudioGenerated}),
        table(['Outcome','Count'],[['Completed',result.outcomes.completed],['Opted out',result.outcomes.opted_out],['Repeat prompts',result.outcomes.repeat_requested],['Pricing deferred',result.outcomes.pricing_deferred],['Low-confidence repeats',result.outcomes.low_confidence_repeated]]),
        node('p',{class:'muted',text:'Hypothetical rounded minutes: '+result.usagePreview.hypotheticalRoundedMinutes+' | Real billing: disabled | Payment collected: no'}),
        node('p',{class:'note',text:result.notice})
      );
    }catch(err){asError(err)}finally{launch.disabled=false}
  });
  const providerSummary=div('stack');
  const providerLaunch=btn('Test Exotel Mock Provider (100 events)',async()=>{
    providerLaunch.disabled=true;
    providerSummary.replaceChildren(node('p',{class:'muted',text:'Validating provider contract and mock callback lifecycle...'}));
    try{
      const result=await api('/v1/human/engineering/provider-pilot','POST',{count:100,scenario:'mixed'});
      providerSummary.replaceChildren(
        node('p',{class:'success',text:'Provider mock events: '+result.count+' | Real calls: '+result.realCallsStarted+' | External requests: '+result.providerNetworkRequests}),
        table(['Mock result','Count'],[
          ['Completed',result.outcomes.completed],['Busy',result.outcomes.busy],
          ['No answer',result.outcomes.no_answer],['Failed',result.outcomes.failed],
          ['Opt-out blocked',result.outcomes.opt_out_blocked],
          ['Consent/DND blocked',result.outcomes.consent_dnd_blocked]
        ]),
        node('p',{class:'note',text:result.notice})
      );
    }catch(err){asError(err)}finally{providerLaunch.disabled=false}
  });
  card.append(status,launch,summary,
    title('Telecom Provider Integration — Mock Validation','h3'),
    node('p',{class:'note',text:'Exotel API contract only; no provider account, verified callback, audio stream or live calls are connected.'}),
    providerLaunch,providerSummary);
  const connectionSummary=div('stack');
  const connectionButton=btn('Check Exotel Connection (read-only)',async()=>{
    connectionButton.disabled=true;
    connectionSummary.replaceChildren(node('p',{class:'muted',text:'Checking approved Exotel account connectivity with server-side secrets only...'}));
    try{
      const result=await api('/v1/human/engineering/provider-connectivity','POST',{});
      connectionSummary.replaceChildren(
        node('p',{class:result.verified?'success':'note',text:'Exotel API: '+(result.verified?'Connection verified':'Not verified')+' | Real dialing: disabled'}),
        node('p',{class:'note',text:result.note})
      );
    }catch(err){asError(err)}finally{connectionButton.disabled=false}
  });
  card.append(title('Exotel Account Connectivity (read-only)','h3'),
    node('p',{class:'note',text:'Uses server-side Exotel credentials only after you add them. Never places calls or exposes keys.'}),
    connectionButton,connectionSummary);
  const ownSipPanel=div('stack',node('p',{class:'note',
    text:'Yes, we can operate our own Asterisk PBX. A 140 caller number ALONE cannot place calls: an authorized telemarketing SIP Trunk and always-on PBX host are required. The lab has NO outbound routes.'}));
  card.append(title('Our Own Calling Engine — No Exotel Required','h3'),ownSipPanel);
  api('/v1/human/engineering/own-sip-setup').then(result=>{
    const lab=node('p',{class:'success',
      text:'Private Asterisk local-only lab: source ready for installation | Real 140 calls: NOT enabled | Automatic voice-to-CRM: NOT enabled'});
    const steps=node('ol');
    for(const task of result.steps||[])
      steps.append(node('li',{text:task.title+' — '+task.owner}));
    const link=node('a',{href:result.reference,target:'_blank',rel:'noopener noreferrer',
      text:'Jio Business — official 140 SIP Trunk example'});
    ownSipPanel.replaceChildren(lab,
      node('p',{class:'note',text:'Do not buy a 140 number without an operator-authorized outbound SIP trunk. A PBX host, SIP routing, audio/STT, secure callbacks and real customer permissions are independent requirements.'}),
      title('Needed for an actual outbound pilot','h3'),steps,link);
  }).catch(asError);
  const trialSetup=div('stack');
  card.append(title('Exotel Trial Setup — What Is Ready?','h3'),
    node('p',{class:'note',text:'This is an onboarding checklist, not a dialer. Setting API keys alone will NOT make live calls possible.'}),
    trialSetup);
  api('/v1/human/engineering/exotel-trial-setup').then(result=>{
    const creds=result.credentialsPresent||{};
    const credentials=div('stack',
      node('p',{class:'muted',text:'Private Worker secret bindings only (values never displayed):'}));
    for(const [name,present] of Object.entries(creds)){
      credentials.append(node('p',{class:present?'success':'muted',
        text:(present?'Configured: ':'Missing: ')+name}));
    }
    const pending=node('ol');
    for(const t of result.manualSteps||[])
      pending.append(node('li',{text:t.title+' — '+t.owner}));
    const codeTasks=node('ul');
    for(const item of result.engineeringRemaining||[])
      codeTasks.append(node('li',{text:item}));
    const promptButton=btn('Copy 7-question Exotel Voicebot instructions',async()=>{
      // User gesture only; contains fixed questions, never keys or customer PII.
      try{
        await navigator.clipboard.writeText(result.managedVoicebotPrompt);
        notice('Draft 7-question instructions copied. Paste into an approved Exotel Voicebot editor; review before use.');
      }catch{
        // No clipboard permissions? Show editable text without app secrets.
        const textarea=node('textarea',{class:'field',rows:14,readonly:'readonly'});
        textarea.value=result.managedVoicebotPrompt;
        trialSetup.append(lab('Copy this fixed bot template manually',textarea));
        notice('Clipboard unavailable — copy the instructions from the text box.');
      }
    },true);
    const docs=node('a',{href:result.managedVoicebotTrialDocs,target:'_blank',rel:'noopener noreferrer',
      text:'Official Exotel Managed Voicebot Guide'});
    trialSetup.replaceChildren(
      node('p',{class:'note',text:'Live calls: disabled | Provider transcript auto-save: disabled | Browser preview: ready'}),
      credentials,
      title('Manual setup (company/Exotel)','h3'),pending,
      title('Still needs engineering after approved account/voice access','h3'),codeTasks,
      node('p',{class:'muted',text:'Managed Voicebot may avoid building a separate WSS/STT gateway; its trial, export API, pricing and builder access must be confirmed.'}),
      promptButton,docs);
  }).catch(asError);
  const webhookResults=div('stack');
  const webhookCheck=btn('Test Exotel Voicebot Transcript Webhooks (offline)',async()=>{
    webhookCheck.disabled=true;
    webhookResults.replaceChildren(node('p',{class:'muted',text:'Checking the official Exotel transcript-event format with fictional data only...'}));
    try{
      const checks=[];
      for(const name of ['seven_questions','out_of_order','retry_duplicate','opt_out']){
        const result=await api('/v1/human/engineering/voicebot-fixture','POST',{scenario:name});
        checks.push([name.replaceAll('_',' '),result.completedTurns,
          result.duplicateEventsIgnored,result.optOutReviewNeeded?'Review':'No']);
        if(result.crmWrites!==0||result.phoneCallsStarted!==0||result.providerWebhookAuthenticated)
          throw Error('Unexpected real provider activity');
      }
      webhookResults.replaceChildren(
        table(['Offline case','Turns','Replays ignored','Opt-out flag'],checks),
        node('p',{class:'note',text:'Only fictional events were tested. Session-end does NOT contain the full transcript. Real webhook authentication, call/lead matching and automatic CRM save remain disabled.'})
      );
    }catch(err){asError(err)}finally{webhookCheck.disabled=false}
  },true);
  card.append(title('Managed Exotel Voicebot — Transcript Webhook Checks','h3'),
    node('p',{class:'note',text:'Seven fixed-question transcripts: validates Exotel vendor-format turn events, reordered delivery, retries and opt-out flags offline. No real calls, customer data or CRM edits.'}),
    webhookCheck,webhookResults);
  const qualificationCheckOutput=div('stack');
  const qualificationButton=btn('Test Voicebot Answers to CRM Review (offline)',async()=>{
    qualificationButton.disabled=true;
    qualificationCheckOutput.replaceChildren(node('p',{class:'muted',text:'Reconstructing fictional Exotel turns into reviewed property fields...'}));
    try{
      const summaries=[];
      for(const scenario of ['plot_complete','flat_complete','not_interested','out_of_order','retry_duplicate','opt_out','incomplete']){
        const r=await api('/v1/human/engineering/voicebot-qualification','POST',{scenario});
        if(r.crmWrites!==0||r.realCallsStarted!==0||r.sourceAuthenticated||r.consentVerified||!r.humanReviewRequired)
          throw Error('Unsafe provider qualification response');
        summaries.push([scenario.replaceAll('_',' '),r.status,
          r.provisionalSurvey?.propertyType||'—',
          r.provisionalSurvey?.budgetInr==null?'—':String(r.provisionalSurvey.budgetInr)]);
      }
      qualificationCheckOutput.replaceChildren(
        table(['Synthetic transcript','Review state','Type','Budget INR'],summaries),
        node('p',{class:'note',text:'These are provisional fields only. No real Exotel webhook is authenticated; no opt-out, lead, CRM, call or site visit is modified.'})
      );
    }catch(err){asError(err)}finally{qualificationButton.disabled=false}
  },true);
  card.append(title('Voicebot Answers to CRM Review — Preflight','h3'),
    node('p',{class:'note',text:'Parses Exotel-style completed turns into the seven fixed property fields. Catches retries, reversed event order, refusal and missing session-end before any live integration.'}),
    qualificationButton,qualificationCheckOutput);
  const mediaOutput=div('stack');
  const mediaTest=btn('Test 100 PCM Audio Frames (offline)',async()=>{
    mediaTest.disabled=true;
    mediaOutput.replaceChildren(node('p',{class:'muted',text:'Validating raw PCM framing locally on Worker...'}));
    try{
      const result=await api('/v1/human/engineering/media-protocol','POST',{frames:100,sampleRate:8000});
      mediaOutput.replaceChildren(
        node('p',{class:'success',text:'PCM frames: '+result.decodedFrames+' received and '+result.encodedFrames+' returned | Real calls: '+result.realCallsStarted}),
        node('p',{class:'note',text:'Media server connected: no | STT/TTS/LLM calls: 0 | Recording saved: 0'}),
        node('p',{class:'note',text:result.notice})
      );
    }catch(err){asError(err)}finally{mediaTest.disabled=false}
  });
  card.append(title('AgentStream Audio Gateway — Protocol Acceptance','h3'),
    node('p',{class:'note',text:'Tests Exotel raw PCM 16-bit mono frames and bidirectional packet formats. No public WebSocket or microphone.'}),
    mediaTest,mediaOutput);
  main.append(card);
  api('/v1/human/engineering/status').then(result=>{
    const states=result.gates.filter(g=>g.state!=='available');
    const list=node('ul');
    states.forEach(g=>list.append(node('li',{text:g.id.replace(/_/g,' ')+': '+g.description})));
    status.append(node('p',{class:'note',text:'Commercial go-live blocked: '+states.length+' release gates still require verification, integration or approval.'}),list);
    if(result.operational){
      const o=result.operational,configured=o.credentialBindingsConfigured||{};
      const binds=Object.entries(configured);
      status.append(title('Operator Setup Checklist','h3'),
        node('p',{class:'note',text:'Provider/API bindings configured: '+binds.filter(([,yes])=>yes).length+'/'+binds.length+' (presence only; not approval)'}));
      const tasks=node('ul');
      for(const t of o.operatorActions||[])tasks.append(node('li',{text:t.label+' — requires manual verification'}));
      status.append(tasks);
    }
  }).catch(asError);
}
function dashboard(){root.replaceChildren();const aside=div('sidebar',node('div',{class:'brand',text:'AR3D AI Calling'},node('small',{text:'MULTI-TENANT PLATFORM'})),div('navitem',state.me.superAdmin?'Super Admin':'Client Dashboard'),node('p',{class:'muted',text:state.me.email}),node('a',{href:'/app/simulator',class:'navitem',text:'Test AI Conversation'}),btn('Sign out',logout,true));const main=div('main',div('row between',title(state.me.superAdmin?'Super Admin':'Personal AI Calling','h1'),node('span',{class:'pill',text:'Development / No live calls'})),div('',node('div',{id:'notice-anchor'})));root.append(div('layout',aside,main));if(state.me.superAdmin){engineeringPanel(main);mfaPanel(main);superAdmin(main)}if(state.me.tenants.length)clientPanel(main)}
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
async function superAdmin(main){const panel=div('card',title('Subscription Clients'));main.append(panel);const list=div('');panel.append(list);async function refresh(){try{const d=await api('/v1/human/tenants');list.replaceChildren(table(['Client','Plan','Storage','Status','Members'],d.tenants.map(t=>[t.display_name,t.plan_code,t.storage_mode,t.status,t.member_count])))}catch(e){asError(e)}}await refresh();const name=input('name','text','Builder company'),slug=input('slug','text','builder-company');const plan=node('select',{class:'field',name:'plan'},['starter','growth','enterprise'].map(p=>node('option',{value:p,text:p})));const mode=node('select',{class:'field'},['shared','dedicated'].map(p=>node('option',{value:p,text:p})));const f=node('form',{class:'formrow'},[lab('Company',name),lab('Slug',slug),lab('Subscription plan',plan),lab('Storage',mode),node('button',{class:'btn',type:'submit',text:'Add client'})]);f.addEventListener('submit',async e=>{e.preventDefault();try{const d=await api('/v1/human/tenants','POST',{displayName:name.value,slug:slug.value,plan:plan.value,storageMode:mode.value});notice('Client created: '+d.slug);f.reset();await refresh();await inviteSection(main)}catch(err){asError(err)}});panel.append(title('Create client','h3'),f);
const accessCard=div('card',title('Tenant Access: Suspend / Resume','h3'),
  node('p',{class:'note',text:'Suspension immediately blocks the company CRM and API keys. Resume restores its prior status, not a paid subscription.'}));
main.append(accessCard);
const accessSelect=node('select',{class:'field'});
const reason=input('tenantActionReason','text','Required reason, at least 10 characters');
reason.maxLength=240;
const actionForm=node('form',{class:'stack'},[lab('Company',accessSelect),lab('Reason (audited)',reason),
  node('button',{class:'btn secondary',type:'submit',text:'Suspend / Resume Selected Client'})]);
accessCard.append(actionForm);
let tenantRows=[];
async function refreshAccess(){
  const result=await api('/v1/human/tenants');
  tenantRows=result.tenants.filter(t=>['trial','active','suspended'].includes(t.status));
  const oldValue=accessSelect.value;
  accessSelect.replaceChildren(...tenantRows.map(t=>node('option',{value:t.id,text:t.display_name+' — '+t.status})));
  if(tenantRows.some(t=>t.id===oldValue))accessSelect.value=oldValue;
}
await refreshAccess();
actionForm.addEventListener('submit',async e=>{e.preventDefault();try{
  const t=tenantRows.find(v=>v.id===accessSelect.value);
  if(!t)throw Error('Select a company first');
  if(reason.value.trim().length<10)throw Error('Provide an audited reason of at least 10 characters');
  const verb=t.status==='suspended'?'resume':'suspend';
  if(!confirm((verb==='suspend'?'Suspend':'Resume')+' access for '+t.display_name+'?'))return;
  const result=await api('/v1/human/tenants/'+t.id+'/'+verb,'POST',{reason:reason.value});
  notice('Tenant '+result.status+'. This is not a payment transaction.');
  reason.value='';await refresh();await refreshAccess();
}catch(err){asError(err)}});
await inviteSection(main)}
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
    const candidateSearch=input('candidateSearch','search','Search eligible leads by name, phone or location');
    candidateSearch.required=false;
    let leadOffset=0;
    const leadPageNote=node('span',{class:'muted'});
    const prevLead=btn('← Previous leads',()=>{leadOffset=Math.max(0,leadOffset-50);loadPicks().catch(asError)},true);
    const nextLead=btn('Next leads →',()=>{leadOffset+=50;loadPicks().catch(asError)},true);
    const searchLead=btn('Find leads',()=>{leadOffset=0;loadPicks().catch(asError)},true);
    campaignCard.append(div('formrow',candidateSearch,searchLead,prevLead,leadPageNote,nextLead));
    const pickForm=node('form',{class:'formrow'},[lab('Draft campaign',campaignPick),lab('Candidate lead',candidatePick),
      node('button',{class:'btn secondary',type:'submit',text:'Add candidate (no calling)'})]);
    const loadPicks=async()=>{
      const campaigns=await refreshCampaigns();
      const leads=await api('/v1/human/leads?tenantId='+encodeURIComponent(tenantId)+
        '&limit=50&offset='+String(leadOffset)+'&q='+encodeURIComponent(candidateSearch.value.trim()));
      leadPageNote.textContent='Page '+(Math.floor(leadOffset/50)+1)+' / '+Math.max(1,Math.ceil(leads.total/50));
      prevLead.disabled=leadOffset===0;nextLead.disabled=leadOffset+leads.leads.length>=leads.total;
      campaignPick.replaceChildren(...campaigns.map(c=>node('option',{value:c.id,text:c.name})));
      candidatePick.replaceChildren(...leads.leads.filter(l=>l.consentStatus!=='denied'&&l.dndStatus!=='blocked')
        .map(l=>node('option',{value:l.id,text:l.name+' · '+l.mobile})));
    };
    await loadPicks();
    const currentCandidate=node('select',{class:'field'});
    let candidateOffset=0;
    const pageHint=node('span',{class:'muted'});
    const prevCandidate=btn('← Previous candidates',()=>{
      candidateOffset=Math.max(0,candidateOffset-50);refreshCandidateList().catch(asError)},true);
    const nextCandidate=btn('Next candidates →',()=>{
      candidateOffset+=50;refreshCandidateList().catch(asError)},true);
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
      const d=await api('/v1/human/campaigns/'+campaignPick.value+'/candidates?tenantId='+
        encodeURIComponent(tenantId)+'&limit=50&offset='+candidateOffset);
      if(candidateOffset>0&&d.candidates.length===0){
        candidateOffset=Math.max(0,candidateOffset-50);return refreshCandidateList();
      }
      pageHint.textContent='Page '+(Math.floor(candidateOffset/50)+1)+' / '+
        Math.max(1,Math.ceil(d.total/50));
      prevCandidate.disabled=candidateOffset===0;
      nextCandidate.disabled=candidateOffset+d.candidates.length>=d.total;
      currentCandidate.replaceChildren(...d.candidates.map(c=>
        node('option',{value:c.leadId,text:c.name+' — '+c.consentStatus+'/'+c.dndStatus})));
      removeCandidate.disabled=d.candidates.length===0;
    };
    campaignPick.addEventListener('change',()=>{
      candidateOffset=0;refreshCandidateList().catch(asError)});
    const candidateActions=div('formrow',lab('Candidates in selected draft',currentCandidate),
      removeCandidate,prevCandidate,pageHint,nextCandidate);
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
          table(['Name','Mobile','Customer type','Plot size','Visit preference'],result.preview.map(r=>
            [r.name,r.mobile,r.customerSegment,r.plotSizePreference||'—',r.visitDatePreference||'—'])));
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
  const segmentFilter=node('select',{class:'field'},[
    ['','All customer types'],['prior_inquiry','Previous enquiry'],
    ['unknown_contact','Unknown/new contact'],['unclassified','Unclassified']
  ].map(([value,text])=>node('option',{value,text})));
  let offset=0;
  const searchBtn=btn('Search',()=>{offset=0;refresh().catch(asError)},true);
  const tableArea=div(''),details=div(''),visitArea=div('');
  workflow.append(div('formrow',lab('Search leads',search),lab('Interest status',filter),lab('Customer type',segmentFilter),searchBtn),tableArea,details);
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
    const customerType=node('select',{class:'field'},[
      ['unclassified','Unclassified'],['prior_inquiry','Previous enquiry'],
      ['unknown_contact','Unknown/new contact']
    ].map(([value,text])=>node('option',{value,text})));
    customerType.value=lead.customerSegment||'unclassified';
    const plotSize=input('plotSize','text','e.g. 30x40 ft');plotSize.required=false;plotSize.maxLength=120;
    plotSize.value=lead.plotSizePreference||'';
    const visitPreference=input('visitPreference','date');visitPreference.required=false;
    visitPreference.value=lead.visitDatePreference||'';
    const min=input('min','number','Budget minimum INR'),max=input('max','number','Budget maximum INR');
    min.required=false;max.required=false;
    min.min='0';max.min='0';min.value=lead.budgetMinInr??'';max.value=lead.budgetMaxInr??'';
    const follow=input('follow','datetime-local');follow.required=false;
    if(lead.followupAt){const d=new Date(lead.followupAt); const localDate=new Date(d.getTime()-d.getTimezoneOffset()*60000);follow.value=localDate.toISOString().slice(0,16)}
    const form=node('form',{class:'formrow'},[lab('Status',editStatus),lab('Location',loc),lab('Min budget',min),lab('Max budget',max),lab('Follow-up',follow),lab('Customer type',customerType),
      lab('Plot size',plotSize),lab('Preferred visit date (not booked)',visitPreference)]);
    if(editable){form.append(node('button',{class:'btn',type:'submit',text:'Update lead'}));
      form.addEventListener('submit',async e=>{e.preventDefault();try{
        await api('/v1/human/leads/'+lead.id,'PATCH',{tenantId,interestStatus:editStatus.value,preferredLocation:loc.value,
          budgetMinInr:min.value===''?null:Number(min.value),budgetMaxInr:max.value===''?null:Number(max.value),
          followupAt:follow.value?new Date(follow.value).toISOString():null,
          customerSegment:customerType.value,plotSizePreference:plotSize.value||null,
          visitDatePreference:visitPreference.value||null});
        notice('Lead updated');await refresh();
      }catch(err){asError(err)}})}else{form.querySelectorAll('input,select').forEach(el=>el.disabled=true)}
    details.append(form);
    if(editable)details.append(fixedSurveyPanel(tenantId,lead,async()=>{
      await refresh();await visitList();
    }));

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
    const params=new URLSearchParams({tenantId,limit:'50',offset:String(offset),status:filter.value,
      segment:segmentFilter.value,q:search.value.trim()});
    const result=await api('/v1/human/leads?'+params.toString());
    const tbl=node('table',{class:'table'});const head=node('tr');
    ['Name','Mobile','Type','Plot size','Location','Budget','Status','Action'].forEach(t=>head.append(node('th',{text:t})));
    tbl.append(node('thead',{},head));const body=node('tbody');
    for(const lead of result.leads){const row=node('tr');
      [lead.name,lead.mobile,lead.customerSegment,lead.plotSizePreference,
        lead.preferredLocation,lead.budgetMaxInr,lead.interestStatus].forEach(t=>row.append(node('td',{text:String(t??'—')})));
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


// Boss-approved 7-question property qualification: staff/browser preview only.
// Name/mobile are read from the CRM Excel import, never asked or overwritten.
function fixedSurveyPanel(tenantId,lead,onSave){
  const card=div('card',title('7 Fixed Questions — Property Qualification','h3'),
    node('p',{class:'note',text:'Excel Name: '+lead.name+' | Mobile: '+lead.mobile+
      '. These are already known; do not ask again. Browser preview only — no phone call.'}));
  const open=btn('Open Fixed Questionnaire',async()=>{
    open.disabled=true;
    try{
      const url='/v1/human/leads/'+lead.id+'/qualification?tenantId='+encodeURIComponent(tenantId);
      const record=await api(url),previous=record.survey||{};
      const form=node('form',{class:'stack'});
      const language=node('select',{class:'field'},[
        ['hi','हिंदी'],['en','English']
      ].map(([value,label])=>node('option',{value,text:label})));
      const propertyType=node('select',{class:'field'},[
        ['plot','Plot / प्लॉट'],['flat','Flat / फ्लैट'],['house','House / घर']
      ].map(([value,label])=>node('option',{value,text:label})));
      propertyType.name='surveyPropertyType';propertyType.value=previous.propertyType||'plot';
      const city=input('surveyCity','text','City / Location');
      city.maxLength=120;city.value=previous.location||'';
      const area=input('surveyArea','text','Neighborhood / Area');
      area.required=false;area.maxLength=120;area.value=previous.area||'';
      const sizeHost=div('');let sizeInput=null;
      const budget=input('surveyBudget','number','Rupees, e.g. 3500000');
      budget.required=false;budget.min='1';budget.step='1';
      budget.value=previous.budgetInr===null||previous.budgetInr===undefined?
        '':String(previous.budgetInr);
      const interest=node('select',{class:'field'},[
        ['interested','Interested / इंटरेस्टेड'],
        ['later','Follow up later / बाद में'],
        ['not_interested','Not interested / रुचि नहीं']
      ].map(([value,label])=>node('option',{value,text:label})));
      interest.name='surveyInterest';interest.value=previous.interest||'interested';
      const visitDate=input('surveyVisit','date');
      visitDate.required=false;visitDate.value=previous.visitDate||'';
      const visitTime=input('surveyVisitTime','time');visitTime.required=false;
      const visitTimeLabel=lab('Optional exact time for a visit REQUEST (India local; sales must confirm)',visitTime);
      const visitDateField=div('stack',lab('Preferred visit date (not confirmed)',visitDate),visitTimeLabel);
      const labels={};
      const question=(field,control)=>{
        const item=lab(field,control);
        labels[field]=item.querySelector('.label');
        return item;
      };
      form.append(
        lab('Question language',language),
        question('propertyType',propertyType),
        question('location',city),
        question('area',area),
        question('size',sizeHost),
        question('budgetInr',budget),
        question('interest',interest),
        question('visitDate',visitDateField)
      );
      function buildSize(){
        const old=sizeInput?.value||previous.size||'';
        sizeInput=propertyType.value==='plot'?
          input('surveyPlotSize','text','e.g. 1200 sqft / 30x40 ft'):
          node('select',{class:'field'},['1BHK','2BHK','3BHK','4BHK','5BHK+']
            .map(value=>node('option',{value,text:value})));
        if(propertyType.value==='plot'){
          sizeInput.maxLength=80;
          sizeInput.value=old&&old.includes('BHK')?'':old;
        }else sizeInput.value=['1BHK','2BHK','3BHK','4BHK','5BHK+'].includes(old)?old:'2BHK';
        sizeHost.replaceChildren(sizeInput);
      }
      function refreshQuestions(){
        const set=record.questionSets[propertyType.value][language.value];
        for(const q of set)labels[q.field].textContent=q.text;
        const interested=interest.value==='interested';
        visitDateField.hidden=!interested;
        visitDate.disabled=!interested;visitTime.disabled=!interested;
      }
      propertyType.addEventListener('change',()=>{buildSize();refreshQuestions()});
      language.addEventListener('change',refreshQuestions);
      interest.addEventListener('change',()=>{
        if(interest.value!=='interested'){visitDate.value='';visitTime.value=''}
        refreshQuestions();
      });
      buildSize();refreshQuestions();

      // Browser speech is opt-in, may depend on browser speech services and
      // is never a verified telecom recording or a trusted speech transcript.
      const speechArea=div('stack',
        node('p',{class:'note',text:'Optional browser voice preview. The browser may use its own speech service. Do not use sensitive real-customer audio without an approved notice and permission. Always review the recognized text before Save.'}));
      const promptPick=node('select',{class:'field'},[
        'propertyType','location','area','size','budgetInr','interest','visitDate'
      ].map((value,i)=>node('option',{value:String(i),text:'Question '+(i+1)})));
      const speak=btn('Speak selected question',()=>{
        if(!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window))
          return notice('Browser speech playback is unavailable',true);
        window.speechSynthesis.cancel();
        const q=record.questionSets[propertyType.value][language.value][Number(promptPick.value)];
        const utterance=new SpeechSynthesisUtterance(q.text);
        utterance.lang=language.value==='hi'?'hi-IN':'en-IN';
        window.speechSynthesis.speak(utterance);
      },true);
      const micField=node('select',{class:'field'},[
        ['location','Location'],['area','Area'],['size','Property size'],['budget','Budget']
      ].map(([value,label])=>node('option',{value,text:label})));
      const dictate=btn('Dictate answer (browser mic)',()=>{
        const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
        if(!Recognition)return notice('Browser speech recognition unavailable. Type the answer.',true);
        const engine=new Recognition();
        engine.lang=language.value==='hi'?'hi-IN':'en-IN';
        engine.interimResults=false;engine.maxAlternatives=1;
        dictate.disabled=true;
        engine.onend=()=>{dictate.disabled=false};
        engine.onerror=()=>{dictate.disabled=false;notice('Speech recognition failed. Type the answer instead.',true)};
        engine.onresult=e=>{
          const words=String(e.results?.[0]?.[0]?.transcript||'').trim();
          if(!words)return;
          const target=micField.value;
          if(target==='location')city.value=words.slice(0,120);
          else if(target==='area')area.value=words.slice(0,120);
          else if(target==='size'){
            if(propertyType.value==='plot')sizeInput.value=words.slice(0,80);
            else{
              const m=words.match(/[1-5]\s*(?:BHK|बीएचके)/i);
              if(m){const number=m[0].match(/[1-5]/)[0];
                sizeInput.value=number==='5'?'5BHK+':number+'BHK'}
              else notice('BHK not recognized. Select 2BHK/3BHK manually.',true);
            }
          }else{
            const cleaned=words.replace(/[०-९]/g,ch=>String('०१२३४५६७८९'.indexOf(ch)))
              .replace(/,/g,'');
            const m=cleaned.match(/\d+(?:\.\d+)?/);
            const scale=/करोड़|crore/i.test(cleaned)?10000000:
              /लाख|lakh|lac/i.test(cleaned)?100000:
              /हजार|thousand|thou/i.test(cleaned)?1000:1;
            const number=m?Math.round(Number(m[0])*scale):NaN;
            if(Number.isSafeInteger(number)&&number>0)budget.value=String(number);
            else notice('Budget not recognized. Enter amount in rupees manually.',true);
          }
          notice('Browser speech captured. Review the answer before saving.');
        };
        engine.start();
      },true);
      const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
      if(!Recognition)dictate.disabled=true;
      speechArea.append(div('formrow',lab('Listen to',promptPick),speak),
        div('formrow',lab('Fill from microphone',micField),dictate));
      form.append(speechArea);
      const voiceDemo=div('card',title('Question-by-question Voice Preview (no calls)','h3'),
        node('p',{class:'note',text:'7 fixed turns only. Browser voice is optional and may use a browser speech service. All answers require review. No customer dial, recording or automatic consent.'}));
      const questionText=node('p',{class:'banner',text:'Start to hear the first fixed question.'});
      const voiceHint=node('p',{class:'muted',text:'Review each answer. Unsupported or low-confidence speech will repeat the question.'});
      const voiceAnswer=input('demoVoiceAnswer','text','Type or dictate the answer');
      voiceAnswer.required=false;voiceAnswer.maxLength=220;
      const voiceStart=btn('Start 7-question voice preview',async()=>{
        try{
          const out=await api('/v1/human/voice-preview','POST',
            {action:'start',language:language.value});
          displayTurn(out);
        }catch(err){asError(err)}
      },true);
      const playVoice=btn('Speak current question',()=>{
        if(!demoState||demoState.status!=='active'||!('speechSynthesis' in window)||
           !('SpeechSynthesisUtterance' in window))
          return notice('Browser question audio is unavailable',true);
        window.speechSynthesis.cancel();
        const utterance=new SpeechSynthesisUtterance(questionText.textContent);
        utterance.lang=language.value==='en'?'en-IN':'hi-IN';
        window.speechSynthesis.speak(utterance);
      },true);
      const voiceDictate=btn('Answer with browser microphone',()=>{
        if(!demoState||demoState.status!=='active')
          return notice('Start the preview first',true);
        const R=window.SpeechRecognition||window.webkitSpeechRecognition;
        if(!R)return notice('Browser speech recognition unavailable. Type your answer.',true);
        const rec=new R();rec.lang=language.value==='en'?'en-IN':'hi-IN';
        rec.interimResults=false;rec.maxAlternatives=1;
        voiceDictate.disabled=true;
        rec.onend=()=>{voiceDictate.disabled=false};
        rec.onerror=()=>{voiceDictate.disabled=false;
          notice('Microphone recognition failed. Type the answer instead.',true)};
        rec.onresult=e=>{
          const heard=String(e.results?.[0]?.[0]?.transcript||'').trim();
          voiceAnswer.value=heard.slice(0,220);
          voiceHint.textContent='Recognized text is unverified. Check spelling and meaning before Next.';
        };
        rec.start();
      },true);
      const nextVoice=btn('Next fixed question',async()=>{
        if(!demoState||demoState.status!=='active')return;
        nextVoice.disabled=true;
        try{
          const out=await api('/v1/human/voice-preview','POST',{
            action:'turn',state:demoState,transcript:voiceAnswer.value,confidence:1
          });
          displayTurn(out);
        }catch(err){asError(err)}
        finally{nextVoice.disabled=demoState?.status!=='active'}
      });
      let demoState=null;
      function displayTurn(result){
        demoState=result.state;
        const current=result.state;
        if(current.status==='active'){
          questionText.textContent='Question '+(current.index+1)+' of 7 — '+result.prompt;
          voiceAnswer.value='';
          voiceHint.textContent=result.warning||'Answer this question, then click Next.';
          nextVoice.disabled=false;
        }else if(current.status==='completed'){
          const a=current.answers;
          propertyType.value=a.propertyType;buildSize();
          city.value=a.location||'';area.value=a.area||'';
          sizeInput.value=a.size||'';
          budget.value=a.budgetInr===null||a.budgetInr===undefined?'':String(a.budgetInr);
          interest.value=a.interest;visitDate.value=a.visitDate||'';
          visitTime.value='';refreshQuestions();
          questionText.textContent='Seven questions completed — answers filled into the CRM form for your review.';
          voiceHint.textContent='Inspect every field and click Save Reviewed Answers to CRM separately. No live call or booking was made.';
          nextVoice.disabled=true;
        }else{
          questionText.textContent=current.status==='opted_out'?
            'Customer said stop calling — stop this preview. Verify and use the Do Not Call action in CRM.':
            'Three unclear attempts — staff review required. No CRM changes made.';
          voiceHint.textContent=result.warning||'Restart the preview when ready.';
          nextVoice.disabled=true;
        }
      }
      nextVoice.disabled=true;
      voiceDemo.append(questionText,voiceHint,
        div('formrow',voiceStart,playVoice),
        div('formrow',lab('Customer answer for preview',voiceAnswer),voiceDictate,nextVoice));
      form.append(voiceDemo);

      const save=node('button',{class:'btn',type:'submit',text:'Save Reviewed Answers to CRM'});
      form.append(save);
      form.addEventListener('submit',async e=>{
        e.preventDefault();save.disabled=true;
        try{
          let amount=null;
          if(budget.value!==''){
            if(!/^\d+$/.test(budget.value))throw Error('Enter budget as full rupees');
            amount=Number(budget.value);
            if(!Number.isSafeInteger(amount)||amount<1)throw Error('Invalid budget');
          }
          const desired=interest.value==='interested'?visitDate.value||null:null;
          if(visitTime.value&&!desired)throw Error('Choose a visit date before an exact time');
          const at=desired&&visitTime.value?
            new Date(desired+'T'+visitTime.value+':00+05:30').toISOString():null;
          const payload={
            tenantId,expectedUpdatedAt:record.updatedAt,
            propertyType:propertyType.value,location:city.value,
            area:area.value||null,size:sizeInput.value,
            budgetInr:amount,interest:interest.value,
            visitDate:desired,visitAt:at
          };
          if(!window.confirm('Save the reviewed property answers for '+lead.name+'? No phone call will be made.'))
            return;
          const result=await api('/v1/human/leads/'+lead.id+'/qualification','POST',payload);
          notice(result.visitRequested?
            'CRM updated. Site visit REQUEST created; sales must confirm. No call placed.':
            'CRM updated. Visit preference is not a confirmed booking. No call placed.');
          await onSave();
        }catch(error){asError(error)}
        finally{save.disabled=false}
      });
      card.replaceChildren(title('7 Fixed Questions — Property Qualification','h3'),
        node('p',{class:'note',text:'Name: '+lead.name+' | Mobile: '+lead.mobile+
          ' (from Excel). No questions about these.'}),form);
    }catch(err){asError(err);open.disabled=false}
  });
  card.append(open);
  return card;
}

load();`;
