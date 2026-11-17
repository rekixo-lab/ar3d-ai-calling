// Human-session CRM endpoints. Every query derives tenant scope from membership,
// not from the URL alone. Calling is deliberately not implemented here.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb,parseJsonBody} from './core.mjs';
import {MAX_CSV_BYTES,parseLeadCsv} from './csv-import.mjs';
import {MAX_XLSX_BYTES,parseLeadXlsxBase64} from './xlsx-import.mjs';

const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(o,status=200)=>Response.json(o,{status,headers});
const fail=(msg,status=400)=>json({error:msg},status);
const now=()=>new Date().toISOString();
const idOk=s=>typeof s==='string'&&/^[0-9a-f-]{36}$/i.test(s);
const statuses=['new','contacted','interested','followup','not_interested','converted'];
async function payload(req,max=16384){
  // Bound HTTP body *before* JSON parsing, including chunked uploads.
  if(Number(req.headers.get('content-length'))>max)return Promise.reject(Error('request body too large'));
  if(!req.body)return parseJsonBody('',max);
  const reader=req.body.getReader();const dec=new TextDecoder('utf-8',{fatal:true});
  let text='',bytes=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;
      if(bytes>max){await reader.cancel();throw Error('request body too large')}
      text+=dec.decode(value,{stream:true});
    }
    text+=dec.decode();
  }finally{reader.releaseLock()}
  return parseJsonBody(text,max);
}
function dateTime(value,label='Date'){
  if(value===null||value==='')return null;
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.\d{1,3})?)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)||!Number.isFinite(Date.parse(value)))
    throw Error('invalid '+label+' (ISO datetime with timezone required)');
  return new Date(value).toISOString();
}
function budget(v){if(v===null||v==='')return null;if(!Number.isSafeInteger(v)||v<0||v>1000000000000)throw Error('invalid budget');return v}
function text(v,label,max=2000){if(typeof v!=='string'||v.trim().length<1||v.trim().length>max)throw Error('invalid '+label);return v.trim()}
async function resolve(env,user,tenantId,write=false){
  const t=await requireMembership(env.CONTROL_DB,user,tenantId,write);
  if(!t)return null;
  return {tenant:t,db:resolveCrmDb(env,t),tid:t.tenant_id};
}
export async function handleCrmRequest(req,env,user){
  const u=new URL(req.url),path=u.pathname,method=req.method;
  if(!path.startsWith('/v1/human/'))return null;
  const importMatch=path==='/v1/human/import/preview'||path==='/v1/human/import/commit';
  const leadMatch=path.match(/^\/v1\/human\/leads\/([0-9a-f-]{36})$/i);
  if(!importMatch&&!leadMatch&&!['/v1/human/leads','/v1/human/visits','/v1/human/notes'].includes(path))return null;
  if(!env.CONTROL_DB)return fail('control database unavailable',503);
  try{
    if(importMatch&&method==='POST'){
      // Limit applies to JSON envelope and CSV. Reject before parsing the file.
      const d=await payload(req,Math.ceil(MAX_XLSX_BYTES/3)*4+4096);
      const access=await resolve(env,user,d.tenantId,true);
      if(!access)return fail('forbidden',403);
      const isXlsx=d.format==='xlsx';
      if(d.format!==undefined&&!['csv','xlsx'].includes(d.format))return fail('Unsupported import format');
      if(isXlsx&&typeof d.xlsxBase64!=='string')return fail('XLSX file data required');
      if(!isXlsx&&typeof d.csv!=='string')return fail('CSV text required');
      const rows=isXlsx?await parseLeadXlsxBase64(d.xlsxBase64):parseLeadCsv(d.csv),{db,tid}=access;
      if(path.endsWith('/preview'))return json({valid:true,rows:rows.length,preview:rows.slice(0,10),
        notice:'Import is NOT calling consent. Existing mobile numbers will be skipped, never overwritten.'});
      const stamp=now(),statements=rows.map(row=>db.prepare(`INSERT INTO leads
        (tenant_id,id,name,mobile_e164,source_type,consent_status,dnd_status,
         preferred_location,budget_min_inr,budget_max_inr,requirements_json,created_at,updated_at)
        VALUES(?,?,?,?,'excel','unknown','unknown',?,?,?,?,?,?)
        ON CONFLICT(tenant_id,mobile_e164) DO NOTHING`).bind(
          tid,crypto.randomUUID(),row.name,row.mobile,row.location,row.budgetMinInr,
          row.budgetMaxInr,JSON.stringify(row.requirement?{raw:row.requirement}:{}),stamp,stamp));
      // D1.batch is transactional: either the entire file succeeds or none is committed.
      statements.push(db.prepare(`INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)
        VALUES(?,?,'human:'||?,?,?)`).bind(tid,crypto.randomUUID(),user.id,isXlsx?'leads.xlsx_import':'leads.csv_import',String(rows.length),stamp));
      const result=await db.batch(statements);
      const inserted=result.slice(0,rows.length).reduce((total,r)=>total+Number(r.meta?.changes||0),0);
      return json({processed:rows.length,inserted,skipped:rows.length-inserted,
        notice:'Imported records have unknown consent and DND status. No calls were placed.'},201);
    }
    if(path==='/v1/human/leads'&&method==='GET'){
      const access=await resolve(env,user,u.searchParams.get('tenantId'));
      if(!access)return fail('forbidden',403);
      const status=u.searchParams.get('status')||'',search=(u.searchParams.get('q')||'').trim();
      if(status&&!statuses.includes(status))return fail('invalid status');
      if(search.length>80)return fail('search too long');
      const limit=Math.min(100,Math.max(1,Number(u.searchParams.get('limit')||50)||50));
      const offset=Number(u.searchParams.get('offset')||0);
      if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return fail('invalid offset');
      const where=[access.tid];let sql=' WHERE tenant_id=?';
      if(status){sql+=' AND interest_status=?';where.push(status)}
      if(search){sql+=" AND (name LIKE ? OR mobile_e164 LIKE ? OR preferred_location LIKE ?)";
        const pattern='%'+search.replace(/[\\%_]/g,'\\$&')+'%';sql=sql.replaceAll(' LIKE ?',' LIKE ? ESCAPE \'\\\'');where.push(pattern,pattern,pattern)}
      const [list,count]=await Promise.all([
        access.db.prepare(`SELECT id,name,mobile_e164 AS mobile,source_type AS sourceType,
          preferred_location AS preferredLocation,budget_min_inr AS budgetMinInr,
          budget_max_inr AS budgetMaxInr,interest_status AS interestStatus,followup_at AS followupAt,
          consent_status AS consentStatus,dnd_status AS dndStatus,updated_at AS updatedAt
          FROM leads ${sql} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`)
          .bind(...where,limit,offset).all(),
        access.db.prepare('SELECT COUNT(*) AS total FROM leads '+sql).bind(...where).first()
      ]);
      return json({leads:list.results,total:Number(count?.total||0),limit,offset});
    }
    if(leadMatch&&method==='PATCH'){
      const d=await payload(req),access=await resolve(env,user,d.tenantId,true);
      if(!access)return fail('forbidden',403);
      const keys=['interestStatus','preferredLocation','budgetMinInr','budgetMaxInr','followupAt'];
      if(!keys.some(k=>Object.hasOwn(d,k)))return fail('no updates supplied');
      if(Object.keys(d).some(k=>!['tenantId',...keys].includes(k)))return fail('invalid update field');
      const old=await access.db.prepare(`SELECT interest_status AS interestStatus,preferred_location AS preferredLocation,
        budget_min_inr AS budgetMinInr,budget_max_inr AS budgetMaxInr,followup_at AS followupAt
        FROM leads WHERE tenant_id=? AND id=?`).bind(access.tid,leadMatch[1]).first();
      if(!old)return fail('lead not found',404);
      const status=Object.hasOwn(d,'interestStatus')?d.interestStatus:old.interestStatus;
      if(!statuses.includes(status))return fail('invalid interest status');
      const location=Object.hasOwn(d,'preferredLocation')?d.preferredLocation:old.preferredLocation;
      if(location!==null&&(typeof location!=='string'||location.trim().length>160))return fail('invalid location');
      const min=budget(Object.hasOwn(d,'budgetMinInr')?d.budgetMinInr:old.budgetMinInr);
      const max=budget(Object.hasOwn(d,'budgetMaxInr')?d.budgetMaxInr:old.budgetMaxInr);
      if(min!==null&&max!==null&&min>max)return fail('invalid budget range');
      const followup=dateTime(Object.hasOwn(d,'followupAt')?d.followupAt:old.followupAt,'followupAt');
      const timestamp=now();
      await access.db.batch([
        access.db.prepare(`UPDATE leads SET interest_status=?,preferred_location=?,budget_min_inr=?,
          budget_max_inr=?,followup_at=?,updated_at=? WHERE tenant_id=? AND id=?`).bind(status,location?.trim()||null,min,max,followup,timestamp,access.tid,leadMatch[1]),
        access.db.prepare(`INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)
          VALUES(?,?,'human:'||?,'lead.updated',?,?)`).bind(access.tid,crypto.randomUUID(),user.id,leadMatch[1],timestamp)
      ]);
      return json({ok:true});
    }
    if(path==='/v1/human/notes'&&method==='GET'){
      const leadId=u.searchParams.get('leadId');if(!idOk(leadId))return fail('invalid leadId');
      const access=await resolve(env,user,u.searchParams.get('tenantId'));
      if(!access)return fail('forbidden',403);
      const result=await access.db.prepare(`SELECT n.id,n.text,n.created_at AS createdAt,n.actor
        FROM lead_notes n JOIN leads l ON l.tenant_id=n.tenant_id AND l.id=n.lead_id
        WHERE n.tenant_id=? AND n.lead_id=? ORDER BY n.created_at DESC LIMIT 50`)
        .bind(access.tid,leadId).all();
      return json({notes:result.results});
    }
    if(path==='/v1/human/notes'&&method==='POST'){
      const d=await payload(req),access=await resolve(env,user,d.tenantId,true);
      if(!access)return fail('forbidden',403);
      if(!idOk(d.leadId))return fail('invalid leadId');
      const body=text(d.text,'note');
      const item=await access.db.prepare('SELECT id FROM leads WHERE tenant_id=? AND id=?').bind(access.tid,d.leadId).first();
      if(!item)return fail('lead not found',404);
      const id=crypto.randomUUID();
      await access.db.prepare(`INSERT INTO lead_notes(tenant_id,id,lead_id,text,actor,created_at)
        VALUES(?,?,?,?,?,?)`).bind(access.tid,id,d.leadId,body,user.id,now()).run();
      return json({id},201);
    }
    if(path==='/v1/human/visits'&&method==='GET'){
      const access=await resolve(env,user,u.searchParams.get('tenantId'));
      if(!access)return fail('forbidden',403);
      const list=await access.db.prepare(`SELECT v.id,v.lead_id AS leadId,l.name AS leadName,
        v.scheduled_at AS scheduledAt,v.status,v.note
        FROM site_visits v JOIN leads l ON l.tenant_id=v.tenant_id AND l.id=v.lead_id
        WHERE v.tenant_id=? ORDER BY v.scheduled_at ASC LIMIT 100`).bind(access.tid).all();
      return json({visits:list.results});
    }
    if(path==='/v1/human/visits'&&method==='POST'){
      const d=await payload(req),access=await resolve(env,user,d.tenantId,true);
      if(!access)return fail('forbidden',403);
      if(!idOk(d.leadId))return fail('invalid leadId');
      const at=dateTime(d.scheduledAt,'scheduledAt');
      if(!at||Date.parse(at)<Date.now()-60000)return fail('site visit must be scheduled for the future');
      const note=d.note===undefined||d.note===null?'':String(d.note).trim();
      if(note.length>1000)return fail('invalid visit note');
      const lead=await access.db.prepare('SELECT id FROM leads WHERE tenant_id=? AND id=?').bind(access.tid,d.leadId).first();
      if(!lead)return fail('lead not found',404);
      const id=crypto.randomUUID(),timestamp=now();
      await access.db.batch([
        access.db.prepare(`INSERT INTO site_visits(tenant_id,id,lead_id,scheduled_at,status,note,created_at)
          VALUES(?,?,?,?,'requested',?,?)`).bind(access.tid,id,d.leadId,at,note,timestamp),
        access.db.prepare(`INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)
          VALUES(?,?,'human:'||?,'visit.requested',?,?)`).bind(access.tid,crypto.randomUUID(),user.id,id,timestamp)
      ]);
      return json({id,status:'requested',scheduledAt:at},201);
    }
    return fail('method not allowed',405);
  }catch(e){
    const msg=String(e?.message||'');
    if(/invalid|CSV|XLSX|budget|quote|column|header|too many|too large|too long|file|row|content|update|no updates|Missing|Malformed|text|required|Date/i.test(msg))return fail(msg,400);
    if(/not provisioned|not configured|missing or invalid/i.test(msg))return fail('database not provisioned',503);
    console.error('AR3D CRM request failed',e);return fail('internal server error',500);
  }
}
