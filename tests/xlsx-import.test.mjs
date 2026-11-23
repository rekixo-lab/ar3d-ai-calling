import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import worker from '../src/index.mjs';
import {parseLeadXlsx,parseLeadXlsxBase64,MAX_XLSX_BYTES} from '../src/xlsx-import.mjs';

function crc32(buf){
  let crc=0xffffffff;
  for(const b of buf){crc^=b;for(let i=0;i<8;i++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1}
  return (crc^0xffffffff)>>>0;
}
const u16=(b,n,i)=>b.writeUInt16LE(n,i);
const u32=(b,n,i)=>b.writeUInt32LE(n,i);
function zip(files,compressed=true){
  const local=[],central=[];let offset=0;
  for(const [name,content] of Object.entries(files)){
    const src=Buffer.from(content),data=compressed?deflateRawSync(src):src,nb=Buffer.from(name);
    const method=compressed?8:0,checksum=crc32(src),header=Buffer.alloc(30);
    u32(header,0x04034b50,0);u16(header,20,4);u16(header,method,8);u32(header,checksum,14);
    u32(header,data.length,18);u32(header,src.length,22);u16(header,nb.length,26);
    local.push(header,nb,data);
    const c=Buffer.alloc(46);
    u32(c,0x02014b50,0);u16(c,20,4);u16(c,20,6);u16(c,method,10);u32(c,checksum,16);
    u32(c,data.length,20);u32(c,src.length,24);u16(c,nb.length,28);u32(c,offset,42);
    central.push(c,nb);offset+=header.length+nb.length+data.length;
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);
  u32(end,0x06054b50,0);u16(end,Object.keys(files).length,8);u16(end,Object.keys(files).length,10);
  u32(end,cd.length,12);u32(end,offset,16);
  return new Uint8Array(Buffer.concat([...local,cd,end]));
}
const workbook=`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const rels=`<?xml version="1.0" encoding="UTF-8"?><Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
const strings=`<sst><si><t>Name</t></si><si><t>Preferred Location</t></si><si><r><t>Rita</t></r><r><t> Shah</t></r></si><si><t>Budget Max</t></si></sst>`;
const sheet=`<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Mobile Number</t></is></c><c r="C1" t="s"><v>1</v></c><c r="D1" t="s"><v>3</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>9876543210</v></c><c r="C2" t="inlineStr"><is><t>Dholera &amp; Park</t></is></c><c r="D2"><v>2500000</v></c></row>
</sheetData></worksheet>`;
function workbookZip(sheetXml=sheet,compressed=true,extras={}){
  return zip({'xl/workbook.xml':workbook,'xl/_rels/workbook.xml.rels':rels,'xl/sharedStrings.xml':strings,'xl/worksheets/sheet1.xml':sheetXml,...extras},compressed);
}
function env(role='client_admin'){
  const log=[];
  const CONTROL_DB={prepare(sql){return {bind(...params){return {async first(){
    if(sql.includes('FROM human_sessions'))return {id:'11111111-1111-4111-8111-111111111111',email:'sample@example.com',globalRole:'user'};
    if(sql.includes('FROM tenant_memberships'))return role?{tenant_id:'22222222-2222-4222-8222-222222222222',role,storage_mode:'shared',status:'active'}:null;
    return null;
  }}}}}};
  const CRM_DB={prepare(sql){return {bind(...params){log.push({sql,params});return {async first(){return null},async all(){return {results:[]}},async run(){return {meta:{changes:1}}}}}}},async batch(rows){return rows.map(()=>({meta:{changes:1}}))}};
  return {env:{CONTROL_DB,CRM_DB},log};
}
function request(payload,route='preview',origin=true){return new Request('https://example.test/v1/human/import/'+route,{method:'POST',headers:{'content-type':'application/json',cookie:'ar3d_calling_session='+'a'.repeat(64),...(origin?{origin:'https://example.test'}:{})},body:JSON.stringify(payload)})}
const tenantId='22222222-2222-4222-8222-222222222222';
const data=workbookZip();const payload={tenantId,format:'xlsx',xlsxBase64:Buffer.from(data).toString('base64')};
test('XLSX stored and compressed first visible worksheet parses rich strings and numeric phone',async()=>{
  for(const zipped of [data,workbookZip(sheet,false)]){
    const rows=await parseLeadXlsx(zipped);
    assert.equal(rows.length,1);assert.equal(rows[0].name,'Rita Shah');
    assert.equal(rows[0].mobile,'+919876543210');assert.equal(rows[0].location,'Dholera & Park');
    assert.equal(rows[0].budgetMaxInr,2500000);
  }
});
test('XLSX valid base64 entry preserves import output',async()=>{
  const rows=await parseLeadXlsxBase64(payload.xlsxBase64);
  assert.equal(rows[0].name,'Rita Shah');
});
test('XLSX refuses formula cells, invalid XML entities and nonexistent sheet paths',async()=>{
  const formula=sheet.replace('<v>2500000</v>','<f>SUM(1,2)</f><v>2500000</v>');
  await assert.rejects(parseLeadXlsx(workbookZip(formula)),/formula cells/);
  await assert.rejects(parseLeadXlsx(workbookZip(sheet.replace('Dholera &amp; Park','Dholera &entity; Park'))),/XML entity/);
  await assert.rejects(parseLeadXlsx(zip({'xl/workbook.xml':workbook,'xl/_rels/workbook.xml.rels':rels})),/missing xl\/worksheets/);
});
test('XLSX rejects macros, malformed base64, oversized input, duplicate phones',async()=>{
  await assert.rejects(parseLeadXlsx(workbookZip(sheet,true,{'xl/vbaProject.bin':'unsafe'})),/macros/);
  await assert.rejects(parseLeadXlsxBase64('!!!'),/base64/);
  await assert.rejects(parseLeadXlsx(new Uint8Array(MAX_XLSX_BYTES+1)),/too large/);
  const extra='<row r="3"><c r="A3" t="inlineStr"><is><t>Another</t></is></c><c r="B3"><v>9876543210</v></c></row>';
  await assert.rejects(parseLeadXlsx(workbookZip(sheet.replace('</sheetData>',extra+'</sheetData>'))),/repeated mobile/);
});
test('Human XLSX preview is read only and import writes tenant scoped unknown consent',async()=>{
  const e=env();const preview=await worker.fetch(request(payload),e.env);
  assert.equal(preview.status,200);const result=await preview.json();assert.equal(result.rows,1);
  assert.equal(e.log.filter(x=>x.sql.includes('INSERT INTO leads')).length,0);
  const commit=await worker.fetch(request(payload,'commit'),e.env);
  assert.equal(commit.status,201);assert.equal((await commit.json()).inserted,1);
  const insert=e.log.find(x=>x.sql.includes('INSERT INTO leads'));
  assert.equal(insert.params[0],tenantId);
  assert.match(insert.sql,/'unknown','unknown'/);
  assert.ok(e.log.some(x=>x.params.includes('leads.xlsx_import')));
});
test('Human XLSX requires write access, same origin and bounded upload',async()=>{
  assert.equal((await worker.fetch(request(payload),env('viewer').env)).status,403);
  assert.equal((await worker.fetch(request(payload,'preview',false),env().env)).status,403);
  assert.equal((await worker.fetch(request({...payload,xlsxBase64:'x'.repeat(1500000)}),env().env)).status,400);
});

test('XLSX customer imports require Name column and non-empty printable names',async()=>{
 const wrongHeader=sheet.replace('<c r="A1" t="s"><v>0</v></c>',
  '<c r="A1" t="inlineStr"><is><t>Other column</t></is></c>');
 await assert.rejects(parseLeadXlsx(workbookZip(wrongHeader)),/Missing Name column/);
 const emptyName=sheet.replace('<c r="A2" t="s"><v>2</v></c>',
  '<c r="A2" t="inlineStr"><is><t></t></is></c>');
 await assert.rejects(parseLeadXlsx(workbookZip(emptyName)),/customer name is required/);
});
