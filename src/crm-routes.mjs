// Human-session CRM endpoints. Every query derives tenant scope from membership,
// not from the URL alone. Calling is deliberately not implemented here.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb,parseJsonBody,sha256hex} from './core.mjs';
import {MAX_CSV_BYTES,parseLeadCsv} from './csv-import.mjs';
import {MAX_XLSX_BYTES,parseLeadXlsxBase64} from './xlsx-import.mjs';

const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(o,status=200)=>Response.json(o,{status,headers});
const fail=(msg,status=400)=>json({error:msg},status);
const now=()=>new Date().toISOString();
const idOk=s=>typeof s==='string'&&/^[0-9a-f-]{36}$/i.test(s);
const statuses=['new','contacted','interested','followup','not_interested','converted'];
const segments=['unclassified','prior_inquiry','unknown_contact'];
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
  if(value===null||value===undefined||value==='')return null;
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.\d{1,3})?)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)||!Number.isFinite(Date.parse(value)))
    throw Error('invalid '+label+' (ISO datetime with timezone required)');
  return new Date(value).toISOString();
}
function optionalPlotSize(value){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value!=='string'||value.trim().length>120||/[\u0000-\u001f]/u.test(value))
    throw Error('invalid plot size preference');
  return value.trim()||null;
}
function preferredVisitDate(value){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw Error('invalid visit date preference');
  const d=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)
    throw Error('invalid visit date preference');
  return value;
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
  const optOutMatch=path.match(/^\/v1\/human\/leads\/([0-9a-f-]{36})\/opt-out$/i);
  // Manual single-customer POST belongs to the authenticated addLead handler in
  // human-routes. Previously this router swallowed it with HTTP 405, so the
  // Client Dashboard's "Add customer" form could never work.
  if(path==='/v1/human/leads'&&method==='POST')return null;
  if(!importMatch&&!leadMatch&&!optOutMatch&&!['/v1/human/leads','/v1/human/visits','/v1/human/notes'].includes(path))return null;
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
      const campaign=d.campaign;
      if(campaign!==undefined&&(!campaign||typeof campaign!=='object'||Array.isArray(campaign)||
         Object.keys(campaign).some(key=>!['name','language','requestId'].includes(key))||
         typeof campaign.name!=='string'||!campaign.name.trim()||campaign.name.trim().length>80||
         /[\u0000-\u001f]/.test(campaign.name)||!['hi','en'].includes(campaign.language)||
         !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(campaign.requestId||'')||
         path.endsWith('/preview')))return fail('invalid import campaign');
      const mobiles=JSON.stringify(rows.map(row=>row.mobile));
      if(path.endsWith('/preview')){
        const found=await db.prepare(`SELECT mobile_e164 AS mobile FROM leads
          WHERE tenant_id=? AND mobile_e164 IN (SELECT value FROM json_each(?))`).bind(tid,mobiles).all();
        const existing=new Set(found.results.map(row=>row.mobile));
        return json({valid:true,rows:rows.length,existingCount:existing.size,
          wouldInsert:rows.length-existing.size,preview:rows.slice(0,10).map(row=>({
            ...row,alreadyInCrm:existing.has(row.mobile)
          })),notice:'Preview is advisory; concurrent CRM imports can change actual inserted count. Consent/DND remains unknown.'});
      }
      const stamp=now(),leadRows=rows.map(row=>({...row,id:crypto.randomUUID(),
        requirementsJson:JSON.stringify(row.requirement?{raw:row.requirement}:{})}));
      const chunks=[];for(let i=0;i<leadRows.length;i+=100)chunks.push(leadRows.slice(i,i+100));
      const statements=chunks.map(chunk=>db.prepare(`INSERT INTO leads
        (tenant_id,id,name,mobile_e164,source_type,consent_status,dnd_status,
         preferred_location,budget_min_inr,budget_max_inr,requirements_json,created_at,updated_at,
         customer_segment,plot_size_preference,visit_date_preference)
        SELECT ?,row.value->>'$.id',row.value->>'$.name',row.value->>'$.mobile','excel','unknown','unknown',
         row.value->>'$.location',row.value->>'$.budgetMinInr',row.value->>'$.budgetMaxInr',
         row.value->>'$.requirementsJson',?,?,row.value->>'$.customerSegment',row.value->>'$.plotSizePreference',
         row.value->>'$.visitDatePreference'
        FROM json_each(?) row WHERE 1
        ON CONFLICT(tenant_id,mobile_e164) DO NOTHING`).bind(tid,stamp,stamp,JSON.stringify(chunk)));
      // D1.batch is transactional: either the entire file succeeds or none is committed.
      statements.push(db.prepare(`INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)
        VALUES(?,?,'human:'||?,?,?,?)`).bind(tid,crypto.randomUUID(),user.id,isXlsx?'leads.xlsx_import':'leads.csv_import',String(rows.length),stamp));
      let campaignId;
      if(campaign){
        const hash=await sha256hex(JSON.stringify([tid,user.id,campaign.name.trim(),campaign.language,campaign.requestId,rows]));
        campaignId=hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-8'+hash.slice(17,20)+'-'+hash.slice(20,32);
        statements.push(
          db.prepare(`INSERT INTO call_campaign_drafts(tenant_id,id,name,language_mode,purpose,status,created_by,created_at,updated_at)
            VALUES(?,?,?,?,'property_information','draft',?,?,?) ON CONFLICT(tenant_id,id) DO NOTHING`)
            .bind(tid,campaignId,campaign.name.trim(),campaign.language,user.id,stamp,stamp),
          db.prepare(`INSERT OR IGNORE INTO call_campaign_candidates(tenant_id,campaign_id,lead_id,created_at)
            SELECT l.tenant_id,?,l.id,? FROM leads l WHERE l.tenant_id=? AND l.mobile_e164 IN (SELECT value FROM json_each(?))
            AND l.consent_status!='denied' AND l.dnd_status!='blocked'
            AND NOT EXISTS (SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id)
            AND NOT EXISTS (SELECT 1 FROM calling_runs r WHERE r.tenant_id=l.tenant_id AND r.campaign_id=?)`)
            .bind(campaignId,stamp,tid,mobiles,campaignId)
        );
      }
      const result=await db.batch(statements);
      const selected=campaignId?await db.prepare('SELECT COUNT(*) AS total FROM call_campaign_candidates WHERE tenant_id=? AND campaign_id=?')
        .bind(tid,campaignId).first():null;
      const inserted=result.slice(0,chunks.length).reduce((sum,row)=>sum+Number(row.meta?.changes||0),0);
      return json({processed:rows.length,inserted,skipped:rows.length-inserted,
        ...(campaignId?{campaignId,campaignCustomers:selected.total}:{}),
        notice:'Imported records have unknown consent and DND status. No calls were placed.'},201);
    }
    if(path==='/v1/human/leads'&&method==='GET'){
      const access=await resolve(env,user,u.searchParams.get('tenantId'));
      if(!access)return fail('forbidden',403);
      const status=u.searchParams.get('status')||'',segment=u.searchParams.get('segment')||'',
        search=(u.searchParams.get('q')||'').trim();
      if(segment&&!segments.includes(segment))return fail('invalid customer segment');
      if(status&&!statuses.includes(status))return fail('invalid status');
      if(search.length>80)return fail('search too long');
      const limit=Math.min(100,Math.max(1,Number(u.searchParams.get('limit')||50)||50));
      const offset=Number(u.searchParams.get('offset')||0);
      if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return fail('invalid offset');
      const where=[access.tid];let sql=' WHERE tenant_id=?';
      if(status){sql+=' AND interest_status=?';where.push(status)}
      if(segment){sql+=' AND customer_segment=?';where.push(segment)}
      if(search){sql+=" AND (name LIKE ? OR mobile_e164 LIKE ? OR preferred_location LIKE ?)";
        const pattern='%'+search.replace(/[\\%_]/g,'\\$&')+'%';sql=sql.replaceAll(' LIKE ?',' LIKE ? ESCAPE \'\\\'');where.push(pattern,pattern,pattern)}
      const [list,count]=await Promise.all([
        access.db.prepare(`SELECT id,name,mobile_e164 AS mobile,source_type AS sourceType,
          preferred_location AS preferredLocation,budget_min_inr AS budgetMinInr,
          budget_max_inr AS budgetMaxInr,interest_status AS interestStatus,followup_at AS followupAt,
          consent_status AS consentStatus,dnd_status AS dndStatus,updated_at AS updatedAt,
          customer_segment AS customerSegment,plot_size_preference AS plotSizePreference,
          visit_date_preference AS visitDatePreference
          FROM leads ${sql} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`)
          .bind(...where,limit,offset).all(),
        access.db.prepare('SELECT COUNT(*) AS total FROM leads '+sql).bind(...where).first()
      ]);
      return json({leads:list.results,total:Number(count?.total||0),limit,offset});
    }

    // The only exposed contact-preference mutation is a one-way opt-out.
    // Never turn this into consent-granting, dialing, or bulk-import behavior.
    if(optOutMatch&&method==='POST'){
      const d=await payload(req),access=await resolve(env,user,d.tenantId,true);
      if(!access)return fail('forbidden',403);
      if(Object.keys(d).some(k=>!['tenantId','source','reason'].includes(k)))return fail('invalid opt-out field');
      const source=d.source||'admin_action';
      if(!['customer_request','admin_action','other'].includes(source))return fail('invalid opt-out source');
      const reason=d.reason===undefined||d.reason===null?'':d.reason;
      if(typeof reason!=='string'||reason.length>500||/[\u0000-\u001f]/u.test(reason))
        return fail('invalid opt-out reason');
      const lead=await access.db.prepare('SELECT id,consent_status,dnd_status FROM leads WHERE tenant_id=? AND id=?')
        .bind(access.tid,optOutMatch[1]).first();
      if(!lead)return fail('lead not found',404);
      if(lead.consent_status==='denied'&&lead.dnd_status==='blocked')
        return json({ok:true,alreadyBlocked:true,consentStatus:'denied',dndStatus:'blocked'});
      const at=now(),eventId=crypto.randomUUID(),auditId=crypto.randomUUID();
      // D1.batch is transactional. Record the source and audit BEFORE the status
      // change; both inserts are conditional on the previous unblocked state.
      // The DB trigger prevents reverting a lead with an opt-out event.
      const result=await access.db.batch([
        access.db.prepare(`INSERT INTO lead_opt_out_events
          (tenant_id,id,lead_id,source,reason,actor,created_at)
          SELECT tenant_id,?,id,?,?,?,? FROM leads
          WHERE tenant_id=? AND id=? AND (consent_status!='denied' OR dnd_status!='blocked')`)
          .bind(eventId,source,reason.trim()||null,user.id,at,access.tid,optOutMatch[1]),
        access.db.prepare(`INSERT INTO crm_audit_events
          (tenant_id,id,actor,action,target_id,created_at)
          SELECT tenant_id,?,'human:'||?,'lead.opted_out',id,?
          FROM leads WHERE tenant_id=? AND id=?
          AND (consent_status!='denied' OR dnd_status!='blocked')`)
          .bind(auditId,user.id,at,access.tid,optOutMatch[1]),
        access.db.prepare(`UPDATE leads SET consent_status='denied',dnd_status='blocked',updated_at=?
          WHERE tenant_id=? AND id=?
          AND (consent_status!='denied' OR dnd_status!='blocked')`)
          .bind(at,access.tid,optOutMatch[1])
      ]);
      const changed=Number(result[2]?.meta?.changes||0);
      return json({ok:true,alreadyBlocked:changed===0,consentStatus:'denied',dndStatus:'blocked'});
    }
    if(optOutMatch&&method==='GET'){
      const access=await resolve(env,user,u.searchParams.get('tenantId'));
      if(!access)return fail('forbidden',403);
      const events=await access.db.prepare(`SELECT e.id,e.source,e.reason,e.created_at AS createdAt
        FROM lead_opt_out_events e JOIN leads l ON l.tenant_id=e.tenant_id AND l.id=e.lead_id
        WHERE e.tenant_id=? AND e.lead_id=? ORDER BY e.created_at DESC LIMIT 50`)
        .bind(access.tid,optOutMatch[1]).all();
      return json({events:events.results});
    }
    if(leadMatch&&method==='PATCH'){
      const d=await payload(req),access=await resolve(env,user,d.tenantId,true);
      if(!access)return fail('forbidden',403);
      const keys=['interestStatus','preferredLocation','budgetMinInr','budgetMaxInr','followupAt',
        'customerSegment','plotSizePreference','visitDatePreference'];
      if(!keys.some(k=>Object.hasOwn(d,k)))return fail('no updates supplied');
      if(Object.keys(d).some(k=>!['tenantId',...keys].includes(k)))return fail('invalid update field');
      const old=await access.db.prepare(`SELECT interest_status AS interestStatus,preferred_location AS preferredLocation,
        budget_min_inr AS budgetMinInr,budget_max_inr AS budgetMaxInr,followup_at AS followupAt,
        customer_segment AS customerSegment,plot_size_preference AS plotSizePreference,
        visit_date_preference AS visitDatePreference
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
      const segment=Object.hasOwn(d,'customerSegment')?d.customerSegment:(old.customerSegment||'unclassified');
      if(!segments.includes(segment))return fail('invalid customer segment');
      const plotSize=optionalPlotSize(Object.hasOwn(d,'plotSizePreference')?d.plotSizePreference:old.plotSizePreference);
      const visitPreference=preferredVisitDate(Object.hasOwn(d,'visitDatePreference')?d.visitDatePreference:old.visitDatePreference);
      const timestamp=now();
      await access.db.batch([
        access.db.prepare(`UPDATE leads SET interest_status=?,preferred_location=?,budget_min_inr=?,
          budget_max_inr=?,followup_at=?,customer_segment=?,plot_size_preference=?,
          visit_date_preference=?,updated_at=? WHERE tenant_id=? AND id=?`).bind(status,location?.trim()||null,min,max,followup,segment,plotSize,visitPreference,timestamp,access.tid,leadMatch[1]),
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
