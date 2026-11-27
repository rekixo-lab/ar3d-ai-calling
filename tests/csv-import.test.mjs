import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLeadCsv,MAX_CSV_ROWS} from '../src/csv-import.mjs';
import worker from '../src/index.mjs';

const userId='11111111-1111-4111-8111-111111111111';
const tenantId='22222222-2222-4222-8222-222222222222';
const leadId='33333333-3333-4333-8333-333333333333';
const cookie='ar3d_calling_session='+'a'.repeat(64);
function request(path,method='GET',body=null,origin=true){return new Request('https://example.test'+path,{method,
  headers:{cookie,...(origin?{origin:'https://example.test'}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
function fakeEnvironment(role='client_admin'){
  const log=[];
  const CONTROL_DB={prepare(sql){return {bind(...params){log.push({db:'control',sql,params});return {
    async first(){
      if(sql.includes('FROM human_sessions'))return {id:userId,email:'admin@example.com',globalRole:'user'};
      if(sql.includes('FROM tenant_memberships'))return role?{tenant_id:tenantId,role,storage_mode:'shared',status:'active'}:null;
      return null;
    }
  }}}}};
  const CRM_DB={prepare(sql){return {bind(...params){log.push({db:'crm',sql,params});return {
    async first(){if(sql.includes('FROM leads WHERE tenant_id'))return {id:leadId,interestStatus:'new',preferredLocation:null,budgetMinInr:null,budgetMaxInr:null,followupAt:null};return null},
    async all(){return {results:[]}},async run(){return {meta:{changes:1}}}
  }}}},async batch(statements){return statements.map((_,i)=>({meta:{changes:i===1?0:1}}))}};
  return {env:{CONTROL_DB,CRM_DB},log};
}
const csv='Name,Mobile Number,Preferred Location,Budget Min,Budget Max,Requirements\n"Rita, Shah",9876543210,Dholera,"1,000,000","2,000,000","Corner plot, near park"\nAman,9123456780,Korba,,,"Needs 2 sites"';
test('Excel-exported CSV: quoting, commas, blanks and budgets parse safely',()=>{
  const rows=parseLeadCsv('\uFEFF'+csv+'\r\n');
  assert.equal(rows.length,2);
  assert.equal(rows[0].name,'Rita, Shah');
  assert.equal(rows[0].mobile,'+919876543210');
  assert.equal(rows[0].budgetMinInr,1000000);
  assert.equal(rows[0].budgetMaxInr,2000000);
  assert.equal(rows[1].budgetMinInr,null);
});
test('multiline quoted cells, escaped quotes parse',()=>{
  const r=parseLeadCsv('Name,Mobile,Requirements\n"A"" B",9876543210,"size 20\nnear park"');
  assert.equal(r[0].name,'A" B');assert.equal(r[0].requirement,'size 20\nnear park');
});
test('CSV fails closed for malformed input, duplicate numbers and invalid monetary values',()=>{
  for(const source of [
    'Name,Phone\nA,9876543210\nB,9876543210',
    'Name,Phone\nA,12345',
    'Name,Phone\n"unfinished,9876543210',
    'Name,Phone\nA,9876543210,extra',
    'Name,Phone,Budget\nA,9876543210,5 lakh',
    'Name,Phone,Budget Min,Budget Max\nA,9876543210,900,100',
    'Name,Something\nA,9876543210',
    'Name,Phone\nA,9876543210\n'+Array(MAX_CSV_ROWS).fill('B,9123456780').join('\n'),
  ])assert.throws(()=>parseLeadCsv(source));
});

test('1000 unique customers per CSV accepted; 1001 rejected before preview or commit',async()=>{
 assert.equal(MAX_CSV_ROWS,1000);
 const rows=Array.from({length:1001},(_,i)=>'Buyer '+(i+1)+','+String(9000000000+i));
 const make=n=>'Name,Mobile\n'+rows.slice(0,n).join('\n');
 const valid=parseLeadCsv(make(1000));
 assert.equal(valid.length,1000);
 assert.throws(()=>parseLeadCsv(make(1001)),/maximum 1000/);
 const e=fakeEnvironment();
 for(const route of ['preview','commit']){
  const res=await worker.fetch(request('/v1/human/import/'+route,'POST',{tenantId,csv:make(1001)}),e.env);
  assert.equal(res.status,400);
 }
 assert.ok(!e.log.some(entry=>entry.sql.includes('INSERT INTO leads')),
  'oversized campaigns cannot write customer records');
});

test('CSV max bytes is enforced',()=>assert.throws(()=>parseLeadCsv('x'.repeat(512001))));
test('Import endpoints require session, same-origin, and tenant write membership',async()=>{
  const {env}=fakeEnvironment(null);
  const write=request('/v1/human/import/commit','POST',{tenantId,csv});
  assert.equal((await worker.fetch(write,env)).status,403);
  assert.equal((await worker.fetch(request('/v1/human/import/preview','POST',{tenantId,csv},false),env)).status,403);
  assert.equal((await worker.fetch(new Request('https://example.test/v1/human/leads?tenantId='+tenantId),env)).status,401);
});
test('CSV preview checks membership but does not write lead or assume consent',async()=>{
  const {env,log}=fakeEnvironment();
  const r=await worker.fetch(request('/v1/human/import/preview','POST',{tenantId,csv}),env);
  assert.equal(r.status,200);const data=await r.json();assert.equal(data.rows,2);
  assert.equal(data.preview[0].mobile,'+919876543210');
  assert.equal(log.some(x=>x.sql.includes('INSERT INTO leads')),false);
});
test('CSV import inserts with tenant scope, no overwrite and unknown consent/DND',async()=>{
  const {env,log}=fakeEnvironment();
  const r=await worker.fetch(request('/v1/human/import/commit','POST',{tenantId,csv}),env);
  assert.equal(r.status,201);const body=await r.json();
  assert.equal(body.processed,2);assert.equal(body.inserted,1);assert.equal(body.skipped,1);
  const inserts=log.filter(x=>x.sql.includes('INSERT INTO leads'));
  assert.equal(inserts.length,1);
  assert.equal(JSON.parse(inserts[0].params[3]).length,2);
  assert.ok(inserts.every(x=>x.sql.includes('ON CONFLICT(tenant_id,mobile_e164) DO NOTHING')));
  assert.ok(inserts.every(x=>x.sql.includes("'unknown','unknown'")));
  assert.ok(inserts.every(x=>x.params[0]===tenantId));
});
test('Viewer cannot import, update, add notes or request visit',async()=>{
  const {env}=fakeEnvironment('viewer');
  for(const [path,method,body] of [
    ['/v1/human/import/preview','POST',{tenantId,csv}],
    ['/v1/human/leads/'+leadId,'PATCH',{tenantId,interestStatus:'interested'}],
    ['/v1/human/notes','POST',{tenantId,leadId,text:'Test note'}],
    ['/v1/human/visits','POST',{tenantId,leadId,scheduledAt:'2030-01-02T10:00:00+05:30'}]
  ])assert.equal((await worker.fetch(request(path,method,body),env)).status,403);
});
test('Client cannot modify consent or another tenant records using arbitrary fields',async()=>{
  const {env}=fakeEnvironment();
  const bad=await worker.fetch(request('/v1/human/leads/'+leadId,'PATCH',{tenantId,consentStatus:'granted'}),env);
  assert.equal(bad.status,400);
  const nonmember=fakeEnvironment(null);
  const no=await worker.fetch(request('/v1/human/notes?tenantId='+tenantId+'&leadId='+leadId),nonmember.env);
  assert.equal(no.status,403);
});
test('Allowed lead edits, private notes, and visit requests stay scoped to tenant',async()=>{
  const {env,log}=fakeEnvironment();
  const edit=await worker.fetch(request('/v1/human/leads/'+leadId,'PATCH',{tenantId,interestStatus:'interested',budgetMinInr:1000000,followupAt:'2030-12-01T10:00:00+05:30'}),env);
  assert.equal(edit.status,200);
  const note=await worker.fetch(request('/v1/human/notes','POST',{tenantId,leadId,text:'Interested in corner plot'}),env);
  assert.equal(note.status,201);
  const visit=await worker.fetch(request('/v1/human/visits','POST',{tenantId,leadId,scheduledAt:'2030-12-01T10:00:00+05:30'}),env);
  assert.equal(visit.status,201);
  assert.ok(log.filter(x=>x.db==='crm').every(x=>x.params.includes(tenantId)));
});
test('Invalid followup datetime, visit in past and oversize CSV rejected',async()=>{
  const {env}=fakeEnvironment();
  const badDate=await worker.fetch(request('/v1/human/leads/'+leadId,'PATCH',{tenantId,followupAt:'2027-01-01T10:00'}),env);
  assert.equal(badDate.status,400);
  const oldVisit=await worker.fetch(request('/v1/human/visits','POST',{tenantId,leadId,scheduledAt:'2020-01-01T10:00:00+05:30'}),env);
  assert.equal(oldVisit.status,400);
  const huge=await worker.fetch(request('/v1/human/import/preview','POST',{tenantId,csv:'A'.repeat(513000)}),env);
  assert.equal(huge.status,400);
});

test('explicit CRM column mapping supports arbitrary headings without inferring consent or private fields',()=>{
 const source='Phone Contact,Guardian,Class request,Account balance\n9876543210,Synthetic guardian,Grade 4,50000';
 const columns=parseLeadCsv(source,{headersOnly:true});assert.equal(columns.columns.length,4);
 const rows=parseLeadCsv(source,{columnMap:{name:1,mobile:0,requirement:2}});
 assert.equal(rows[0].name,'Synthetic guardian');assert.equal(rows[0].mobile,'+919876543210');assert.equal(rows[0].requirement,'Grade 4');
 assert.ok(!JSON.stringify(rows).includes('50000'));
 for(const columnMap of [{name:1,mobile:1},{name:1,mobile:99},{name:1,mobile:0,consent:2},{name:1,mobile:0,accountBalance:3},{name:1},{name:'1',mobile:0}])assert.throws(()=>parseLeadCsv(source,{columnMap}),/Invalid column mapping/);
});
test('mapped CSV preview and commit use identical validation; inspection cannot write CRM',async()=>{
 const e=fakeEnvironment();
 const data={tenantId,format:'csv',csv:'Guardian,Contact\nSynthetic guardian,9876543210'};
 let r=await worker.fetch(request('/v1/human/import/columns','POST',data),e.env);
 assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).columns[1].label,'Contact');
 assert.ok(!e.log.some(x=>/INSERT INTO leads/i.test(x.sql)));
 for(const action of ['preview','commit']){
  r=await worker.fetch(request('/v1/human/import/'+action,'POST',{...data,columnMap:{name:0,mobile:0}}),e.env);assert.equal(r.status,400);
 }
 r=await worker.fetch(request('/v1/human/import/preview','POST',{...data,columnMap:{name:0,mobile:1}}),e.env);
 assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).preview[0].name,'Synthetic guardian');
});
