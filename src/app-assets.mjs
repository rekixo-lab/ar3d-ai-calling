export const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1120"><title>AR3D AI Calling</title><link rel="stylesheet" href="/app/assets/style.css"></head><body><div id="app" role="main"><p>Loading AR3D AI Calling…</p></div><script src="/app/assets/app.js" defer></script></body></html>`;
export {css} from './dashboard-styles.mjs';
export const js=String.raw`'use strict';
const root=document.getElementById('app');
const state={me:null,tenant:null,notice:'',clientTab:'customers',clientSetTab:null};
const node=(tag,props={},children=[])=>{const n=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')n.className=v;else if(k==='value')n.value=v;else if(k==='type')n.type=v;else if(k==='onclick')n.addEventListener('click',v);else if(k==='onsubmit')n.addEventListener('submit',v);else if(k==='text')n.textContent=v;else n.setAttribute(k,String(v))}for(const ch of (Array.isArray(children)?children:[children])){if(ch!==null&&ch!==undefined)n.append(ch instanceof Node?ch:document.createTextNode(String(ch)))}return n};
const div=(className,...ch)=>node('div',{class:className},ch);
const iconPaths={wallet:'M20 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h15v-4 M3 8h17a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-5a4 4 0 0 1 0-8h5 M16 12h.01',clock:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M12 6v6l4 2',receipt:'M4 3l3 2 3-2 3 2 3-2 4 2v16l-4-2-3 2-3-2-3 2-3-2z M8 9h8 M8 13h8 M8 17h4',chart:'M3 3v18h18 M7 16v-4 M12 16V7 M17 16V4',grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',phone:'M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 3.09 5.18 2 2 0 0 1 5.08 3h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.79a2 2 0 0 1-.45 2.11L9.05 10.9a16 16 0 0 0 4.05 4.05l1.27-1.27a2 2 0 0 1 2.11-.45c.89.33 1.83.56 2.79.69A2 2 0 0 1 22 16.92',shield:'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11 M9 12l2 2 4-4',mail:'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2 M22 6l-10 7L2 6',settings:'M4 7h16 M4 17h16 M8 4v6 M16 14v6',upload:'M12 16V3 M7 8l5-5 5 5 M3 16v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4',plus:'M12 5v14 M5 12h14',arrow:'M5 12h14 M13 6l6 6-6 6',logout:'M9 21H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5 M16 17l5-5-5-5 M21 12H9',spark:'m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3',calendar:'M4 5h16v16H4z M16 3v4 M8 3v4 M4 11h16',play:'m8 5 11 7-11 7V5',pause:'M8 5v14 M16 5v14',refresh:'M20 7v5h-5 M4 17v-5h5 M6.1 7a7 7 0 0 1 11.6-2L20 8 M4 16l2.3 3a7 7 0 0 0 11.6-2',search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',file:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5'};
function icon(name){const n=document.createElementNS('http://www.w3.org/2000/svg','svg');n.setAttribute('viewBox','0 0 24 24');n.setAttribute('class','icon');n.setAttribute('aria-hidden','true');const p=document.createElementNS(n.namespaceURI,'path');p.setAttribute('d',iconPaths[name]||iconPaths.grid);n.append(p);return n}
const sectionIcon=s=>/wallet|credit|minute/i.test(s)?'wallet':/transaction|billing/i.test(s)?'receipt':/usage|report/i.test(s)?'chart':/security|auth|access|verification/i.test(s)?'shield':/invite/i.test(s)?'mail':/call|voice/i.test(s)?'phone':/client|customer|lead/i.test(s)?'users':/import|excel|export/i.test(s)?'file':/visit/i.test(s)?'calendar':/agent|AI/i.test(s)?'spark':'settings';
const title=(s,tag='h2')=>node(tag,{},[icon(sectionIcon(s)),node('span',{text:s})]);
const btn=(label,fn,secondary=false)=>node('button',{class:'btn'+(secondary?' secondary':''),type:'button',onclick:fn},[icon(/sign out/i.test(label)?'logout':/pause/i.test(label)?'pause':/start|resume|run|test/i.test(label)?'play':/refresh|^load/i.test(label)?'refresh':/search/i.test(label)?'search':/upload|import|download|export/i.test(label)?'upload':/create|add/i.test(label)?'plus':'arrow'),node('span',{text:label})]);
const input=(name,type='text',placeholder='')=>node('input',{class:'field',name,type,placeholder,required:'required'});
const lab=(text,control)=>node('label',{},[node('span',{class:'label',text}),control]);
function notice(msg,isError=false){state.notice=msg;const old=document.getElementById('notice');if(old)old.remove();const area=document.getElementById('notice-anchor')||root;area.prepend(node('div',{id:'notice',class:'banner '+(isError?'err':'success'),text:msg}))}
async function api(path,method='GET',payload){const r=await fetch(path,{method,credentials:'same-origin',headers:payload?{'Content-Type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||data.code||data.notice||'Request failed');return data}
function asError(e){notice(e instanceof Error?e.message:'Unexpected error',true)}
function table(headers,rows){const t=node('table',{class:'table'});const h=node('tr');headers.forEach(v=>h.append(node('th',{text:v})));t.append(node('thead',{},h));const b=node('tbody');rows.forEach(row=>{const tr=node('tr');row.forEach(v=>{const text=String(v??'—');const cell=node('td');if(v instanceof Node){cell.append(v);tr.append(cell);return}if(['active','completed','submitted','running','trial','paused','queued','draft','suspended','failed','unknown','blocked'].includes(text))cell.append(node('span',{class:'badge '+(['active','completed','running'].includes(text)?'positive':['trial','paused','queued','draft','submitted'].includes(text)?'pending':'negative'),text}));else cell.textContent=text;tr.append(cell)});b.append(tr)});if(!rows.length)b.append(node('tr',{},node('td',{class:'empty-state',colspan:headers.length,text:'No records yet'})));t.append(b);return div('tablewrap',t)}
async function load(){
 const invite=location.hash.match(/^#invite=([a-f0-9]{64})$/);
 if(invite){
  // Opening an invitation must never replace an existing session.
  try{state.me=await api('/v1/human/me');inviteSessionNotice()}
  catch{state.me=null;inviteView(invite[1])}
  return;
 }
 const malformedInvitation=location.hash.startsWith('#invite=');
 if(malformedInvitation)history.replaceState(null,'','/app');
 try{state.me=await api('/v1/human/me');dashboard()}
 catch{state.me=null;login('',malformedInvitation?unavailableInvitationMessage:'')}

}
const unavailableInvitationMessage='This invitation has already been used, expired, or does not match the invited email. If you have activated your account, sign in with your existing password. For first-time access, ask your administrator to check the invited email and share a new link if needed.';
function openSignIn(email='',message=''){
 history.replaceState(null,'','/app');
 if(state.me){dashboard();return}
 login(email,message);
}
function login(emailValue='',message=''){
 root.replaceChildren();
 const email=input('email','email','you@company.com'),pass=input('password','password','Enter your password');
 email.value=emailValue;email.autocomplete='username';pass.autocomplete='current-password';
 const submit=node('button',{class:'btn',type:'submit',text:'Sign in'});
 const form=node('form',{class:'stack'},[lab('Email address',email),lab('Password',pass),submit]);
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(submit.disabled)return;submit.disabled=true;
  try{
   const res=await api('/v1/human/login','POST',{email:email.value,password:pass.value});
   if(res.mfaRequired){mfaChallengeView(res.challenge);return}
   await load();
  }catch(err){asError(err)}
  finally{submit.disabled=false}
 });
 root.append(div('auth',div('card',title('AR3D AI Calling','h1'),
  node('p',{class:'muted',text:'Sign in to your dashboard with your email and password.'}),
  message?node('p',{class:'note',role:'status',text:message}):null,div('stack',form))));
}
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
    f,btn('Back to login',()=>openSignIn(),true))));
}
function inviteSessionNotice(){
 root.replaceChildren();
 const account=state.me?.email||'your existing account';
 const message=state.me?.superAdmin?'Super Admin':'another account';
 const openLogin=btn('Back to my dashboard',()=>{
  history.replaceState(null,'','/app');dashboard()
 },true);
 root.append(div('auth',div('card',title('Client invitation — separate login','h1'),
  node('p',{class:'note',text:'You are already signed in as '+account+' ('+message+'). Opening a client invitation does not replace this login.'}),
  node('p',{class:'muted',text:'To keep both accounts separate, open the invitation in an Incognito window or a different Chrome profile. If it was already activated on mobile, open /app there and sign in with the client email and existing password; the invitation is one-time.'}),
  openLogin)));
}
function inviteView(token){
 root.replaceChildren();
 const email=input('email','email','invited@company.com'),pass=input('password','password','Minimum 8 characters');
 email.autocomplete='username';pass.minLength=8;pass.maxLength=128;pass.autocomplete='new-password';
 const submit=node('button',{class:'btn',type:'submit',text:'Activate client account'});
 const form=node('form',{class:'stack'},[lab('Invited email',email),lab('Create password',pass),submit]);
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(submit.disabled)return;submit.disabled=true;
  try{
   const result=await api('/v1/human/accept-invite','POST',{token,email:email.value,password:pass.value});
   history.replaceState(null,'','/app');
   if(result.mfaRequired)mfaChallengeView(result.challenge);
   else await load();
  }catch(err){
   if(['invalid or expired invitation','invitation has already been used'].includes(err.message))
    openSignIn(email.value,unavailableInvitationMessage);
   else asError(err);
  }finally{submit.disabled=false}
 });
 root.append(div('auth',div('card',title('Accept client invitation','h1'),
  node('p',{class:'muted',text:'Use this one-time link to activate your client account.'}),
  div('stack',form,btn('Sign in with email and password',()=>openSignIn(email.value),true)))));
}
async function logout(){
 try{await api('/v1/human/logout','POST',{})}
 finally{state.me=null;state.clientTab='customers';state.adminTab='clients';state.importCampaign=null;openSignIn()}
}
function scriptedPhonePilotPanel(){
  const card=div('card',title('Internal phone test'));
  const language=node('select',{class:'field'},[
    node('option',{value:'hi',text:'Hindi'}),
    node('option',{value:'en',text:'English'})
  ]);
  language.value=state.internalPilotLanguage||'hi';
  language.addEventListener('change',()=>{state.internalPilotLanguage=language.value});
  const status=node('p',{class:'note',role:'status',text:'Checking pilot configuration…'});
  const results=div('stack'),prepared=div('stack'),mediaReport=div('stack');
  const mediaCheck=btn('Check last call media (no call)',async()=>{
   mediaCheck.disabled=true;
   try{
    const d=await api('/v1/human/scripted-phone-pilot/media-diagnostics');
    mediaReport.replaceChildren(table(['Provider check','Result','HTTP','Matching records'],[
     ['Latest Nova-3 streams',d.streams.state.replaceAll('_',' '),d.streams.httpStatus??'—',d.streams.count??'—'],
     ['Latest Whisper recordings',d.recordings.state.replaceAll('_',' '),d.recordings.httpStatus??'—',d.recordings.count??'—']]),
     node('p',{class:'muted',text:'No new phone call, audio download or transcription. Matching recording duration: '+(d.recordings.durationMs??'—')+' ms. A zero count or unavailable API is not proof of provider failure.'}));
   }catch(e){asError(e)}finally{mediaCheck.disabled=false}
  },true);
  const probeReport=div('stack');
  const probe=btn('Test one saved recording (no call)',async()=>{
   if(!window.confirm('Confirm the recipient of the latest recorded internal test has agreed to reprocess one saved answer with Workers AI. AI usage may be charged. No new call or CRM update.'))return;
   probe.disabled=true;
   try{
    const d=await api('/v1/human/scripted-phone-pilot/recording-probe','POST',{confirm:'REPROCESS_ONE_CONSENTED_INTERNAL_RECORDING'});
    probeReport.replaceChildren(table(['Diagnostic','Result'],[['Outcome',d.state.replaceAll('_',' ')],['Metadata HTTP',d.metadataHttp??'—'],['Verified media host',d.mediaHost??'—'],['Media HTTP',d.mediaHttp??'—'],['Downloaded bytes',d.bytes],['Whisper STT',d.stt.replaceAll('_',' ')]]),node('p',{class:'muted',text:'No new call or CRM change. Audio and transcript are not retained by this diagnostic.'}));
   }catch(e){asError(e)}finally{probe.disabled=false}
  },true);
  const answerReport=div('stack');
  const answerProbe=btn('Inspect first answer recognition (no call)',async()=>{
   if(!window.confirm('Confirm the recipient of the latest recorded internal test explicitly agrees to reprocess and display ONE existing answer transcript to you. AI usage may be charged. No new call, no CRM changes. Do not share private speech.'))return;
   answerProbe.disabled=true;answerReport.replaceChildren();
   try{
    const d=await api('/v1/human/scripted-phone-pilot/recording-probe','POST',{confirm:'SHOW_ONE_CONSENTED_INTERNAL_FIRST_ANSWER'});
    answerReport.replaceChildren(table(['Diagnostic','Result'],[['Outcome',d.state.replaceAll('_',' ')],['Media HTTP',d.mediaHttp??'—'],['Downloaded bytes',d.bytes],['Whisper STT',d.stt.replaceAll('_',' ')],['Recognized words',d.transcript??'—'],['First question parser',d.parserAction??'—'],['Property type',d.propertyType??'—']]),node('p',{class:'muted',text:'Diagnostic only. One existing answer; nothing is saved to CRM. Clear before sharing the screen.'}),btn('Clear transcript',()=>answerReport.replaceChildren(),true));
   }catch(e){asError(e)}finally{answerProbe.disabled=false}
  },true);
  const lastAnswerReport=div('stack');
  const lastAnswerProbe=btn('Inspect last rejected answer (no call)',async()=>{
   if(!window.confirm('Confirm the internal recipient agrees to reprocess and display the latest saved answer using Whisper twice and Cloudflare-hosted Deepgram Nova-3 once. Three AI recognition runs may be charged. No new call or CRM update. Keep the transcript private.'))return;
   lastAnswerProbe.disabled=true;lastAnswerReport.replaceChildren();
   try{
    const d=await api('/v1/human/scripted-phone-pilot/recording-probe','POST',{confirm:'SHOW_ONE_CONSENTED_INTERNAL_LAST_ANSWER'});
    lastAnswerReport.replaceChildren(table(['Diagnostic','Result'],[['Outcome',d.state.replaceAll('_',' ')],['Question',d.question??'—'],['Media HTTP',d.mediaHttp??'—'],['Downloaded bytes',d.bytes],['Media type',d.contentType??'—'],['Recording duration (ms)',d.recordingDurationMs??'—']]),table(['Same recording','Whisper','Whisper + hint','Nova-3 recorded'],[['STT',d.stt.replaceAll('_',' '),d.hinted?.stt?.replaceAll('_',' ')??'—',d.nova?.stt?.replaceAll('_',' ')??'—'],['Recognized words',d.transcript??'—',d.hinted?.transcript??'—',d.nova?.transcript??'—'],['Deterministic parser',d.parserAction??'—',d.hinted?.parserAction??'—',d.nova?.parserAction??'—'],['Normalized answer',d.normalizedAnswer??'—',d.hinted?.normalizedAnswer??'—',d.nova?.normalizedAnswer??'—'],['Reported confidence','—','—',d.nova?.confidence??'—'],['Safe error code',d.failureCode??'—',d.hinted?.failureCode??'—',d.nova?.failureCode??'—']]),node('p',{class:'muted',text:'Three fresh recognition runs on the latest recording by provider time, not the original callback transcript. Question inferred from saved state; contextual interpretation and split-answer memory are not replayed. Check the words against what you actually said. Do not share private speech.'}),btn('Clear transcript',()=>lastAnswerReport.replaceChildren(),true));
   }catch(e){asError(e)}finally{lastAnswerProbe.disabled=false}
  },true);
  const sarvamReport=div('stack');
  const sarvamProbe=btn('Test Sarvam Hindi STT (no call)',async()=>{
   if(!window.confirm('Confirm the internal recipient agrees to send the latest saved answer to Sarvam AI for transcription and, only if needed, contextual interpretation; display the results privately. Up to two AI requests may incur charges. No new call or CRM update.'))return;
   sarvamProbe.disabled=true;sarvamReport.replaceChildren();
   try{
    const d=await api('/v1/human/scripted-phone-pilot/recording-probe','POST',{confirm:'REPLAY_ONE_CONSENTED_INTERNAL_LAST_SARVAM'});
    sarvamReport.replaceChildren(table(['Saaras v4 diagnostic','Result'],[['Outcome',d.state],['Question',d.question??'—'],['STT',d.stt],['Recognized words',d.transcript??'—'],['Parser',d.parserAction??'—'],['Normalized answer',d.normalizedAnswer??'—'],['Recognition latency (ms)',d.recognitionMs??'—'],['Interpreter',d.interpretation?.interpreter??'—'],['Proposed action',d.interpretation?.action??'—'],['Proposed answer (not saved)',d.interpretation?.normalizedAnswer??'—'],['LLM requests',d.interpretation?.llmRequests??'—'],['LLM input tokens',d.interpretation?.usage?.inputTokens??'—'],['LLM output tokens',d.interpretation?.usage?.outputTokens??'—'],['Interpretation latency (ms)',d.interpretation?.latencyMs??'—'],['Safe error code',d.failureCode??'—']]),node('p',{class:'muted',text:d.state==='sarvam_not_configured'?'Server secret SARVAM_API_KEY is required. Do not paste it into this dashboard or chat.':'Latest existing internal recording only. Verify the recognized words against actual speech; not a live-call test.'}),btn('Clear transcript',()=>sarvamReport.replaceChildren(),true));
   }catch(e){asError(e)}finally{sarvamProbe.disabled=false}
  },true);
  const verifiedReport=div('stack');
  const verifyResult=btn('Verify last Sarvam call & CRM (no call)',async()=>{
   verifyResult.disabled=true;verifiedReport.replaceChildren();
   try{
    const d=await api('/v1/human/scripted-phone-pilot/verify-result');
    if(d.state!=='verified_read_only'){verifiedReport.append(node('p',{class:'note',text:d.state}));return}
    verifiedReport.replaceChildren(table(['Call verification','Result'],[['Started',formatIst(d.startedAt)],['Test device','••••'+d.destinationLast4],['Status',d.phase],['Signed hangup',d.signedHangup?'Received':'Missing'],['CRM save verified',d.crmVerified?'Yes':'No'],['Same call saved in CRM',d.crmSameSession?'Yes':'No'],['Answers match',d.answersMatch?'Yes':'No'],['CRM columns match',d.crmColumnsMatch?'Yes':'No'],['Connected seconds',d.connectedSeconds],['Attempts',d.attempts],['Questions accepted',d.questionsAccepted]]),
     table(['Field','Call answer','Saved CRM answer'],Object.entries(d.answers).map(([k,v])=>[k,v??'—',d.storedAnswers?.[k]??'—'])),
     table(['Recorded usage (not invoice)','Value'],Object.entries(d.usage).map(([k,v])=>[k,v??'Unknown'])),
     node('p',{class:'muted',text:'Read-only check of the latest signed-ended internal Sarvam call and its exact test lead. Does not compare to what the recipient actually said; check the displayed values yourself. No new call, AI request, or CRM write.'}),btn('Clear result',()=>verifiedReport.replaceChildren(),true));
   }catch(e){asError(e)}finally{verifyResult.disabled=false}
  },true);
  const listenReport=div('stack');
  let revokeListening=null;
  const listen=btn('Listen to last saved answer (no call, no AI)',async()=>{
   if(!window.confirm('Confirm the internal recipient consents to you listening privately to this saved answer. No new call or AI recognition. Do not share or download the audio.'))return;
   revokeListening?.();listenReport.replaceChildren();listen.disabled=true;
   try{
    const r=await fetch('/v1/human/scripted-phone-pilot/recording-probe',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:'PLAY_ONE_CONSENTED_INTERNAL_LAST_ANSWER'})});
    if(!r.ok||!['audio/mpeg','audio/wav','audio/x-wav'].includes(r.headers.get('Content-Type'))){
     const d=await r.json();throw Error(d.error||d.state||'Playback unavailable');
    }
    const blob=await r.blob();if(blob.size<1||blob.size>524288)throw Error('Invalid audio size');
    const url=URL.createObjectURL(blob),audio=node('audio',{controls:'controls',preload:'none',src:url,controlslist:'nodownload', 'aria-label':'Latest consented internal answer'});
    const clear=()=>{audio.pause();audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);listenReport.replaceChildren();revokeListening=null};
    const timeout=setTimeout(clear,60000);
    revokeListening=()=>{clearTimeout(timeout);clear()};
    listenReport.append(node('p',{class:'muted',text:'Latest short recording by provider time, not necessarily the last callback. Listen privately. Audio player clears after 60 seconds.'}),audio,btn('Clear audio',()=>revokeListening?.(),true));
   }catch(e){asError(e)}finally{listen.disabled=false}
  },true);
  const device=node('select',{class:'field','aria-label':'Internal test number'});
  const engine=node('select',{class:'field','aria-label':'Speech recognition engine'},[
    node('option',{value:'sarvam',text:'Sarvam Saaras v4 · Hindi-first'}),
    node('option',{value:'whisper',text:'Whisper · legacy diagnostic'}),
    node('option',{value:'deepgram_stream',text:'Deepgram Nova-3 · experimental'})
  ]);
  engine.value=state.internalSpeechEngine||'sarvam';
  engine.addEventListener('change',()=>{state.internalSpeechEngine=engine.value;updateAvailability()});
  const mobile=input('internalTestMobile','tel','10-digit Indian mobile');mobile.maxLength=13;
  const enroll=btn('Add test number',async()=>{
    const raw=mobile.value.trim().replace(/\s/g,'');
    const number=/^[6-9][0-9]{9}$/.test(raw)?'+91'+raw:raw;
    if(!/^[+]91[6-9][0-9]{9}$/.test(number)){notice('Enter a valid Indian mobile number.',true);return}
    if(!confirm('Confirm this is an owned or authorized internal test device, the recipient explicitly agrees to the test and recording notice, and your provider permits the test. Adding it will not place a call.'))return;
    enroll.disabled=true;
    try{const d=await api('/v1/human/scripted-phone-pilot/devices','POST',{mobile:number,confirm:'VERIFIED_CONSENTED_INTERNAL_DEVICE_NO_CALL'});mobile.value='';await refresh();device.value=d.leadId;updateAvailability();notice('Internal test number added. No call placed.')}catch(e){asError(e)}finally{updateAvailability()}
  },true);
  const enrollment=node('details',{class:'card'},[node('summary',{text:'Manage internal test numbers (up to 5)'}),node('p',{class:'muted',text:'Only authorized, consenting internal recipients. The primary number counts toward the five-device limit. No call is made when adding a device.'}),div('formrow',lab('Additional mobile',mobile),enroll)]);
  const prepare=btn('Prepare internal test customer (no call)',async()=>{
    if(!window.confirm('Create or reuse the AR3D Internal test customer for the mobile configured in Worker Secrets? Confirm you own and have verified that number. No call, consent clearance or payment is made.'))return;
    prepare.disabled=true;
    try{
      const d=await api('/v1/human/scripted-phone-pilot/prepare-lead','POST',{confirm:'PREPARE_INTERNAL_TEST_LEAD_NO_CALL'});
      const copy=node('input',{class:'field',value:d.leadId,readonly:'readonly','aria-label':'Internal test lead ID'});
      prepared.replaceChildren(node('p',{class:'success',text:(d.created?'Internal test customer created':'Existing internal test customer reused')+' · mobile ending '+d.destinationLast4+'. No call placed.'}),
        node('p',{class:'note',text:'Set this ID as the Worker Secret AR3D_SCRIPTED_PILOT_LEAD_ID, deploy, then refresh go-live checks. Do not enable calling yet.'}),
        copy,btn('Copy internal lead ID',async()=>{try{await navigator.clipboard.writeText(d.leadId);notice('Lead ID copied.')}catch{copy.select()}},true));
    }catch(err){asError(err)}finally{prepare.disabled=false}
  },true);
  let config,busy=false,refreshing=false,deadline=0,timer=null;
  const cooldown=node('p',{class:'muted',role:'status'});
  function updateAvailability(){
    const available=config?.availability;
    const seconds=Math.max(0,Math.ceil((deadline-Date.now())/1000));
    call.disabled=busy||refreshing||!config?.configured||available?.ready!==true||!device.value||!config?.engines?.includes(engine.value);
    enroll.disabled=busy||refreshing||!config?.enrollmentEnabled||(config?.devices?.length||0)>=5;
    cooldown.textContent=!config?.configured?'':available?.reason==='awaiting_signed_hangup'?
      'Waiting for signed hangup from Plivo. Do not redial an unconfirmed call.':
      available?.reason==='cooldown'?'Next internal test in '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'):
      available?.ready===true?'Ready for one internal test call.':'Refresh status to verify call availability.';
  }
  function scheduleCheck(){
    if(timer!==null){clearInterval(timer);timer=null}
    if(!config?.configured||config?.availability?.ready===true)return;
    let ticks=0;
    timer=setInterval(()=>{
      if(!card.isConnected){clearInterval(timer);timer=null;return}
      if(card.closest('[hidden]'))return;
      updateAvailability();ticks++;
      if(!busy&&!refreshing&&(ticks%5===0||(config.availability?.reason==='cooldown'&&Date.now()>=deadline)))
        refresh().catch(()=>{});
    },1000);
  }
  const call=btn('Call the verified internal number once',async()=>{
    const selected=config?.devices?.find(x=>x.leadId===device.value);
    if(busy||refreshing||!selected||config?.availability?.ready!==true||!window.confirm('Place one internal pilot call to the selected test number ending '+selected.destinationLast4+'? Confirm the actual recipient has been informed BEFORE this call about AI processing, text retention and their right to decline, and has explicitly agreed to the selected provider processing their speech and text. Sarvam uses recorded answers and Sarvam AI speech recognition and optional contextual interpretation. Legacy Whisper and Deepgram use Workers AI. For Sarvam, explicitly confirm the recipient has already received and accepted the recording notice before placing this call; it will not be repeated in the greeting. Other recorded calls play their usual notice. No keypad required. Selected recognition: '+engine.options[engine.selectedIndex].textContent+'. Telephony and AI usage may be charged.'))return;
    busy=true;updateAvailability();
    try{
      await api('/v1/human/scripted-phone-pilot','POST',{language:language.value,leadId:selected.leadId,engine:engine.value,confirm:engine.value==='sarvam'?'CALL_ONE_INTERNAL_SARVAM_WITH_PRIOR_RECORDING_NOTICE':'CALL_ONE_PRECONSENTED_INTERNAL_NUMBER'});
      notice('Pilot submitted. Waiting for signed hangup.');
    }catch(err){asError(err)}
    finally{try{await refresh()}catch(err){asError(err)}busy=false;updateAvailability()}
  });
  call.disabled=true;
  async function refresh(){
    if(refreshing)return;
    refreshing=true;updateAvailability();
    try{
    config=await api('/v1/human/scripted-phone-pilot');
    deadline=Date.now()+1000*(config.availability?.retryAfterSeconds||0);
    for(const option of engine.options)option.disabled=!config.engines?.includes(option.value);
    if(!config.sarvamConfigured&&engine.value==='sarvam')status.textContent='Sarvam API key is missing; configure Worker Secret SARVAM_API_KEY.';
    status.textContent=config.configured?'Choose one pre-consented internal device. No keypad required. Complete answers update only its test lead.':'Waiting for Plivo: approve a caller number and configure the internal test.';
    const previous=device.value;
    device.replaceChildren(...(config.devices||[]).map(x=>node('option',{value:x.leadId,text:(x.primary?'Primary':'Test device')+' · ••••'+x.destinationLast4})));
    if(config.devices?.some(x=>x.leadId===previous))device.value=previous;
    enrollment.hidden=!config.configured;
    prepare.hidden=!!config.configured;

    results.replaceChildren(...(config.recent?.length?[table(['Started','Test number','Language','Speech engine','Status','Provider call reference','Attempts processed','Questions accepted','Audio result','Audio received (ms)','Audio bytes','Media host','STT connected','Answer interpreter','STT ms','Interpret ms','LLM requests','STT audio ms','Safe error','Signed hangup','Seconds'],
      config.recent.map(x=>[formatIst(x.created_at),x.destinationLast4?'••••'+x.destinationLast4:'—',x.language,x.engine==='sarvam'?'Sarvam Saaras v4':x.engine==='deepgram_stream'?'Deepgram live':'Whisper',x.phase,x.provider_call_reference?'Received':'Not received',x.turn??'—',x.question_index??'—',x.last_audio_outcome?x.last_audio_outcome.replaceAll('_',' '):'—',x.audio_ms??'—',x.audio_bytes??'—',x.media_host??'—',x.stt_connected==null?'—':x.stt_connected?'Yes':'No',x.interpreter??'—',x.recognition_ms??'—',x.interpretation_ms??'—',x.llm_requests??'—',x.stt_audio_ms??'—',x.failure_code??'—',x.signed_hangup?'Received':'Not received',x.duration_seconds??'—']))]:[]));
    }catch(err){config=null;status.textContent='Could not verify internal call availability. Refresh status to retry.';throw err}
    finally{refreshing=false;updateAvailability();scheduleCheck()}
  }
  enrollment.hidden=true;device.addEventListener('change',updateAvailability);
  card.append(status,prepare,prepared,enrollment,div('formrow',lab('Internal test number',device),lab('Recorded prompt language',language),lab('Speech recognition engine',engine),call,
    btn('Refresh fixed-question pilot status',()=>refresh().catch(asError),true)),cooldown,results,verifyResult,verifiedReport,sarvamProbe,sarvamReport,listen,listenReport,node('details',{class:'card'},[node('summary',{text:'Legacy recognition diagnostics (no call)'}),mediaCheck,mediaReport,probe,probeReport,answerProbe,answerReport,lastAnswerProbe,lastAnswerReport]));
  refresh().catch(()=>{status.textContent='Pilot status requires a current MFA Super Admin session.'});
  return card;
}
function dashboard(){
 root.replaceChildren();
 const admin=state.me.superAdmin;
 state.clientSetTab=null;
 const items=admin?[
  ['clients','Clients','users','Client companies and sign-in invitations.'],
  ['calling','Calling Setup','phone','Internal testing and client calling approval.'],
  ['wallet','Minutes & Wallet','wallet','Review exact call seconds, reconciliation and credit transactions.'],
  ['company','Company details','file','Manage company information and client requests.'],
  ['security','Security','shield','Manage two-factor authentication and recovery codes.']
 ]:[
  ['customers','Customers / Excel','users','Import customers and prepare a calling campaign.'],
  ['ai-test','AI Testing','spark','Practice the seven fixed questions without a phone call or CRM update.'],
  ['calling','Calling','phone','Review your campaign and start or pause approved calls.'],
  ['results','Results / CRM','grid','See call outcomes and answers saved to your CRM.'],
  ['wallet','Minutes & Wallet','wallet','View verified call usage and credit history.'],
  ['company','Company details','file','Review your company information and request changes.']
 ];
 const heading=title(admin?'Clients':items[0][1],'h1');
 heading.tabIndex=-1;
 const subtitle=node('p',{class:'page-description'});
 const nav=node('nav',{'aria-label':admin?'Admin sections':'Client workspace sections',class:'workspace-nav'});
 const links=new Map(),areas=new Map(),loaded=new Set();
 const main=div('main',div('topbar',div('page-heading',node('p',{class:'workspace-role',text:admin?'Super Admin':state.me.tenants.some(t=>t.role==='client_admin')?'Client Admin':'Client viewer'}),heading,subtitle)),
  node('div',{id:'notice-anchor','aria-live':'polite'}));
 const account=div('sidebar-footer',div('account',div('avatar',node('span',{text:state.me.email.slice(0,2).toUpperCase()})),
  div('account-copy',node('strong',{text:state.me.email}))),
  btn('Sign out',logout,true));
 const brand=div('brand',div('brand-mark',icon('phone')),div('',node('strong',{text:'AR3D'}),node('small',{text:'AI Calling'})));
 root.append(div('layout',node('aside',{class:'sidebar'},[brand,nav,account]),main));
 function openView(key,{focus=false,resetScroll=false}={}){
  const item=items.find(x=>x[0]===key);
  if(!item)return;
  if(admin)state.adminTab=key;else state.clientTab=key;
  if(focus&&location.hash!=='#'+key&&!location.hash.startsWith('#invite='))history.replaceState(null,'','#'+key);
  for(const [id,link] of links){
   if(id===key)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  }
  heading.querySelector('span').textContent=item[1];
  subtitle.textContent=item[3];
  if(admin){
   for(const [id,area] of areas)area.hidden=id!==key;
   if(!loaded.has(key)){
    loaded.add(key);
    const area=areas.get(key);
    const renderers={
     clients:()=>superAdmin(area),
     calling:async()=>{area.append(scriptedPhonePilotPanel());await callingAdminPanel(area)},
     wallet:()=>adminMinuteWallet(area),
     company:async()=>{await companyAdminPanel(area);await adminCompanyChangesPanel(area)},
     security:()=>mfaPanel(area)
    };
    Promise.resolve(renderers[key]()).catch(err=>{
     loaded.delete(key);
     area.replaceChildren(node('p',{class:'banner err',role:'alert',text:'Could not load this section.'}),
      btn('Retry',()=>{area.replaceChildren();openView(key)},true));
    });
   }
  }else state.clientSetTab?.(key);
  if(resetScroll)window.scrollTo(0,0);
  if(focus)document.getElementById('notice')?.remove();
  if(focus)heading.focus({preventScroll:true});
 }
 for(const [key,label,symbol] of items){
  const link=node('a',{href:'#'+key,class:'navitem',onclick:e=>{e.preventDefault();openView(key,{focus:true,resetScroll:true})}},
   [icon(symbol),node('span',{text:label})]);
  links.set(key,link);nav.append(link);
  if(admin){
   const area=node('section',{class:'workspace-section',id:key,hidden:true});
   areas.set(key,area);main.append(area);
  }
 }
 if(admin)openView(items.some(x=>x[0]===location.hash.slice(1))?location.hash.slice(1):state.adminTab||'clients');
 else{
  openView(state.clientTab||'customers');
  if(state.me.tenants.length)clientPanel(main,openView);
  else main.append(div('card',title('No company assigned'),node('p',{class:'muted',text:'Ask your administrator to invite this email address.'})));
 }
}
function showRecoveryCodes(target,codes){
  target.replaceChildren(node('p',{class:'success',text:'Save these one-time recovery codes now. Each works only once. They will not be displayed again.'}));
  const box=node('textarea',{class:'field',rows:'8',readonly:'readonly'});
  box.value=codes.join('\n');
  target.append(lab('Recovery codes — keep offline and private',box),
    node('p',{class:'note',text:'Do not send these codes in messages or screenshots. Store them in a trusted password manager or secure offline record.'}));
}
async function mfaPanel(main){
  const card=div('card security-card',title('Two-factor authentication'));
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
// Operator credit controls are optional; no client-facing setup friction.
function formatIst(value){
 const date=new Date(value);return value&&Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'medium'}).format(date)+' IST':'—';
}
function formatSeconds(value){
 if(!Number.isSafeInteger(value)||value<0)return '—';
 return Math.floor(value/60)+'m '+String(value%60).padStart(2,'0')+'s';
}
function minuteUsagePanel(main,tenantId,admin){
 const card=div('card minute-wallet',title('Minute usage & transactions')),
  body=div('stack'),actions=div('formrow');
 let offset=0,version=0;
 const previous=btn('Previous',()=>{offset=Math.max(0,offset-50);load().catch(asError)},true),
  next=btn('Next',()=>{offset+=50;load().catch(asError)},true),
  refresh=btn('Refresh usage',()=>load().catch(asError),true);
 previous.disabled=true;next.disabled=true;actions.append(previous,next,refresh);
 card.append(body,actions);main.append(card);
 const metric=(label,value,description)=>div('card metric',div('metric-symbol',icon(/time|seconds|minutes/i.test(label)?'clock':/calls|CDR/i.test(label)?'phone':'wallet')),node('span',{class:'muted',text:label}),
  node('strong',{text:value}),node('p',{class:'muted',text:description}));
 async function load(){
  const seq=++version;refresh.disabled=true;
  body.replaceChildren(node('p',{class:'muted',text:'Loading verified usage…'}));
  try{
   const d=await api('/v1/human/credits/minute-usage?'+new URLSearchParams({tenantId,offset:String(offset)}));
   if(seq!==version||!card.isConnected)return;
   const rows=d.records.map(r=>{
    const observed=r.verifiedAt!==null;
    const action=admin&&!observed?btn('Verify CDR',async()=>{
     if(!confirm('Read this final call record from Plivo and record its exact seconds? No debit or new call.'))return;
     try{await api('/v1/human/plivo-cost-reconcile','POST',{tenantId,jobId:r.jobId});notice('Provider CDR verified; no debit applied.');await load()}catch(e){asError(e)}
    },true):observed?'Verified':'Pending verification';
    return [formatIst(r.updatedAt),r.state,formatSeconds(r.connectedSeconds),formatSeconds(r.billedSeconds),action];
   });
   body.replaceChildren(div('cards wallet-metrics',
    metric('Connected time',formatSeconds(d.connectedSeconds),d.connectedSeconds+' exact seconds · verified calls'),
    metric('Provider billed time',formatSeconds(d.billedSeconds),d.billedSeconds+' exact billed seconds'),
    metric('Planned budget','₹'+(d.plannedPaise/100).toFixed(2),'Not a spendable wallet'),
    metric('Verified calls',String(d.verifiedCalls),'Final provider records'),
    metric('Awaiting CDR',String(d.pendingCalls),'Not included in verified totals'),
    metric('Available minutes','Not active','No paid credit or deductions')),
    node('p',{class:'note',text:'Connected and billed durations are separate. A provider may bill in increments. No automatic wallet debits, payment or calling approval is active.'}),
    ...(admin&&d.internal?[node('p',{class:'muted',text:'Internal tests (not client charges): '+d.internal.calls+' calls · '+formatSeconds(d.internal.connectedSeconds)+' signed hangup time.'})]:[]),
    title('Call usage records','h3'),table(['Updated','Status','Connected','Provider billed','CDR'],rows),
    title('Budget transaction history','h3'),table(['Date (IST)','Reference','Type','Change (₹)','Before (₹)','After (₹)',...(admin?['Actor','Reason']:[])],
     d.transactions.map(t=>[formatIst(t.createdAt),t.transactionId,t.type==='allocation'?'Planned allocation':t.type==='recovery'?'Planned recovery':'Unchanged',
      (t.deltaPaise>0?'+':'')+(t.deltaPaise/100).toFixed(2),(t.previousPaise/100).toFixed(2),(t.newPaise/100).toFixed(2),...(admin?[t.actor,t.reason]:[])])),
    node('p',{class:'muted',text:'Budget adjustments are audited planning transactions, not purchases or charges.'}));
   previous.disabled=offset===0;next.disabled=!d.hasMore;
  }catch(e){if(seq===version){body.replaceChildren(node('p',{class:'err',text:'Usage unavailable. Refresh to retry.'}));throw e}}
  finally{if(seq===version)refresh.disabled=false}
 }
 return load();
}
async function adminMinuteWallet(main){
 const card=div('card',title('Client minute management')),company=node('select',{class:'field','aria-label':'Minute wallet company'}),
  search=input('walletSearch','search','Find company by name or email'),detail=div('stack');
 search.required=false;search.maxLength=80;
 let generation=0;
 const find=async()=>{
  const seq=++generation;
  const d=await api('/v1/human/tenants?'+new URLSearchParams({limit:'100',q:search.value.trim()}));
  if(seq!==generation)return;
  const previous=company.value;
  company.replaceChildren(node('option',{value:'',text:'Select client company'}),
   ...d.tenants.map(t=>node('option',{value:t.id,text:t.display_name+' — '+t.status})));
  if(d.tenants.some(t=>t.id===previous))company.value=previous;
  await select();
 };
 async function select(){detail.replaceChildren();if(company.value){const selected=company.value;const credits=div('stack'),costs=div('stack'),minutes=div('stack');detail.append(credits,costs,minutes);manualMinuteLedger(credits,selected,true);callCostIntelligence(costs,selected);await minuteUsagePanel(minutes,selected,true)}}
 company.addEventListener('change',()=>select().catch(asError));
 card.append(div('formrow',lab('Search clients',search),btn('Find company',()=>find().catch(asError),true)),
  lab('Client company',company),detail);main.append(card);
 productionCostPlanner(main);
 creditWalletOperator(main);
 await find();
}
function manualMinuteLedger(main,tenantId,admin){
 const panel=div('card minute-wallet',title('Calling credit ledger')),body=div('stack'),form=div('stack');
 const minutes=input('manualMinutes','number','Minutes'),reason=input('manualReason','text','Reason / external reference');
 minutes.min='1';minutes.max='16666666';minutes.step='1';reason.maxLength=200;
 const mode=node('select',{class:'field'},[node('option',{value:'1',text:'Allocate minutes'}),node('option',{value:'-1',text:'Recover unused allocation'})]);
 let balance=null,offset=0,seq=0,pending=null,busy=false;
 const refresh=btn('Refresh credits',()=>load().catch(asError),true),prev=btn('Previous',()=>{offset=Math.max(0,offset-50);load().catch(asError)},true),next=btn('Next',()=>{offset+=50;load().catch(asError)},true);
 const submit=btn('Save credit adjustment',async()=>{
  if(busy||balance===null)return;
  if(!pending){
   if(!minutes.checkValidity()||!reason.checkValidity()||reason.value.trim().length<10){notice('Enter whole minutes and a reason of at least 10 characters.',true);return}
   const delta=Number(minutes.value)*60*Number(mode.value);
   if(!confirm('Confirm '+(delta>0?'allocation':'recovery')+' of '+Math.abs(delta/60)+' minutes for this client? No payment collected and no calls enabled.'))return;
   pending={tenantId,transactionId:crypto.randomUUID(),deltaSeconds:delta,expectedBalanceSeconds:balance,reason:reason.value.trim()};
  }
  busy=true;submit.disabled=true;
  try{await api('/v1/human/credits/minute-ledger','POST',pending);pending=null;minutes.value='';reason.value='';offset=0;await load();notice('Credit adjustment recorded. Calling remains disabled by this ledger.')}
  catch(e){asError(e);notice('Adjustment not confirmed. Retry the same transaction or refresh after checking history.',true)}
  finally{busy=false;submit.disabled=balance===null}
 });
 const reset=btn('Clear pending adjustment & refresh',()=>{if(busy)return;if(pending&&!confirm('Check transaction history before creating another adjustment. Clear this pending request?'))return;pending=null;offset=0;load().catch(asError)},true);
 if(admin)form.append(div('formrow',lab('Adjustment',mode),lab('Whole calling minutes',minutes),lab('Audit reason',reason)),div('formrow',submit,reset));
 async function load(){
  const id=++seq;refresh.disabled=prev.disabled=next.disabled=submit.disabled=true;
  try{const d=await api('/v1/human/credits/minute-ledger?'+new URLSearchParams({tenantId,offset:String(offset)}));if(id!==seq)return;balance=d.allocatedSeconds;
   body.replaceChildren(div('card metric',node('span',{class:'muted',text:'Allocated calling credits'}),node('strong',{text:formatSeconds(balance)}),node('p',{class:'note',text:'Allocation only — not yet spendable. No online payments.'})),
    table(['Date (IST)','Transaction ID','Type','Change (min)','Before','After',...(admin?['Actor','Reason']:[])],d.transactions.map(t=>[formatIst(t.createdAt),t.transactionId,t.kind,(t.deltaSeconds>0?'+':'')+String(t.deltaSeconds/60),formatSeconds(t.previousSeconds),formatSeconds(t.balanceSeconds),...(admin?[t.actor,t.reason]:[])])));
   prev.disabled=offset===0;next.disabled=!d.hasMore;
  }catch(e){if(id===seq){balance=null;body.replaceChildren(node('p',{class:'err',text:'Credit ledger unavailable. Refresh to retry.'}))}throw e}
  finally{if(id===seq){refresh.disabled=false;submit.disabled=busy||balance===null}}
 }
 panel.append(body,form,div('formrow',refresh,prev,next));main.append(panel);return load().catch(asError);
}
function callCostIntelligence(main,tenantId){
 const panel=div('card',title('Call Cost Intelligence')),result=div('stack');let offset=0,seq=0,records=[];
 const cash=n=>n===null||n===undefined?'Unavailable':'₹'+(n/1000000).toFixed(4);
 const prev=btn('Previous',()=>{offset=Math.max(0,offset-50);load().catch(asError)},true),next=btn('Next',()=>{offset+=50;load().catch(asError)},true),refresh=btn('Refresh costs',()=>load().catch(asError),true);
 function row(x){
  const observed=div('stack');
  function show(y){observed.replaceChildren(node('span',{text:y.providerCdr?y.providerCdr.reportedAmount+' · '+y.providerCdr.billedSeconds+' billed sec · currency unverified':'Not checked'}))}
  show(x);
  if(x.scope==='internal'&&!x.providerCdr)observed.append(btn('Check Plivo CDR',async()=>{
   const b=observed.querySelector('button');if(b)b.disabled=true;
   try{const d=await api('/v1/human/credits/internal-call-cdr?'+new URLSearchParams({tenantId,sessionId:x.id}));Object.assign(x,d.record);render()}
   catch(e){asError(e);if(b)b.disabled=false}
  },true));
  return [formatIst(x.startedAt),x.scope,x.engine,x.status,x.connectedSeconds,x.plannedBilledSeconds,observed,
   cash(x.estimatedMicroInr.plivo),x.sttAudioMs===null?'Unknown':(x.sttAudioMs/1000).toFixed(2),x.sttEstimatedRoundedSeconds??'Unknown',
   cash(x.estimatedMicroInr.stt),x.llmRequests??'Unknown',x.llmInputTokens??'Unknown',x.llmOutputTokens??'Unknown',cash(x.estimatedMicroInr.llmBudget),cash(x.estimatedMicroInr.total)];
 }
 function render(){result.replaceChildren(table(['Started (IST)','Scope','Engine','Status','Connected sec','Planned billed sec','Provider CDR','Plivo estimate','STT audio sec','Rounded STT sec (model)','STT estimate','LLM requests','Input tokens','Output tokens','LLM allowance','Total estimate'],records.map(row)))}
 async function load(){const id=++seq;refresh.disabled=prev.disabled=next.disabled=true;
  try{const d=await api('/v1/human/credits/call-costs?'+new URLSearchParams({tenantId,offset:String(offset)}));if(id!==seq)return;
   records=d.records;render();
   prev.disabled=offset===0;next.disabled=!d.hasMore;
  }catch(e){if(id===seq)result.replaceChildren(node('p',{class:'err',text:'Call costs unavailable. Refresh to retry.'}));throw e}
  finally{if(id===seq)refresh.disabled=false}
 }
 panel.append(node('p',{class:'note',text:'Super Admin only. Internal tests are not customer charges. Estimates use the approved tariff model; older audio lacks per-request rounding, LLM allowance is not an invoice, and missing data is not zero. Raw CDR currency is unverified. No revenue, margin, payment or client debit is inferred.'}),div('formrow',refresh,prev,next),result);
 main.append(panel);load().catch(asError);
}
function productionCostPlanner(main){
 const panel=div('card',title('Production cost planner'));
 const minutes=input('estimateMinutes','number'),audio=input('estimateAudio','number'),numbers=input('estimateNumbers','number'),result=div('stack');
 for(const [el,min,max,val] of [[minutes,1,1000000,1000],[audio,0,100,50],[numbers,1,1000,1]]){
  el.min=String(min);el.max=String(max);el.step='1';el.value=String(val);
 }
 let seq=0;
 const refresh=btn('Calculate production cost',()=>calculate().catch(asError),true);
 async function calculate(){
  const id=++seq;refresh.disabled=true;
  try{
   if(![minutes,audio,numbers].every(x=>x.checkValidity()))throw Error('Enter valid whole-number cost assumptions');
   const d=await api('/v1/human/credits/production-cost-plan?'+new URLSearchParams({minutes:minutes.value,audioPercent:audio.value,numbers:numbers.value}));
   if(id!==seq)return;
   const money=n=>'₹'+(n/d.plan.scale).toFixed(3);
   result.replaceChildren(table(['Variable component','Estimated per minute'],[['Plivo',money(d.perMinute.plivo)],['Sarvam STT',money(d.perMinute.stt)],['Contextual LLM budget',money(d.perMinute.llm)],['Variable total',money(d.variablePerMinute)],['Full-minute STT budget',money(d.conservativePerMinute)]]),
    table(['Monthly cost','Estimated INR'],[['Calling numbers',money(d.fixed.numbers)],['Cloudflare Workers Paid',money(d.fixed.cloudflare)],['Fixed subtotal',money(d.fixedTotal)],['Variable subtotal',money(d.variableTotal)],['Total before tax',money(d.total)]]),
    node('p',{class:'note',text:'Planning only · not verified provider charges or a client credit balance. Assumes billed phone minutes equal entered minutes and the entered percentage is billable STT audio. Excludes taxes, FX changes, rounding, retries and Cloudflare overages. No call limits or wallet changes.'}));
  }catch(e){if(id===seq)result.replaceChildren();throw e}
  finally{if(id===seq)refresh.disabled=false}
 }
 panel.append(node('p',{class:'muted',text:'Approved architecture: Plivo + Saaras v4 + direct-first AR3D interpreter / Sarvam contextual LLM. Internal cost assumptions only.'}),div('formrow',lab('Monthly calling minutes (estimate)',minutes),lab('Billable STT audio %',audio),lab('Rented numbers',numbers),refresh),result);
 main.append(panel);calculate().catch(asError);
}
function creditWalletOperator(main){
 const panel=node('details',{class:'card'},node('summary',{text:'Provider balance & provisional budget adjustments'}));
 const area=div('stack'),provider=div(''),connection=div(''),usage=div(''),total=div(''),clientStatus=div('');
 const company=node('select',{class:'field','aria-label':'Client credit company'});
 const packages=[0,100,200,300,400,500];
 const budget=node('select',{class:'field','aria-label':'Planned client credit package'},
  packages.map(n=>node('option',{value:String(n),text:n?String(n)+' credits · ₹'+n+' planned':'No credits · ₹0'})));
 const reason=input('creditReason','text','Reason for changing planned credit');
 reason.maxLength=200;reason.value='AR3D provisional client credit package update';
 const save=btn('Set planned credit',async()=>{
  if(!company.value)return;
  if(!confirm('Set the selected client planned credit to ₹'+budget.value+'? This does NOT transfer Plivo funds or activate calls.'))return;
  save.disabled=true;
  try{
   const n=Number(budget.value);
   if(!packages.includes(n))throw Error('Choose 100, 200, 300, 400 or 500 planned credits');
   const d=await api('/v1/human/credits/tenant','POST',{
    tenantId:company.value,totalInr:n,expectedCurrentInr:current,reason:reason.value
   });
   notice('Client planned credit saved: ₹'+d.plannedInr+'. No Plivo funds transferred.');
   await reload();
  }catch(e){asError(e)}finally{save.disabled=false}
 });
 let current=0,opened=false;
 const loadProvider=async()=>{
  const d=await api('/v1/human/credits/provider');
  provider.replaceChildren(node('p',{class:'note',text:d.available?
   'Plivo API cash_credits: '+d.cashCredits+' (currency not independently verified). '+
   (d.accountType==='developer'?'Trial account — not spendable client funding.':'Not yet a verified INR funding pool.'):
   'Plivo balance unavailable until API credentials and carrier access are set.'}));
 };
 const loadConnection=async()=>{
  const d=await api('/v1/human/credits/provider-check');
  const messages={
   plivo_auth_id_missing:'Cloudflare Secret PLIVO_AUTH_ID is missing from the running Worker.',
   plivo_auth_token_missing:'Cloudflare Secret PLIVO_AUTH_TOKEN is missing from the running Worker.',
   plivo_auth_id_format_invalid:'PLIVO_AUTH_ID has an invalid format. Re-enter the exact Plivo Auth ID without spaces.',
   plivo_auth_token_format_invalid:'PLIVO_AUTH_TOKEN has an invalid format. Re-enter the Auth Token as a Worker Secret without spaces.',
   plivo_account_unauthorized:'Plivo rejected the account login (401). Check the Auth ID and Auth Token belong to the same Plivo account, then save the Secrets again.',
   plivo_account_forbidden:'Plivo refused this account API request (403). Check API access/account restrictions in Plivo.',
   plivo_account_not_found:'Plivo account not found (404). Confirm the Auth ID belongs to the selected Plivo organization.',
   plivo_account_rate_limited:'Plivo is rate-limiting account access (429). Retry later; do not rotate tokens without a reason.',
   plivo_account_http_error:'Plivo Account API returned an unsuccessful HTTP status. Check Plivo status and Worker logs.',
   plivo_account_timeout:'Plivo Account API timed out. Check network connectivity and retry.',
   plivo_account_network_error:'Cloudflare Worker could not reach the Plivo Account API. Check Worker logs and network.',
   plivo_account_invalid_response:'Plivo Account API returned a response we could not validate. Check the provider status and JSON response shape.',
   plivo_account_identity_mismatch:'Plivo returned a different Auth ID than this Worker. Check the connected organization and Secret pair.'
  };
  const reason=d.reason||'unknown';
  const authStatus=d.credentialsVerified?
   'Plivo API authenticated':
   'Plivo API connection NOT verified · '+(messages[reason]||'Unknown connection issue.');
  const http=d.credentialsVerified?'':d.httpStatus?' · HTTP '+d.httpStatus:'';
  const numberStatus=d.credentialsVerified?
   d.configuredCallerPresent===true?
    'Configured caller ••••1333 found in your Plivo account'+
      (d.callerVerifiedBy==='account_number_detail'?' (individual-number lookup)':' (number list)'):
   d.numberListAvailable?
    'Rented-number list available, but configured caller ownership not confirmed':
    'Rented-number list not available':
   'Number check cannot run until Plivo account authentication succeeds';
  const details=d.credentialsVerified&&d.numberListReason?
   ' · Number-list check: '+d.numberListReason+
    (d.numberListHttpStatus?' (HTTP '+d.numberListHttpStatus+')':''):
   '';
  const safety=' This diagnostic never enables campaigns or overrides calling permissions.';
  connection.replaceChildren(
   node('p',{class:'note',role:'status',text:authStatus+http+' · '+numberStatus+details+'.'+safety}),
   ...(d.credentialsVerified&&Array.isArray(d.listedNumbers)?d.listedNumbers.map(n=>
    node('p',{class:'muted',text:n.maskedNumber+(n.inIndia?' · India':'')+
     (n.voiceEnabled?' · Voice enabled':' · Voice not independently verified')})):[]
   )
  );
 };
 const loadUsage=async()=>{
  const d=await api('/v1/human/credits/usage-summary');
  const result=d.available?
   'Plivo India outbound voice · '+d.fromDate+' to '+d.toDateExclusive+
   ' (exclusive) · '+d.listedCalls+' calls · '+d.listedBilledSeconds+
   ' billed seconds · '+d.listedAmount+' '+d.currency+
   (d.hasMorePages?' · Partial rows; more provider pages available':'')+
   '. This is the provider account total, not client wallet deductions.':
   'Plivo usage not available. Check credentials and UsageSummary API permission.';
  usage.replaceChildren(node('p',{class:'note',role:'status',text:result}));
 };
 async function reload(){
  if(!company.value)return;
  const [d,sum]=await Promise.all([
   api('/v1/human/credits/tenant?tenantId='+encodeURIComponent(company.value)),
   api('/v1/human/credits/overview')
  ]);
  current=d.plannedInr;
  // Preserve any previously configured legacy plan in the read-only display.
  if(!packages.includes(current))budget.append(node('option',{value:String(current),text:'Existing legacy plan · ₹'+current}));
  budget.value=String(current);
  clientStatus.replaceChildren(node('p',{class:'note',
   text:'This company: ₹'+current+' planned, ₹ balance not spendable. No billing or calling activated.'}));
  total.replaceChildren(node('p',{class:'muted',
   text:'Total planned across '+sum.clientsWithPlan+' clients: ₹'+sum.plannedTotalInr+
    '. Not deducted from Plivo cash_credits.'}));
 }
 async function open(){
  if(opened)return;
  opened=true;
  const d=await api('/v1/human/tenants?limit=100');
  company.replaceChildren(node('option',{value:'',text:'Select a client company'}),
   ...d.tenants.map(t=>node('option',{value:t.id,text:t.display_name+' — '+t.status})));
  await Promise.all([loadProvider(),api('/v1/human/credits/overview').then(x=>
   total.replaceChildren(node('p',{class:'note',text:'Total planned: ₹'+x.plannedTotalInr+
    ' across '+x.clientsWithPlan+' clients (not yet spendable).'})))]);
 }
 company.addEventListener('change',()=>reload().catch(asError));
 area.append(node('p',{class:'muted',
  text:'These are planning limits only. No money moves to a Plivo subaccount; calling remains disabled until approved funding, minutes reconciliation and telecom checks.'}),
  btn('Refresh Plivo API balance',()=>loadProvider().catch(asError),true),provider,
  btn('Check Plivo API & rented numbers',()=>loadConnection().catch(asError),true),connection,
  btn('View last 7 days Plivo voice usage',()=>loadUsage().catch(asError),true),usage,total,
  div('formrow',lab('Client company',company),lab('Total planned credit (₹)',budget)),
  lab('Audit reason',reason),save,clientStatus);
 panel.append(area);main.append(panel);
 panel.addEventListener('toggle',()=>{if(panel.open)open().catch(err=>{opened=false;asError(err)})});
 document.addEventListener('client-created',()=>{opened=false;if(panel.open)open().catch(asError)});
}

async function superAdmin(main){
 const panel=div('card client-directory',title('Client directory'));panel.id='clients-panel';main.append(panel);
 const list=div(''),directorySearch=input('clientDirectorySearch','search','Search company name, slug or email');
 const prev=btn('← Previous companies',async()=>{pageOffset=Math.max(0,pageOffset-100);await refresh();await refreshAccess();populateMemberCompanies()},true);
 const next=btn('Next companies →',async()=>{pageOffset+=100;await refresh();await refreshAccess();populateMemberCompanies()},true);
 const searchButton=btn('Search clients',async()=>{pageOffset=0;await refresh();await refreshAccess();populateMemberCompanies()},true);
 const pagination=div('formrow',prev,next);
 directorySearch.maxLength=80;
 directorySearch.setAttribute('aria-label','Search all clients');
 directorySearch.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();pageOffset=0;refresh().then(refreshAccess).then(populateMemberCompanies).catch(asError)}
 });
 panel.append(div('formrow',lab('Find any company',directorySearch),searchButton),list,pagination);
 let existing=null,tenantRowsAll=[],pageOffset=0;
 async function refresh(){
  try{
   const query=new URLSearchParams({limit:'100',offset:String(pageOffset),q:directorySearch.value.trim()});
   const d=await api('/v1/human/tenants?'+query);tenantRowsAll=d.tenants;
   const total=Number.isSafeInteger(d.total)?d.total:d.tenants.length;
   const matched=Number.isSafeInteger(d.matched)?d.matched:d.tenants.length;
   prev.disabled=pageOffset===0;next.disabled=pageOffset+d.tenants.length>=matched;
   list.replaceChildren(
    div('cards',...[
      ['Total clients',total,'users'],
      ['Active clients',Number.isSafeInteger(d.active)?d.active:d.tenants.filter(t=>t.status==='active').length,'phone'],
      ['Team members',Number.isSafeInteger(d.members)?d.members:d.tenants.reduce((n,t)=>n+Number(t.member_count||0),0),'shield']
    ].map(([label,value,symbol])=>div('card metric',div('metric-symbol',icon(symbol)),node('span',{class:'muted',text:label}),node('strong',{text:String(value)})))),
    node('p',{class:'muted',text:'Showing '+d.tenants.length+' of '+matched+
      ' matching companies · page '+(Math.floor(pageOffset/100)+1)}),
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
 const initialCredit=input('initialMinutes','number','0');
 initialCredit.value='0';initialCredit.defaultValue='0';initialCredit.min='0';initialCredit.max='16666666';initialCredit.step='1';
 existing=node('select',{class:'field'},[node('option',{value:'',text:'New company or automatically match by name'}),
  ...tenantRowsAll.filter(t=>t.status==='trial'||t.status==='active').map(t=>node('option',{value:t.id,text:t.display_name}))]);
 existing.addEventListener('change',()=>{const t=tenantRowsAll.find(t=>t.id===existing.value);if(t)name.value=t.display_name});
 const advanced=node('details',{},[node('summary',{text:'Link to an existing company instead'}),lab('Existing company',existing)]);
 const f=node('form',{class:'stack'},[
  div('formrow',lab('Company name',name),lab('Client email',email),lab('Client mobile',mobile)),
  lab('Starting calling minutes (new companies only)',initialCredit),
  advanced,
  node('button',{class:'btn',type:'submit',text:'Create client invitation'})
 ]);
 const inviteResult=div('');
 f.addEventListener('submit',async e=>{
  e.preventDefault();
  const matched=tenantRowsAll.find(t=>t.id===existing.value)||
   tenantRowsAll.find(t=>t.display_name.toLowerCase()===name.value.trim().toLowerCase());
  const action=matched?'Link to existing '+matched.display_name:'Create or link company';
  if(!confirm(action+' and generate a private invitation for '+email.value+'? Initial minutes: '+initialCredit.value+'. Allocation only; no payment or calls enabled. No email or password will be sent automatically.'))return;
  const submit=f.querySelector('button[type=submit]');submit.disabled=true;
  try{
   const body={displayName:name.value,email:email.value,mobile:mobile.value,
    initialMinutes:Number(initialCredit.value||0)};
   if(existing.value)body.tenantId=existing.value;
   const d=await api('/v1/human/client-accounts','POST',body);
   inviteResult.replaceChildren(div('banner',
    node('strong',{text:d.existingTenant?'Existing company linked':'New company created'}),
    node('p',{text:'Initial allocated credits: '+formatSeconds(d.initialAllocatedSeconds)+' (not yet spendable).'}),
    node('p',{text:'Invitation is not sent automatically. Copy this private one-time link and share it only with the intended client. The client chooses their own password.'}),
    node('input',{class:'field',value:d.inviteUrl,readonly:'readonly','aria-label':'Private client invitation link'}),
    btn('Copy private link',async()=>{try{await navigator.clipboard.writeText(d.inviteUrl);notice('Private link copied.')}catch{notice('Select and copy the invitation link above.',true)}},true),
    node('p',{text:'After activation, use the permanent sign-in link with the existing email and password.'}),
    node('input',{class:'field',value:location.origin+'/app',readonly:'readonly','aria-label':'Permanent client sign-in link'})
   ));
   notice('Invitation prepared; client account activates after invitation acceptance.');
   f.reset();await refresh();await refreshAccess();populateMemberCompanies();document.dispatchEvent(new CustomEvent('client-created',{detail:d.id}));
  }catch(err){asError(err)}
  finally{submit.disabled=false}
 });
 panel.append(node('details',{class:'card'},[node('summary',{text:'Create / invite a new client'}),f,inviteResult]));
const accessCard=div('card access-card',title('Tenant Access: Suspend / Resume','h3'),
  node('p',{class:'note',text:'Suspending access blocks the company CRM and API keys.'}));
const management=node('details',{class:'card client-directory',id:'client-access'},node('summary',{text:'Manage existing access'}));main.append(management);management.append(accessCard);
const accessSelect=node('select',{class:'field'});
const reason=input('tenantActionReason','text','Required reason, at least 10 characters');
reason.maxLength=240;
const actionForm=node('form',{class:'stack'},[lab('Company',accessSelect),lab('Reason (audited)',reason),
  node('button',{class:'btn secondary',type:'submit',text:'Suspend / Resume Selected Client'})]);
accessCard.append(actionForm);
let tenantRows=[];
async function refreshAccess(){
  const q=new URLSearchParams({q:directorySearch.value.trim(),limit:'100',offset:String(pageOffset)});
  const result=await api('/v1/human/tenants?'+q);
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
  notice('Client access updated: '+result.status+'.');
  reason.value='';await refresh();await refreshAccess();populateMemberCompanies();
}catch(err){asError(err)}});
await inviteSection(management);
// Super Admin can review and revoke individual access without suspending a whole builder.
const membersPanel=node('details',{class:'card'},node('summary',{text:'Members & unused invitation links'}));
management.append(membersPanel);
const memberCompany=node('select',{class:'field'});
const revokeReason=input('revokeReason','text','Required audit reason (at least 10 characters)');
revokeReason.maxLength=240;
const memberResults=div('');
const memberControls=div('stack',lab('Company',memberCompany),
  lab('Reason for disabling or revoking access',revokeReason),
  btn('Refresh members and invitations',async()=>{try{await loadMembers()}catch(err){asError(err)}},true),
  memberResults);
membersPanel.append(memberControls);
function populateMemberCompanies(){
 const previous=memberCompany.value;
 memberCompany.replaceChildren(node('option',{value:'',text:'Select a company'}),
  ...tenantRows.map(t=>node('option',{value:t.id,text:t.display_name+' — '+t.status})));
 if(tenantRows.some(t=>t.id===previous))memberCompany.value=previous;
}
populateMemberCompanies();
memberCompany.addEventListener('change',()=>{loadMembers().catch(asError)});
async function revokeAccess(path,description){
 if(revokeReason.value.trim().length<10)throw Error('Enter an audit reason of at least 10 characters');
 if(!confirm(description+'? This change is recorded in the audit log.'))return;
 await api(path,'POST',{reason:revokeReason.value.trim()});
 revokeReason.value='';
 notice('Access updated. Existing company data and other client accounts are unchanged.');
 await refresh();await refreshAccess();populateMemberCompanies();await loadMembers();
}
async function loadMembers(){
 const tenantId=memberCompany.value;
 memberResults.replaceChildren();
 if(!tenantId)return;
 const data=await api('/v1/human/tenants/'+tenantId+'/access');
 const members=data.members.map(m=>[m.email,m.role,m.status,m.status==='active'?
   btn('Disable member',async()=>{try{
    await revokeAccess('/v1/human/tenants/'+tenantId+'/members/'+encodeURIComponent(m.id)+'/disable',
      'Disable '+m.email+' for '+data.client.name);
   }catch(err){asError(err)}},true):'—']);
 const invites=data.pendingInvitations.map(i=>[i.email,i.role,new Date(i.expiresAt).toLocaleString(),
   btn('Revoke link',async()=>{try{
    await revokeAccess('/v1/human/tenants/'+tenantId+'/invitations/'+i.id+'/revoke',
      'Revoke pending invitation for '+i.email);
   }catch(err){asError(err)}},true)]);
 memberResults.append(title('Member accounts','h3'),
   node('p',{class:'muted',text:'Disabled members immediately lose access to this company. Re-invite them to restore access. Other company memberships are unaffected.'}),
   table(['Email','Role','Status','Action'],members),
   title('Pending invitations','h3'),
   node('p',{class:'muted',text:'Only unused, unexpired links are shown. Private invitation tokens are never listed.'}),
   table(['Email','Role','Expires','Action'],invites));
}
}
async function inviteSection(main){
 const previous=document.getElementById('invite-card');if(previous)previous.remove();
 const card=div('card invite-card');card.id='invite-card';
 card.append(title('Invite an existing client user','h3'),
  node('p',{class:'muted',text:'Create a private invitation for a company. Search across all companies.'}));
 const select=node('select',{class:'field','aria-label':'Company to invite'}),
  search=input('inviteCompanySearch','search','Find any company by name or email');
 search.maxLength=80;
 async function find(){
  const q=new URLSearchParams({q:search.value.trim(),limit:'100'});
  const result=await api('/v1/human/tenants?'+q);
  const old=select.value;
  select.replaceChildren(node('option',{value:'',text:'Choose company'}),
   ...result.tenants.map(t=>node('option',{value:t.id,text:t.display_name})));
  if(result.tenants.some(t=>t.id===old))select.value=old;
 }
 const email=input('email','email','client@builder.com');
 const role=node('select',{class:'field'},['client_admin','viewer'].map(x=>node('option',{value:x,text:x})));
 const f=node('form',{class:'formrow'},[lab('Company',select),lab('Client email',email),lab('Role',role),
  node('button',{type:'submit',class:'btn',text:'Create invitation'})]);
 f.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!select.value){asError(Error('Choose a company before inviting'));return}
  try{
   const d=await api('/v1/human/invitations','POST',{tenantId:select.value,email:email.value,role:role.value});
   const share=node('input',{class:'field',value:d.inviteUrl,readonly:'readonly',style:'width:100%'});
   card.append(div('banner',node('p',{text:'Share this one-time link securely:'}),share));
   notice('Invitation generated for '+email.value);
  }catch(err){asError(err)}
 });
 const findBtn=btn('Find company',()=>find().catch(asError),true);
 search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();find().catch(asError)}});
 card.append(div('formrow',lab('Search client directory',search),findBtn),f);
 main.append(card);await find().catch(asError);
}
async function adminCompanyChangesPanel(main){
 const card=div('card client-directory',title('Client Change Requests','h3'),
  node('p',{class:'note',text:'Clients request corrections here. Update the company profile before marking a change request handled.'}));
 card.id='company-change-inbox';main.append(card);
 const company=node('select',{class:'field','aria-label':'Review client company'}),items=div('stack');
 const search=input('changeRequestCompanySearch','search','Search all companies');
 search.maxLength=80;
 const refreshList=async()=>{
  items.replaceChildren();
  if(!company.value)return;
  try{
   const d=await api('/v1/human/company-change-requests?tenantId='+encodeURIComponent(company.value));
   if(!d.requests.length){items.append(node('p',{class:'muted',text:'No company change requests yet.'}));return}
   for(const item of d.requests){
    const host=div('card stack',node('p',{text:item.message}),
      node('p',{class:'muted',text:item.status+' · '+new Date(item.createdAt).toLocaleString()+
        (item.resolutionNote?' · '+item.resolutionNote:'')}));
    if(item.status==='pending'){
     const actions=div('formrow');
     for(const [action,label] of [['handled','Mark handled (after AI update)'],['dismissed','Dismiss request']]){
      const button=btn(label,async()=>{
       if(!confirm(action==='handled'?'Confirm: the approved company information or AI was reviewed and updated separately?':'Dismiss this client request without changing the company AI?'))return;
       button.disabled=true;
       try{
        await api('/v1/human/company-change-requests/'+encodeURIComponent(item.id)+'/resolve','POST',
         {tenantId:company.value,status:action});
        notice('Client request '+action+'. Current published AI changes only after a separate Admin publish.');
        await refreshList();
       }catch(e){asError(e);button.disabled=false}
      },action==='dismissed');
      actions.append(button);
     }
     host.append(actions);
    }
    items.append(host);
   }
  }catch(e){items.append(node('p',{class:'err',text:e.message}))}
 };
 const refreshCompanies=async()=>{
  const old=company.value;
  const d=await api('/v1/human/tenants?'+new URLSearchParams({q:search.value.trim(),limit:'100'}));
  company.replaceChildren(...d.tenants.filter(t=>['trial','active'].includes(t.status))
   .map(t=>node('option',{value:t.id,text:t.display_name})));
  if([...company.options].some(x=>x.value===old))company.value=old;
  await refreshList();
 };
 company.addEventListener('change',()=>refreshList().catch(asError));
 const find=btn('Find companies',()=>refreshCompanies().catch(asError),true);
 search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();refreshCompanies().catch(asError)}});
 card.append(div('formrow',lab('Find company',search),find),
  div('formrow',lab('Client',company),
   btn('Refresh client requests',()=>refreshCompanies().catch(asError),true)),items);
 await refreshCompanies();
}
async function clientCompanySummary(tenantId,content,role,companyName=''){
 const card=div('card',title('Company information'),
  node('p',{class:'note',text:'These company details are view-only. To correct a price, project or location, use Request Changes below.'}));
 content.append(card);
 try{
  const company=await api('/v1/human/company-profile?tenantId='+encodeURIComponent(tenantId));
  const labels=[['companyName','Company name'],['locations','Location'],['projects','Projects and plots'],
   ['propertyTypes','Property types'],['pricing','Approved prices'],['amenities','Amenities'],
   ['contact','Sales contact'],['officeHours','Office hours'],['website','Website'],
   ['about','About the company'],['additionalFacts','Additional details']];
  const rows=labels.map(([key,label])=>[label,company.profile[key]||((key==='companyName')?companyName:'—')])
   .filter(([key,val])=>val&&val!=='—');
  card.append(rows.length?table(['Company information','Provided details'],rows):
   node('p',{class:'muted',text:'Company details have not yet been saved by AR3D.'}));
 }catch(e){card.append(node('p',{class:'err',text:'Company information unavailable. Please contact AR3D.'}))}
 const requestCard=div('card',title('Request Changes','h3'),
  node('p',{class:'muted',text:'Tell AR3D what needs correcting, for example: project, location, plot size or price. AR3D reviews each request before updating the profile.'}));
 content.append(requestCard);
 const history=div('stack');
 async function refresh(){
  const d=await api('/v1/human/company-change-requests?tenantId='+encodeURIComponent(tenantId));
  history.replaceChildren(d.requests.length?
   table(['Requested change','Status','Submitted'],d.requests.map(x=>[x.message,x.status,new Date(x.createdAt).toLocaleDateString()])):
   node('p',{class:'muted',text:'No change requests yet.'}));
 }
 if(role==='client_admin'){
  const message=node('textarea',{class:'field',rows:3,placeholder:'Example: Update our Raipur plot price from 12 lakh to 14 lakh.'});
  message.maxLength=1200;message.minLength=15;
  const form=node('form',{class:'stack'},[
   lab('What should AR3D update?',message),
   node('button',{class:'btn',type:'submit',text:'Send change request'})
  ]);
  form.addEventListener('submit',async e=>{
   e.preventDefault();
   const send=form.querySelector('button[type=submit]');send.disabled=true;
   try{await api('/v1/human/company-change-requests','POST',{tenantId,message:message.value});
    message.value='';notice('Request sent to AR3D.');await refresh()}
   catch(err){asError(err)}finally{send.disabled=false}
  });
  requestCard.append(form);
 }
 requestCard.append(history);try{await refresh()}catch(e){history.append(node('p',{class:'err',text:'Change request history unavailable.'}))}
}
async function clientPanel(main,openView){
 const tenants=state.me.tenants;
 const panel=div('client-workspace'),content=div('client-content');
 const choice=node('select',{class:'field'},tenants.map(t=>
  node('option',{value:t.id,text:t.name+' · '+(t.role==='client_admin'?'Admin':'Viewer')})));
 if(tenants.length>1){
  panel.append(div('company-switch',lab('Company',choice)));
  choice.addEventListener('change',()=>renderClient(choice.value,content));
 }else panel.append(node('p',{class:'company-context',text:tenants[0].name}));
 panel.append(content);main.append(panel);
 content.openView=openView;
 await renderClient(choice.value,content);
}

// Verified tenant overview: only the selected company's server-authorized counts.
function clientDashboardOverview(data,onRefresh){
 const owner=data.role==='client_admin',metrics=data.metrics||{};
 const count=key=>String(Number.isSafeInteger(metrics[key])&&metrics[key]>=0?metrics[key]:0);
 const summary=div('card client-summary',
  div('row between',
   div('',title('Company overview'),node('strong',{class:'client-company-name',text:data.tenant.name})),
   div('row',node('span',{class:'badge '+(owner?'positive':'pending'),
     text:owner?'Client Admin · Can manage customers':'Viewer · Read-only'}),
    btn('Refresh overview',onRefresh,true))),
  div('cards client-metrics',
   ...[['Customers',count('leads'),'users'],
       ['Call records',count('calls'),'phone'],
       ['Visit requests',count('siteVisits'),'calendar']].map(([label,value,symbol])=>
      div('card metric',div('metric-symbol',icon(symbol)),
       node('span',{class:'muted',text:label}),node('strong',{text:value})))),
  node('p',{class:'muted',text:'These figures are this company’s CRM records, not verified Plivo call minutes or charges.'}),
  btn('View follow-ups and next actions',()=>{state.clientTab='results';state.clientSetTab?.('results')},true));
 summary.setAttribute('aria-label','Selected company overview');
 return summary;
}
async function renderClient(id,content){
 const version=(content.renderVersion||0)+1;
 content.renderVersion=version;
 state.clientSetTab=null;
 const roleLabel=root.querySelector('.workspace-role');
 if(roleLabel)roleLabel.textContent='Client workspace';
 // Clear the previous company's visible data before requesting this company.
 content.replaceChildren(node('p',{class:'muted',text:'Loading workspace…'}));
 let d;
 try{d=await api('/v1/human/overview?tenantId='+encodeURIComponent(id))}
 catch(e){
  if(content.isConnected&&content.renderVersion===version)content.replaceChildren(
   node('p',{class:'banner err',role:'alert',text:'Could not load this company.'}),
   btn('Retry',()=>renderClient(id,content),true));
  return;
 }
 if(!content.isConnected||content.renderVersion!==version)return;
 if(roleLabel)roleLabel.textContent=d.role==='client_admin'?'Client Admin':'Client viewer';
 const overview=clientDashboardOverview(d,()=>renderClient(id,content));
 // Client-visible credit is explicitly provisional until carrier CDR billing.
 if(d.role==='client_admin'){
  const metric=div('card metric',node('span',{class:'muted',text:'Planned calling credit'}),
   node('strong',{text:'Loading…'}),
   node('p',{class:'muted',text:'Not yet spendable; activation pending.'}));
  overview.querySelector('.client-metrics')?.append(metric);
  api('/v1/human/credits/tenant?tenantId='+encodeURIComponent(id)).then(w=>{
   if(content.renderVersion!==version)return;
   metric.querySelector('strong').textContent='₹'+String(w.plannedInr);
  }).catch(()=>{
   if(content.renderVersion===version)metric.querySelector('strong').textContent='Not configured';
  });
 }
 const sections=Object.fromEntries(['customers','ai-test','calling','results','wallet','company'].map(key=>[
  key,node('section',{class:'workspace-section',id:key,hidden:true})
 ]));
 const loaded=new Set();
 const renderers={
  customers:async section=>{
   if(d.role==='client_admin')section.append(manualCustomerPanel(id,content));
   await crmWorkflow(id,section,d.role,content);
  },
  'ai-test':section=>aiTestingPanel(section,id,d.role),
  calling:section=>customerCallingPanel(id,section,d.role,content.openView),
  results:async section=>{
   nextActionsPanel(id,section);
   operationsReportPanel(id,section);
   campaignResultsPanel(id,section,d.role);
   if(d.role==='client_admin'){
    const reports=node('details',{class:'card'},node('summary',{text:'Export and audit history'}));
    section.append(reports);
    reports.addEventListener('toggle',()=>{
     if(!reports.open||reports.dataset.loaded)return;
     reports.dataset.loaded='true';
     Promise.all([usageAndExport(id,reports,d.role),auditPanel(id,reports)]).catch(asError);
    });
   }
  },
  wallet:section=>{if(d.role==='client_admin'){manualMinuteLedger(section,id,false);return minuteUsagePanel(section,id,false)}section.append(node('p',{class:'note',text:'Wallet and transaction details require Client Admin access.'}))},
  company:section=>clientCompanySummary(id,section,d.role,d.tenant.name)
 };
 content.replaceChildren(overview,...Object.values(sections));
 function selectSection(key){
  if(!Object.hasOwn(sections,key))return;
  for(const [name,section] of Object.entries(sections))section.hidden=name!==key;
  const section=sections[key];
  if(loaded.has(key)){section.dispatchEvent(new Event('workspace-tab-shown'));return}
  loaded.add(key);
  Promise.resolve(renderers[key](section)).catch(()=>{
   loaded.delete(key);
   section.replaceChildren(node('p',{class:'banner err',role:'alert',text:'Could not load this section.'}),
    btn('Retry',()=>{section.replaceChildren();selectSection(key)},true));
  });
 }
 state.clientSetTab=selectSection;
 content.openView(state.clientTab||'customers');
}

// Browser-only AI preview, with optional explicit auto-save to one CRM customer.
// No calls, telecom records, or consent/DND changes in either mode.
function aiTestingPanel(content,tenantId,role){
 const box=div('card ai-testing',title('7-question AI test (no calls)'),
  node('p',{class:'note',text:'Practice with fictional answers. This is not a live phone call. By default results are not saved. A Client Admin may explicitly enable auto-save for one selected CRM customer; nothing changes consent, DND or call records.'}));
 const language=node('select',{class:'field','aria-label':'AI test language'},
  [['hi','हिंदी'],['en','English']].map(([value,label])=>node('option',{value,text:label})));
 const status=node('p',{class:'banner',role:'status',text:'Choose a language and start the test.'});
 const question=node('p',{class:'ai-test-question',text:'No question started.'});
 const answer=input('aiTestAnswer','text','Enter a fictional answer');
 answer.required=false;answer.maxLength=220;answer.disabled=true;
 answer.setAttribute('aria-label','AI test answer');
 const canSave=role==='client_admin';
 const search=input('aiTestCustomerSearch','search','Search customer by name or mobile');
 search.required=false;search.maxLength=80;
 search.setAttribute('aria-label','Search CRM customer');
 const customer=node('select',{class:'field','aria-label':'Select CRM customer'},
  node('option',{value:'',text:'Select a customer to enable auto-save'}));
 const autoSave=node('input',{type:'checkbox'});
 autoSave.checked=false;
 autoSave.setAttribute('aria-label','Auto-save AI test answers to selected customer CRM');
 const customerNote=node('p',{class:'muted',text:'No customer selected. AI test answers stay in preview.'});
 const lookup=btn('Find CRM customer',async()=>{
  lookup.disabled=true;
  try{
   const args=new URLSearchParams({tenantId,q:search.value.trim(),limit:'50'});
   const data=await api('/v1/human/leads?'+args);
   customer.replaceChildren(node('option',{value:'',text:'Select a customer to enable auto-save'}),
    ...data.leads.map(lead=>node('option',{value:lead.id,
     text:lead.name+' · mobile ending '+String(lead.mobile||'').slice(-4)})));
   autoSave.checked=false;
   customerNote.textContent=data.leads.length+' matching customers shown. Choose one, then explicitly enable auto-save.';
  }catch(err){asError(err)}finally{lookup.disabled=false}
 },true);
 if(canSave){
  customer.addEventListener('change',()=>{autoSave.checked=false;
   customerNote.textContent=customer.value?'Enable auto-save only if these fictional answers should update this customer.':'No customer selected. AI test answers stay in preview.'});
  box.append(div('stack',
   title('Optional CRM auto-save','h3'),
   node('p',{class:'muted',text:'Only the selected customer will be updated after the final answer. Existing notes are retained. No visit is booked; no calls are placed.'}),
   div('formrow',lab('Search customer',search),lookup),
   lab('Customer for this test',customer),
   lab('Automatically save completed test answers to this CRM customer',autoSave),
   customerNote));
 }else box.append(node('p',{class:'note',text:'Viewer access: practice only. CRM auto-save requires a Client Admin account.'}));
 let linked=false,secureContext=null,secureProof=null,selectedName='';
 const preview=div('stack');preview.hidden=true;
 const start=btn('Start AI test',async()=>{
  start.disabled=true;
  try{
   const wantSave=canSave&&autoSave.checked;
   if(wantSave&&!customer.value)throw Error('Select a CRM customer before enabling auto-save');
   const result=wantSave?
    await api('/v1/human/ai-test-crm','POST',{
     action:'start',tenantId,leadId:customer.value,language:language.value
    }):
    await api('/v1/human/voice-preview','POST',{action:'start',language:language.value});
   linked=wantSave;secureContext=result.context||null;secureProof=result.proof||null;
   selectedName=wantSave?result.selectedCustomer:'';
   render(result);
  }catch(err){asError(err)}finally{start.disabled=false}
 });
 const next=btn('Submit test answer',async()=>{
  if(!session||session.status!=='active')return;
  next.disabled=true;
  try{
   const payload={action:'turn',state:session,transcript:answer.value,confidence:1};
   if(linked){payload.context=secureContext;payload.proof=secureProof}
   const result=await api(linked?'/v1/human/ai-test-crm':'/v1/human/voice-preview','POST',payload);
   if(linked){secureContext=result.context||secureContext;secureProof=result.proof||null}
   render(result);
  }catch(err){asError(err)}
  finally{next.disabled=!session||session.status!=='active'}
 });
 next.disabled=true;
 const speak=btn('Speak current question',()=>{
  if(!session||session.status!=='active')return;
  if(!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window))
    return notice('Question audio is unavailable in this browser.',true);
  window.speechSynthesis.cancel();
  const msg=new SpeechSynthesisUtterance(promptText);
  msg.lang=session.language==='hi'?'hi-IN':'en-IN';
  window.speechSynthesis.speak(msg);
 },true);
 speak.disabled=true;
 let session=null,promptText='';
 function render(result){
  session=result.state;promptText=result.prompt||'';
  const active=session.status==='active';
  answer.disabled=!active;next.disabled=!active;speak.disabled=!active;
  language.disabled=active;
  if(canSave){search.disabled=active;customer.disabled=active;autoSave.disabled=active;lookup.disabled=active}
  if(active){
   question.textContent='Question '+(session.index+1)+' of 7 — '+promptText;
   status.textContent=result.action==='repeat'?
    'Please clarify: '+(result.warning||'Answer not recognized'):
    'Demo only · Question '+(session.index+1)+' of 7';
   if(result.action!=='repeat')answer.value='';
   if(result.action!=='repeat')answer.focus();
   preview.hidden=true;
   return;
  }
  question.textContent=session.status==='completed'?'AI test completed — review the recognized answers below.':
   session.status==='opted_out'?'Stop-calling request detected. In a real CRM, staff must verify and record the opt-out.':
    'Response unclear after three attempts. Human review required.';
  status.textContent=session.status==='completed'?
    (result.savedToCrm?
     'Auto-saved to '+selectedName+' in this company CRM. No calls, consent or site visits changed.':
     'Completed: preview only. No CRM saves, calls or site visits.'):
    'Stopped safely: no CRM record, opt-out or consent was modified.';
  if(session.status==='completed'){
   const a=session.answers;
   preview.replaceChildren(title('Test result','h3'),
     table(['Question','Interpreted answer'],[
      ['Property type',a.propertyType],['Location',a.location],['Area',a.area],
      ['Size',a.size],['Budget (INR)',a.budgetInr??'—'],
      ['Interest',a.interest],['Visit date',a.visitDate||'Not requested']
     ]),node('p',{class:'muted',text:result.savedToCrm?
       'Auto-save completed for '+selectedName+'. This is simulated qualification, not a verified customer phone call or a confirmed visit.':
       'Preview only. To save these answers, use a new test with explicit CRM auto-save or open Customers / Excel → Details → 7 Fixed Questions.'}));
   preview.hidden=false;
  }else preview.hidden=true;
 }
 answer.addEventListener('keydown',event=>{
  if(event.key==='Enter'&&!next.disabled){event.preventDefault();next.click()}
 });
 box.append(div('formrow',lab('Question language',language),start),
  status,question,lab('Test answer',answer),div('formrow',next,speak),preview);
 content.append(box);
}

function manualCustomerPanel(tenantId,content){
 const details=node('details',{class:'card'},node('summary',{text:'Add one customer manually'}));
 const name=input('customerName','text','Full name'),mobile=input('customerMobile','tel','Indian mobile number');
 const submit=node('button',{class:'btn',type:'submit',text:'Add customer'});
 const form=node('form',{class:'formrow'},[lab('Name',name),lab('Mobile',mobile),submit]);
 form.addEventListener('submit',async e=>{
  e.preventDefault();submit.disabled=true;
  try{
   await api('/v1/human/leads','POST',{tenantId,name:name.value,mobile:mobile.value});
   notice('Customer added. Calling clearance still requires review.');await renderClient(tenantId,content);
  }catch(e){asError(e)}finally{submit.disabled=false}
 });
 details.append(form);return details;
}

// Read-only operational reporting for the selected company only.
// Counts exclude customer PII and cannot trigger any provider/CRM mutation.
// Read-only in-app follow-up/reminder preview; no external message or phone call.
function nextActionsPanel(tenantId,content){
 const card=div('card',title('Next Actions · Follow-ups & Visits','h3'),
  node('p',{class:'muted',text:'Your upcoming follow-ups and site visits in one place. No call or WhatsApp message is sent automatically.'}));
 card.id='client-next-actions';
 const days=node('select',{class:'field','aria-label':'Next actions time window'},[
  ['1','Next 24 hours'],['7','Next 7 days'],['14','Next 14 days'],['30','Next 30 days']
 ].map(([value,text])=>node('option',{value,text})));
 days.value='7';
 const area=div('stack'),reminderDraft=div('stack');
 const reminderChannel=node('select',{class:'field','aria-label':'Reminder channel'},
   [['whatsapp','WhatsApp draft'],['sms','SMS draft']].map(([value,text])=>
    node('option',{value,text})));
 const reminderLanguage=node('select',{class:'field','aria-label':'Reminder language'},
   [['hi','Hindi'],['en','English']].map(([value,text])=>node('option',{value,text})));
 const previewReminder=visit=>btn('Prepare reminder',async()=>{
  try{
   const query=new URLSearchParams({
    tenantId,visitId:visit.visitId,channel:reminderChannel.value,language:reminderLanguage.value
   });
   const d=await api('/v1/human/visit-reminder-preview?'+query);
   if(!card.isConnected)return;
   reminderDraft.replaceChildren(
    node('p',{class:'note',text:'Draft only — not sent. Check customer permission and approved template before using.'}),
    node('pre',{class:'note',text:d.message}),
    btn('Copy draft',async()=>{
     try{await navigator.clipboard.writeText(d.message);notice('Reminder text copied. Nothing was sent.')}
     catch{notice('Select and copy the text above manually.',true)}
    },true)
   );
  }catch(err){
   reminderDraft.replaceChildren(node('p',{class:'banner err',
    text:'Reminder cannot be prepared. Check visit status and Do Not Call.'}));
   asError(err);
  }
 },true);
 const refresh=btn('Refresh next actions',()=>load().catch(asError),true);
 card.append(div('formrow',lab('Show tasks',days),refresh),
  div('formrow',lab('Reminder language',reminderLanguage),lab('Channel',reminderChannel)),
  area,reminderDraft);
 content.append(card);
 let inflight=false;
 async function load(){
  if(inflight||!card.isConnected)return;
  inflight=true;refresh.disabled=true;
  try{
   const query=new URLSearchParams({tenantId,days:days.value});
   const result=await api('/v1/human/next-actions?'+query);
   if(!card.isConnected)return;
   const next=(date)=>new Date(date).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'});
   const followups=result.followups.map(f=>[f.customer,next(f.dueAt),
     f.status==='do_not_call'?'Do Not Call':'Staff follow-up',f.interestStatus]);
   const visits=result.visits.map(v=>[v.customer,next(v.scheduledAt),
    v.status==='confirmed'?'Confirmed':'Needs confirmation',
    v.status==='confirmed'?previewReminder(v):'Confirm visit first']);
   area.replaceChildren(
    div('row between',title('Follow-ups · '+String(followups.length),'h3'),
     node('span',{class:'muted',text:result.hasMoreFollowups?'First 20 shown':'All due within window'})),
    followups.length?table(['Customer','Due','Action','Interest'],followups):
     node('p',{class:'muted',text:'No follow-ups due in this window.'}),
    div('row between',title('Site visits · '+String(visits.length),'h3'),
     node('span',{class:'muted',text:result.hasMoreVisits?'First 20 shown':'Upcoming visits'})),
    visits.length?table(['Customer','Visit time','Status','Reminder'],visits):
     node('p',{class:'muted',text:'No site visits in this window.'}),
    node('p',{class:'note',text:'Review contact permission before calling or messaging. Automatic callbacks and external reminders are not active.'})
   );
  }catch(err){
   if(card.isConnected)area.replaceChildren(node('p',{class:'banner err',role:'alert',
    text:'Next actions unavailable. No messages or calls were sent.'}));
   throw err;
  }finally{inflight=false;refresh.disabled=false}
 }
 days.addEventListener('change',()=>load().catch(asError));
 content.addEventListener('workspace-tab-shown',()=>load().catch(asError));
 if(!content.hidden)load().catch(asError);
}

function operationsReportPanel(tenantId,content){
 const card=div('card',title('Operations & Security Report'),
  node('p',{class:'muted',text:'Read-only company summary. Failed and unknown calls must be reviewed manually; this page cannot retry a call.'}));
 const view=div('stack'),refresh=btn('Refresh operations report',()=>load().catch(asError),true);
 card.append(refresh,view);
 content.append(card);
 async function load(){
  refresh.disabled=true;
  try{
   const data=await api('/v1/human/operations/report?tenantId='+encodeURIComponent(tenantId));
   if(!card.isConnected)return;
   const jobs=data.jobs;
   const lines=[
    ['CRM customers',data.customers.total],
    ['Interested customers',data.leadPipeline.interested],
    ['Follow-up leads',data.leadPipeline.followup],
    ['Follow-ups already due',data.leadPipeline.dueFollowups],
    ['Not interested',data.leadPipeline.not_interested],
    ['Blocked / denied customers',data.customers.blockedOrDenied],
    ['Campaigns running',data.campaigns.running],
    ['Queued call jobs',jobs.queued],
    ['Provider in-flight jobs',jobs.reserved+jobs.submitted],
    ['Unknown provider outcomes',jobs.unknown],
    ['Failed jobs',jobs.failed],
    ['Completed jobs',jobs.completed],
    ['Visit requests',data.visits.requested],
    ['CRM audit events · last 7 days',data.recentActivity.auditEvents],
    ['AI test auto-saves · last 7 days',data.recentActivity.simulatedCrmAutoSaves]
   ];
   view.replaceChildren(
    node('p',{class:'muted',text:'Updated '+new Date(data.asOf).toLocaleString()+
      ' · last 7 days for activity counts · not billable provider usage'}),
    table(['Measure','Count'],lines.map(([name,count])=>[name,String(count)])),
    node('p',{class:data.providerReview.needsManualReconciliation?'banner err':'note',
     role:'status',text:data.providerReview.notice}),
    node('p',{class:'muted',text:'No automatic redial, consent changes or billing actions. Any uncertain provider response stays locked until manually reconciled.'})
   );
  }catch(error){
   if(card.isConnected)view.replaceChildren(node('p',{class:'banner err',role:'alert',
    text:'Operational report unavailable. No calling or CRM action was performed.'}));
   throw error;
  }finally{refresh.disabled=false}
 }
 load().catch(asError);
 content.addEventListener('workspace-tab-shown',()=>{
  if(!card.isConnected)return;
  load().catch(asError);
 });
}

function campaignResultsPanel(tenantId,content,role){
 const card=div('card',title('Campaign results & customer answers')),output=div('stack');
 const answer=div('answer-sheet');answer.hidden=true;
 const chargeInfo=div('');
 card.id='client-reports';
 content.append(card);
 const campaign=node('select',{class:'field','aria-label':'Filter results by campaign'});
 let offset=0,fetching=false,loaded=false;
 const back=btn('Previous results',()=>{offset=Math.max(0,offset-50);refresh().catch(asError)},true);
 const next=btn('Next results',()=>{offset+=50;refresh().catch(asError)},true);
 const refreshBtn=btn('Refresh customer answers',()=>refresh().catch(asError),true);
 back.disabled=true;next.disabled=true;
 function answerBudget(amount){return amount==null?'—':new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(amount)}
 const outcomes={completed:'Answers saved',declined:'Declined or opted out',ended:'Ended before completion',needs_review:'Review needed',rejected:'Provider rejected',operator_reviewed:'Reviewed by admin',
  queued:'Queued / awaiting clearance',reserved:'Preparing call',submitted:'Call sent',failed:'Call unsuccessful',unknown:'Awaiting verification',blocked:'Blocked'};
 async function refresh(){
  if(fetching)return;
  fetching=true;refreshBtn.disabled=true;campaign.disabled=true;back.disabled=true;next.disabled=true;
  try{
   if(!loaded){
    const {campaigns}=await api('/v1/human/campaigns?tenantId='+encodeURIComponent(tenantId));
    campaign.replaceChildren(node('option',{value:'',text:'All campaigns'}),...campaigns.map(c=>node('option',{value:c.id,text:c.name})));
    loaded=true;
   }
   const query=new URLSearchParams({tenantId,offset:String(offset)});
   if(campaign.value)query.set('campaignId',campaign.value);
   const {results,total}=await api('/v1/human/calling/results?'+query);
   answer.hidden=true;
   output.replaceChildren(
    node('p',{class:'muted',text:total?(offset+1)+'–'+(offset+results.length)+' of '+total+' customers':'Campaign call attempts will appear here.'}),
    table(['Customer','Campaign','Outcome','CRM','Answers','Plivo charge'],results.map(r=>[
     r.name,r.campaign,outcomes[r.outcome]||outcomes[r.state]||r.state,
     r.answers?(r.partial?'Partial · review needed':r.savedToLead?'Saved to lead':'Lead needs review'):'—',
     r.answers?btn(r.partial?'View partial answers':'View answers',()=>showAnswers(r),true):'—',
     role==='client_admin'&&['completed','failed'].includes(r.state)?
      btn('Check charge',()=>checkCharge(r),true):'—'
    ]))
   );
   back.disabled=offset===0;next.disabled=offset+results.length>=total;
  }finally{fetching=false;refreshBtn.disabled=false;campaign.disabled=false}
 }
 async function checkCharge(result){
  try{
   const query=new URLSearchParams({tenantId,jobId:result.id});
   const bill=await api('/v1/human/plivo-cdr?'+query);
   const nodeText='Plivo reports '+bill.providerReportedAmount+
    ' (currency not verified), billed '+bill.billedSeconds+
    ' seconds. No planned credits deducted.';
   chargeInfo.replaceChildren(node('p',{class:'note',text:nodeText}));
  }catch(err){chargeInfo.replaceChildren(node('p',{class:'note',
   text:'This call has no verified provider bill yet. No credits were deducted.'}));asError(err)}
 }
 function showAnswers(result){
  const trigger=document.activeElement,q=result.answers;
  const fields=[
   ['Property type',q.propertyType],['City or location',q.location],['Area',q.area],['Property size',q.size],
   ['Budget',answerBudget(q.budgetInr)],['Interest',({interested:'Interested',later:'Follow up later',not_interested:'Not interested'})[q.interest]],
   ['Preferred visit date',q.visitDate]
  ];
  answer.replaceChildren(div('row between',title(result.name+(result.partial?' — partial call answers':' — call answers'),'h3'),
   btn('Close answers',()=>{answer.hidden=true;trigger?.focus()},true)),
   ...(result.partial?[node('p',{class:'note',text:'Incomplete conversation. Only accepted answers are shown; the main customer profile was not changed. Review before following up.'})]:[]),
   node('dl',{class:'answer-fields'},
   fields.map(([label,value])=>div('',node('dt',{text:label}),node('dd',{text:value||'—'})))));
  answer.hidden=false;
  answer.tabIndex=-1;
  answer.focus();
 }
 campaign.addEventListener('change',()=>{offset=0;refresh().catch(asError)});
 card.append(div('formrow',lab('Campaign',campaign),refreshBtn),chargeInfo,answer,output,div('formrow',back,next));
 content.addEventListener('workspace-tab-shown',()=>refresh().catch(asError));
 if(!content.hidden)refresh().catch(asError);
}

async function customerCallingPanel(tenantId,content,role,openView){
 const card=div('card',title('Campaign controls'));
 const pick=node('select',{class:'field','aria-label':'Calling campaign'});
 const status=node('p',{class:'note',role:'status',text:'Loading calling status…'});
 const summary=div('campaign-info');
 let snapshot=null,busy=false;
 const start=btn('Start calling',()=>changeRun('start'));
 const pause=btn('Pause campaign',()=>changeRun('pause'),true);
 const refreshBtn=btn('Refresh status',()=>refresh().catch(asError),true);
 const options=div('formrow',lab('Campaign',pick),refreshBtn);
 const actions=div('formrow',btn('Import customers',()=>openView('customers',{resetScroll:true}),true),
  btn('View customer answers',()=>openView('results',{resetScroll:true}),true));
 if(role==='client_admin')actions.prepend(start,pause);
 card.append(status,options,summary,actions);content.append(card);
 async function changeRun(action){
  if(busy||!pick.value)return;
  if(action==='start'&&!confirm('Call the approved customers in this campaign? This uses calling credits.'))return;
  const campaignId=pick.value;
  busy=true;render();
  try{
   const res=await api('/v1/human/calling/runs','POST',{tenantId,campaignId,action});
   notice(action==='pause'?'Campaign paused. A call already with Plivo may finish.':'Campaign '+res.state+'.');
   await refresh();
  }catch(e){asError(e)}finally{busy=false;render()}
 }
 function render(){
  const campaign=snapshot?.campaigns.find(c=>c.id===pick.value);
  const run=snapshot?.data.runs.find(r=>r.campaignId===campaign?.id);
  const policy=snapshot?.data.policy;
  const policyReady=policy?.enabled&&Date.parse(policy.expiresAt)>Date.now();
  const ready=snapshot?.data.configuration.ready&&policyReady;
  const languageOK=campaign&&['hi','en'].includes(campaign.languageMode);
  pick.disabled=busy||!snapshot?.campaigns.length;
  refreshBtn.disabled=busy;
  start.disabled=busy||!ready||!languageOK||['running','completed'].includes(run?.state);
  pause.disabled=busy||run?.state!=='running';
  start.querySelector('span').textContent=run?.state==='paused'?'Resume calling':'Start calling';
  if(!snapshot)return;
  // Keep provider onboarding and consent paperwork in the AR3D operator view.
  // Ordinary clients only need to prepare a list, start when enabled and see results.
  status.textContent=!snapshot.data.configuration.ready?
   'AI calling is being prepared by AR3D. You can import your customer list now.':
   !policyReady?'AI calling for this company is waiting for AR3D activation.':
   'Call your approved customers · up to '+policy.dailyLimit+' calls per day · 09:00–20:00 India time';
  status.className='note '+(ready?'ready-note':'');
  summary.replaceChildren(campaign?div('between row',
   node('strong',{text:campaign.name}),
   node('span',{class:'badge '+(run?.state==='completed'||run?.state==='running'?'positive':'pending'),text:run?.state||'draft'}),
   node('span',{class:'muted',text:languageOK?(campaign.languageMode==='hi'?'Hindi':'English'):'Use a Hindi or English campaign for the phone flow.'})
  ):node('p',{class:'muted',text:'Import a customer file to prepare your first campaign.'}));
 }
 async function refresh(){
  refreshBtn.disabled=true;
  try{
   const [data,list]=await Promise.all([api('/v1/human/calling/state?tenantId='+tenantId),api('/v1/human/campaigns?tenantId='+tenantId)]);
   const prior=pick.value||(state.importCampaign?.tenantId===tenantId?state.importCampaign.id:'');
   snapshot={data,campaigns:list.campaigns};
   pick.replaceChildren(...snapshot.campaigns.map(c=>node('option',{value:c.id,text:c.name})));
   if(prior&&snapshot.campaigns.some(c=>c.id===prior))pick.value=prior;
  }finally{render()}
 }
 pick.addEventListener('change',render);
 content.addEventListener('workspace-tab-shown',()=>refresh().catch(asError));
 render();await refresh();
}

// Go-live truth is separate from the successful deployment of a CRM/phone
// prototype. This view never sends credentials and cannot activate calling.
function launchReadinessPanel(main){
 const card=div('card',title('Plivo Go-Live Readiness')),
  status=node('p',{class:'note',role:'status',
   text:'Checking the Plivo setup and independent production requirements…'}),
  details=div('stack'),refreshButton=btn('Refresh go-live checks',()=>refresh().catch(asError),true);
 card.append(node('p',{class:'muted',text:'Read-only. Does not contact Plivo, place any call, authorize customers or change configuration.'}),
  status,refreshButton,details);
 main.append(card);
 async function refresh(){
  refreshButton.disabled=true;
  try{
   const data=await api('/v1/human/launch-readiness');
   if(!card.isConnected)return;
   status.textContent=data.canClaimProductionReady?
    'Production go-live verified.':'Not yet production-ready. Plivo KYC alone is not the remaining step.';
   const engineering=table(['Required engineering / privacy gate','Readiness'],
    data.engineering.filter(x=>x.id!=='open_conversation').map(x=>
     [x.label,x.ready?'Verified':'Not implemented / signed off']));
   const packs=Array.isArray(data.audioPacks)?data.audioPacks:[];
   const audio=table(['Private R2 internal test voice pack','Object metadata check'],
    packs.map(p=>[
     (p.language==='hi'?'Hindi':'English')+' — internal pilot',
     String(p.requiredReady)+'/'+String(p.requiredTotal)+' required MP3 ready; repeat.mp3: '+
      String(p.optionalRepeat)+'; '+(p.ready?'All required objects ready':'Incomplete or unverified')+
      (p.missing?.length?'; missing: '+p.missing.join(', '):'')+
      (p.invalid?.length?'; invalid size: '+p.invalid.join(', '):'')+
      (p.unavailable?.length?'; metadata unavailable: '+p.unavailable.join(', '):'')
    ]));
   const external=table(['Provider / operator gate','Verification'],data.external.map(x=>[x.label,x.verified?'Verified':'Independent verification required']));
   const setup=table(['Plivo and Worker configuration','Configuration only'],data.environment.map(x=>[x.label,x.configured?'Present':'Missing / disabled']));
   const steps=Array.isArray(data.setupActions)?data.setupActions:[];
   const nextSteps=table(['Who','One-time Production setup','Status'],
    steps.map(x=>[
     x.owner,x.label+' — '+x.note,
     x.ready?'Configured / verify independently':(x.owner==='Plivo/provider'||x.owner==='Provider/operator'?'Provider confirmation needed':'Manual step pending')
    ]));
   details.replaceChildren(
    title('Next steps before the first authorized Production call','h3'),nextSteps,
    node('p',{class:'muted',text:'Agreed v1: fixed-question Smart Voice Q&A, not an open-ended streaming AI. Live two-way interruption is optional later. No API key or R2 file proves Plivo KYC or a permitted call route.'}),
    title('Internal pilot audio (R2, read-only)','h3'),audio,
    node('p',{class:'muted',text:'Checks private R2 object presence and size, not pronunciation, sound quality or phone readiness. Customer campaign voice packs use separate tenant folders.'}),
    title('Engineering and operator sign-off still required','h3'),engineering,
    node('details',{class:'card'},[
     node('summary',{text:'Provider approvals and internal pilot'}),
     external,
     node('p',{class:'muted',text:'Only the provider/operator can verify Indian KYC, traffic category, consent, caller ID and completed pilot.'})
    ]),
    node('details',{class:'card'},[
     node('summary',{text:'Configured environment (names only, no credential values)'}),
     setup
    ])
   );
  }catch(error){
   if(card.isConnected)status.textContent='Readiness unavailable. No calling action occurred. A current MFA Super Admin session is required.';
   throw error;
  }finally{refreshButton.disabled=false}
 }
 refresh().catch(()=>{});
}

async function callingAdminPanel(main){
 const diagnostics=node('details',{class:'card'},node('summary',{text:'Advanced diagnostics · Plivo go-live readiness'}));
 const details=div('stack');diagnostics.append(details);main.append(diagnostics);
 diagnostics.addEventListener('toggle',()=>{if(diagnostics.open&&!diagnostics.dataset.loaded){diagnostics.dataset.loaded='true';launchReadinessPanel(details)}});
 const card=div('card calling-settings',title('Client calling approval')),area=div('approval-grid');card.id='calling-setup';main.append(card);
 const company=node('select',{class:'field','aria-label':'Calling setup company'});
 const companySearch=input('callingSetupCompanySearch','search','Search company name or email');
 companySearch.maxLength=80;
 async function findCompany(){
  const prev=company.value;
  const query=new URLSearchParams({limit:'100',q:companySearch.value.trim()});
  const d=await api('/v1/human/tenants?'+query);
  company.replaceChildren(...d.tenants.map(t=>node('option',{value:t.id,text:t.display_name+' — '+t.status})));
  if(d.tenants.some(t=>t.id===prev))company.value=prev;
 }
 try{await findCompany()}catch(e){asError(e);return}
 const approval=input('approval','text','Approved phone provider and calling purpose reference');
 const days=input('days','number');days.value='7';days.min='1';days.max='30';
 const limit=input('dailyLimit','number');limit.value='10';limit.min='1';limit.max='100';
 const seconds=input('maxSeconds','number');seconds.value='180';seconds.min='180';seconds.max='300';
 const enabled=node('input',{type:'checkbox','aria-label':'Enable company calling'});
 const policyForm=node('form',{class:'stack'},[title('Company approval','h3'),lab('Provider approval reference',approval),div('formrow',lab('Approval days (1–30)',days),lab('Daily calls (1–100)',limit),lab('Maximum call seconds (180–300)',seconds)),lab('Enable company calling',enabled),node('button',{class:'btn',type:'submit',text:'Save company calling approval'})]);
 const consent=input('consent','text','Purpose-specific opt-in evidence reference'),dnd=input('dnd','text','Provider DND check reference');
 const choices=div('stack approval-list');
 const draft=node('select',{class:'field','aria-label':'Uploaded campaign'});
 let clearanceOffset=0,requestGeneration=0;
 const older=btn('Next customers',()=>{clearanceOffset+=200;refresh().catch(asError)},true);
 const newer=btn('Previous customers',()=>{clearanceOffset=Math.max(0,clearanceOffset-200);refresh().catch(asError)},true);
 older.disabled=true;newer.disabled=true;
 const purpose=node('select',{class:'field'},['property_information','site_visit'].map(x=>node('option',{value:x,text:x})));
 const clearanceForm=node('form',{class:'stack'},[title('Customer clearance','h3'),node('p',{class:'note',text:'Select only customers covered by the consent evidence and current provider DND check. Excel upload alone does not supply these checks. Opted-out customers cannot be approved.'}),lab('Uploaded campaign',draft),lab('Purpose',purpose),lab('Consent evidence reference',consent),lab('DND verification reference',dnd),choices,div('formrow',newer,older),node('button',{class:'btn',type:'submit',text:'Approve selected customers'})]);
 const status=div(''),recovery=div('stack');
 const expires=()=>{const n=Number(days.value);if(!Number.isInteger(n)||n<1||n>30)throw Error('Approval days must be 1–30');return new Date(Date.now()+n*86400000).toISOString()};
 policyForm.addEventListener('submit',async e=>{e.preventDefault();try{await api('/v1/human/calling/policy','POST',{tenantId:company.value,enabled:enabled.checked,approvalReference:approval.value,expiresAt:expires(),dailyLimit:Number(limit.value),maxSeconds:Number(seconds.value)});notice('Company approval saved.');await refresh()}catch(e){asError(e)}});
 clearanceForm.addEventListener('submit',async e=>{e.preventDefault();try{const leadIds=[...choices.querySelectorAll('input:checked')].map(x=>x.value);const r=await api('/v1/human/calling/clearances','POST',{tenantId:company.value,leadIds,purpose:purpose.value,consentReference:consent.value,dndReference:dnd.value,expiresAt:expires()});notice(r.reviewed+' customer approvals saved.');await refresh()}catch(e){asError(e)}});
 async function refresh(){
  const generation=++requestGeneration,tenantId=company.value;
  choices.replaceChildren();status.replaceChildren();recovery.replaceChildren();
  if(!tenantId)return;
  try{
   const selected=draft.value;
   const query=new URLSearchParams({tenantId,offset:String(clearanceOffset)});
   if(selected)query.set('campaignId',selected);
   const [p,c,{locked}]=await Promise.all([api('/v1/human/calling/policy?tenantId='+tenantId),api('/v1/human/calling/clearances?'+query),api('/v1/human/calling/reconcile?tenantId='+tenantId)]);
   if(generation!==requestGeneration)return;
   draft.replaceChildren(node('option',{value:'',text:'All customers'}),...c.campaigns.map(x=>node('option',{value:x.id,text:x.name})));
   draft.value=selected;newer.disabled=clearanceOffset===0;older.disabled=!c.hasMore;
   approval.value=p.policy?.approvalReference||'';enabled.checked=!!p.policy?.enabled;
   limit.value=String(p.policy?.dailyLimit||10);seconds.value=String(p.policy?.maxSeconds||180);
   status.append(node('p',{class:'note',text:p.configuration.ready?'Fixed-question customer calling configured.':p.configuration.missing.join(', ')}));
   for(const l of c.leads){const checkbox=node('input',{type:'checkbox',value:l.id});if(l.consentStatus==='denied'||l.dndStatus==='blocked')checkbox.disabled=true;choices.append(lab(l.name+' — '+l.id.slice(0,8),checkbox))}
   status.append(table(['Customer','Purpose','Approval expires'],c.clearances.map(x=>[x.name,x.purpose,x.expiresAt])));
   if(locked){
    const evidence=input('carrierEvidence','text','Carrier verification reference');
    evidence.maxLength=160;
    const close=btn('Close verified attempt',async()=>{
     if(!window.confirm('Confirm that Plivo shows this attempt has ended. Closing will not dial this customer again.'))return;
     close.disabled=true;
     try{
      await api('/v1/human/calling/reconcile','POST',{tenantId,jobId:locked.id,evidenceReference:evidence.value});
      notice('Reviewed attempt closed. The client can resume the paused campaign.');
      await refresh();
     }catch(e){asError(e);close.disabled=false}
    },true);
    close.disabled=locked.runState!=='paused'||!locked.canClose;
    recovery.append(title('Attempt awaiting carrier verification','h3'),
      node('p',{class:'note',text:locked.customer+' | '+locked.campaign+' | '+locked.reservedAt+
       '. Pause the campaign and verify the final status in Plivo. Review can close the attempt after 30 minutes.'}),
      lab('Carrier verification reference',evidence),close);
   }
  }catch(e){if(generation===requestGeneration)status.append(node('p',{class:'err',text:e.message+' — use a current Super Admin MFA login.'}))}
 }
 // Optional central-operator evidence queue. It is collapsed and never
 // shown in the client's one-click campaign workflow. This view cannot approve
 // evidence, clear DND or start calls.
 const queuePanel=node('details',{class:'card'},
  node('summary',{text:'Pending customer consent references (operator only)'}));
 const queueContent=div('stack',
  node('p',{class:'muted',text:'For AR3D review only. These references are not verified permissions; customer calling remains blocked until external approvals.'}));
 const queueData=div('stack'),queueControls=div('formrow');
 let queueOffset=0,queueRequest=0;
 const prevQueue=btn('Previous',()=>{queueOffset=Math.max(0,queueOffset-25);loadQueue().catch(asError)},true);
 const nextQueue=btn('Next',()=>{queueOffset+=25;loadQueue().catch(asError)},true);
 const refreshQueue=btn('Refresh pending references',()=>loadQueue().catch(asError),true);
 prevQueue.disabled=true;nextQueue.disabled=true;
 queueControls.append(prevQueue,nextQueue);
 queueContent.append(refreshQueue,queueData,queueControls);
 queuePanel.append(queueContent);main.append(queuePanel);
 async function loadQueue(){
  if(!queuePanel.open)return;
  const generation=++queueRequest,tenantId=company.value;
  queueData.replaceChildren();
  if(!tenantId)return;
  refreshQueue.disabled=true;
  try{
   const params=new URLSearchParams({tenantId,offset:String(queueOffset),limit:'25'});
   const data=await api('/v1/human/consent-review-queue?'+params);
   if(generation!==queueRequest||tenantId!==company.value)return;
   queueData.append(node('p',{class:'note',
    text:String(data.total)+' reference(s) pending review — 0 approved by this screen.'}));
   if(data.items.length)queueData.append(
    table(['Customer','Purpose','Reference','Captured','Lead status'],
     data.items.map(row=>[row.leadName||row.leadId.slice(0,8),row.purpose,
      row.reference,row.capturedAt,
      row.optedOut?'Do Not Call':row.consentStatus+' / '+row.dndStatus])));
   prevQueue.disabled=queueOffset===0;
   nextQueue.disabled=queueOffset+data.items.length>=data.total;
  }catch(err){
   if(generation===queueRequest)queueData.append(node('p',{class:'err',
    text:'Pending references unavailable. Current Super Admin MFA is required.'}));
   throw err;
  }finally{if(generation===queueRequest)refreshQueue.disabled=false}
 }
 queuePanel.addEventListener('toggle',()=>{if(queuePanel.open)loadQueue().catch(asError)});
 company.addEventListener('change',()=>{
  queueOffset=0;
  if(queuePanel.open)loadQueue().catch(asError);
  draft.value='';clearanceOffset=0;approval.value='';enabled.checked=false;consent.value='';dnd.value='';refresh().catch(asError);
 });
 draft.addEventListener('change',()=>{clearanceOffset=0;refresh().catch(asError)});
 const find=btn('Find company',async()=>{try{await findCompany();await refresh()}catch(e){asError(e)}},true);
 companySearch.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();findCompany().then(refresh).catch(asError)}
 });
 card.append(div('formrow',lab('Search all clients',companySearch),find),
  lab('Client company',company),btn('Load calling setup',()=>refresh().catch(asError),true),area);
 area.append(policyForm,clearanceForm,recovery,status);await refresh();
}

async function companyAdminPanel(main){
 const card=div('card',title('Company profile'));
 const company=node('select',{class:'field','aria-label':'Company profile'});
 const search=input('profileCompanySearch','search','Find any company by name or email');
 search.maxLength=80;
 const area=div('stack');
 async function findCompany(){
  const prev=company.value;
  const result=await api('/v1/human/tenants?'+new URLSearchParams({limit:'100',q:search.value.trim()}));
  company.replaceChildren(...result.tenants.filter(t=>['active','trial'].includes(t.status))
   .map(t=>node('option',{value:t.id,text:t.display_name})));
  if(result.tenants.some(t=>t.id===prev))company.value=prev;
  load();
 }
 const button=btn('Find company',()=>findCompany().catch(asError),true);
 search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();findCompany().catch(asError)}});
 card.append(div('formrow',lab('Search all companies',search),button),
  div('formrow',lab('Choose company',company)),area);main.append(card);
 function load(){
  if(!company.value){area.replaceChildren(node('p',{class:'muted',text:'Create a client before editing a company profile.'}));return}
  const profile=div('stack');
  area.replaceChildren(profile);
  companyProfileEditor(company.value,profile,true,company.selectedOptions[0]?.textContent||'').catch(asError);
 }
 company.addEventListener('change',load);
 await findCompany();
}
async function companyProfileEditor(tenantId,content,admin=false,companyLabel=''){
 const card=div(admin?'stack':'card',title('Company Knowledge','h3'));content.append(card);
 let data;try{data=await api('/v1/human/company-profile?tenantId='+tenantId)}catch(e){card.append(node('p',{class:'err',text:e.message}));return}
 const specs=[['companyName','Company name',1],['website','Website',1],['about','About your company',3],['locations','Cities / locations served',2],['propertyTypes','Property types',2],['projects','Projects and property details',4],['pricing','Approved prices / budget ranges',3],['amenities','Amenities and facilities',2],['officeHours','Office hours',1],['contact','Sales contact / office address',2],['additionalFacts','Other approved information',3]];
 const controls={},form=node('form',{class:'stack'}),summary=node('p',{class:'note',text:'These details appear in the client workspace. Phone calls use the fixed property questionnaire.'});card.append(summary,form);
 let row;
 for(const [key,label,rows] of specs){const field=rows===1?input('company-'+key,'text',label):node('textarea',{class:'field',rows});field.required=key==='companyName';field.value=data.profile[key]||(admin&&key==='companyName'?companyLabel:'');field.disabled=!data.canEdit;controls[key]=field;if(rows===1){if(!row){row=div('formrow');form.append(row)}row.append(lab(label,field))}else{row=null;form.append(lab(label,field))}}
 const status=node('p',{class:'muted',text:data.revision?'Company information v'+data.revision+' saved':'Add your company information to get started'});form.append(status);
 if(data.canEdit)form.append(node('button',{class:'btn',type:'submit',text:'Save company information'}));
 form.addEventListener('submit',async e=>{e.preventDefault();const submit=form.querySelector('button[type=submit]');submit.disabled=true;try{const result=await api('/v1/human/company-profile','POST',{tenantId,baseRevision:data.revision,profile:Object.fromEntries(Object.entries(controls).map(([key,field])=>[key,field.value]))});data.revision=result.revision;status.textContent='Company information v'+data.revision+' saved. The fixed phone questionnaire is managed separately.';document.dispatchEvent(new CustomEvent('company-profile-saved',{detail:tenantId}));notice('Company information saved')}catch(e){asError(e)}finally{submit.disabled=false}});
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
  const card=div('card',title('Export customers','h3'),
    node('p',{class:'note',text:'Download your customer records securely.'}));
  content.append(card);
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
async function crmWorkflow(tenantId,content,role,refreshContent=content){
  const editable=role==='client_admin';
  const workflow=div('card',title('Customer list'));workflow.id='customer-workflow';
  if(editable){
    const upload=div('card import-card',title('Upload customer file'),
      node('p',{class:'muted',text:'CSV or Excel (.xlsx) · up to 100 customers per file · Name and Mobile columns'}));
    content.prepend(upload);
    const template=btn('Download customer Excel template (CSV)',()=>{const href=URL.createObjectURL(new Blob(['Name,Mobile\r\n'],{type:'text/csv;charset=utf-8'}));const a=node('a',{href,download:'ar3d-customer-template.csv'});document.body.append(a);a.click();a.remove();URL.revokeObjectURL(href)},true);upload.append(template);
    const picker=node('input',{class:'field',type:'file',accept:'.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),previewBox=div(''),csvBox=div('formrow',lab('Excel .xlsx or CSV file',picker));
    let importData=null,requestId=null;
    const importName=input('importCampaignName','text','Campaign name');
    importName.maxLength=80;
    const importLanguage=node('select',{class:'field'},[node('option',{value:'hi',text:'Hindi'}),node('option',{value:'en',text:'English'})]);
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
        requestId=crypto.randomUUID();importActions.hidden=false;commitBtn.disabled=false;campaignBtn.disabled=false;
      }catch(e){importData=null;importActions.hidden=true;commitBtn.disabled=true;campaignBtn.disabled=true;previewBox.replaceChildren();asError(e)}
    });
    async function commit(makeCampaign){
      if(importData===null)return;
      const name=importName.value.trim();
      if(makeCampaign&&!name)return notice('Enter a campaign name.',true);
      commitBtn.disabled=true;campaignBtn.disabled=true;previewBtn.disabled=true;picker.disabled=true;
      try{
        const data=makeCampaign?{...importData,campaign:{name,language:importLanguage.value,requestId}}:importData;
        const result=await api('/v1/human/import/commit','POST',data);
        if(result.campaignId){
          state.importCampaign={tenantId,id:result.campaignId};state.clientTab='calling';
          notice('Campaign prepared with '+result.campaignCustomers+' customers from this file. Review calling approvals before Start.');
        }else notice('Import finished: '+result.inserted+' new, '+result.skipped+' duplicates. No calls placed.');
        await renderClient(tenantId,refreshContent);
      }catch(e){asError(e);commitBtn.disabled=false;campaignBtn.disabled=false}
      finally{previewBtn.disabled=false;picker.disabled=false}
    }
    const commitBtn=btn('Import to CRM',()=>commit(false),true);
    const campaignBtn=btn('Import & prepare campaign',()=>commit(true));
    commitBtn.disabled=true;campaignBtn.disabled=true;
    const importActions=div('formrow',lab('Campaign name for this file',importName),lab('Call language',importLanguage),commitBtn,campaignBtn);
    importActions.hidden=true;
    picker.addEventListener('change',()=>{
      importData=null;requestId=null;importActions.hidden=true;commitBtn.disabled=true;campaignBtn.disabled=true;previewBox.replaceChildren();
    });
    csvBox.append(previewBtn);upload.append(csvBox,previewBox,importActions);
    upload.append(node('p',{class:'muted',text:'A prepared campaign needs calling clearance before any customer is dialed.'}));
  }
  content.append(workflow);
  const search=input('search','search','Name, number or location');search.required=false;
  const filter=node('select',{class:'field'},['','new','contacted','interested','followup','not_interested','converted']
    .map(s=>node('option',{value:s,text:s||'All statuses'})));
  const segmentFilter=node('select',{class:'field'},[
    ['','All customer types'],['prior_inquiry','Previous enquiry'],
    ['unknown_contact','Unknown/new contact'],['unclassified','Unclassified']
  ].map(([value,text])=>node('option',{value,text})));
  let offset=0;
  const searchBtn=btn('Search',()=>{offset=0;refresh().catch(asError)},true);
  const hotLeadsBtn=btn('Interested leads',()=>{filter.value='interested';offset=0;refresh().catch(asError)},true);
  const tableArea=div(''),details=div(''),visitArea=div('');
  workflow.append(div('formrow',lab('Search leads',search),lab('Interest status',filter),lab('Customer type',segmentFilter),searchBtn,hotLeadsBtn),tableArea,details);
  const schedule=node('details',{class:'card'},[node('summary',{text:'Site visits'}),visitArea]);
  content.append(schedule);
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
        const newVisitTime=input('newVisitTime','datetime-local');
        function currentVisitTime(){
          const v=pending.find(x=>x.id===selected.value);
          if(!v)return;
          const time=new Date(v.scheduledAt);
          newVisitTime.value=new Date(time.getTime()-time.getTimezoneOffset()*60000).toISOString().slice(0,16);
        }
        selected.addEventListener('change',()=>{statusOptions();currentVisitTime()});statusOptions();currentVisitTime();
        const form=node('form',{class:'formrow'},[lab('Visit',selected),lab('Status update',statusSelect),
          node('button',{class:'btn secondary',type:'submit',text:'Save visit status'})]);
        form.addEventListener('submit',async e=>{e.preventDefault();try{
          await api('/v1/human/visits/'+selected.value,'PATCH',{tenantId,status:statusSelect.value});
          notice('Visit status saved; no notifications were sent.');await visitList();
        }catch(err){asError(err)}});
        const rescheduleForm=node('form',{class:'formrow'},[
          lab('New visit date/time',newVisitTime),
          node('button',{class:'btn secondary',type:'submit',text:'Reschedule visit'})
        ]);
        rescheduleForm.addEventListener('submit',async e=>{
          e.preventDefault();
          try{
            const v=pending.find(x=>x.id===selected.value);
            if(!v||!newVisitTime.value)throw Error('Select a visit and a new date/time');
            await api('/v1/human/visits/'+v.id,'PATCH',{
              tenantId,action:'reschedule',expectedScheduledAt:v.scheduledAt,
              scheduledAt:new Date(newVisitTime.value).toISOString()
            });
            notice('Visit date updated in CRM. Inform the customer separately.');await visitList();
          }catch(err){asError(err)}
        });
        visitArea.append(form,rescheduleForm,
         node('p',{class:'muted',text:'Rescheduling updates CRM only. Automatic SMS/WhatsApp reminders are not connected yet.'}));
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
    if(editable){
      const team=div('card',title('Assign customer to sales staff','h3'),
       node('p',{class:'muted',text:'Assign an interested customer to someone on your team. This only updates the CRM; it does not place a call.'}));
      const assignee=node('select',{class:'field','aria-label':'Assigned sales staff'});
      const status=node('p',{class:'muted',role:'status',text:'Loading company staff…'});
      const saveStaff=btn('Save staff assignment',async()=>{
        saveStaff.disabled=true;
        try{
          const chosen=assignee.value||null;
          const data=await api('/v1/human/lead-staff','POST',{
           tenantId,leadId:lead.id,userId:chosen,expectedUserId:currentAssignee
          });
          currentAssignee=data.assignedUserId;
          status.textContent='Sales staff saved. No calls or messages were sent.';
        }catch(err){asError(err)}finally{saveStaff.disabled=false}
      },true);
      saveStaff.disabled=true;
      let currentAssignee=null;
      team.append(div('formrow',lab('Team member',assignee),saveStaff),status);
      details.append(team);
      api('/v1/human/lead-staff?'+new URLSearchParams({tenantId,leadId:lead.id})).then(data=>{
        if(!team.isConnected)return;
        currentAssignee=data.assignedUserId;
        assignee.replaceChildren(
         node('option',{value:'',text:'Unassigned'}),
         ...data.members.map(m=>node('option',{value:m.id,text:m.email+' · '+m.role}))
        );
        if(currentAssignee&&!data.members.some(m=>m.id===currentAssignee))
         assignee.append(node('option',{value:currentAssignee,text:'Former team member · reassignment needed'}));
        assignee.value=currentAssignee||'';
        saveStaff.disabled=false;
        status.textContent=currentAssignee?'Staff assigned. You can change it here.':'No staff member assigned yet.';
      }).catch(()=>{
       if(team.isConnected)status.textContent='Team list unavailable. No changes were made.';
      });
    }
    if(editable)details.append(fixedSurveyPanel(tenantId,lead,async()=>{
      await refresh();await visitList();
    }));

    const blocked=lead.consentStatus==='denied'||lead.dndStatus==='blocked';
    const callPrefs=div('card',title('Calling Preferences / कॉलिंग अनुमति','h3'),
      node('p',{class:'note',text:blocked?'DO NOT CALL — this lead is blocked. No client-side reactivation is available.':
        'Calling eligibility is reviewed for each campaign. Record any request to stop calls here.'}));
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
    if(!result.leads.length)body.append(node('tr',{},node('td',{class:'empty-state',colspan:'8',text:'No customers match these filters.'})));
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
        node('p',{class:'note',text:'Use fictional answers in this preview. Cloudflare transcribes each short microphone clip. Review the answers before saving them. No phone call is placed.'}));
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
      const localPrompt=node('input',{class:'field',type:'file',accept:'audio/*'});
      const playVoice=btn('Speak current question',()=>{
        if(!demoState||demoState.status!=='active')return notice('Start the preview first',true);
        if(localPrompt.files[0]){
          const url=URL.createObjectURL(localPrompt.files[0]),audio=new Audio(url);
          const release=()=>URL.revokeObjectURL(url);
          audio.addEventListener('ended',release,{once:true});
          audio.addEventListener('error',release,{once:true});
          audio.play().catch(()=>{release();notice('Could not play the selected recording.',true)});
          return;
        }
        if(!('speechSynthesis' in window)||
           !('SpeechSynthesisUtterance' in window))
          return notice('Browser question audio is unavailable',true);
        window.speechSynthesis.cancel();
        const utterance=new SpeechSynthesisUtterance(questionText.textContent);
        utterance.lang=language.value==='en'?'en-IN':'hi-IN';
        window.speechSynthesis.speak(utterance);
      },true);
      let answerRecorder=null;
      const voiceDictate=btn('Record answer for Cloudflare',async()=>{
        if(answerRecorder?.state==='recording'){answerRecorder.stop();return}
        if(!demoState||demoState.status!=='active')return notice('Start the preview first',true);
        if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)
          return notice('Audio recording unavailable. Type the answer.',true);
        const turn=demoState;
        const label=voiceDictate.querySelector('span');
        voiceDictate.disabled=true;
        let stream;
        try{
          stream=await navigator.mediaDevices.getUserMedia({audio:true});
          if(demoState!==turn||!voiceDictate.isConnected){stream.getTracks().forEach(t=>t.stop());return}
          const recorder=new MediaRecorder(stream),chunks=[];
          answerRecorder=recorder;
          recorder.addEventListener('dataavailable',event=>{if(event.data.size)chunks.push(event.data)});
          const limit=setTimeout(()=>{if(recorder.state==='recording')recorder.stop()},12000);
          recorder.addEventListener('stop',async()=>{
            clearTimeout(limit);stream.getTracks().forEach(t=>t.stop());
            answerRecorder=null;
            voiceDictate.disabled=true;label.textContent='Transcribing…';
            try{
              if(demoState!==turn||!voiceDictate.isConnected||!chunks.length)return;
              const type=recorder.mimeType||chunks[0].type;
              const params=new URLSearchParams({tenantId,language:turn.language});
              const response=await fetch('/v1/human/voice-preview/transcribe?'+params,{
                method:'POST',headers:{'Content-Type':type},body:new Blob(chunks,{type}),cache:'no-store'
              });
              const result=await response.json();
              if(!response.ok)throw Error(result.error||'Transcription failed');
              if(demoState!==turn||!voiceDictate.isConnected)return;
              if(result.text)voiceAnswer.value=result.text;
              voiceHint.textContent=result.text?'Review the transcription, then click Next.':'No clear speech detected. Record again or type the answer.';
            }catch(err){asError(err)}
            finally{label.textContent='Record answer for Cloudflare';voiceDictate.disabled=false}
          },{once:true});
          recorder.start();
          label.textContent='Stop recording';voiceDictate.disabled=false;
        }catch{
          stream?.getTracks().forEach(t=>t.stop());answerRecorder=null;
          voiceDictate.disabled=false;notice('Microphone unavailable. Type the answer instead.',true);
        }
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
          localPrompt.value='';voiceAnswer.value='';
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
        div('formrow',voiceStart,lab('Optional recording for this question',localPrompt),playVoice),
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

// Following a second invitation in the same tab can change only the hash.
window.addEventListener('hashchange',event=>{
 if(location.hash.startsWith('#invite=')||new URL(event.oldURL).hash.startsWith('#invite='))load();
});
load();`;
