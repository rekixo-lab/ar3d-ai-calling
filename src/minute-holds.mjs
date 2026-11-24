// Internal primitives used by gated campaign dispatch and matched CDR settlement.
// A caller must independently establish provider funding and dispatch permission.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const jobId=/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
function identity(tenantId,job){if(!uuid.test(tenantId||'')||!jobId.test(job||''))throw Error('invalid hold identity')}
export async function minutePosition(db,tenantId){
 if(!uuid.test(tenantId||''))throw Error('invalid tenant');
 const r=await db.prepare(`SELECT COALESCE((SELECT balance_seconds FROM tenant_minute_ledger WHERE tenant_id=? ORDER BY sequence DESC LIMIT 1),0) AS allocated,
 COALESCE(SUM(CASE WHEN state='held' THEN reserved_seconds ELSE 0 END),0) AS held,
 COALESCE(SUM(CASE WHEN state='settled' THEN charged_seconds ELSE 0 END),0) AS used FROM tenant_minute_holds WHERE tenant_id=?`).bind(tenantId,tenantId).first();
 return {allocatedSeconds:r.allocated,heldSeconds:r.held,usedSeconds:r.used,uncommittedSeconds:r.allocated-r.held-r.used};
}
async function find(db,tenantId,job){return db.prepare('SELECT * FROM tenant_minute_holds WHERE tenant_id=? AND job_id=?').bind(tenantId,job).first()}
export async function reserveMinutes(db,{tenantId,job,maxSeconds,now=Date.now()}){
 identity(tenantId,job);if(!integer(maxSeconds,1,86400))throw Error('invalid duration');
 const seconds=Math.ceil(maxSeconds/30)*30;
 const old=await find(db,tenantId,job);
 if(old)return {ok:old.state==='held'&&old.reserved_seconds===seconds,replayed:true,state:old.state};
 const r=await db.prepare(`INSERT INTO tenant_minute_holds(tenant_id,job_id,reserved_seconds,created_at)
 SELECT id,?,?,? FROM tenants WHERE id=? AND status='active'
 AND NOT EXISTS(SELECT 1 FROM tenant_minute_holds WHERE tenant_id=? AND job_id=?)
 AND COALESCE((SELECT balance_seconds FROM tenant_minute_ledger WHERE tenant_id=? ORDER BY sequence DESC LIMIT 1),0)>=?+
 COALESCE((SELECT SUM(CASE WHEN state='held' THEN reserved_seconds ELSE charged_seconds END) FROM tenant_minute_holds WHERE tenant_id=?),0)`)
 .bind(job,seconds,new Date(now).toISOString(),tenantId,tenantId,job,tenantId,seconds,tenantId).run();
 if(r.meta.changes===1)return {ok:true,replayed:false,state:'held'};
 const current=await find(db,tenantId,job);
 return current?{ok:current.state==='held'&&current.reserved_seconds===seconds,replayed:true,state:current.state}:{ok:false,replayed:false,state:'insufficient_or_unavailable'};
}
// Evidence must be validated by the provider reconciliation adapter.
// Uncertain submission, absent CDR, or charge beyond reserve must stay held.
export async function closeMinuteHold(db,{tenantId,job,billedSeconds,evidenceRef,kind,now=Date.now()}){
 identity(tenantId,job);
 if(!['verified_cdr','verified_no_submission'].includes(kind)||!integer(billedSeconds,0,86400)||billedSeconds%30!==0||
 (kind==='verified_no_submission'&&billedSeconds!==0)||typeof evidenceRef!=='string'||!evidenceRef.trim()||evidenceRef.length>160||/[\u0000-\u001f]/u.test(evidenceRef))throw Error('invalid settlement evidence');
 const state=kind==='verified_cdr'?'settled':'released';
 const old=await find(db,tenantId,job);
 const matches=x=>x?.state===state&&x.charged_seconds===billedSeconds&&x.evidence_ref===evidenceRef;
 if(!old)return {ok:false,state:'missing_hold'};
 if(old.state!=='held')return {ok:matches(old),replayed:true,state:old.state};
 if(billedSeconds>old.reserved_seconds)return {ok:false,state:'over_reserve_review'};
 const r=await db.prepare("UPDATE tenant_minute_holds SET state=?,charged_seconds=?,evidence_ref=?,closed_at=? WHERE tenant_id=? AND job_id=? AND state='held' AND reserved_seconds>=?")
 .bind(state,billedSeconds,evidenceRef,new Date(now).toISOString(),tenantId,job,billedSeconds).run();
 if(r.meta.changes===1)return {ok:true,replayed:false,state};
 const current=await find(db,tenantId,job);return {ok:matches(current),replayed:true,state:current?.state||'missing_hold'};
}
