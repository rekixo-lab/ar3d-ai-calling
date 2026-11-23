// Read-only, aggregate per-company operations report.
// No customer PII, transcripts, phone numbers, provider tokens or billing claims.
// This route never schedules, starts, resumes or retries a call.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb} from './core.mjs';

const PATH='/v1/human/operations/report';
const HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(body,status=200)=>Response.json(body,{status,headers:HEADERS});
const fail=(error,status=400)=>json({error},status);
const WEEK_MS=7*86400000;
const id=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function totals(rows,allowed){
 if(!Array.isArray(rows)||rows.some(row=>!row||
    typeof row.state!=='string'||!allowed.includes(row.state)||
    !Number.isSafeInteger(Number(row.n))||Number(row.n)<0))
  throw Error('invalid operations summary');
 const result=Object.fromEntries(allowed.map(name=>[name,0]));
 for(const row of rows)result[row.state]+=Number(row.n);
 return result;
}
const JOB_STATES=['queued','reserved','submitted','completed','failed','blocked','unknown'];
const RUN_STATES=['running','paused','completed'];
const VISIT_STATES=['requested','confirmed','completed','cancelled'];

export async function handleOperationsReportRequest(req,env,user){
 const url=new URL(req.url);
 if(url.pathname!==PATH)return null;
 if(req.method!=='GET')return fail('method not allowed',405);
 const ids=url.searchParams.getAll('tenantId');
 if(ids.length!==1||!id.test(ids[0])||
    [...url.searchParams.keys()].some(k=>k!=='tenantId'))
  return fail('invalid report query');
 try{
  const member=await requireMembership(env.CONTROL_DB,user,ids[0],false);
  if(!member)return fail('forbidden',403);
  const db=resolveCrmDb(env,member),tid=member.tenant_id;
  const now=Date.now(),asOf=new Date(now).toISOString(),
    since=new Date(now-WEEK_MS).toISOString();
  const [customers,campaigns,visits,jobs,audit]=await Promise.all([
   db.prepare(`SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN consent_status='denied' OR dnd_status='blocked' THEN 1 ELSE 0 END),0) AS blocked
    FROM leads WHERE tenant_id=?`).bind(tid).first(),
   db.prepare(`SELECT state,COUNT(*) AS n FROM calling_runs
    WHERE tenant_id=? GROUP BY state`).bind(tid).all(),
   db.prepare(`SELECT status AS state,COUNT(*) AS n FROM site_visits
    WHERE tenant_id=? GROUP BY status`).bind(tid).all(),
   db.prepare(`SELECT state,COUNT(*) AS n FROM calling_jobs
    WHERE tenant_id=? GROUP BY state`).bind(tid).all(),
   db.prepare(`SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN action='lead.ai_test_auto_saved' THEN 1 ELSE 0 END),0) AS simulatedSaved,
    COALESCE(SUM(CASE WHEN action='lead.opted_out' THEN 1 ELSE 0 END),0) AS optOuts
    FROM crm_audit_events WHERE tenant_id=? AND created_at>=?`).bind(tid,since).first()
  ]);
  const number=value=>{
   const n=Number(value);
   if(!Number.isSafeInteger(n)||n<0)throw Error('invalid operations counter');
   return n;
  };
  const runs=totals(campaigns.results,RUN_STATES),
    v=totals(visits.results,VISIT_STATES),
    j=totals(jobs.results,JOB_STATES);
  // "unknown" and unfinished provider work always require human
  // reconciliation. Reporting NEVER changes the queue.
  return json({
   tenantId:tid,asOf,period:{from:since,to:asOf,days:7},
   customers:{total:number(customers?.total),blockedOrDenied:number(customers?.blocked)},
   campaigns:{...runs},
   visits:{...v},
   jobs:{...j},
   recentActivity:{auditEvents:number(audit?.total),
    simulatedCrmAutoSaves:number(audit?.simulatedSaved),optOutEvents:number(audit?.optOuts)},
   providerReview:{needsManualReconciliation:j.unknown>0,unknownJobs:j.unknown,
    inFlightJobs:j.reserved+j.submitted,
    notice:j.unknown>0?
     'Unknown provider outcome: operator must reconcile before any new call. No automatic retry.':
     'No unknown outcomes recorded. In-flight attempts still require verified provider completion.'},
   paidUsageVerified:false,customerCallsStartedByReport:0,crmWritesByReport:0,
   notice:'Read-only per-company CRM counts, not proof of delivered calls, provider minutes or charges.'
  });
 }catch(e){
  if(/not provisioned|not configured/i.test(String(e?.message||'')))
   return fail('CRM not provisioned',503);
  // Do not log customer data, SQL values, tokens, or full provider errors.
  console.error('AR3D operations report unavailable');
  return fail('operations report temporarily unavailable',503);
 }
}
