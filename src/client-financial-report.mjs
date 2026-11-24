// Read-only point-in-time financial position. Never infer tax, FX, refunds
// or earned accounting revenue from externally confirmed collections.
// FIFO paid-value allocation is available only for an unmixed purchase ledger.
export async function clientFinancialReport(db,{tenantId=null,offset=0}={}){
 const data=(await db.prepare(`WITH selected AS (
 SELECT id,display_name,status FROM tenants WHERE (? IS NULL OR id=?) ORDER BY id LIMIT 51 OFFSET ?
 ), purchases AS (
 SELECT p.tenant_id,SUM(p.paid_paise) AS paidPaise,SUM(p.purchased_seconds) AS purchasedSeconds,COUNT(*) AS purchases,
 SUM(CASE WHEN l.id IS NULL OR l.delta_seconds<>p.purchased_seconds OR l.kind<>'allocation' THEN 1 ELSE 0 END) AS brokenPurchases
 FROM tenant_credit_purchases p JOIN selected t ON t.id=p.tenant_id
 LEFT JOIN tenant_minute_ledger l ON l.id='purchase:'||p.id AND l.tenant_id=p.tenant_id GROUP BY p.tenant_id
 ), adjustments AS (
 SELECT l.tenant_id,SUM(CASE WHEN p.id IS NULL THEN 1 ELSE 0 END) AS otherAdjustments,
 SUM(CASE WHEN l.id LIKE 'call-reversal:%' THEN l.delta_seconds ELSE 0 END) AS reversedSeconds
 FROM tenant_minute_ledger l JOIN selected t ON t.id=l.tenant_id
 LEFT JOIN tenant_credit_purchases p ON l.id='purchase:'||p.id AND l.tenant_id=p.tenant_id GROUP BY l.tenant_id
 ), holds AS (
 SELECT h.tenant_id,SUM(CASE WHEN h.state='held' THEN h.reserved_seconds ELSE 0 END) AS heldSeconds,
 SUM(CASE WHEN h.state='settled' THEN h.charged_seconds ELSE 0 END) AS usedSeconds,
 SUM(CASE WHEN h.state='settled' THEN 1 ELSE 0 END) AS settledCalls,
 SUM(CASE WHEN h.state='settled' AND (p.job_id IS NULL OR s.job_id IS NULL) THEN 1 ELSE 0 END) AS incompleteCostCalls
 FROM tenant_minute_holds h JOIN selected t ON t.id=h.tenant_id
 LEFT JOIN provider_cost_reconciliations p ON p.tenant_id=h.tenant_id AND p.job_id=h.job_id AND p.provider='plivo'
 LEFT JOIN provider_cost_reconciliations s ON s.tenant_id=h.tenant_id AND s.job_id=h.job_id AND s.provider='sarvam'
 GROUP BY h.tenant_id
 ), lots AS (
 SELECT p.tenant_id,p.paid_paise,p.purchased_seconds,
 COALESCE(SUM(p.purchased_seconds) OVER(PARTITION BY p.tenant_id ORDER BY p.sequence ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS priorSeconds
 FROM tenant_credit_purchases p JOIN selected t ON t.id=p.tenant_id
 ), value AS (
 SELECT l.tenant_id,SUM(l.paid_paise*MIN(l.purchased_seconds,MAX(0,COALESCE(h.usedSeconds,0)-l.priorSeconds))/l.purchased_seconds) AS usedValuePaise
 FROM lots l LEFT JOIN holds h ON h.tenant_id=l.tenant_id GROUP BY l.tenant_id
 ), costs AS (
 SELECT r.tenant_id,
 SUM(CASE WHEN r.provider='plivo' AND r.currency='INR' THEN r.actual_micros ELSE 0 END) AS plivoInrMicros,
 SUM(CASE WHEN r.provider='plivo' AND r.currency='USD' THEN r.actual_micros ELSE 0 END) AS plivoUsdMicros,
 SUM(CASE WHEN r.provider='sarvam' AND r.currency='INR' THEN r.actual_micros ELSE 0 END) AS sarvamInrMicros,
 SUM(CASE WHEN r.provider='sarvam' AND r.currency='USD' THEN r.actual_micros ELSE 0 END) AS sarvamUsdMicros,
 COUNT(*) AS expenseEntries
 FROM provider_cost_reconciliations r JOIN selected t ON t.id=r.tenant_id GROUP BY r.tenant_id
 ) SELECT t.id AS tenantId,t.display_name AS company,t.status,
 COALESCE((SELECT balance_seconds FROM tenant_minute_ledger l WHERE l.tenant_id=t.id ORDER BY sequence DESC LIMIT 1),0) AS allocatedSeconds,
 COALESCE(p.paidPaise,0) AS paidPaise,COALESCE(p.purchasedSeconds,0) AS purchasedSeconds,COALESCE(p.purchases,0) AS purchases,
 COALESCE(p.brokenPurchases,0) AS brokenPurchases,COALESCE(a.otherAdjustments,0) AS otherAdjustments,COALESCE(a.reversedSeconds,0) AS reversedSeconds,
 COALESCE(h.heldSeconds,0) AS heldSeconds,COALESCE(h.usedSeconds,0) AS usedSeconds,COALESCE(h.settledCalls,0) AS settledCalls,COALESCE(h.incompleteCostCalls,0) AS incompleteCostCalls,
 COALESCE(v.usedValuePaise,0) AS usedValuePaise,
 COALESCE(c.plivoInrMicros,0) AS plivoInrMicros,COALESCE(c.plivoUsdMicros,0) AS plivoUsdMicros,
 COALESCE(c.sarvamInrMicros,0) AS sarvamInrMicros,COALESCE(c.sarvamUsdMicros,0) AS sarvamUsdMicros,COALESCE(c.expenseEntries,0) AS expenseEntries
 FROM selected t LEFT JOIN purchases p ON p.tenant_id=t.id LEFT JOIN adjustments a ON a.tenant_id=t.id
 LEFT JOIN holds h ON h.tenant_id=t.id LEFT JOIN value v ON v.tenant_id=t.id LEFT JOIN costs c ON c.tenant_id=t.id ORDER BY t.id`).bind(tenantId,tenantId,offset).all()).results;
 const rows=data.slice(0,50).map(r=>{
  if(Object.values(r).some(v=>typeof v==='number'&&(!Number.isSafeInteger(v)||v<0)))throw Error('financial totals require review');
  const outstandingSeconds=r.allocatedSeconds-r.usedSeconds,uncommittedSeconds=outstandingSeconds-r.heldSeconds,netUsedSeconds=r.usedSeconds-r.reversedSeconds;
  if(Math.min(outstandingSeconds,uncommittedSeconds,netUsedSeconds)<0)throw Error('financial position inconsistent');
  const clean=r.otherAdjustments===0&&r.brokenPurchases===0&&r.allocatedSeconds===r.purchasedSeconds&&r.usedValuePaise<=r.paidPaise;
  const paidValueUsedPaise=clean?r.usedValuePaise:null,remainingPrepaidValuePaise=clean?r.paidPaise-r.usedValuePaise:null;
  const providerCostsComplete=r.incompleteCostCalls===0&&r.expenseEntries===2*r.settledCalls;
  const inrCosts=r.plivoInrMicros+r.sarvamInrMicros;
  const comparable=clean&&providerCostsComplete&&r.plivoUsdMicros===0&&r.sarvamUsdMicros===0&&Number.isSafeInteger(inrCosts)&&Number.isSafeInteger(paidValueUsedPaise*10000);
  // Integer micros, no silent FX conversion or premature rounding of expense.
  // This is only a before-tax, before-overhead service contribution indicator.
  const contributionMicros=comparable?paidValueUsedPaise*10000-inrCosts:null;
  return {...r,usedValuePaise:undefined,outstandingSeconds,uncommittedSeconds,netUsedSeconds,paidValueUsedPaise,remainingPrepaidValuePaise,providerCostsComplete,contributionMicros,
   valueStatus:clean?'fifo_paid_value_only':'mixed_adjustments_require_review',
   contributionStatus:!clean?'mixed_adjustments_require_review':!providerCostsComplete?'incomplete_provider_evidence':r.plivoUsdMicros||r.sarvamUsdMicros?'verified_fx_required':!comparable?'numeric_review_required':'indicative_before_tax_overhead'};
 });
 return {rows,offset,hasMore:data.length>50,asOf:new Date().toISOString(),basis:'cumulative_recorded_transactions',profitVerified:false,recognizedRevenuePaise:null,providerRequests:0};
}
