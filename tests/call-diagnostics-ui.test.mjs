import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {js} from '../src/app-assets.mjs';

const source=js.slice(js.indexOf('function callAttemptLabel('),js.indexOf('async function customerCallingPanel('));
function fixture(initial){
 const elements=[],requests=[],notices=[];
 const element=(tag,props={},children=[])=>{
  let text=props.text??'';
  const e={tag,value:'',selectedIndex:0,isConnected:true,hidden:false,...props,children:[],events:{},
   append(...items){this.children.push(...items.flat())},
   replaceChildren(...items){text='';this.children=items.flat()},
   addEventListener(name,listener){this.events[name]=listener}
  };
  Object.defineProperty(e,'textContent',{get(){return text+this.children.map(c=>c?.textContent??String(c??'')).join(' ')},set(v){text=String(v);this.children=[]}});
  e.append(children);elements.push(e);return e;
 };
 let current=initial;
 const context=vm.createContext({
  node:element,div:(cls,...children)=>element('div',{class:cls},children),title:(text,tag='h2')=>element(tag,{text}),
  btn:(text,onclick)=>element('button',{text,onclick}),lab:(text,control)=>element('label',{text},control),
  table:(headers,rows)=>element('table',{},[element('tr',{},headers),...rows.map(r=>element('tr',{},r))]),
  URLSearchParams,formatIst:v=>v,formatSeconds:n=>n+'s',
  notice:text=>notices.push(text),asError:error=>notices.push(error.message),
  api:async(path,method='GET',payload)=>{
   requests.push({path,method,payload});
   if(method==='POST'){
    assert.equal(path,'/v1/human/calling/release-unused-reservation');
    current={...current,callEvidence:{...current.callEvidence,reservationState:'released',chargedSeconds:0}};
    return {released:true,releasedSeconds:180,callPlaced:false};
   }
   if(path.startsWith('/v1/human/campaigns?'))return {campaigns:[]};
   assert.ok(path.startsWith('/v1/human/calling/results?'));
   return {results:[current],total:1};
  }
 });
 vm.runInContext(source+';globalThis.panel=campaignResultsPanel;globalThis.label=callAttemptLabel;globalThis.progress=campaignRunProgress;',context);
 const main=element('main');
 return {context,main,requests,notices,elements,button:text=>elements.find(e=>e.tag==='button'&&e.textContent===text),flush:()=>new Promise(r=>setImmediate(r))};
}
const failed={id:'abc123',name:'Test buyer',campaign:'Small campaign',state:'failed',errorCode:'credit_reservation_unavailable',
 destinationLast4:'0042',destinationSource:'attempt',reservedAt:'2026-11-26T12:51:46.000Z',durationSeconds:null,
 callEvidence:{sessionPresent:false,requestAccepted:false,signedHangup:false,audioReceived:false,reservationState:'held',reservedSeconds:180}};

test('call labels distinguish a pre-submit failure, an accepted request, and a signed end',()=>{
 const f=fixture(failed),label=f.context.label;
 assert.equal(label(failed),'Not dialed · credit reservation failed');
 assert.equal(label({...failed,callEvidence:undefined}),'Attempt failed');
 assert.match(label({state:'submitted',callEvidence:{requestAccepted:true}}),/awaiting outcome/);
 assert.match(label({state:'failed',callEvidence:{signedHangup:true,durationSeconds:0}}),/Call ended · questionnaire incomplete/);
 assert.doesNotMatch(label({state:'submitted'}),/answered|ringing|completed/i);
 assert.equal(label({state:'queued'}),'Queued · no call sent');
 assert.doesNotThrow(()=>new vm.Script(js));
});

test('a running campaign with only queued or failed jobs never claims a connected call',()=>{
 const f=fixture(failed),progress=f.context.progress,run={id:'run-1',state:'running'};
 assert.match(progress(run,[{runId:'run-1',state:'queued'}]),/Campaign queued/);
 assert.match(progress(run,[{runId:'run-1',state:'failed'}]),/finished with issues/);
 assert.match(progress(run,[{runId:'run-1',state:'submitted'}]),/not yet confirmed/);
 assert.match(progress(run,[{runId:'run-1',state:'unknown'}]),/needs verification/);
 assert.doesNotMatch(progress(run,[{runId:'other-run',state:'submitted'}]),/Provider accepted/);
});

test('Super Admin sees masked target, reason and hold without calling the provider or creating a run',async()=>{
 const f=fixture(failed);f.context.panel('tenant',f.main,'super_admin');await f.flush();
 assert.deepEqual(f.requests.map(r=>r.method),['GET']);
 assert.match(f.main.textContent,/••••0042/);
 assert.match(f.main.textContent,/Not dialed · credit reservation failed/);
 assert.match(f.main.textContent,/credit_reservation_unavailable/);
 assert.match(f.main.textContent,/On hold: 180s/);
 assert.match(f.main.textContent,/No accepted Plivo request recorded/);
 assert.match(f.main.textContent,/does not save an audio playback file/);
 assert.ok(f.button('Return unused held minutes'));
 assert.equal(f.requests.some(r=>/runs|plivo-cost-reconcile/.test(r.path)),false);
});

test('explicit unused-hold recovery refreshes results and cannot retry the phone call',async()=>{
 const f=fixture(failed);f.context.panel('tenant',f.main,'super_admin');await f.flush();
 await f.button('Return unused held minutes').onclick();await f.flush();
 const posts=f.requests.filter(r=>r.method==='POST');
 assert.equal(posts.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(posts[0].payload)),{tenantId:'tenant',jobId:'abc123'});
 assert.match(f.main.textContent,/Unused reservation returned/);
 assert.doesNotMatch(f.main.textContent,/Return unused held minutes/);
 assert.match(f.notices.join(' '),/call was not retried/);
});

test('clients and uncertain attempts never get a release action',async()=>{
 for(const [role,result] of [['client_admin',failed],['super_admin',{...failed,state:'unknown'}],
  ['super_admin',{...failed,callEvidence:{...failed.callEvidence,sessionPresent:true}}],
  ['super_admin',{...failed,callEvidence:{...failed.callEvidence,reservationState:'released'}}]]){
  const f=fixture(result);f.context.panel('tenant',f.main,role);await f.flush();
  assert.equal(f.button('Return unused held minutes'),undefined);
  assert.equal(f.requests.some(r=>r.method==='POST'),false);
 }
});
