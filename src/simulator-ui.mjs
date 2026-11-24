// Read-only-by-default, synthetic text conversation simulator UI.
export const simulatorHtml=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1120"><title>AR3D AI Calling | Conversation Simulator</title><link rel="stylesheet" href="/app/assets/style.css"><link rel="stylesheet" href="/app/assets/simulator.css"></head><body><main class="main"><header class="row between"><div><a href="/app">← AR3D AI Calling Dashboard</a><h1>AI Conversation Simulator</h1></div><span class="pill">SIMULATION ONLY</span></header><p class="note">No outgoing calls, audio, recording, appointment booking, or changes to consent/DND status happen here. Test with fictional customer details.</p><section class="card"><h2>Choose your client &amp; AI agent</h2><div class="formrow"><label>Client company<select class="field" id="tenant"></select></label><label>AI Agent<select class="field" id="agent"></select></label><button class="btn" id="start" disabled>Start simulation</button></div><p class="muted" id="note" role="status">Loading your account…</p></section><section class="card"><h2>Conversation</h2><div id="chat" class="sim-chat" role="log" aria-live="polite"></div><form id="reply" class="formrow"><label>Customer response<input class="field" id="utterance" maxlength="500" autocomplete="off" placeholder="Type customer reply here" required></label><button class="btn" type="submit" disabled>Send response</button></form><p class="foot" id="status">No test started.</p></section>
<section class="card"><h2>Hindi / English speech plan (text-only)</h2>
<p class="note">No microphone or audio is generated. These are locale hints for future approved TTS providers.</p>
<button id="preview-speech" class="btn secondary" type="button" disabled>Preview next spoken turn</button>
<div id="speech-plan" class="sim-chat" aria-live="polite"></div></section>
<section class="card"><h2>Optional question playback</h2>
<p class="note">Listen to fictional agent questions and type your answers. For microphone transcription with Sarvam, use the seven-question preview in the client workspace. No outgoing calls or automatic response submission.</p>
<div class="formrow">
<button id="speak-demo" class="btn secondary" type="button" disabled>Speak agent demo text</button>
<button id="stop-demo" class="btn secondary" type="button" disabled>Stop audio</button>
</div><p id="voice-status" class="note" role="status">Speech is disabled until you start a demo and explicitly select an action.</p>
</section></main><script src="/app/assets/simulator.js" defer></script></body></html>`;
export const simulatorCss=`.sim-chat{min-height:180px;max-height:430px;overflow:auto;border:1px solid #26394f;border-radius:10px;padding:18px;background:#0b192a;display:grid;align-content:start;gap:12px}.sim-msg{border:1px solid #31445e;background:#172b44;border-radius:10px;padding:12px;max-width:90%;white-space:pre-wrap;overflow-wrap:anywhere}.sim-msg.customer{background:#15363b;justify-self:end}.sim-msg.agent{justify-self:start}.sim-msg small{display:block;color:#b0c0d6;margin-bottom:6px;font-weight:700}#reply{margin-top:16px}#reply label{flex:1}#reply input{width:100%}`;
export const simulatorJs=String.raw`'use strict';
const by=id=>document.getElementById(id);
const tenant=by('tenant'),agent=by('agent'),start=by('start'),chat=by('chat'),reply=by('reply'),input=by('utterance'),send=reply.querySelector('button'),note=by('note'),status=by('status');
let me=null,session=null;
const previewSpeech=by('preview-speech'),speechPlan=by('speech-plan');
const speakDemo=by('speak-demo'),stopDemo=by('stop-demo'),voiceStatus=by('voice-status');
const synth=window.speechSynthesis||null;
let voiceSerial=0;
function syncVoiceControls(){
  speakDemo.disabled=!session||!synth||!window.SpeechSynthesisUtterance;
  stopDemo.disabled=!synth||(!synth.speaking&&!synth.pending);
}
function stopBrowserVoice(){
  voiceSerial++;
  if(synth)synth.cancel();
  syncVoiceControls();
}
speakDemo.addEventListener('click',async()=>{
  if(!session||!synth||!window.SpeechSynthesisUtterance)return;
  stopBrowserVoice();
  const currentId=session.id,currentRevision=session.revision,serial=++voiceSerial;
  try{
    const plan=await api('/v1/human/simulations/'+currentId+'/voice-preview?tenantId='+encodeURIComponent(tenant.value));
    if(!session||session.id!==currentId||session.revision!==currentRevision||serial!==voiceSerial)return;
    const segments=plan.speech.segments;
    voiceStatus.textContent='Speaking synthetic agent text. No real call is connected.';
    function speakPart(index){
      if(index>=segments.length||serial!==voiceSerial||session?.revision!==currentRevision){
        syncVoiceControls();return;
      }
      const utterance=new SpeechSynthesisUtterance(segments[index].text);
      utterance.lang=segments[index].locale;
      utterance.onend=()=>speakPart(index+1);
      utterance.onerror=()=>{voiceStatus.textContent='Browser speech output could not play.';syncVoiceControls()};
      synth.speak(utterance);syncVoiceControls();
    }
    speakPart(0);
  }catch(e){error(e);syncVoiceControls()}
});
stopDemo.addEventListener('click',()=>{
  stopBrowserVoice();voiceStatus.textContent='Question playback stopped.'
});
window.addEventListener('pagehide',stopBrowserVoice);
async function api(url,method='GET',data){const resp=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined});const j=await resp.json();if(!resp.ok)throw Error(j.error||'Request failed');return j}
function option(value,text){const el=document.createElement('option');el.value=value;el.textContent=text;return el}
function error(e){note.textContent=e instanceof Error?e.message:'Something went wrong'}
function render(){chat.replaceChildren();if(!session)return;for(const item of session.simulation.turns){const div=document.createElement('div');div.className='sim-msg '+item.role;const who=document.createElement('small');who.textContent=item.role==='agent'?'AI Agent':'Demo customer';const content=document.createElement('span');content.textContent=item.text;div.append(who,content);chat.append(div)}chat.scrollTop=chat.scrollHeight;status.textContent='Status: '+session.simulation.status+' · '+session.simulation.answers.length+' answers saved in demo only';send.disabled=session.simulation.status!=='active';input.disabled=send.disabled;previewSpeech.disabled=false;speechPlan.replaceChildren();syncVoiceControls()}
previewSpeech.addEventListener('click',async()=>{if(!session)return;previewSpeech.disabled=true;try{
  const id=session.id,revision=session.revision;
  const result=await api('/v1/human/simulations/'+id+'/voice-preview?tenantId='+encodeURIComponent(tenant.value));
  if(!session||session.id!==id||session.revision!==revision)return;
  speechPlan.replaceChildren();for(const segment of result.speech.segments){
    const item=document.createElement('p');item.textContent=segment.locale+': '+segment.text;speechPlan.append(item)
  }
  note.textContent='Synthetic TTS plan only. No voice audio was synthesized.'
}catch(e){error(e)}finally{previewSpeech.disabled=!session}});
async function loadAgents(){stopBrowserVoice();agent.replaceChildren(option('','Choose an agent'));start.disabled=true;session=null;previewSpeech.disabled=true;speechPlan.replaceChildren();render();if(!tenant.value)return;try{const d=await api('/v1/human/simulations/agents?tenantId='+encodeURIComponent(tenant.value));for(const a of d.agents)agent.append(option(a.id,a.displayName+' ('+a.questionCount+' questions)'));const t=me.tenants.find(x=>x.id===tenant.value);note.textContent=d.agents.length?'Use only fictional test responses.':'No agents yet: create a Draft AI Agent in the Dashboard.';start.disabled=!d.agents.length||t?.role!=='client_admin'}catch(e){error(e)}}
start.addEventListener('click',async()=>{if(!tenant.value||!agent.value)return;start.disabled=true;try{const d=await api('/v1/human/simulations','POST',{tenantId:tenant.value,agentId:agent.value});session=d;render();input.focus();note.textContent='Demo started. No call is placed.'}catch(e){error(e);start.disabled=false}});
reply.addEventListener('submit',async e=>{e.preventDefault();if(!session||session.simulation.status!=='active')return;stopBrowserVoice();send.disabled=true;try{const d=await api('/v1/human/simulations/'+session.id+'/turn','POST',{tenantId:tenant.value,expectedRevision:session.revision,message:input.value});session=d;input.value='';render();input.focus()}catch(e){error(e);send.disabled=false}});
tenant.addEventListener('change',loadAgents);
agent.addEventListener('change',()=>{start.disabled=!agent.value||me.tenants.find(x=>x.id===tenant.value)?.role!=='client_admin'});
async function init(){try{me=await api('/v1/human/me');if(!me.tenants?.length){note.textContent='No client membership. Ask Super Admin to invite you.';return}for(const t of me.tenants)tenant.append(option(t.id,t.name));await loadAgents()}catch{note.textContent='Sign in to AR3D AI Calling first.';const a=document.createElement('a');a.href='/app';a.textContent='Sign in';note.append(' ',a)}}init();`;
