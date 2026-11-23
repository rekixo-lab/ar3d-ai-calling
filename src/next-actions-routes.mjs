// Bounded client "Next Actions" preview. Read-only; it never dials, submits
// WhatsApp/SMS, modifies consent, clears DND or creates call jobs.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb} from './core.mjs';

const PATH='/v1/human/next-actions';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-[a-f0-9]{12}$/i;
// Use the same precise, canonical tenant-ID format as the other human routes.
const TENANT=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(body,status=200)=>Response.json(body,{status,headers:HEADERS});
const fail=(message,status=400)=>json({error:message},status);

export async function handleNextActionsRequest(req,env,user,{now=Date.now()}={}){
 const url=new URL(req.url);
 if(url.pathname!==PATH)return null;
 if(req.method!=='GET')return fail('method not allowed',405);
 const keys=[...url.searchParams.keys()];
 if(keys.some(key=>!['tenantId','days'].includes(key)||
    url.searchParams.getAll(key).length!==1)||
    !TENANT.test(url.searchParams.get('tenantId')||'')||
    (url.searchParams.has('days')&&!['1','7','14','30'].includes(url.searchParams.get('days'))))
  return fail('invalid next-actions request');
 if(!Number.isSafeInteger(now)||now<0)return fail('invalid time');
 const tid=url.searchParams.get('tenantId');
 try{
  const member=await requireMembership(env.CONTROL_DB,user,tid,false);
  if(!member)return fail('forbidden',403);
  const db=resolveCrmDb(env,member),days=Number(url.searchParams.get('days')||7);
  const end=new Date(now+days*86400000).toISOString();
  const [followups,visits]=await Promise.all([
   db.prepare(
    'SELECT l.id AS leadId,l.name AS customer,l.followup_at AS dueAt,'+
    'l.interest_status AS interestStatus,l.consent_status AS consentStatus,l.dnd_status AS dndStatus,'+
    'EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id) AS optedOut '+
    'FROM leads l WHERE l.tenant_id=? AND l.followup_at IS NOT NULL AND l.followup_at<=? '+
    'ORDER BY l.followup_at ASC,l.id LIMIT 21'
   ).bind(tid,end).all(),
   db.prepare(
    'SELECT v.id AS visitId,v.lead_id AS leadId,l.name AS customer,'+
    'v.scheduled_at AS scheduledAt,v.status AS status '+
    'FROM site_visits v JOIN leads l ON l.tenant_id=v.tenant_id AND l.id=v.lead_id '+
    "WHERE v.tenant_id=? AND v.status IN('requested','confirmed') AND v.scheduled_at>=? AND v.scheduled_at<=? "+
    'ORDER BY v.scheduled_at ASC,v.id LIMIT 21'
   ).bind(tid,new Date(now-86400000).toISOString(),end).all()
  ]);
  const fs=followups.results,vs=visits.results;
  return json({
   tenantId:tid,days,asOf:new Date(now).toISOString(),
   followups:fs.slice(0,20).map(r=>({
    leadId:r.leadId,customer:r.customer,dueAt:r.dueAt,interestStatus:r.interestStatus,
    optedOut:Boolean(r.optedOut),canAutoDial:false,
    status:r.optedOut||r.consentStatus==='denied'||r.dndStatus==='blocked'?
     'do_not_call':'manual_followup_required'
   })),
   visits:vs.slice(0,20).map(r=>({
    leadId:r.leadId,visitId:r.visitId,customer:r.customer,
    scheduledAt:r.scheduledAt,status:r.status,reminderSent:false
   })),
   hasMoreFollowups:fs.length>20,hasMoreVisits:vs.length>20,
   automaticCallsScheduled:0,notificationsSent:0,
   notice:'In-app task list only. External calls and WhatsApp/SMS reminders are not enabled; staff must separately verify contact permission.'
  });
 }catch{
  console.error('AR3D next-actions read failed');
  return fail('next actions temporarily unavailable',503);
 }
}
