export const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1120"><title>AR3D AI Calling</title><link rel="stylesheet" href="/app/assets/style.css"></head><body><div id="app" role="main"><p>Loading AR3D AI Calling…</p></div><script src="/app/assets/app.js" defer></script></body></html>`;
export const css=`:root{font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#243148;background:#e3e8f0;font-size:13px;font-synthesis:none;--accent:#6558e8;--line:#b9c4d5;--muted:#60718b}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#e3e8f0}button,input,select,textarea{font:inherit}button{cursor:pointer}a{color:var(--accent)}.layout{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100vh}.sidebar{background:#111624;color:#aab2c7;padding:26px 16px;display:flex;flex-direction:column;gap:7px;position:sticky;top:0;height:100vh;min-width:0;border-right:1px solid #202637}.brand{display:flex;gap:10px;align-items:center;color:#fff;font-size:16px;font-weight:750;letter-spacing:-.5px;padding:0 8px 28px}.brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:linear-gradient(140deg,#8b7bff,#6254df);box-shadow:0 4px 16px #6558e840;color:white;flex-shrink:0}.brand-mark .icon{width:20px;height:20px}.brand small{display:block;color:#707d97;font-size:8px;letter-spacing:1.8px;margin-top:5px;font-weight:650}.nav-caption{font-size:9px;letter-spacing:1.6px;color:#63708a;padding:14px 12px 7px;font-weight:700}.navitem{display:flex;align-items:center;gap:11px;min-height:39px;padding:10px 12px;border-radius:9px;text-decoration:none;color:#929db5;font-size:12px;font-weight:550;border:1px solid transparent}.navitem:hover{background:#1b2234;color:#e9eaff}.navitem.active{background:#282441;color:#c1b9ff;border-color:#43386a}.navitem .icon{width:16px;height:16px;flex-shrink:0}.sidebar-footer{margin-top:auto;border-top:1px solid #252c3c;padding:17px 8px 0;display:grid;gap:12px}.account{display:flex;gap:9px;align-items:center;min-width:0}.avatar{display:grid;place-items:center;width:31px;height:31px;border-radius:10px;background:#252d42;color:#c9c2ff;font-size:11px;font-weight:700;flex-shrink:0}.account-copy{min-width:0}.account-copy strong{display:block;font-size:11px;color:#e2e6f1}.account-copy p{font-size:10px;margin:4px 0 0;overflow-wrap:anywhere;color:#7d8ba7}.sidebar-footer .btn{justify-content:flex-start;background:transparent;color:#a3adc3;box-shadow:none;padding:6px 0;font-weight:500;font-size:11px}.main{padding:28px 32px 40px;min-width:0;width:100%;max-width:1560px;margin:0 auto;align-self:start}.topbar{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:23px}.eyebrow{font-size:9px;letter-spacing:1.7px;font-weight:750;color:#6e7e96;text-transform:uppercase;margin-bottom:7px}h1,h2,h3{margin:0;letter-spacing:-.45px;color:#202b40}h1{font-size:25px;line-height:1.25;font-weight:730;display:flex;gap:10px;align-items:center}h1>.icon{display:none}h2{font-size:14px;font-weight:700;margin-bottom:16px;display:flex;gap:9px;align-items:center}h3{font-size:12px;font-weight:650;margin:18px 0 11px;display:flex;gap:8px;align-items:center}h2>.icon,h3>.icon{width:16px;height:16px;color:#796ac2;flex-shrink:0}.page-description{font-size:11px;color:#61728b;margin:7px 0 0}.topbar-right{display:flex;align-items:center;gap:12px}.topbar-right>.avatar{background:#eae7fd;color:#6755d6}.status-dot{display:inline-block;width:6px;height:6px;background:#28a88a;border-radius:50%;margin-right:7px;box-shadow:0 0 0 3px #28a88a0c}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.between{justify-content:space-between}.card{background:#f8f9fc;border:1px solid var(--line);border-radius:13px;padding:19px;margin:0 0 16px;box-shadow:0 3px 10px #17284c0c;min-width:0}.admin-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}.admin-grid>.card{margin:0}.client-directory{grid-column:1/-1;order:0}.invite-card{order:1}.security-card{order:2}.calling-settings{grid-column:1/-1;order:3}.access-card{grid-column:1/-1;order:4}.access-card>.stack{grid-template-columns:1fr 1fr auto;align-items:end}.access-card>.note{margin-bottom:13px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 19px}.metric{padding:15px 17px;position:relative;overflow:hidden}.metric .metric-symbol{position:absolute;right:15px;top:17px;display:grid;place-items:center;width:32px;height:32px;background:#f0edff;color:#8071dd;border-radius:10px}.metric:nth-child(2) .metric-symbol{background:#e8f5f0;color:#3ca589}.metric:nth-child(3) .metric-symbol{background:#fff3e9;color:#d9a06e}.metric .muted{font-size:10px;font-weight:550}.metric strong{display:block;font-size:25px;color:#263148;font-weight:700;margin-top:8px;letter-spacing:-1px}.metric small{display:block;color:#74839b;font-size:9px;margin-top:6px}.client-directory .cards{margin-bottom:16px}.client-directory .metric{background:#eaf0f7;box-shadow:none}.label{display:block;font-size:10px;font-weight:600;color:#50617b;margin-bottom:6px;letter-spacing:.05px}.field{width:100%;min-width:0;max-width:100%;min-height:36px;border:1px solid #aebbd0;background:#edf2f8;border-radius:7px;color:#354159;padding:8px 10px;outline:none;transition:border-color .15s,box-shadow .15s}.field:focus{border-color:#a198ed;box-shadow:0 0 0 3px #6558e811;background:#fff}.field::placeholder{color:#6d7e96}select.field{padding-right:23px}textarea.field{min-height:74px;resize:vertical}input[type=checkbox]{accent-color:var(--accent)}input[type=file]{padding:7px;font-size:10px}input[type=file]::file-selector-button{background:#eeebfb;color:#6557bf;border:0;border-radius:4px;padding:4px 7px;margin-right:7px}.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid transparent;border-radius:7px;padding:9px 12px;min-height:35px;background:var(--accent);color:#fff;font-size:10px;font-weight:650;line-height:1.4;box-shadow:0 2px 4px #6558e817;transition:background .15s,transform .15s}.btn:hover{background:#574acb}.btn:active{transform:translateY(1px)}.btn .icon{width:13px;height:13px;flex-shrink:0}.btn.secondary{background:#fff;border-color:#b1bed1;color:#52627e;box-shadow:none}.btn.secondary:hover{background:#f7f7fc;border-color:#cdc7ed;color:#6557be}.btn:disabled{opacity:.45;cursor:not-allowed;transform:none}.formrow{display:flex;flex-wrap:wrap;gap:11px;align-items:flex-end}.formrow label{flex:1;min-width:130px}.formrow .field{width:100%}.stack{display:grid;gap:12px}.stack>label .field{width:100%}.tablewrap{overflow-x:auto;width:100%;border:1px solid #bac6d7;border-radius:8px}.table{width:100%;border-collapse:collapse;font-size:10px;white-space:nowrap}.table th,.table td{padding:11px 12px;text-align:left;border-bottom:1px solid #c7d0df}.table th{font-weight:600;color:#52637d;background:#e5ebf3;font-size:9px;letter-spacing:.1px}.table td{color:#455671}.table tr:last-child td{border-bottom:0}.table tbody tr:hover{background:#fcfbff}.table td:first-child{font-weight:550;color:#35435c}.empty-state{text-align:center!important;padding:23px!important;color:#70809a!important;font-weight:400!important}.pill{display:inline-flex;align-items:center;white-space:nowrap;background:#eff8f4;color:#40977b;border:1px solid #deeee5;border-radius:6px;padding:6px 9px;font-size:9px;font-weight:550}.badge{display:inline-block;padding:3px 7px;border-radius:5px;font-size:9px;font-weight:600;background:#eef0f6;color:#7c879b}.badge.positive{background:#e9f7f0;color:#369878}.badge.pending{background:#fff5e7;color:#bd9655}.badge.negative{background:#ffeded;color:#ce7272}.note{background:#eaf0f8;border:1px solid #c3cce0;border-left:2px solid #978acb;border-radius:6px;padding:9px 11px;color:#536680;font-size:10px;line-height:1.7;margin:0 0 13px}.muted{color:#62738d;font-size:11px;line-height:1.6}.err{color:#c75d72}.success{color:#2d947b}.banner{padding:10px 13px;border:1px solid #d9ece2;background:#f0f9f4;border-radius:7px;margin:0 0 16px;overflow-wrap:anywhere;font-size:11px}.banner.err{background:#fff2f3;border-color:#f2dce1}.auth{min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at top,#eae7fc 0,transparent 60%),#f5f6fa}.auth .card{width:min(420px,100%);padding:28px;box-shadow:0 16px 60px #3a306314}.auth h1{font-size:22px;margin-bottom:8px}.auth .stack{gap:17px}.foot{margin-top:18px;font-size:10px;color:#a3abba}.icon{width:17px;height:17px;vertical-align:middle;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}details.card{padding:14px 17px;background:#f8f9fc}details>summary{font-size:11px;font-weight:600;color:#596b85;cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px}details>summary:before{content:'›';font-size:18px;color:#9c93d5;line-height:14px;transition:transform .15s}details[open]>summary:before{transform:rotate(90deg)}details[open]>summary{margin-bottom:17px}details>summary::-webkit-details-marker{display:none}.main>details.card{margin-top:16px}.client-workspace{padding:0;background:transparent;border:0;box-shadow:none}.client-workspace>h2{display:none}.client-workspace>label{display:inline-block;min-width:230px;margin-bottom:17px}.client-content{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:16px;align-items:start}.client-content>.cards,.client-content>.note,.client-content>details{grid-column:1/-1;margin:0}.client-content>.card{margin:0}.client-content>.cards .metric{margin:0;background:#f8f9fc}.client-content>.cards{margin-bottom:0}.client-content .tablewrap{margin:11px 0}.client-content>.card h3:first-child{margin-top:0}.client-content>.card .formrow{gap:9px}.client-content .formrow .btn{flex-shrink:0}.calling-settings>.stack{display:grid;grid-template-columns:1fr 1fr;align-items:start;gap:23px;margin-top:17px;border-top:1px solid var(--line);padding-top:18px}.calling-settings>.stack>form+form{border-left:1px solid var(--line);padding-left:23px}.calling-settings>.stack>div:last-child{grid-column:1/-1}.calling-settings>.stack h3{margin-top:0}.calling-settings>label{display:inline-block;min-width:230px;max-width:65%;margin-right:10px;vertical-align:bottom}.approval-list{max-height:146px;overflow-y:auto;padding:8px 10px;border:1px solid var(--line);border-radius:7px;gap:8px}.approval-list:empty{display:none}.approval-list label{display:flex;flex-direction:row-reverse;justify-content:flex-end;align-items:center;gap:8px}.approval-list .label{margin:0}.security-card .stack .formrow{display:flex}.security-card .note{margin-bottom:0}:focus-visible{outline:2px solid #9e92e9;outline-offset:3px}button:focus-visible{outline-offset:3px}[id]{scroll-margin-top:22px}@media(min-width:1400px){.main{padding:32px 40px}.layout{grid-template-columns:230px minmax(0,1fr)}}@media(max-width:1100px){.main{padding:24px 22px}.layout{grid-template-columns:195px minmax(0,1fr)}.calling-settings>.stack{gap:16px}.calling-settings>.stack>form+form{padding-left:16px}.formrow label{min-width:110px}}@media(max-width:860px){.client-content{grid-template-columns:1fr}.client-content>*{grid-column:1!important}.admin-grid{grid-template-columns:1fr}.admin-grid>.card{grid-column:1}.calling-settings>.stack{grid-template-columns:1fr}.calling-settings>.stack>form+form{padding-left:0;border-left:0;border-top:1px solid var(--line);padding-top:17px}.access-card>.stack{grid-template-columns:1fr 1fr}.access-card>.stack>.btn{grid-column:1/-1;justify-self:start}}@media(max-width:640px){.layout{display:block}.sidebar{position:relative;height:auto;padding:15px 17px;display:grid;grid-template-columns:1fr 1fr;gap:6px}.brand{grid-column:1/-1;padding:0 0 9px;font-size:16px}.brand small{display:none}.brand-mark{width:29px;height:29px;border-radius:9px}.nav-caption{display:none}.navitem{min-height:34px;padding:8px 10px;font-size:10px}.sidebar-footer{grid-column:1/-1;margin-top:6px;padding:10px 0 0;display:flex;align-items:center;justify-content:space-between}.account-copy p{font-size:9px}.account-copy strong{font-size:10px}.sidebar-footer>.btn{font-size:10px}.main{padding:20px 15px}.topbar{margin-bottom:18px}h1{font-size:22px}.topbar-right>.avatar{display:none}.topbar .pill{font-size:8px;padding:6px}.page-description{font-size:10px;max-width:230px;line-height:1.6}.card{padding:15px;border-radius:11px}.cards{gap:8px}.metric{padding:12px}.metric strong{font-size:22px}.metric small,.metric .metric-symbol{display:none}.metric .muted{font-size:9px}.formrow{gap:9px}.formrow label{min-width:calc(50% - 9px)}.field{font-size:12px;min-height:38px}.btn{font-size:10px;min-height:36px}.calling-settings>label{min-width:0;max-width:none;width:100%;margin-bottom:10px}.calling-settings>.stack{padding-top:15px;margin-top:15px}.client-workspace>label{width:100%}.access-card>.stack{grid-template-columns:1fr}.access-card>.stack>.btn{grid-column:1}.table th,.table td{padding:10px}.admin-grid,.client-content{gap:12px}.stack{gap:11px}.eyebrow{font-size:8px}.client-directory .cards{gap:7px}.client-directory .metric{padding:11px}.approval-list{max-height:150px}}.sidebar-footer .btn.secondary{background:transparent;border:0;color:#a3adc3;justify-content:flex-start;width:auto}.security-card details{margin-top:2px}.security-card details[open]>.stack{margin-top:14px}@media(prefers-reduced-motion:reduce){*,*:before{transition:none!important;scroll-behavior:auto!important}}`;
export const js=String.raw`'use strict';
const root=document.getElementById('app');
const state={me:null,tenant:null,notice:''};
const node=(tag,props={},children=[])=>{const n=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')n.className=v;else if(k==='value')n.value=v;else if(k==='type')n.type=v;else if(k==='onclick')n.addEventListener('click',v);else if(k==='onsubmit')n.addEventListener('submit',v);else if(k==='text')n.textContent=v;else n.setAttribute(k,String(v))}for(const ch of (Array.isArray(children)?children:[children])){if(ch!==null&&ch!==undefined)n.append(ch instanceof Node?ch:document.createTextNode(String(ch)))}return n};
const div=(className,...ch)=>node('div',{class:className},ch);
const iconPaths={grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',phone:'M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 3.09 5.18 2 2 0 0 1 5.08 3h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.79a2 2 0 0 1-.45 2.11L9.05 10.9a16 16 0 0 0 4.05 4.05l1.27-1.27a2 2 0 0 1 2.11-.45c.89.33 1.83.56 2.79.69A2 2 0 0 1 22 16.92',shield:'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11 M9 12l2 2 4-4',mail:'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2 M22 6l-10 7L2 6',settings:'M4 7h16 M4 17h16 M8 4v6 M16 14v6',upload:'M12 16V3 M7 8l5-5 5 5 M3 16v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4',plus:'M12 5v14 M5 12h14',arrow:'M5 12h14 M13 6l6 6-6 6',logout:'M9 21H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5 M16 17l5-5-5-5 M21 12H9',spark:'m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3',calendar:'M4 5h16v16H4z M16 3v4 M8 3v4 M4 11h16',play:'m8 5 11 7-11 7V5',pause:'M8 5v14 M16 5v14',refresh:'M20 7v5h-5 M4 17v-5h5 M6.1 7a7 7 0 0 1 11.6-2L20 8 M4 16l2.3 3a7 7 0 0 0 11.6-2',search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',file:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5'};
function icon(name){const n=document.createElementNS('http://www.w3.org/2000/svg','svg');n.setAttribute('viewBox','0 0 24 24');n.setAttribute('class','icon');n.setAttribute('aria-hidden','true');const p=document.createElementNS(n.namespaceURI,'path');p.setAttribute('d',iconPaths[name]||iconPaths.grid);n.append(p);return n}
const sectionIcon=s=>/security|auth|access|verification/i.test(s)?'shield':/invite/i.test(s)?'mail':/call|voice|exotel/i.test(s)?'phone':/client|customer|lead/i.test(s)?'users':/import|excel|export/i.test(s)?'file':/visit/i.test(s)?'calendar':/agent|AI/i.test(s)?'spark':'settings';
const title=(s,tag='h2')=>node(tag,{},[icon(sectionIcon(s)),node('span',{text:s})]);
const btn=(label,fn,secondary=false)=>node('button',{class:'btn'+(secondary?' secondary':''),type:'button',onclick:fn},[icon(/sign out/i.test(label)?'logout':/pause/i.test(label)?'pause':/start|resume|run|test/i.test(label)?'play':/refresh|^load/i.test(label)?'refresh':/search/i.test(label)?'search':/upload|import|download|export/i.test(label)?'upload':/create|add/i.test(label)?'plus':'arrow'),node('span',{text:label})]);
const input=(name,type='text',placeholder='')=>node('input',{class:'field',name,type,placeholder,required:'required'});
const lab=(text,control)=>node('label',{},[node('span',{class:'label',text}),control]);
function notice(msg,isError=false){state.notice=msg;const old=document.getElementById('notice');if(old)old.remove();const area=document.getElementById('notice-anchor')||root;area.prepend(node('div',{id:'notice',class:'banner '+(isError?'err':'success'),text:msg}))}
async function api(path,method='GET',payload){const r=await fetch(path,{method,credentials:'same-origin',headers:payload?{'Content-Type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||data.code||data.notice||'Request failed');return data}
function asError(e){notice(e instanceof Error?e.message:'Unexpected error',true)}
function table(headers,rows){const t=node('table',{class:'table'});const h=node('tr');headers.forEach(v=>h.append(node('th',{text:v})));t.append(node('thead',{},h));const b=node('tbody');rows.forEach(row=>{const tr=node('tr');row.forEach(v=>{const text=String(v??'—');const cell=node('td');if(['active','completed','submitted','running','trial','paused','queued','draft','suspended','failed','unknown','blocked'].includes(text))cell.append(node('span',{class:'badge '+(['active','completed','running'].includes(text)?'positive':['trial','paused','queued','draft','submitted'].includes(text)?'pending':'negative'),text}));else cell.textContent=text;tr.append(cell)});b.append(tr)});if(!rows.length)b.append(node('tr',{},node('td',{class:'empty-state',colspan:headers.length,text:'No records yet'})));t.append(b);return div('tablewrap',t)}
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
  const status=div('stack',node('p',{class:'muted',text:'Engineering pilot. Exotel account may be connected; customer campaign dialing and payments remain blocked.'}));
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
    node('p',{class:'note',text:'This button runs a simulated provider contract check; it does not send real calls.'}),
    providerLaunch,providerSummary);
  const connectionSummary=div('stack');
  const connectionButton=btn('Check Exotel Connection (read-only)',async()=>{
    connectionButton.disabled=true;
    connectionSummary.replaceChildren(node('p',{class:'muted',text:'Checking approved Exotel account connectivity with server-side secrets only...'}));
    try{
      const result=await api('/v1/human/engineering/provider-connectivity','POST',{});
      connectionSummary.replaceChildren(
        node('p',{class:result.verified?'success':'note',text:'Exotel API: '+(result.verified?'Connection verified':'Not verified')+' | Region: '+(result.apiRegion||'not configured')+' ('+(result.apiRegionStatus||'unknown')+') | Real dialing: disabled'}),
        node('p',{class:'note',text:result.note})
      );
      if(typeof result.checkDiagnostic==='string')
        connectionSummary.append(node('p',{class:'note',text:'Read-only diagnostic: '+result.checkDiagnostic}));
    }catch(err){asError(err)}finally{connectionButton.disabled=false}
  });
  card.append(title('Exotel Account Connectivity (read-only)','h3'),
    node('p',{class:'note',text:'Uses server-side Exotel credentials only after you add them. Never places calls or exposes keys.'}),
    connectionButton,connectionSummary);
  const cutoverOutput=div('stack');
  const cutoverButton=btn('Run Production GO/NO-GO Audit (no calls)',async()=>{
    cutoverButton.disabled=true;
    cutoverOutput.replaceChildren(node('p',{class:'muted',text:
      'Inspecting isolated Calling database guards and remaining independent approvals...'}));
    try{
      const r=await api('/v1/human/engineering/production-cutover');
      cutoverOutput.replaceChildren(
        node('p',{class:r.verdict==='NO_GO'?'note':'err',text:
          'Customer launch: '+r.verdict+
          ' | Control DB: '+r.databaseSafety.control+
          ' | CRM safety: '+r.databaseSafety.crm+
          ' | Customer calls: '+r.customerCallsPlaced+
          ' | Provider requests: '+r.providerNetworkRequests}),
        table(['Unverified production gate','Owner','Next required step'],
          r.blockers.filter(item=>item.requiredForPilot).map(item=>
            [item.title,item.owner,item.action])),
        node('p',{class:'note',text:r.note})
      );
      if(r.databaseSafety.crmMissing.length||r.databaseSafety.controlMissing.length){
        cutoverOutput.append(node('p',{class:'err',text:
          'Critical: Missing database protections. Control: '+
          (r.databaseSafety.controlMissing.join(', ')||'none')+
          ' | CRM: '+(r.databaseSafety.crmMissing.join(', ')||'none')}));
      }
      if(r.verdict!=='NO_GO'||r.customerCampaignLaunchAuthorized||
         r.hundredCustomerCallPilotAuthorized||r.customerCallsPlaced!==0)
        throw Error('Unexpected unsafe production gate response');
    }catch(err){asError(err)}finally{cutoverButton.disabled=false}
  },true);
  card.append(title('Customer Production Launch — GO / NO-GO','h3'),
    node('p',{class:'note',text:
      'A successful code deployment does not permit commercial customer calls. This audited, read-only report checks actual CRM no-dial and consent SQL protection, then lists outstanding Exotel, telecom, privacy, consent/DND, source authentication, backup and operational approvals. No switch can approve launch.'}),
    cutoverButton,cutoverOutput);
  const operatorPanel=div('stack',
    node('p',{class:'note',text:'Software-initiated Exotel Voicebot test: only the one verified phone set privately on the Worker. OFF by default. Never calls Excel leads or runs campaigns. A real test may consume Exotel credits.'}));
  const operatorStatus=node('p',{class:'muted',text:'Checking trial setup...'});
  const operatorHistory=div('stack'),operatorFeedback=div('stack');
  function confirmOperatorTest(){return new Promise(resolve=>{
    const prompt=div('card stack',node('p',{text:'Start ONE real outgoing Exotel Voicebot call to your privately configured verified test number? This may use trial credits. No customer will be called.'}));
    prompt.setAttribute('role','alertdialog');prompt.setAttribute('aria-label','Confirm verified test call');
    function finish(approved){prompt.remove();resolve(approved)}
    prompt.append(div('formrow',btn('Confirm one test call',()=>finish(true)),btn('Cancel test call',()=>finish(false),true)));operatorPanel.append(prompt);prompt.querySelector('button').focus();
  })}
  const operatorDial=btn('Call my verified test phone once',async()=>{
    operatorDial.disabled=true;
    if(!await confirmOperatorTest()){operatorDial.disabled=false;return}
    try{
      const data=await api('/v1/human/engineering/exotel-self-test','POST',
        {confirm:'CALL_MY_VERIFIED_NUMBER_ONCE'});
      operatorFeedback.replaceChildren(node('p',{class:'success',
        text:'Exotel request: '+data.state+'. The call may ring your verified phone. Request ID: '+data.requestId}));
    }catch(err){asError(err)}
    finally{operatorDial.disabled=false;loadOperatorTest()}
  },true);
  async function loadOperatorTest(){
    try{
      const r=await api('/v1/human/engineering/exotel-self-test');
      operatorStatus.textContent='Test dispatch: '+(r.configured?'Configured':'Blocked')+
        ' | Current login MFA: '+(r.mfaEnabled?'Verified':'Sign out and sign in with authenticator')+
        ' | Flow: '+(r.voicebotFlowId||'not configured')+
        ' | Verified destination ending: '+(r.destinationLast4||'not configured');
      operatorDial.disabled=!r.configured||!r.mfaEnabled;
      operatorHistory.replaceChildren();
      for(const item of r.recent||[]){
        const entry=div('stack',node('p',{class:'muted',
          text:item.createdAt+' — '+item.state+' — '+item.id+
            (item.errorCode?' ('+item.errorCode+')':'')}));
        if(item.checkState==='verified'){
          entry.append(node('p',{class:'success',text:
            'Verified Exotel Call Details: '+item.providerStatus+
            (item.durationSeconds===null?' | duration pending':
              ' | '+item.durationSeconds+' seconds')+
            ' | checked '+item.checkedAt}));
        }else if(item.checkState==='unknown'){
          entry.append(node('p',{class:'muted',
            text:'Latest Exotel status could not be verified ('+item.checkError+
            '). No call was initiated by this check.'}));
        }else if(item.checkState==='reserved'){
          entry.append(node('p',{class:'muted',
            text:'Previous Exotel status check still pending. No call initiated.'}));
        }
        if(item.webhookCandidate){
          const c=item.webhookCandidate;
          if(c.state==='candidate_only'){
            entry.append(node('p',{class:'muted',text:
              'Potential Exotel webhook matches (hashed metadata only): '+
              c.uniqueReceipts+' unique events | '+c.completedTurns+
              ' completed turns | '+c.sessionEnds+' session ends | '+
              c.possibleOptOutEvents+' potential opt-out event flags'+
              (c.lastReceivedAt?' | last '+c.lastReceivedAt:'')}));
            entry.append(node('p',{class:'note',text:
              'Candidate only: the webhook external_id must equal this registered test CallSid and its optional leg SID must not conflict. No independent vendor-origin proof, transcript text, CRM lead link, consent or verified opt-out follows. A zero count is NOT proof no webhook arrived.'}));
          }else{
            entry.append(node('p',{class:'muted',text:
              'Webhook matching is unavailable (private token/schema missing or query failed); no conclusion about delivery.'}));
          }
        }
        if(item.state==='submitted'&&r.mfaEnabled){
          if(item.checkState==='verified'&&['failed','busy','no-answer'].includes(item.providerStatus)){
            const retry=btn('Retry this failed test once',async()=>{
              retry.disabled=true;
              if(!await confirmOperatorTest()){retry.disabled=false;return}
              try{const result=await api('/v1/human/engineering/exotel-self-test','POST',{confirm:'RETRY_MY_FAILED_VERIFIED_TEST_ONCE',failedRequestId:item.id});operatorFeedback.replaceChildren(node('p',{class:'success',text:'Reviewed retry: '+result.state+'. Request ID: '+result.requestId}))}catch(e){asError(e)}finally{await loadOperatorTest()}
            },true);entry.append(retry);
          }
          const refresh=btn('Check existing Exotel call status (read-only)',async()=>{
            refresh.disabled=true;
            try{
              const result=await api('/v1/human/engineering/exotel-status-check',
                'POST',{requestId:item.id});
              if(result.state==='verified')notice('Exotel verified: '+
                result.providerStatus+(result.durationSeconds===null?
                  ' | duration pending':' | '+result.durationSeconds+' sec')+
                '. No new call started.');
            }catch(err){asError(err)}
            finally{loadOperatorTest()}
          },true);
          entry.append(refresh);
        }
        operatorHistory.append(entry);
      }
      if(!r.configured)operatorHistory.append(node('p',{class:'note',
        text:'Operator setup missing: '+r.missing.join(', ')+
          '. Store the verified test destination and explicit approval only in private Cloudflare Secrets.'}));
    }catch(err){
      operatorDial.disabled=true;
      operatorStatus.textContent='Operator test status unavailable; dialing disabled.';
    }
  }
  operatorDial.disabled=true;
  operatorPanel.append(operatorStatus,operatorDial,operatorFeedback,operatorHistory);
  card.append(title('AR3D Software → Exotel: One Verified Outgoing Voice Test','h3'),
    operatorPanel);
  loadOperatorTest();
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
      node('p',{class:'muted',text:'Exotel account API region: '+(result.apiRegion||'not configured')+' | Setting: '+(result.apiRegionStatus||'unknown')+' (my.exotel.com usually means singapore)'}),
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
      node('p',{class:'note',text:'Customer campaigns: disabled | Operator-only self-test requires separate approval | Provider transcript auto-save: disabled'}),
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
        node('p',{class:'note',text:'Only fictional events were tested. Session-end does NOT contain the full transcript. This offline fixture does not authenticate provider callbacks. Production callbacks go to a separate Bearer-protected, metadata-only quarantine; call/lead matching and automatic CRM save remain disabled.'})
      );
    }catch(err){asError(err)}finally{webhookCheck.disabled=false}
  },true);
  card.append(title('Managed Exotel Voicebot — Transcript Webhook Checks','h3'),
    node('p',{class:'note',text:'Seven fixed-question transcripts: validates Exotel vendor-format turn events, reordered delivery, retries and opt-out flags offline. No real calls, customer data or CRM edits.'}),
    webhookCheck,webhookResults);
  const webhookHealthOutput=div('stack');
  const webhookHealthButton=btn('Check saved Exotel webhooks (read-only)',async()=>{
    webhookHealthButton.disabled=true;
    webhookHealthOutput.replaceChildren(node('p',{class:'muted',
      text:'Reading safe Exotel webhook receipt counts from Control database...'}));
    try{
      const r=await api('/v1/human/engineering/exotel-webhook-health');
      const m=r.metrics;
      webhookHealthOutput.replaceChildren(
        node('p',{class:'muted',text:
          'Webhook Bearer token: '+(r.webhookTokenConfigured?'configured':'not configured')+
          ' | Source IP guard: '+
          (r.sourceNetworkPolicy==='cloudflare_ipv4_allowlist_enforced'?'network-restricted (not vendor-verified)':
            r.sourceNetworkPolicy==='invalid_allowlist_fail_closed'?'invalid config — callbacks blocked':
            'not configured (Bearer-only quarantine)')+
          ' | Last saved event: '+(r.lastReceivedAt||'none')}),
        table(['Quarantined metadata (unexpired only)','Unique stored receipts'],[
          ['All events',m.uniqueReceipts],
          ['Transcript events',m.transcriptReceipts],
          ['Session end events',m.sessionEndReceipts],
          ['Completed turns',m.completedTurns],
          ['In-progress turns',m.inProgressTurns],
          ['Distinct session fingerprints',m.distinctSessions],
          ['Potential opt-out signals',m.possibleOptOutSignals]
        ]),
        node('p',{class:'note',text:
          'These are unique saved Bearer-authenticated receipts, NOT all webhook attempts or verified provider-origin events. Exotel Test URL pings do not create receipts. A potential opt-out needs separate human investigation; this report has no caller identity or transcript. No CRM writes or calls are performed.'})
      );
    }catch(err){asError(err)}finally{webhookHealthButton.disabled=false}
  },true);
  card.append(title('Exotel Webhook Receipt Health (real saved metadata)','h3'),
    node('p',{class:'note',text:
      'See whether real webhook event metadata reached AR3D. Safe aggregate-only monitoring; it cannot identify a customer or confirm Exotel as the sender.'}),
    webhookHealthButton,webhookHealthOutput);
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
        node('p',{class:'note',text:'These are provisional fields only. This offline fixture does not authenticate vendor callbacks. Live bearer quarantine records only metadata; no lead, opt-out, CRM, call or site visit is modified.'})
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
function dashboard(){
 root.replaceChildren();const admin=state.me.superAdmin;
 const nav=(label,name,target,active=false)=>node('a',{href:'#'+target,class:'navitem'+(active?' active':''),onclick:e=>{e.preventDefault();document.querySelectorAll('.sidebar a[href^="#"]').forEach(n=>n.classList.remove('active'));e.currentTarget.classList.add('active');const el=document.getElementById(target);if(el){if(el.tagName==='DETAILS')el.open=true;el.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'})}}},[icon(name),node('span',{text:label})]);
 const aside=div('sidebar',div('brand',div('brand-mark',icon('spark')),node('div',{},['AR3D',node('small',{text:'AI CALLING WORKSPACE'})])),node('div',{class:'nav-caption',text:'WORKSPACE'}),nav(admin?'Overview':'Dashboard','grid','workspace-top',true),nav(admin?'Clients':'Customers','users',admin?'clients-panel':'customer-workflow'),nav(admin?'Settings':'Campaigns','phone',admin?'platform-settings':'customer-calling'),node('div',{class:'nav-caption',text:'MANAGEMENT'}));
 if(admin)aside.append(nav('Client access','mail','client-access'),nav('Security','shield','platform-settings'));
 else aside.append(nav('Reports & activity','file','client-reports'));
 aside.append(div('sidebar-footer',div('account',div('avatar',node('span',{text:state.me.email.slice(0,2).toUpperCase()})),div('account-copy',node('strong',{text:admin?'Administrator':'Client workspace'}),node('p',{text:state.me.email}))),btn('Sign out',logout,true)));
 const main=div('main',div('topbar',div('',node('div',{class:'eyebrow',text:'WORKSPACE / '+(admin?'OVERVIEW':'DASHBOARD')}),title(admin?'Super Admin':'Personal AI Calling','h1'),node('p',{class:'page-description',text:admin?'Manage your clients, calling and workspace access.':'Your customers, conversations and campaigns. All in one place.'})),div('topbar-right',node('span',{class:'pill'},[node('span',{class:'status-dot'}),'AR3D Client Platform']),div('avatar',node('span',{text:state.me.email.slice(0,2).toUpperCase()})))),div('',node('div',{id:'notice-anchor'})));main.id='workspace-top';root.append(div('layout',aside,main));
 if(admin){const grid=div('admin-grid');main.append(grid);superAdmin(grid);const settings=node('details',{class:'card',id:'platform-settings'},node('summary',{text:'Workspace settings'})),settingsGrid=div('admin-grid');main.append(settings);settings.append(settingsGrid);callingAdminPanel(settingsGrid);scriptAdminPanel(settingsGrid);mfaPanel(settingsGrid);const advanced=node('details',{class:'stack'},node('summary',{text:'Engineering tools and diagnostics'}));settings.append(advanced);engineeringPanel(advanced);voiceGatewayPanel(advanced)}
 if(state.me.tenants.length)clientPanel(main);
}
function showRecoveryCodes(target,codes){
  target.replaceChildren(node('p',{class:'success',text:'Save these one-time recovery codes now. Each works only once. They will not be displayed again.'}));
  const box=node('textarea',{class:'field',rows:'8',readonly:'readonly'});
  box.value=codes.join('\n');
  target.append(lab('Recovery codes — keep offline and private',box),
    node('p',{class:'note',text:'Do not send these codes in messages or screenshots. Store them in a trusted password manager or secure offline record.'}));
}
async function mfaPanel(main){
  const card=div('card security-card',title('Super Admin Two-Factor Authentication'));
  card.id='security-panel';main.append(card);
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
      section.append(node('details',{},[node('summary',{text:'Manage recovery codes'}),form,output]));
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
async function superAdmin(main){
 const panel=div('card client-directory',title('Clients'));panel.id='clients-panel';main.append(panel);
 const list=div('');panel.append(list);
 let existing=null,tenantRowsAll=[];
 async function refresh(){
  try{
   const d=await api('/v1/human/tenants');tenantRowsAll=d.tenants;
   list.replaceChildren(
    div('cards',...[
      ['Total clients',d.tenants.length,'users'],
      ['Active clients',d.tenants.filter(t=>t.status==='active').length,'phone'],
      ['Team members',d.tenants.reduce((n,t)=>n+Number(t.member_count||0),0),'shield']
    ].map(([label,value,symbol])=>div('card metric',div('metric-symbol',icon(symbol)),node('span',{class:'muted',text:label}),node('strong',{text:String(value)})))),
    table(['Company','Contact email','Mobile','Status','Members'],d.tenants.map(t=>[t.display_name,t.contact_email||'—',t.contact_mobile||'—',t.status,t.member_count]))
   );
   if(existing){
    const old=existing.value;
    existing.replaceChildren(node('option',{value:'',text:'New company or automatically match by name'}),
      ...d.tenants.filter(t=>t.status==='trial'||t.status==='active').map(t=>node('option',{value:t.id,text:t.display_name})));
    if(d.tenants.some(t=>t.id===old))existing.value=old;
   }
  }catch(e){asError(e)}
 }
 await refresh();
 const name=input('company','text','Builder company name');
 const email=input('contactEmail','email','client@builder.com');
 const mobile=input('mobile','tel','10-digit Indian mobile');
 existing=node('select',{class:'field'},[node('option',{value:'',text:'New company or automatically match by name'}),
  ...tenantRowsAll.filter(t=>t.status==='trial'||t.status==='active').map(t=>node('option',{value:t.id,text:t.display_name}))]);
 existing.addEventListener('change',()=>{const t=tenantRowsAll.find(t=>t.id===existing.value);if(t)name.value=t.display_name});
 const advanced=node('details',{},node('summary',{text:'Link to an existing company instead'}),lab('Existing company',existing));
 const f=node('form',{class:'stack'},[
  div('formrow',lab('Company name',name),lab('Client email',email),lab('Client mobile',mobile)),
  advanced,
  node('button',{class:'btn',type:'submit',text:'Create client invitation'})
 ]);
 const inviteResult=div('');
 f.addEventListener('submit',async e=>{
  e.preventDefault();
  const matched=tenantRowsAll.find(t=>t.id===existing.value)||
   tenantRowsAll.find(t=>t.display_name.toLowerCase()===name.value.trim().toLowerCase());
  const action=matched?'Link to existing '+matched.display_name:'Create a new company';
  if(!confirm(action+' and generate a private invitation for '+email.value+'? No email or password will be sent automatically.'))return;
  const submit=f.querySelector('button[type=submit]');submit.disabled=true;
  try{
   const body={displayName:name.value,email:email.value,mobile:mobile.value};
   if(existing.value)body.tenantId=existing.value;
   const d=await api('/v1/human/client-accounts','POST',body);
   inviteResult.replaceChildren(div('banner',
    node('strong',{text:d.existingTenant?'Existing company linked':'New company created'}),
    node('p',{text:'Invitation is not sent automatically. Copy this private one-time link and share it only with the intended client. The client chooses their own password.'}),
    node('input',{class:'field',value:d.inviteUrl,readonly:'readonly','aria-label':'Private client invitation link'})
   ));
   notice('Invitation prepared; client account activates after invitation acceptance.');
   f.reset();await refresh();await refreshAccess();
  }catch(err){asError(err)}
  finally{submit.disabled=false}
 });
 panel.append(title('Create client access','h3'),f,inviteResult);
}
const accessCard=div('card access-card',title('Tenant Access: Suspend / Resume','h3'),
  node('p',{class:'note',text:'Suspension immediately blocks the company CRM and API keys. Resume restores its prior status, not a paid subscription.'}));
const management=node('details',{class:'card client-directory',id:'client-access'},node('summary',{text:'Client access and invitations'}));main.append(management);management.append(accessCard);
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
await inviteSection(management)}
async function inviteSection(main){const previous=document.getElementById('invite-card');if(previous)previous.remove();const card=div('card invite-card');card.id='invite-card';card.append(title('Invite client admin','h2'),node('p',{class:'muted',text:'Invitation link shown once. Share privately with the intended client.'}));const select=node('select',{class:'field'},[node('option',{value:'',text:'Choose company'})]);const tenants=await api('/v1/human/tenants');tenants.tenants.forEach(t=>select.append(node('option',{value:t.id,text:t.display_name})));const email=input('email','email','client@builder.com');const role=node('select',{class:'field'},['client_admin','viewer'].map(x=>node('option',{value:x,text:x})));const f=node('form',{class:'formrow'},[lab('Company',select),lab('Client email',email),lab('Role',role),node('button',{type:'submit',class:'btn',text:'Create invitation'})]);f.addEventListener('submit',async e=>{e.preventDefault();try{const d=await api('/v1/human/invitations','POST',{tenantId:select.value,email:email.value,role:role.value});const share=node('input',{class:'field',value:d.inviteUrl,readonly:'readonly',style:'width:100%'});card.append(div('banner',node('p',{text:'Share this one-time link securely:'}),share));notice('Invitation generated for '+email.value)}catch(err){asError(err)}});card.append(f);main.append(card)}
async function clientPanel(main){const panel=div('client-workspace',title('Personal CRM & AI Agent'));main.append(panel);const select=node('select',{class:'field'},state.me.tenants.map(t=>node('option',{value:t.id,text:t.name+' — '+t.plan})));const content=div('client-content');panel.append(lab('Your company',select),content);select.addEventListener('change',()=>renderClient(select.value,content));await renderClient(select.value,content)}
async function renderClient(id,content){content.replaceChildren(node('p',{class:'muted',text:'Loading client dashboard…'}));try{const d=await api('/v1/human/overview?tenantId='+encodeURIComponent(id));content.replaceChildren();const cards=div('cards',...[['Customers',d.metrics.leads],['Call attempts',d.metrics.calls],['Site Visits',d.metrics.siteVisits]].map(([name,val])=>div('card metric',div('metric-symbol',icon(sectionIcon(name))),node('span',{class:'muted',text:name}),node('strong',{text:String(val)}),node('small',{text:'Workspace total'}))));content.append(cards);content.append(node('p',{class:'note',text:'Upload customers, review a campaign, then start Exotel calling after Super Admin approval.'}));await crmWorkflow(id,content,d.role);await customerCallingPanel(id,content,d.role);await callingScriptEditor(id,content);const extra=node('details',{class:'card'},node('summary',{text:'Manual customer entry and agent drafts'}));content.append(extra);const leadCard=div('card',title('Leads','h3'),table(['Name','Mobile','Source','Consent'],d.leads.map(l=>[l.name,l.mobile,l.sourceType,l.consentStatus])));extra.append(leadCard);const name=input('name','text','Customer name'),mobile=input('mobile','tel','9876543210');const leadForm=node('form',{class:'formrow'},[lab('Name',name),lab('Mobile',mobile),node('button',{class:'btn',type:'submit',text:'Add lead'})]);leadForm.addEventListener('submit',async e=>{e.preventDefault();try{await api('/v1/human/leads','POST',{tenantId:id,name:name.value,mobile:mobile.value});notice('Lead saved without calling consent');await renderClient(id,content)}catch(err){asError(err)}});if(d.role==='client_admin')leadCard.append(leadForm);const agentCard=div('card',title('AI Agents','h3'),table(['Name','Language','Status'],d.agents.map(a=>[a.displayName,a.languageMode,a.status])));extra.append(agentCard);if(d.role==='client_admin'){const agentName=input('displayName','text','Sales Agent'),language=node('select',{class:'field'},['hi-en','hi','en'].map(x=>node('option',{value:x,text:x}))),q=node('textarea',{class:'field',placeholder:'One question per line',rows:4});const agentForm=node('form',{class:'stack'},[lab('AI Agent Name',agentName),lab('Language',language),lab('Questions (one per line)',q),node('button',{class:'btn',type:'submit',text:'Save draft AI Agent'})]);agentForm.addEventListener('submit',async e=>{e.preventDefault();try{await api('/v1/human/agents','POST',{tenantId:id,displayName:agentName.value,languageMode:language.value,questions:q.value.split('\n').map(s=>s.trim()).filter(Boolean)});notice('Draft AI Agent saved');await renderClient(id,content)}catch(err){asError(err)}});agentCard.append(agentForm);await agentEditor(id,agentCard)}const planning=node('details',{class:'card'},node('summary',{text:'Advanced campaign planning and project links'}));content.append(planning);await planningPanels(id,planning,d.role);const reports=node('details',{class:'card'},node('summary',{text:'Exports, answer reviews and audit history'}));reports.id='client-reports';content.append(reports);await usageAndExport(id,reports,d.role);if(d.role==='client_admin')await voicebotReviewPanel(id,reports);if(d.role==='client_admin')await auditPanel(id,reports)}catch(e){content.replaceChildren();asError(e)}}

async function voicebotReviewPanel(tenantId,content){
  const card=div('card',title('Verified Exotel Voicebot Review Queue','h3'),
    node('p',{class:'note',text:'Pending staff review of independently verified Exotel answers. Speech answers are reviewed in Exotel. Automatic transcript import is not configured here.'}));
  content.append(card);
  try{
    const res=await api('/v1/human/voicebot-reviews?tenantId='+encodeURIComponent(tenantId));
    if(!res.reviews.length){
      card.append(node('p',{class:'muted',text:'No verified Voicebot reviews yet. Exotel account/callback approval remains pending.'}));
      return;
    }
    for(const item of res.reviews){
      const survey=item.provisionalSurvey;
      const info=div('stack',
        node('p',{text:'Lead reference: '+item.leadId+' | Status: '+item.status}),
        node('p',{class:'muted',text:item.possibleOptOut?
          'Possible Do Not Call request — verify and use the separate CRM suppression action.':
          'Type: '+(survey?.propertyType||'?')+' | City: '+(survey?.location||'?')+
          ' | Size: '+(survey?.size||'?')+' | Budget INR: '+(survey?.budgetInr??'?')+
          ' | Interest: '+(survey?.interest||'?')+' | Visit preference: '+(survey?.visitDate||'none')}));
      const itemCard=div('card',info);
      if(item.status==='pending'){
        const buttons=div('formrow');
        if(!item.possibleOptOut){
          const apply=btn('Apply staff-reviewed answers',async()=>{
            apply.disabled=true;
            try{
              await api('/v1/human/voicebot-reviews/'+encodeURIComponent(item.id)+'/apply','POST',{
                tenantId,expectedUpdatedAt:item.leadUpdatedAt,acknowledged:true});
              notice('Reviewed Voicebot answers applied. No call or site visit was created.');
              await renderClient(tenantId,content);
            }catch(e){asError(e)}finally{apply.disabled=false}
          },true);
          buttons.append(apply);
        }
        if(item.possibleOptOut&&!item.suppressionConfirmed){
          buttons.append(node('p',{class:'note',text:'Possible opt-out: use the lead Do Not Call action and verify suppression before closing this review.'}));
        }else{
          const dismiss=btn('Dismiss review',async()=>{
            dismiss.disabled=true;
            try{
              await api('/v1/human/voicebot-reviews/'+encodeURIComponent(item.id)+'/dismiss','POST',{tenantId});
              notice('Review dismissed without changing CRM.');
              await renderClient(tenantId,content);
            }catch(e){asError(e)}finally{dismiss.disabled=false}
          },true);
          buttons.append(dismiss);
        }
        itemCard.append(buttons);
      }
      card.append(itemCard);
    }
  }catch(e){card.append(node('p',{class:'err',text:'Voicebot review queue could not load.'}));asError(e)}
}

async function customerCallingPanel(tenantId,content,role){
 const card=div('card',title('Exotel Customer Calling','h3'),node('p',{class:'note',text:'Excel import → campaign → Start. Calls continue in the background after closing this page. One call at a time per company; 09:00–20:00 India time. Super Admin must review company and customer permissions first.'}));
 card.id='customer-calling';content.append(card);
 const area=div('stack');card.append(area);
 const pick=node('select',{class:'field','aria-label':'Calling campaign'});
 async function refresh(){
  const [data,campaigns]=await Promise.all([api('/v1/human/calling/state?tenantId='+tenantId),api('/v1/human/campaigns?tenantId='+tenantId)]);
  const prior=pick.value;pick.replaceChildren(...campaigns.campaigns.map(c=>node('option',{value:c.id,text:c.name})));if(prior)pick.value=prior;
  area.replaceChildren(node('p',{class:'note',text:!data.configuration.ready?'Exotel dispatch disabled: '+data.configuration.missing.join(', '):!data.policy?.enabled?'Super Admin company approval required.':'Daily call limit: '+data.policy.dailyLimit+' | Approval expires: '+data.policy.expiresAt}),
   table(['Campaign','State'],data.runs.map(r=>[r.name,r.state])),
   table(['Customer','Call state','Exotel status','Seconds','Details'],data.jobs.map(j=>[j.name,j.state,j.providerStatus,j.durationSeconds,j.errorCode])));
 }
 const refreshBtn=btn('Refresh call results',()=>refresh().catch(asError),true);
 card.append(refreshBtn);
 if(role==='client_admin'){
  const name=input('callCampaignName','text','November follow-up');
  const create=btn('Create campaign with first 200 CRM customers',async()=>{
   create.disabled=true;
   try{
    if(!name.value.trim())throw Error('Enter a campaign name');
    const first=await api('/v1/human/leads?tenantId='+tenantId+'&limit=100&offset=0');
    const second=first.total>100?await api('/v1/human/leads?tenantId='+tenantId+'&limit=100&offset=100'):{leads:[]};
    const ids=[...first.leads,...second.leads].map(l=>l.id);
    if(!ids.length)throw Error('Upload your Excel file first');
    const campaign=await api('/v1/human/campaigns','POST',{tenantId,name:name.value,languageMode:'hi-en',purpose:'property_information'});
    let inserted=0;
    for(let i=0;i<ids.length;i+=50){const r=await api('/v1/human/campaigns/'+campaign.id+'/candidates','POST',{tenantId,leadIds:ids.slice(i,i+50)});inserted+=r.inserted}
    notice(inserted+' customers added. Review the campaign before Start.');await refresh();pick.value=campaign.id;
   }catch(e){asError(e)}finally{create.disabled=false}
  });
  const start=btn('Start / Resume calling',async()=>{
   if(!pick.value)return notice('Create a campaign first.',true);
   if(!confirm('Start real Exotel calls to the approved customers in this campaign? This uses Exotel credits.'))return;
   start.disabled=true;
   try{const r=await api('/v1/human/calling/runs','POST',{tenantId,campaignId:pick.value,action:'start'});notice('Campaign '+r.state+'. Results refresh below.');await refresh()}catch(e){asError(e)}finally{start.disabled=false}
  });
  const pause=btn('Pause campaign',async()=>{try{await api('/v1/human/calling/runs','POST',{tenantId,campaignId:pick.value,action:'pause'});notice('Paused. A call already sent to Exotel may finish.');await refresh()}catch(e){asError(e)}},true);
  card.append(div('formrow',lab('Campaign name',name),create),div('formrow',lab('Campaign',pick),start,pause));
 }
 try{await refresh()}catch(e){area.append(node('p',{class:'err',text:e.message}))}
}
async function callingAdminPanel(main){
 const card=div('card calling-settings',title('Client Calling Setup')),area=div('stack');card.id='calling-setup';main.append(card);
 const company=node('select',{class:'field','aria-label':'Calling setup company'});
 try{const d=await api('/v1/human/tenants');company.append(...d.tenants.map(t=>node('option',{value:t.id,text:t.display_name+' — '+t.status})))}catch(e){asError(e);return}
 const flow=input('flowId','text','Exotel Voicebot Flow ID'),approval=input('approval','text','Exotel approval / account reference');
 const days=input('days','number');days.value='7';days.min='1';days.max='30';
 const limit=input('dailyLimit','number');limit.value='10';limit.min='1';limit.max='100';
 const seconds=input('maxSeconds','number');seconds.value='120';seconds.min='30';seconds.max='600';
 const enabled=node('input',{type:'checkbox','aria-label':'Enable company calling'});
 const policyForm=node('form',{class:'stack'},[lab('Exotel Voicebot Flow ID',flow),lab('Provider approval reference',approval),div('formrow',lab('Approval days (1–30)',days),lab('Daily calls (1–100)',limit),lab('Maximum call seconds',seconds)),lab('Enable company calling',enabled),node('button',{class:'btn',type:'submit',text:'Save company calling approval'})]);
 const consent=input('consent','text','Purpose-specific opt-in evidence reference'),dnd=input('dnd','text','Provider DND check reference');
 const choices=div('stack approval-list');
 const purpose=node('select',{class:'field'},['property_information','site_visit'].map(x=>node('option',{value:x,text:x})));
 const clearanceForm=node('form',{class:'stack'},[title('Review customers for calling','h3'),node('p',{class:'note',text:'Select only customers covered by the consent evidence and current provider DND check. Excel upload alone does not supply these checks. Opted-out customers cannot be approved.'}),lab('Purpose',purpose),lab('Consent evidence reference',consent),lab('DND verification reference',dnd),choices,node('button',{class:'btn',type:'submit',text:'Approve selected customers'})]);
 const status=div('');
 const expires=()=>{const n=Number(days.value);if(!Number.isInteger(n)||n<1||n>30)throw Error('Approval days must be 1–30');return new Date(Date.now()+n*86400000).toISOString()};
 policyForm.addEventListener('submit',async e=>{e.preventDefault();try{await api('/v1/human/calling/policy','POST',{tenantId:company.value,enabled:enabled.checked,flowId:flow.value,approvalReference:approval.value,expiresAt:expires(),dailyLimit:Number(limit.value),maxSeconds:Number(seconds.value)});notice('Company approval saved.');await refresh()}catch(e){asError(e)}});
 clearanceForm.addEventListener('submit',async e=>{e.preventDefault();try{const leadIds=[...choices.querySelectorAll('input:checked')].map(x=>x.value);const r=await api('/v1/human/calling/clearances','POST',{tenantId:company.value,leadIds,purpose:purpose.value,consentReference:consent.value,dndReference:dnd.value,expiresAt:expires()});notice(r.reviewed+' customer approvals saved.');await refresh()}catch(e){asError(e)}});
 async function refresh(){
  choices.replaceChildren();status.replaceChildren();
  if(!company.value)return;
  try{
   const [p,c]=await Promise.all([api('/v1/human/calling/policy?tenantId='+company.value),api('/v1/human/calling/clearances?tenantId='+company.value)]);
   flow.value=p.policy?.flowId||'';approval.value=p.policy?.approvalReference||'';enabled.checked=!!p.policy?.enabled;
   limit.value=String(p.policy?.dailyLimit||10);seconds.value=String(p.policy?.maxSeconds||120);
   status.append(node('p',{class:'note',text:p.configuration.ready?'Exotel customer dispatcher configured.':p.configuration.missing.join(', ')}));
   for(const l of c.leads){const checkbox=node('input',{type:'checkbox',value:l.id});if(l.consentStatus==='denied'||l.dndStatus==='blocked')checkbox.disabled=true;choices.append(lab(l.name+' — '+l.id.slice(0,8),checkbox))}
   status.append(table(['Customer','Purpose','Approval expires'],c.clearances.map(x=>[x.name,x.purpose,x.expiresAt])));
  }catch(e){status.append(node('p',{class:'err',text:e.message+' — use a current Super Admin MFA login.'}))}
 }
 company.addEventListener('change',()=>refresh().catch(asError));
 card.append(lab('Client company',company),btn('Load calling setup',()=>refresh().catch(asError),true),area);
 area.append(policyForm,clearanceForm,status);await refresh();
}

async function scriptAdminPanel(main){
 const card=div('card',title('Questions & Conversation Logic')),area=div('stack');card.id='conversation-setup';main.append(card);
 const company=node('select',{class:'field','aria-label':'Conversation company'});
 try{const result=await api('/v1/human/tenants');company.append(...result.tenants.filter(t=>['trial','active'].includes(t.status)).map(t=>node('option',{value:t.id,text:t.display_name})));}catch(e){asError(e);return}
 async function load(){area.replaceChildren();if(company.value)await callingScriptEditor(company.value,area,true)}
 company.addEventListener('change',()=>load().catch(asError));card.append(lab('Company',company),area);await load();
}
async function voiceGatewayPanel(main){
 const card=div('card stack',title('Shared Calling Gateway','h3')),status=node('p',{class:'note',text:'Checking shared calling connection…'}),result=div('stack');main.append(card);card.append(status);
 const bot=input('gatewayBotId','text','Shared Voicebot UUID'),flow=input('gatewayFlowId','text','Shared Exotel flow ID'),authTemplate=input('gatewayAuthTemplate','text','Existing authenticated webhook bot UUID');
 const form=node('form',{class:'stack'},[node('p',{class:'muted',text:'One-time platform connection. New clients use this gateway automatically; their company knowledge and assistants remain separate.'}),lab('Shared gateway bot',bot),lab('Shared gateway flow',flow),lab('Authenticated webhook template',authTemplate),node('button',{class:'btn',type:'submit',text:'Prepare shared calling connection'})]);
 async function refresh(){const r=await api('/v1/human/voice-gateway');status.textContent=r.gateway?'Shared connection: '+r.gateway.state+' · Flow '+r.gateway.flowId+(r.gateway.version?' · '+r.gateway.version:'')+(r.gateway.errorCode?' · '+r.gateway.errorCode:''):'Shared connection needs one-time setup';if(r.gateway){bot.value=r.gateway.botId;flow.value=r.gateway.flowId;form.querySelector('button[type=submit]').disabled=true}}
 form.addEventListener('submit',async e=>{e.preventDefault();const submit=form.querySelector('button[type=submit]');submit.disabled=true;try{const r=await api('/v1/human/voice-gateway','POST',{action:'configure',botId:bot.value,flowId:flow.value,authTemplateBotId:authTemplate.value});result.replaceChildren(node('p',{class:'note',text:r.notice}));await refresh()}catch(e){asError(e);submit.disabled=false}});
 card.append(form,div('formrow',btn('Inspect gateway contract',async()=>{try{const r=await api('/v1/human/voice-gateway','POST',{action:'inspect',botId:bot.value});result.replaceChildren(node('pre',{class:'note',text:JSON.stringify(r,null,2)}))}catch(e){asError(e)}},true),btn('Connect authenticated session router',async()=>{try{const r=await api('/v1/human/voice-gateway','POST',{action:'connect',authTemplateBotId:authTemplate.value});result.replaceChildren(node('p',{class:'note',text:r.notice}));await refresh()}catch(e){asError(e)}},true),btn('Verify shared gateway rollout',async()=>{try{const r=await api('/v1/human/voice-gateway','POST',{action:'verify'});result.replaceChildren(node('p',{class:'note',text:r.notice}));await refresh()}catch(e){asError(e)}},true)),result);
 const company=node('select',{class:'field','aria-label':'Gateway test company'});try{const r=await api('/v1/human/tenants');company.append(...r.tenants.filter(t=>['trial','active'].includes(t.status)).map(t=>node('option',{value:t.id,text:t.display_name})))}catch(e){asError(e)}
 const test=btn('Test published client on my verified phone',async()=>{
  test.disabled=true;
  const confirmation=div('card stack',node('p',{text:'Start one real gateway call to your privately configured verified test phone, using the selected client’s published agent?'}));confirmation.setAttribute('role','alertdialog');confirmation.setAttribute('aria-label','Confirm client gateway test');
  const approved=await new Promise(resolve=>{function finish(ok){confirmation.remove();resolve(ok)}confirmation.append(div('formrow',btn('Confirm one gateway test',()=>finish(true)),btn('Cancel gateway test',()=>finish(false),true)));card.append(confirmation);confirmation.querySelector('button').focus()});
  if(!approved){test.disabled=false;return}
  try{const r=await api('/v1/human/engineering/exotel-self-test','POST',{confirm:'CALL_MY_VERIFIED_NUMBER_ONCE',publishedTenantId:company.value});result.replaceChildren(node('p',{class:r.routingRegistered?'success':'note',text:'Gateway test: '+r.state+' · routing '+(r.routingRegistered?'registered':'not confirmed')+' · '+r.requestId}))}catch(e){asError(e)}finally{test.disabled=false}
 },true);card.append(lab('Published client for verified-phone test',company),test);refresh().catch(asError);
}
async function companyProfileEditor(tenantId,content,admin=false){
 const card=div(admin?'stack':'card',title('Company Knowledge','h3'));content.append(card);
 let data;try{data=await api('/v1/human/company-profile?tenantId='+tenantId)}catch(e){card.append(node('p',{class:'err',text:e.message}));return}
 const specs=[['companyName','Company name',1],['website','Website',1],['about','About your company',3],['locations','Cities / locations served',2],['propertyTypes','Property types',2],['projects','Projects and property details',4],['pricing','Approved prices / budget ranges',3],['amenities','Amenities and facilities',2],['officeHours','Office hours',1],['contact','Sales contact / office address',2],['additionalFacts','Other approved information',3]];
 const controls={},form=node('form',{class:'stack'}),summary=node('p',{class:'note',text:'Save company details for your AI agent. Enter only information you want the agent to use with customers. Publishing the agent applies these details to calls.'});card.append(summary,form);
 let row;
 for(const [key,label,rows] of specs){const field=rows===1?input('company-'+key,'text',label):node('textarea',{class:'field',rows});field.required=key==='companyName';field.value=data.profile[key]||'';field.disabled=!data.canEdit;controls[key]=field;if(rows===1){if(!row){row=div('formrow');form.append(row)}row.append(lab(label,field))}else{row=null;form.append(lab(label,field))}}
 const status=node('p',{class:'muted',text:data.revision?'Company information v'+data.revision+' saved':'Add your company information to get started'});form.append(status);
 if(data.canEdit)form.append(node('button',{class:'btn',type:'submit',text:'Save company information'}));
 form.addEventListener('submit',async e=>{e.preventDefault();const submit=form.querySelector('button[type=submit]');submit.disabled=true;try{const result=await api('/v1/human/company-profile','POST',{tenantId,baseRevision:data.revision,profile:Object.fromEntries(Object.entries(controls).map(([key,field])=>[key,field.value]))});data.revision=result.revision;status.textContent='Company information v'+data.revision+' saved. Publish the agent to use it in calls.';document.dispatchEvent(new CustomEvent('company-profile-saved',{detail:tenantId}));notice('Company information saved')}catch(e){asError(e)}finally{submit.disabled=false}});
}
async function callingScriptEditor(tenantId,content,admin=false){
 await companyProfileEditor(tenantId,content,admin);
 const card=div(admin?'stack':'card',title('AI Questions & Answers','h3')),status=div(''),history=div(''),faqRows=div('stack');content.append(card);
 let data;
 try{data=await api('/v1/human/calling-scripts?tenantId='+tenantId)}catch(e){card.append(node('p',{class:'err',text:e.message}));return}
 const name=input('scriptName','text','Conversation name'),language=node('select',{class:'field'},['hi-en','hi','en'].map(x=>node('option',{value:x,text:x}))),greeting=node('textarea',{class:'field',rows:2,'aria-label':'Opening message'}),questions=node('textarea',{class:'field',rows:5,'aria-label':'Call questions'}),rules=node('textarea',{class:'field',rows:4,'aria-label':'Conversation rules'}),closing=node('textarea',{class:'field',rows:2,'aria-label':'Closing message'});
 const fields=[name,language,greeting,questions,rules,closing];let baseRevision=data.versions[0]?.revision||0;
 function addFaq(f={question:'',answer:''}){const q=input('faqQuestion','text','Customer question'),a=node('textarea',{class:'field',rows:2,placeholder:'Approved answer'});q.value=f.question;a.value=f.answer;const row=div('stack',lab('Customer question',q),lab('Approved answer',a));row._faq={q,a};if(data.canEdit)row.append(btn('Remove answer',()=>row.remove(),true));faqRows.append(row)}
 function fill(c){name.value=c.name;language.value=c.language;greeting.value=c.greeting;questions.value=c.questions.join('\n');rules.value=c.rules;closing.value=c.closing;faqRows.replaceChildren();c.faqs.forEach(addFaq);fields.forEach(f=>f.disabled=!data.canEdit)}
 fill(data.versions[0]?.config||data.defaults);
 const form=node('form',{class:'stack'},[div('formrow',lab('Conversation name',name),lab('Language',language)),lab('Opening message',greeting),lab('Questions — one per line',questions),title('Approved answers','h3'),faqRows,lab('Conversation rules / follow-up logic',rules),lab('Closing message',closing)]);
 if(data.canEdit){form.insertBefore(btn('Add approved answer',()=>{if(faqRows.children.length<25)addFaq();else notice('Up to 25 approved answers')},true),rules.parentElement);form.append(node('button',{class:'btn',type:'submit',text:'Save new script version'}))}
 form.addEventListener('submit',async e=>{e.preventDefault();const submit=form.querySelector('button[type=submit]');submit.disabled=true;try{
  const config={name:name.value,language:language.value,greeting:greeting.value,questions:questions.value.split('\n').map(q=>q.trim()).filter(Boolean),faqs:[...faqRows.children].map(row=>({question:row._faq.q.value,answer:row._faq.a.value})),rules:rules.value,closing:closing.value};
  const saved=await api('/v1/human/calling-scripts','POST',{tenantId,baseRevision,config});baseRevision=saved.revision;notice('Script version '+saved.revision+' saved. Live calls have not changed.');await refreshHistory();
 }catch(e){asError(e)}finally{submit.disabled=false}});
 async function refreshHistory(){data=await api('/v1/human/calling-scripts?tenantId='+tenantId);baseRevision=data.versions[0]?.revision||0;history.replaceChildren();const published=data.publication?.state==='ready'&&data.publication.scriptRevision===baseRevision&&data.publication.profileRevision===data.profileRevision;status.replaceChildren(node('p',{class:published?'success':'note',text:published?'Latest company information and questions are published for calls.':baseRevision?'Version '+baseRevision+' saved in AR3D. Publish your AI agent below to apply the latest company information and questions to calls.':'No script saved yet. Edit the questions below and save your first version.'}));
  const list=div('stack');for(const v of data.versions){const row=div('formrow',node('span',{text:'v'+v.revision+' · '+v.providerState+(v.providerVersion?' · Exotel '+v.providerVersion:'')+(v.errorCode?' · '+v.errorCode:'')}));if(data.canEdit)row.append(btn('Load v'+v.revision,()=>{fill(v.config);notice('Loaded v'+v.revision+'. Save to create a new version. Latest version remains in history.')},true));if(admin&&data.canStage&&['draft','failed'].includes(v.providerState))row.append(btn('Sync v'+v.revision+' to Exotel',async()=>{try{const r=await api('/v1/human/calling-scripts/stage','POST',{tenantId,id:v.id});notice(r.notice);await refreshHistory()}catch(e){asError(e);await refreshHistory()}},true));list.append(row)}history.append(list);
  if(data.canEdit&&baseRevision){const publish=btn(published?'Agent published':'Publish AI agent for calls',async()=>{publish.disabled=true;try{const r=await api('/v1/human/calling-scripts/publish','POST',{tenantId,id:data.versions[0].id,profileRevision:data.profileRevision});notice(r.notice||'AI agent already published');await refreshHistory()}catch(e){asError(e);await refreshHistory()}finally{publish.disabled=false}});publish.disabled=published;status.append(publish);if(data.publication&&['failed','unknown','sending'].includes(data.publication.state))status.append(node('p',{class:'err',text:'Last publication: '+data.publication.state+(data.publication.errorCode?' — '+data.publication.errorCode:'')}))}
 }
 document.addEventListener('company-profile-saved',e=>{if(e.detail===tenantId&&card.isConnected)refreshHistory().catch(asError)});
 card.append(node('p',{class:'note',text:'Control the questions, approved answers, language and conversation rules here. Each save keeps a new version. Opt-out handling and honest answers remain required.'}),status,form,title('Version history','h3'),history);await refreshHistory();

}

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
    const campaignRisk=div('stack');
    const checkCampaign=btn('Check draft calling readiness (no calls)',async()=>{
      if(!campaignPick.value)return notice('Create a campaign draft first.');
      checkCampaign.disabled=true;
      try{
        const result=await api('/v1/human/campaigns/'+campaignPick.value+
          '/readiness?tenantId='+encodeURIComponent(tenantId));
        const c=result.stats;
        campaignRisk.replaceChildren(
          node('p',{class:'err',text:'NOT APPROVED FOR CALLING — '+c.total+
            ' candidates | '+c.blocked+' explicitly blocked | '+c.optedOut+
            ' opt-outs | '+c.unverified+' unverified | '+c.pendingEvidence+
            ' pending consent evidence | '+c.unclassified+' unclassified'}),
          ...result.reasons.map(reason=>node('p',{class:'note',text:reason})),
          ...result.nextActions.map(action=>node('p',{class:'muted',text:action}))
        );
      }catch(err){asError(err)}
      finally{checkCampaign.disabled=false}
    },true);
    campaignCard.append(checkCampaign,campaignRisk);
    await refreshCandidateList();
    pickForm.addEventListener('submit',async e=>{e.preventDefault();try{
      if(!campaignPick.value||!candidatePick.value)throw Error('Create a draft and a lead first');
      const result=await api('/v1/human/campaigns/'+campaignPick.value+'/candidates','POST',
        {tenantId,leadIds:[candidatePick.value]});
      notice('Candidate references added: '+result.inserted+'. No call started.');await refreshCandidateList();
    }catch(err){asError(err)}});
    campaignCard.append(pickForm);
    const addIntent=btn('Record blocked call intent for selected candidate (no call)',async()=>{
      if(!campaignPick.value||!currentCandidate.value){
        notice('Choose an existing draft candidate first. No call can start.');
        return;
      }
      if(!confirm('Record a BLOCKED planning-only intent for this candidate? This does NOT authorize or start a real call.'))return;
      addIntent.disabled=true;
      try{
        const r=await api('/v1/human/call-intent-proposals','POST',{
          tenantId,campaignId:campaignPick.value,leadId:currentCandidate.value,
          acknowledgeNoDial:true
        });
        if(r.state!=='blocked'||r.executionAllowed||r.customerCallsStarted!==0)
          throw Error('Unsafe intent response');
        notice('Blocked planning intent recorded. No dial request created.');
        await refreshIntentProposals();
      }catch(err){asError(err)}finally{addIntent.disabled=false}
    },true);
    campaignCard.append(addIntent);
  }
  const intentCard=div('card',
    title('Blocked Call Intents — planning only','h3'),
    node('p',{class:'note',text:
      'An immutable proposal records which tenant draft and lead needs review. It is NOT consent approval, provider registration, call authorization or an Exotel dial request.'}));
  const intentList=div('stack');
  content.append(intentCard);
  intentCard.append(intentList);
  async function refreshIntentProposals(){
    try{
      const result=await api('/v1/human/call-intent-proposals?tenantId='+
        encodeURIComponent(tenantId)+'&limit=50');
      if(result.executionAllowed!==false||result.customerCallsStarted!==0)
        throw Error('Unexpected intent readiness');
      intentList.replaceChildren(
        table(['Draft','Lead reference','Purpose','State','Consent','DND','Opt-out'],
          result.proposals.map(p=>[
            p.campaignName,p.leadId.slice(0,8),p.purpose,
            p.state,p.consentStatus,p.dndStatus,p.optOutRecorded?'Yes':'No'
          ])),
        node('p',{class:'muted',text:
          'All proposals remain blocked, including when an earlier lead later revokes permission. This list contains no phone numbers or transcripts.'})
      );
    }catch(err){intentList.replaceChildren(
      node('p',{class:'err',text:'Blocked intent history unavailable.'}));asError(err)}
  }
  await refreshIntentProposals();
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
    node('p',{class:'note',text:'CRM record counts and private customer exports. Call charges are managed in Exotel.'}));
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
  const workflow=div('card',title('Lead Workflow & Excel Import','h3'));workflow.id='customer-workflow';
  workflow.append(node('p',{class:'note',text:'Excel .xlsx या CSV UTF-8 अपलोड करें (अधिकतम 200 leads)। Import से calling consent नहीं मिलता; consent/DND unknown रहेगा।'}));
  content.append(workflow);
  if(editable){
    const template=btn('Download customer Excel template (CSV)',()=>{const href=URL.createObjectURL(new Blob(['Name,Mobile\r\n'],{type:'text/csv;charset=utf-8'}));const a=node('a',{href,download:'ar3d-customer-template.csv'});document.body.append(a);a.click();a.remove();URL.revokeObjectURL(href)},true);workflow.append(template);
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
      .then(result=>readiness.append(node('p',{class:'err',text:'BLOCKED — '+
        (result.optOutRecorded?'Opt-out recorded. ':'')+
        result.pendingEvidenceCount+' pending evidence reference(s). '+result.reasons.join('; ')})))
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
