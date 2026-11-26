import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {js} from '../src/app-assets.mjs';

const source=js.slice(js.indexOf('function fundingSettingsPanel('),js.indexOf('function providerFinancialJournal('));
const initial={settings:null,funding:{source:'legacy_environment',status:'setup_required'}};
const saved={mode:'journal',plivoCurrency:'USD',plivoPulseMicros:123456,sarvamPulseMicros:500000,revision:7,evidenceRef:'review-evidence-007',updatedAt:'2026-11-26T12:00:00.000Z'};
function fixture(snapshot=initial){
 const elements=[],requests=[],notices=[];let respond=async()=>snapshot;
 const element=(tag,props={},children=[])=>{
  const e={tag,...props,value:props.value??'',checked:false,children:[],events:{},disabled:!!props.disabled,
   append(...items){this.children.push(...items)},addEventListener(name,listener){this.events[name]=listener}};
  e.append(...(Array.isArray(children)?children:[children]));elements.push(e);return e;
 };
 const context=vm.createContext({
  node:element,div:(cls,...children)=>element('div',{class:cls},children),title:text=>element('h2',{text}),
  input:(name,type,placeholder)=>element('input',{name,type,placeholder}),lab:(text,control)=>element('label',{text},control),
  btn:(text,onclick)=>element('button',{text,onclick}),formatIst:value=>value,
  notice:(text,error)=>notices.push({text,error}),asError:error=>notices.push({text:error.message,error:true}),
  api:async(path,method='GET',payload)=>{requests.push({path,method,payload});return respond(path,method,payload)}
 });
 vm.runInContext(source+';globalThis.panel=fundingSettingsPanel;',context);
 const main=element('main');context.panel(main);
 const byName=name=>elements.find(e=>e.name===name);
 const button=text=>elements.find(e=>e.tag==='button'&&e.text===text);
 const form=elements.find(e=>e.tag==='form'),currency=elements.find(e=>e.tag==='select'),reviewed=elements.find(e=>e.type==='checkbox');
 const fill=()=>{currency.value='USD';byName('fundingPlivoPulse').value='0.123456';byName('fundingSarvamPulse').value='0.000001';byName('fundingEvidence').value='review-evidence-001';reviewed.checked=true};
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 return {elements,requests,notices,byName,button,currency,reviewed,fill,flush,
  submit:()=>form.events.submit({preventDefault(){}}),respond(fn){respond=fn}};
}
test('funding setup starts with no invented tariffs and sends exact micros with the reviewed revision',async()=>{
 assert.doesNotThrow(()=>new vm.Script(js));
 const f=fixture();await f.flush();
 assert.equal(f.currency.value,'');assert.equal(f.byName('fundingPlivoPulse').value,'');assert.equal(f.byName('fundingSarvamPulse').value,'');
 assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
 f.fill();f.respond(async(_path,method,payload)=>method==='POST'?{settings:{...saved,revision:1,...payload},funding:{source:'recorded_provider_ledger',status:'ready'}}:initial);
 f.submit();await f.flush();
 const request=f.requests.find(r=>r.method==='POST');
 assert.deepEqual(JSON.parse(JSON.stringify(request.payload)),{mode:'journal',plivoCurrency:'USD',plivoPulseMicros:123456,sarvamPulseMicros:1,evidenceRef:'review-evidence-001',expectedRevision:0});
 assert.equal(f.reviewed.checked,false);
 assert.match(f.notices.at(-1).text,/without Worker variable edits or redeployment/);
});
test('funding setup rejects ambiguous, rounded, zero and excessive monetary input',async()=>{
 const f=fixture();await f.flush();
 for(const amount of ['0','-1','1e2','0.0000009','1000.000001','1,000','NaN','']){
  f.fill();f.byName('fundingPlivoPulse').value=amount;f.submit();await f.flush();
 }
 f.fill();f.reviewed.checked=false;f.submit();await f.flush();
 assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
 assert.equal(f.notices.length,9);
});
test('funding setup requires refresh after an uncertain or conflicted save',async()=>{
 const f=fixture({settings:saved,funding:{source:'recorded_provider_ledger',status:'ready'}});await f.flush();f.fill();
 f.respond(async()=>{throw Error('funding settings changed; refresh')});
 f.submit();await f.flush();
 assert.equal(f.button('Save funding settings').disabled,true);
 assert.equal(f.button('Disable journal funding').disabled,true);
 f.submit();await f.flush();assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
 f.respond(async()=>({settings:{...saved,revision:8},funding:{source:'recorded_provider_ledger',status:'ready'}}));
 await f.button('Refresh funding settings').onclick();f.fill();
 f.submit();await f.flush();
 assert.equal(f.requests.filter(r=>r.method==='POST').at(-1).payload.expectedRevision,8);
});
test('disabling funding retains saved costs even when the enable form is edited',async()=>{
 const f=fixture({settings:saved,funding:{source:'recorded_provider_ledger',status:'ready'}});await f.flush();
 f.byName('fundingPlivoPulse').value='999';f.currency.value='INR';
 await f.button('Disable journal funding').onclick();
 const payload=f.requests.find(r=>r.method==='POST').payload;
 assert.equal(payload.mode,'disabled');assert.equal(payload.expectedRevision,7);
 assert.equal(payload.plivoCurrency,'USD');assert.equal(payload.plivoPulseMicros,123456);assert.equal(payload.sarvamPulseMicros,500000);
});
