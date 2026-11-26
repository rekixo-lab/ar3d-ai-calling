import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {js} from '../src/app-assets.mjs';

const source=js.slice(js.indexOf('function parseProviderBalanceMicros('),js.indexOf('async function adminDashboard('));
const endpoint='/v1/human/credits/provider-balance-sync';
const row=(provider,overrides={})=>({provider,currency:'INR',available:false,syncedBalanceMicros:null,availableBalanceMicros:null,heldMicros:0,usedMicros:0,lastSyncAt:null,revision:0,...overrides});
const snapshot=(plivo={},sarvam={})=>({mode:'manual_balance',callingEnabled:false,providers:[row('plivo',plivo),row('sarvam',sarvam)]});
const saved=(balanceMicros,revision=1)=>({available:true,syncedBalanceMicros:balanceMicros,availableBalanceMicros:balanceMicros,lastSyncAt:'2026-11-26T18:00:00.000Z',revision});

function fixture(initial=snapshot()){
 const elements=[],requests=[],notices=[],prompts=[],answers=[];
 let respond=async()=>initial,uuidCount=0;
 const element=(tag,props={},children=[])=>{
  let text=props.text??'';
  const e={tag,...props,disabled:!!props.disabled,isConnected:true,children:[],events:{},
   append(...items){this.children.push(...items)},
   addEventListener(name,listener){this.events[name]=listener},
   replaceChildren(...items){text='';this.children=items},
   querySelector(selector){for(const child of this.children){if(child?.tag===selector)return child;const nested=child?.querySelector?.(selector);if(nested)return nested;}return null;}
  };
  Object.defineProperty(e,'textContent',{get(){return text+this.children.map(c=>c?.textContent??String(c??'')).join('')},set(value){text=String(value);this.children=[]}});
  e.append(...(Array.isArray(children)?children:[children]));elements.push(e);return e;
 };
 const context=vm.createContext({
  node:element,div:(cls,...children)=>element('div',{class:cls},children),title:(text,tag='h2')=>element(tag,{text}),
  input:(name,type,placeholder)=>element('input',{name,type,placeholder,value:''}),lab:(text,control)=>element('label',{text},control),
  btn:(text,onclick)=>element('button',{text,onclick}),formatIst:value=>value,formatSeconds:value=>String(value),
  overviewMetric:(label,value)=>element('section',{'aria-label':label},[element('span',{text:label}),element('strong',{text:value})]),
  prompt:text=>{prompts.push(text);return answers.length?answers.shift():null},
  crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++uuidCount).padStart(12,'0')}`},
  notice:(text,error)=>notices.push({text,error}),asError:error=>notices.push({text:error.message,error:true}),
  api:async(path,method='GET',payload)=>{requests.push({path,method,payload});return respond(path,method,payload)}
 });
 vm.runInContext(source+';globalThis.makePanel=providerBalancePanel;globalThis.parseBalance=parseProviderBalanceMicros;globalThis.activatePanel=clientCallingActivationPanel;',context);
 const main=element('main'),panel=context.makePanel(()=>{});main.append(panel.panel);
 const button=text=>elements.find(e=>e.tag==='button'&&e.textContent===text);
 const card=name=>elements.find(e=>e['aria-label']===name+' balance');
 const posts=()=>requests.filter(r=>r.method==='POST');
 return {elements,requests,notices,prompts,answers,context,main,panel,button,card,posts,
  respond(fn){respond=fn},flush:()=>new Promise(resolve=>setImmediate(resolve))};
}

test('manual balance parsing accepts exact copied INR totals including zero without rounding',()=>{
 const f=fixture();
 for(const [raw,micros] of [['0',0],['₹ 1,000.50',1000500000],[' 98.730001 ',98730001],['1,00,000.123456',100000123456],['999999.999999',999999999999],['0.000001',1]])assert.equal(f.context.parseBalance(raw),micros);
 for(const raw of ['', '-1', '1e2', 'Infinity', '1.0000001', '₹1,00', '1,2', '1 000', '1,000,000', '1000000', '12.34.5'])assert.throws(()=>f.context.parseBalance(raw));
 assert.doesNotThrow(()=>new vm.Script(js));
});

test('the HTTP helper preserves conflict status for revision-safe sync recovery',async()=>{
 const apiSource=js.slice(js.indexOf('async function api('),js.indexOf('function asError('));
 const context=vm.createContext({fetch:async()=>({ok:false,status:409,json:async()=>({code:'balance_revision_conflict',error:'Balance changed'})})});
 vm.runInContext(apiSource+';globalThis.request=api;',context);
 await assert.rejects(context.request(endpoint,'POST',{expectedRevision:0}),error=>error.status===409&&error.code==='balance_revision_conflict');
});

test('both provider cards distinguish an untouched balance from a synced zero',async()=>{
 const f=fixture(snapshot({},saved(0)));await f.panel.load();
 assert.equal(f.card('Plivo').querySelector('strong').textContent,'Not synced');
 assert.equal(f.card('Sarvam').querySelector('strong').textContent,'₹0.00');
 assert.match(f.card('Plivo').textContent,/No current balance has been pasted/);
 assert.match(f.card('Sarvam').textContent,/Last synced balance: ₹0.00/);
 assert.match(f.card('Sarvam').textContent,/Estimated available/);
 assert.equal(f.button('Sync Plivo balance').disabled,false);
 assert.equal(f.button('Sync Sarvam balance').disabled,false);
 assert.equal(f.posts().length,0);
 assert.deepEqual(f.requests.map(r=>r.path),[endpoint]);
 assert.doesNotMatch(f.panel.panel.textContent,/80\/USD|USD|receipt|approval reference|cost per/);
});

test('sync replaces each current balance with exact micros and its own expected revision',async()=>{
 const f=fixture(snapshot(saved(30000000,3),saved(20000000,8)));await f.panel.load();
 f.respond(async(_path,method,payload)=>method==='POST'?snapshot(payload.provider==='plivo'?saved(payload.balanceMicros,4):saved(98730001,4),payload.provider==='sarvam'?saved(payload.balanceMicros,9):saved(20000000,8)):snapshot());
 f.answers.push('₹98.730001');await f.button('Sync Plivo balance').onclick();
 f.answers.push('0');await f.button('Sync Sarvam balance').onclick();
 assert.deepEqual(f.posts().map(r=>JSON.parse(JSON.stringify(r.payload))),[
  {id:'00000000-0000-4000-8000-000000000001',provider:'plivo',balanceMicros:98730001,expectedRevision:3},
  {id:'00000000-0000-4000-8000-000000000002',provider:'sarvam',balanceMicros:0,expectedRevision:8}
 ]);
 assert.equal(f.card('Plivo').querySelector('strong').textContent,'₹98.730001');
 assert.equal(f.card('Sarvam').querySelector('strong').textContent,'₹0.00');
 assert.match(f.prompts[0],/total balance, not only the recharge amount/);
});

test('an unresolved balance keeps the last snapshot and permits a new sync without displaying zero',async()=>{
 const f=fixture(snapshot({...saved(750000000,7),availableBalanceMicros:null,heldMicros:null,usedMicros:null}));
 await f.panel.load();
 assert.equal(f.card('Plivo').querySelector('strong').textContent,'Unavailable');
 assert.match(f.card('Plivo').textContent,/Last synced balance: ₹750.00/);
 assert.match(f.card('Plivo').textContent,/Balance review required/);
 assert.equal(f.button('Sync Plivo balance').disabled,false);
 f.respond(async()=>snapshot(saved(700000000,8)));
 f.answers.push('700');await f.button('Sync Plivo balance').onclick();
 assert.equal(f.posts()[0].payload.expectedRevision,7);
 assert.equal(f.card('Plivo').querySelector('strong').textContent,'₹700.00');
 assert.match(f.card('Plivo').textContent,/Estimated call costs update automatically/);
 assert.equal(f.elements.find(e=>e.textContent==='Open Sarvam dashboard').href,'https://indus.sarvam.ai/');
});

test('an uncertain save retries one frozen id and amount even after the dashboard refreshes',async()=>{
 const f=fixture();await f.panel.load();
 let posted=false;
 f.respond(async(_path,method)=>{
  if(method==='POST'&&!posted){posted=true;throw Error('Connection lost after write');}
  return snapshot(saved(1000000000,1));
 });
 f.answers.push('1000');await f.button('Sync Plivo balance').onclick();
 assert.match(f.card('Plivo').textContent,/Sync result is uncertain/);
 const pending=f.posts()[0].payload;assert.equal(Object.isFrozen(pending),true);
 await f.panel.load();
 f.answers.push('2000'); // This answer must not be requested by a retry.
 await f.button('Retry Plivo sync').onclick();
 assert.equal(f.prompts.length,1);assert.equal(f.posts().length,2);
 assert.strictEqual(f.posts()[1].payload,pending);
 assert.equal(f.posts()[1].payload.expectedRevision,0);
 assert.equal(f.button('Sync Plivo balance').disabled,false);
 assert.equal(f.card('Plivo').querySelector('strong').textContent,'₹1,000.00');
});

test('a conflicting save refreshes the revision and requires a fresh pasted total',async()=>{
 const f=fixture(snapshot(saved(100000000,4)));await f.panel.load();
 let conflict=true;
 f.respond(async(_path,method,payload)=>{
  if(method==='POST'&&conflict){conflict=false;const error=Error('Balance changed');error.status=409;throw error;}
  return snapshot(saved(method==='POST'?payload.balanceMicros:200000000,method==='POST'?6:5));
 });
 f.answers.push('300');await f.button('Sync Plivo balance').onclick();
 assert.equal(f.posts().length,1);
 assert.equal(f.card('Plivo').querySelector('strong').textContent,'₹200.00');
 assert.match(f.card('Plivo').textContent,/paste its current balance again/);
 f.answers.push('250.50');await f.button('Sync Plivo balance').onclick();
 assert.equal(f.posts()[1].payload.expectedRevision,5);
 assert.equal(f.posts()[1].payload.balanceMicros,250500000);
 assert.notEqual(f.posts()[0].payload.id,f.posts()[1].payload.id);
});

test('failed conflict refresh blocks a new save until an explicit refresh succeeds',async()=>{
 const f=fixture();await f.panel.load();
 f.respond(async(_path,method)=>{const error=Error('Try again');if(method==='POST')error.status=409;throw error;});
 f.answers.push('50');await f.button('Sync Plivo balance').onclick();
 assert.equal(f.button('Sync Plivo balance').disabled,true);
 await f.button('Sync Plivo balance').onclick();assert.equal(f.posts().length,1);
 f.respond(async()=>snapshot(saved(25000000,1)));await f.panel.load();
 assert.equal(f.button('Sync Plivo balance').disabled,false);
});

test('repeated clicks cannot send duplicate in-flight requests and older snapshots cannot regress a revision',async()=>{
 const f=fixture();await f.panel.load();
 let resolvePost;
 f.respond(async(_path,method)=>method==='POST'?new Promise(resolve=>{resolvePost=resolve}):snapshot(saved(10000000,1)));
 f.answers.push('20');const sync=f.button('Sync Plivo balance'),saving=sync.onclick();
 assert.equal(sync.disabled,true);await sync.onclick();assert.equal(f.posts().length,1);
 resolvePost(snapshot(saved(20000000,2)));await saving;
 await f.panel.load();
 assert.equal(f.card('Plivo').querySelector('strong').textContent,'₹20.00');
});

test('client activation is an explicit action, reports partial results and never starts a call',async()=>{
 const f=fixture();let refreshed=0;
 const activation=f.context.activatePanel(f.main,async()=>{refreshed++});
 assert.equal(f.posts().length,0);
 let resolveActivation;
 f.respond(async()=>new Promise(resolve=>{resolveActivation=resolve}));
 const enable=f.button('Enable client calling'),saving=enable.onclick();
 await enable.onclick();assert.equal(f.posts().length,1);assert.equal(enable.disabled,true);
 resolveActivation({enabled:1,companies:[{name:'Client A',status:'enabled'},{name:'Client B',status:'skipped',reason:'Prompt audio is not ready'}]});await saving;
 assert.deepEqual(JSON.parse(JSON.stringify(f.posts()[0])),{path:'/v1/human/calling/enable-clients',method:'POST',payload:{reference:'owner-dashboard-activation'}});
 assert.match(activation.textContent,/Calling enabled for 1 client company/);
 assert.match(activation.textContent,/Client B: skipped · Prompt audio is not ready/);
 assert.equal(refreshed,1);assert.equal(enable.disabled,false);
 assert.equal(f.requests.some(r=>/campaign|start|dial/.test(r.path)),false);
});

test('manual funding mode hides and disables legacy rate entry while keeping refresh available',async()=>{
 const f=fixture();
 f.respond(async()=>({settings:{mode:'manual_balance',revision:2},funding:{source:'manual_balance',status:'ready'}}));
 const settingsSource=js.slice(js.indexOf('function fundingSettingsPanel('),js.indexOf('function providerFinancialJournal('));
 vm.runInContext(settingsSource+';globalThis.fundingPanel=fundingSettingsPanel;',f.context);
 f.context.fundingPanel(f.main,()=>{});await f.flush();
 const form=f.elements.find(e=>e.tag==='form');
 assert.equal(form.hidden,true);
 for(const name of ['fundingPlivoPulse','fundingSarvamPulse','fundingEvidence'])assert.equal(f.elements.find(e=>e.name===name).disabled,true);
 assert.equal(f.button('Save funding settings').disabled,true);
 assert.equal(f.button('Disable journal funding').disabled,true);
 assert.equal(f.button('Record or review provider funds').hidden,true);
 assert.equal(f.button('Refresh funding settings').disabled,false);
 assert.match(f.main.textContent,/Manual balance sync is active\. Update Plivo and Sarvam balances on Dashboard\. Calling estimates use published rates; actual provider balances apply\./);
 form.events.submit({preventDefault(){}});await f.button('Disable journal funding').onclick();await f.flush();
 assert.equal(f.posts().length,0);
});

test('explicit Plivo diagnostics show observed trial, paid and unknown account types',async()=>{
 const f=fixture();
 f.context.connection=f.context.node('section');
 const statusSource=js.slice(js.indexOf('function plivoAccountStatus('),js.indexOf('function parseProviderBalanceMicros('));
 const checkSource=js.slice(js.indexOf('const loadConnection=async()=>{'),js.indexOf('const loadUsage=async()=>{'));
 vm.runInContext(statusSource+checkSource+';globalThis.checkConnection=loadConnection;',f.context);
 assert.equal(f.requests.length,0);
 for(const [accountType,credentialsVerified,expected] of [
  ['developer',true,/Plivo account: Free Trial — only sandbox destinations allowed by provider\./],
  ['standard',true,/Plivo account: paid \(standard\); provider route restrictions still apply\./],
  ['unknown',true,/Plivo account: unknown — account type could not be verified\./],
  ['standard',false,/Plivo account: unknown — account type could not be verified\./]
 ]){
  f.respond(async()=>({accountType,credentialsVerified,listedNumbers:[]}));
  await f.context.checkConnection();assert.match(f.context.connection.textContent,expected);
 }
 assert.deepEqual(f.requests.map(r=>r.path),Array(4).fill('/v1/human/credits/provider-check'));
 assert.equal(f.posts().length,0);
});
