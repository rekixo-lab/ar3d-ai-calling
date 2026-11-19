// Small, dependency-free RFC4180 CSV parser for controlled CRM imports.
// It intentionally does NOT treat an Excel spreadsheet as proof of call consent.
import {normalizeIndianPhone} from './core.mjs';

export const MAX_CSV_BYTES=160000;
export const MAX_CSV_ROWS=200;
const HEADERS=Object.freeze({
  name:['name','customer name','client name','full name','customer'],
  mobile:['mobile','mobile number','phone','phone number','contact','contact number','number','whatsapp number'],
  location:['location','preferred location','interested location','project location','area'],
  budgetMin:['budget min','min budget','minimum budget','budget from'],
  budgetMax:['budget max','max budget','maximum budget','budget','budget to'],
  requirement:['requirements','requirement','notes','customer requirement','plot requirement'],
  customerSegment:['customer segment','customer type','lead type','contact type','customer category'],
  plotSize:['plot size','preferred plot size','plot size preference','size requirement','area requirement'],
  visitDate:['visit date preference','preferred visit date','visit date'],
});
function normalizeHeader(s){return String(s).trim().toLowerCase().replace(/[\s_-]+/g,' ')}
function csvCells(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_CSV_BYTES)
    throw Error('CSV file too large (maximum 160 KB)');
  const source=text.replace(/^\uFEFF/,'');
  if(!source.trim())throw Error('CSV file is empty');
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(quoted){
      if(ch==='"'){
        if(source[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}
      }else cell+=ch;
    }else if(ch==='"'){
      if(closed||cell.trim())throw Error('Malformed CSV: misplaced quote');
      quoted=true;
    }else if(ch===','){
      row.push(cell.trim());cell='';closed=false;
    }else if(ch==='\n'||ch==='\r'){
      row.push(cell.trim());cell='';closed=false;
      if(row.some(v=>v!==''))rows.push(row);
      row=[];
      if(ch==='\r'&&source[i+1]==='\n')i++;
    }else{
      if(closed&&!/\s/.test(ch))throw Error('Malformed CSV: content after quote');
      if(!closed)cell+=ch;
    }
    if(cell.length>3000)throw Error('CSV cell too long');
    if(rows.length>MAX_CSV_ROWS+1)throw Error('Too many CSV rows (maximum 200)');
  }
  if(quoted)throw Error('Malformed CSV: unclosed quote');
  row.push(cell.trim());
  if(row.some(v=>v!==''))rows.push(row);
  if(rows.length<2)throw Error('CSV must have a header and at least one customer');
  if(rows.length>MAX_CSV_ROWS+1)throw Error('Too many CSV rows (maximum 200)');
  if(rows[0].length>24)throw Error('Too many columns');
  return rows;
}
function money(raw){
  if(!raw)return null;
  const cleaned=String(raw).replace(/[₹,\s]/g,'');
  if(!/^\d{1,13}$/.test(cleaned))throw Error('Budget must be a whole INR amount (example: 1500000)');
  const value=Number(cleaned);
  if(!Number.isSafeInteger(value)||value>1000000000000)throw Error('Budget out of range');
  return value;
}
function parseSegment(raw,line){
  const s=String(raw||'').trim().toLowerCase().replace(/[\s_-]+/g,' ');
  if(!s||['unclassified','unspecified','not sure'].includes(s))return 'unclassified';
  if(['prior inquiry','previous inquiry','existing','known','old customer','existing customer'].includes(s))return 'prior_inquiry';
  if(['unknown contact','unknown','new','new customer','cold lead'].includes(s))return 'unknown_contact';
  throw Error('CSV row '+line+': invalid customer type');
}
function parseVisitDate(raw,line){
  if(!raw)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))throw Error('CSV row '+line+': visit preference must be YYYY-MM-DD');
  const d=new Date(raw+'T00:00:00.000Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==raw)
    throw Error('CSV row '+line+': invalid visit preference date');
  return raw;
}
export function parseLeadCsv(csv){
  const rows=csvCells(csv),head=rows.shift().map(normalizeHeader);
  const positions={};
  for(const [field,aliases] of Object.entries(HEADERS)){
    const found=head.map((v,i)=>aliases.includes(v)?i:-1).filter(i=>i!==-1);
    if(found.length>1)throw Error('Duplicate CSV header for '+field);
    positions[field]=found[0]??-1;
  }
  if(positions.mobile<0)throw Error('Missing Mobile Number column');
  const seen=new Set();const parsed=[];
  for(let i=0;i<rows.length;i++){
    const cells=rows[i],line=i+2;
    if(cells.length!==head.length)throw Error('CSV row '+line+': column count mismatch');
    const get=f=>positions[f]<0?'':String(cells[positions[f]]||'').trim();
    let mobile;
    try{mobile=normalizeIndianPhone(get('mobile'))}catch{throw Error('CSV row '+line+': invalid mobile number')}
    if(seen.has(mobile))throw Error('CSV row '+line+': repeated mobile number within file');
    seen.add(mobile);
    const name=get('name'),location=get('location'),requirement=get('requirement');
    const plotSize=get('plotSize'),customerSegment=parseSegment(get('customerSegment'),line);
    const visitDatePreference=parseVisitDate(get('visitDate'),line);
    if(plotSize.length>120||/[\u0000-\u001f]/u.test(plotSize))
      throw Error('CSV row '+line+': invalid plot size');
    if(name.length>120||location.length>160||requirement.length>1000)
      throw Error('CSV row '+line+': text field too long');
    let min,max;
    try{min=money(get('budgetMin'));max=money(get('budgetMax'))}
    catch(e){throw Error('CSV row '+line+': '+e.message)}
    if(min!==null&&max!==null&&min>max)throw Error('CSV row '+line+': minimum budget exceeds maximum');
    parsed.push({name,mobile,location:location||null,budgetMinInr:min,budgetMaxInr:max,requirement:requirement||null,customerSegment,plotSizePreference:plotSize||null,visitDatePreference});
  }
  return parsed;
}
