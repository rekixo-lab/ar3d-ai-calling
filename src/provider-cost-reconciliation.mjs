// Manual attribution of exact per-call provider expense evidence. Never
// infer charges from estimated metering, aggregate invoices or account spend.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const jobId=/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
export function validReconciliation(d){
 return d&&Object.keys(d).sort().join(',')==='evidenceRef,jobId,provider,tenantId,zeroCost'&&uuid.test(d.tenantId||'')&&jobId.test(d.jobId||'')&&['plivo','sarvam'].includes(d.provider)&&typeof d.zeroCost==='boolean'&&typeof d.evidenceRef==='string'&&/^[A-Za-z0-9][A-Za-z0-9 ._:/-]{3,119}$/.test(d.evidenceRef);
}
export async function reconcileProviderCost(db,d,actor,now=Date.now()){
 if(!validReconciliation(d)||typeof actor!=='string'||!actor)throw Error('invalid reconciliation');
 const lookup=()=>db.prepare('SELECT currency,actual_micros AS actualMicros,evidence_ref AS evidenceRef,actor FROM provider_cost_reconciliations WHERE tenant_id=? AND job_id=? AND provider=?').bind(d.tenantId,d.jobId,d.provider).first();
 const replay=r=>r&&r.evidenceRef===d.evidenceRef&&r.actor===actor&&(r.actualMicros===0)===d.zeroCost?{ok:true,replayed:true,actualMicros:r.actualMicros,currency:r.currency}:{ok:false};
 const prior=await lookup();if(prior)return replay(prior);
 // All predicates and the over-reserve safety event are atomic. A positive
 // expense must already exist once in the immutable provider journal.
 const result=await db.prepare(`INSERT INTO provider_cost_reconciliations(tenant_id,job_id,provider,currency,actual_micros,journal_id,evidence_ref,actor,created_at)
 SELECT r.tenant_id,r.job_id,?,CASE ? WHEN 'plivo' THEN r.plivo_currency ELSE r.sarvam_currency END,
 CASE WHEN ?=1 THEN 0 ELSE j.amount_micros END,CASE WHEN ?=1 THEN NULL ELSE j.id END,?,?,?
 FROM provider_cost_reservations r JOIN tenant_minute_holds h ON h.tenant_id=r.tenant_id AND h.job_id=r.job_id
 LEFT JOIN provider_financial_journal j ON j.provider=? AND j.evidence_ref=? COLLATE BINARY
 WHERE r.tenant_id=? AND r.job_id=? AND h.state='settled'
 AND ((?=1 AND NOT EXISTS(SELECT 1 FROM provider_financial_journal z WHERE z.provider=? AND z.evidence_ref=? COLLATE NOCASE))
 OR (?=0 AND j.kind='expense' AND j.currency=CASE ? WHEN 'plivo' THEN r.plivo_currency ELSE r.sarvam_currency END))
 AND NOT EXISTS(SELECT 1 FROM provider_cost_reconciliations x WHERE (x.tenant_id=r.tenant_id AND x.job_id=r.job_id AND x.provider=?) OR (x.provider=? AND x.evidence_ref=? COLLATE NOCASE) OR (j.id IS NOT NULL AND x.journal_id=j.id))`)
 .bind(d.provider,d.provider,Number(d.zeroCost),Number(d.zeroCost),d.evidenceRef,actor,new Date(now).toISOString(),d.provider,d.evidenceRef,d.tenantId,d.jobId,Number(d.zeroCost),d.provider,d.evidenceRef,Number(d.zeroCost),d.provider,d.provider,d.provider,d.evidenceRef).run();
 const saved=await lookup();
 if(result.meta.changes!==1)return replay(saved);
 return {ok:true,replayed:false,actualMicros:saved.actualMicros,currency:saved.currency};
}
export async function providerCostRows(db,tid,offset){
 const rows=(await db.prepare(`SELECT r.job_id AS jobId,r.created_at AS createdAt,r.reserved_seconds AS reservedSeconds,h.state,
 r.plivo_currency AS plivoCurrency,r.plivo_micros AS plivoReserved,p.actual_micros AS plivoActual,p.evidence_ref AS plivoEvidence,
 r.sarvam_currency AS sarvamCurrency,r.sarvam_micros AS sarvamReserved,s.actual_micros AS sarvamActual,s.evidence_ref AS sarvamEvidence
 FROM provider_cost_reservations r JOIN tenant_minute_holds h ON h.tenant_id=r.tenant_id AND h.job_id=r.job_id
 LEFT JOIN provider_cost_reconciliations p ON p.tenant_id=r.tenant_id AND p.job_id=r.job_id AND p.provider='plivo'
 LEFT JOIN provider_cost_reconciliations s ON s.tenant_id=r.tenant_id AND s.job_id=r.job_id AND s.provider='sarvam'
 WHERE r.tenant_id=? ORDER BY r.created_at DESC,r.job_id LIMIT 51 OFFSET ?`).bind(tid,offset).all()).results;
 const totals=(await db.prepare(`SELECT provider,currency,SUM(actual_micros) AS actualMicros,COUNT(*) AS entries FROM provider_cost_reconciliations WHERE tenant_id=? GROUP BY provider,currency`).bind(tid).all()).results;
 return {rows:rows.slice(0,50),hasMore:rows.length>50,offset,totals,source:'operator_reviewed_per_call_evidence',clientDebits:0,providerRequests:0};
}
