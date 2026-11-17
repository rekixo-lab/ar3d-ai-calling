// Bounded, dependency-free XLSX reader for small lead sheets.
// Reads the first visible worksheet; never evaluates formulas or executes macros.
// ZIP (stored/deflate) and XML inputs are untrusted. Production usage requires
// a Cloudflare Workers staging smoke test of DecompressionStream('deflate-raw').
import {parseLeadCsv,MAX_CSV_ROWS} from './csv-import.mjs';

export const MAX_XLSX_BYTES=1024*1024;
const MAX_ENTRY_BYTES=2*1024*1024;
const MAX_TOTAL_XML_BYTES=4*1024*1024;
const MAX_ZIP_ENTRIES=120;
const MAX_COLUMNS=24;
const td=new TextDecoder('utf-8',{fatal:true});
const u16=(v,p)=>v.getUint16(p,true);
const u32=(v,p)=>v.getUint32(p,true);
function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc&1)?(crc>>>1)^0xedb88320:crc>>>1}
  return (crc^0xffffffff)>>>0;
}
function fail(s){throw Error('XLSX: '+s)}
function xmlText(v){
  if(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/.test(v))fail('unsupported XML entity');
  return v.replace(/&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,(_,e)=>{
    if(e==='amp')return '&';if(e==='lt')return '<';if(e==='gt')return '>';
    if(e==='quot')return '"';if(e==='apos')return "'";
    const n=e.startsWith('#x')?parseInt(e.slice(2),16):parseInt(e.slice(1),10);
    if(n===0||n>0x10ffff||(n>=0xd800&&n<=0xdfff))fail('invalid XML character');
    return String.fromCodePoint(n);
  });
}
function safeXml(bytes,label){
  let s;try{s=td.decode(bytes)}catch{fail(label+' must be UTF-8')}
  if(/<!\s*(?:DOCTYPE|ENTITY)/i.test(s))fail('XML DTD is not allowed');
  return s;
}
function attr(tag,key){
  const m=tag.match(new RegExp('(?:^|\\s)'+key.replace(':','\\:')+'\\s*=\\s*(["\'])(.*?)\\1','i'));
  return m?xmlText(m[2]):null;
}
function partsXml(s,tag){
  const re=new RegExp('<(?:[\\w-]+:)?'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?'+tag+'\\s*>','g');
  return [...s.matchAll(re)].map(m=>m[1]);
}
function childValue(s,tag){const r=partsXml(s,tag);return r.length?r[0]:null}
function textRuns(s){return [...s.matchAll(/<(?:[\w-]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?t\s*>/g)]
  .map(m=>xmlText(m[1])).join('')}
function safePath(s){return !!s&&!s.startsWith('/')&&!s.includes('\\')&&!s.split('/').includes('..')&&!s.includes('\0')}
async function extract(file,entry){
  const {bytes,view}=file,{offset,method,compressedSize,size,checksum}=entry;
  if(offset+30>bytes.length||u32(view,offset)!==0x04034b50)fail('invalid ZIP local header');
  const lf=u16(view,offset+26),le=u16(view,offset+28),dataStart=offset+30+lf+le;
  if(dataStart+compressedSize>bytes.length)fail('truncated ZIP entry');
  const zipBytes=bytes.subarray(dataStart,dataStart+compressedSize);
  if(method===0){if(compressedSize!==size||crc32(zipBytes)!==checksum)fail('stored ZIP integrity mismatch');return zipBytes}
  if(method!==8)fail('unsupported ZIP compression');
  if(typeof DecompressionStream!=='function')fail('deflate decompressor unavailable');
  let stream;
  try{stream=new Blob([zipBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))}
  catch{fail('deflate-raw decompressor unavailable')}
  const reader=stream.getReader(),chunks=[];let length=0;
  try{
    while(true){const {value,done}=await reader.read();if(done)break;
      length+=value.byteLength;
      if(length>size||length>MAX_ENTRY_BYTES)fail('decompression size limit exceeded');
      chunks.push(value);
    }
  }catch(e){await reader.cancel().catch(()=>{});if(/^XLSX:/.test(e.message))throw e;fail('corrupt compressed data')}
  if(length!==size)fail('ZIP uncompressed size mismatch');
  const out=new Uint8Array(length);let i=0;for(const c of chunks){out.set(c,i);i+=c.length}
  if(crc32(out)!==checksum)fail('ZIP checksum mismatch');
  return out;
}
function zipIndex(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>MAX_XLSX_BYTES)fail('file too large or invalid (max 1 MB)');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
    if(u32(v,i)===0x06054b50&&i+22+u16(v,i+20)===bytes.length){eocd=i;break}
  }
  if(eocd<0)fail('ZIP central directory missing');
  if(u16(v,eocd+4)!==0||u16(v,eocd+6)!==0)fail('multidisk ZIP not supported');
  const count=u16(v,eocd+10),offset=u32(v,eocd+16),length=u32(v,eocd+12);
  if(count<1||count>MAX_ZIP_ENTRIES||offset+length>eocd)fail('ZIP entries/size invalid');
  const entries=new Map();let cursor=offset,total=0;
  for(let i=0;i<count;i++){
    if(cursor+46>bytes.length||u32(v,cursor)!==0x02014b50)fail('corrupt ZIP central directory');
    const flags=u16(v,cursor+8),method=u16(v,cursor+10),checksum=u32(v,cursor+16),compressedSize=u32(v,cursor+20),size=u32(v,cursor+24);
    const nameLength=u16(v,cursor+28),extra=u16(v,cursor+30),comment=u16(v,cursor+32),position=u32(v,cursor+42);
    const end=cursor+46+nameLength+extra+comment;
    if(end>offset+length)fail('invalid ZIP central entry');
    let name;try{name=td.decode(bytes.subarray(cursor+46,cursor+46+nameLength))}catch{fail('invalid ZIP filename encoding')}
    if(!safePath(name)||entries.has(name)||flags&1||![0,8].includes(method)||size===0xffffffff||compressedSize===0xffffffff)
      fail('unsupported, encrypted, or unsafe ZIP entry');
    if(size>MAX_ENTRY_BYTES)fail('ZIP entry too large');
    if(/(?:^|\/)(?:vbaProject\.bin|externalLinks)(?:\/|$)/i.test(name))fail('macros/external links unsupported');
    total+=size;if(total>MAX_TOTAL_XML_BYTES)fail('ZIP expanded size too large');
    entries.set(name,{bytes,view:v,offset:position,method,compressedSize,size,checksum,name});cursor=end;
  }
  if(cursor!==offset+length)fail('ZIP directory length mismatch');
  return entries;
}
function firstSheetPath(book,rels){
  const all=[...book.matchAll(/<(?:[\w-]+:)?sheet\s[^>]*\/?\s*>/g)];
  const chosen=all.find(m=>attr(m[0],'state')!=='hidden'&&attr(m[0],'state')!=='veryHidden');
  if(!chosen)fail('no visible worksheet');
  const relation=attr(chosen[0],'r:id');if(!relation)fail('worksheet relationship missing');
  const rel=[...rels.matchAll(/<(?:[\w-]+:)?Relationship\s[^>]*\/?\s*>/g)]
    .find(m=>attr(m[0],'Id')===relation);
  if(!rel||!/\/worksheet$/.test(attr(rel[0],'Type')||''))fail('worksheet relationship invalid');
  const dest=attr(rel[0],'Target');if(!dest||!safePath(dest.startsWith('/')?dest.slice(1):dest)||/^(?:https?:|\/\/)/i.test(dest))fail('unsafe worksheet reference');
  const resolved=dest.startsWith('/')?dest.slice(1):'xl/'+dest;
  if(!safePath(resolved)||!resolved.startsWith('xl/worksheets/'))fail('unsupported worksheet path');
  return resolved;
}
function sheetCells(sheet,strings){
  const rows=[];let previous=0,headerWidth=0;
  const rowTag=/<(?:[\w-]+:)?row\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?row\s*>/g;
  for(const m of sheet.matchAll(rowTag)){
    const rn=Number(attr(m[1],'r'));
    if(!Number.isInteger(rn)||rn<1||rn<=previous||rn>MAX_CSV_ROWS+1)fail('invalid or excessive worksheet rows');
    previous=rn;const cols=[],seen=new Set();
    const cellRe=/<(?:[\w-]+:)?c\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?c\s*>/g;
    for(const c of m[2].matchAll(cellRe)){
      const ref=attr(c[1],'r'),cm=/^([A-Z]{1,3})(\d+)$/.exec(ref||'');
      if(!cm||Number(cm[2])!==rn)fail('cell address missing or inconsistent');
      let col=0;for(const ch of cm[1])col=col*26+(ch.charCodeAt(0)-64);
      if(col<1||col>MAX_COLUMNS||seen.has(col))fail('excessive or duplicate worksheet columns');
      seen.add(col);
      if(/<(?:[\w-]+:)?f(?:\s|>)/i.test(c[2]))fail('formula cells not accepted; paste values and retry');
      const t=attr(c[1],'t')||'n';let val='';
      if(t==='inlineStr'){val=textRuns(childValue(c[2],'is')||'')}
      else {
        const v=childValue(c[2],'v');
        if(v!==null){val=xmlText(v);
          if(t==='s'){const idx=Number(val);if(!Number.isInteger(idx)||idx<0||idx>=strings.length)fail('shared string index invalid');val=strings[idx]}
          else if(t==='e')fail('Excel error cell not allowed');
          else if(t==='n'){const n=Number(val);if(Number.isSafeInteger(n)&&/^\d+(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(val))val=String(n)}
          else if(!['str','b','d'].includes(t))fail('unsupported Excel cell type');
        }
      }
      if(val.length>3000)fail('cell too long');cols[col-1]=val;
    }
    const width=cols.length;
    if(rn===1){headerWidth=width;if(!headerWidth)fail('header row is blank')}
    if(rn>1&&cols.some(v=>v!==undefined&&v!=='')){
      if(!headerWidth)fail('worksheet header missing');
      if(width>headerWidth)fail('data outside header columns');
    }
    while(rows.length<rn-1)rows.push([]);
    rows.push(cols);
  }
  if(!rows.length||!rows[0].length)fail('worksheet missing rows');
  while(rows.length&&rows.at(-1).every(v=>v===undefined||v===''))rows.pop();
  return rows;
}
function asCsv(rows){
  return rows.filter((row,i)=>i===0||row.some(v=>v!==undefined&&v!==''))
    .map(row=>{const width=rows[0].length;return Array.from({length:width},(_,i)=>{
      const s=String(row[i]??'');return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
    }).join(',')}).join('\n');
}
export async function parseLeadXlsx(bytes){
  const entries=zipIndex(bytes);
  const read=async(path,required=true)=>{
    const entry=entries.get(path);if(!entry){if(required)fail('missing '+path);return ''}
    return safeXml(await extract({bytes,view:new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)},entry),path)
  };
  const book=await read('xl/workbook.xml');
  const relationships=await read('xl/_rels/workbook.xml.rels');
  const sheetPath=firstSheetPath(book,relationships);
  const rawStrings=await read('xl/sharedStrings.xml',false);
  const strings=rawStrings?partsXml(rawStrings,'si').map(textRuns):[];
  const sheet=await read(sheetPath);
  const csv=asCsv(sheetCells(sheet,strings));
  try{return parseLeadCsv(csv)}catch(e){fail(e.message)}
}
export async function parseLeadXlsxBase64(raw){
  if(typeof raw!=='string'||raw.length>Math.ceil(MAX_XLSX_BYTES/3)*4||raw.length<24||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)||raw.length%4!==0)
    fail('invalid or oversized base64 data');
  let value;try{value=atob(raw)}catch{fail('invalid base64 data')}
  if(value.length>MAX_XLSX_BYTES)fail('XLSX exceeds 1 MB');
  const bytes=Uint8Array.from(value,c=>c.charCodeAt(0));
  return parseLeadXlsx(bytes);
}
