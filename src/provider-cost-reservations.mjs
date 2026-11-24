// Explicit, operator-reviewed conservative money envelopes, not live cash
// balances or verified tariffs. All values use integer millionths of currency.
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
function number(raw,min,max){return typeof raw==='string'&&/^\d{1,12}$/.test(raw)&&int(Number(raw),min,max)?Number(raw):null;}
export function moneyBudgetConfig(env){
 const config={};
 for(const provider of ['plivo','sarvam']){
  const p='AR3D_'+provider.toUpperCase()+'_';
  const currency=env?.[p+'BUDGET_CURRENCY'],capMicros=number(env?.[p+'BUDGET_CEILING_MICROS'],0,999999999999),pulseMicros=number(env?.[p+'BUDGET_PULSE_MICROS'],1,1000000000);
  if(!['INR','USD'].includes(currency)||capMicros===null||pulseMicros===null)return null;
  config[provider]={currency,capMicros,pulseMicros};
 }
 return config;
}
// Keep the full reservation until exact per-call expense evidence is linked.
// No-submission releases it; reconciliation replaces each provider's reserve
// with its evidenced amount, including overruns and explicit zero amounts.
const statsSql=`SELECT COALESCE(SUM(CASE WHEN h.state<>'released' THEN COALESCE(p.actual_micros,r.plivo_micros) ELSE 0 END),0) AS plivo,
 COALESCE(SUM(CASE WHEN h.state<>'released' THEN COALESCE(s.actual_micros,r.sarvam_micros) ELSE 0 END),0) AS sarvam,
 COALESCE(SUM(CASE WHEN r.plivo_currency<>? OR r.sarvam_currency<>? THEN 1 ELSE 0 END),0) AS mismatch
 FROM provider_cost_reservations r JOIN tenant_minute_holds h ON h.tenant_id=r.tenant_id AND h.job_id=r.job_id
 LEFT JOIN provider_cost_reconciliations p ON p.tenant_id=r.tenant_id AND p.job_id=r.job_id AND p.provider='plivo'
 LEFT JOIN provider_cost_reconciliations s ON s.tenant_id=r.tenant_id AND s.job_id=r.job_id AND s.provider='sarvam'`;
const legacySql="SELECT COUNT(*) AS n FROM tenant_minute_holds h WHERE h.state='held' AND NOT EXISTS(SELECT 1 FROM provider_cost_reservations r WHERE r.tenant_id=h.tenant_id AND r.job_id=h.job_id)";
export async function providerBudgetPosition(db,config){
 if(!config)return {configured:false,ready:false,remainingSeconds:0,reason:'reviewed_money_budgets_missing',accounts:[]};
 const [r,legacy]=await Promise.all([db.prepare(statsSql).bind(config.plivo.currency,config.sarvam.currency).first(),db.prepare(legacySql).first()]);
 const valid=int(r.plivo,0,Number.MAX_SAFE_INTEGER)&&int(r.sarvam,0,Number.MAX_SAFE_INTEGER)&&r.mismatch===0&&legacy.n===0;
 const accounts=['plivo','sarvam'].map(provider=>{const c=config[provider],committedMicros=valid?r[provider]:null,remainingMicros=valid?Math.max(0,c.capMicros-committedMicros):null;
  return {provider,...c,committedMicros,remainingMicros,low:remainingMicros===null?null:remainingMicros<=Math.floor(c.capMicros/5)};});
 const remainingSeconds=valid?Math.min(...accounts.map(a=>Math.floor(a.remainingMicros/a.pulseMicros)*30),999999999999):0;
 return {configured:true,ready:valid&&remainingSeconds>=30,remainingSeconds,reason:!valid?'legacy_hold_or_currency_review':remainingSeconds<30?'money_budget_exhausted':null,accounts};
}
export async function reserveBudgetedMinutes(db,{tenantId,job,maxSeconds,now=Date.now(),globalCap,config}){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(tenantId||'')||!/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(job||'')||!int(maxSeconds,30,600)||maxSeconds%30||!int(globalCap,0,999999999999)||!config)throw Error('invalid budget reservation');
 for(const p of ['plivo','sarvam'])if(!['INR','USD'].includes(config[p]?.currency)||!int(config[p]?.capMicros,0,999999999999)||!int(config[p]?.pulseMicros,1,1000000000))throw Error('invalid budget configuration');
 const p=config.plivo,s=config.sarvam,pm=maxSeconds/30*p.pulseMicros,sm=maxSeconds/30*s.pulseMicros;
 // SQLite serializes the predicates and the AFTER INSERT trigger. Either
 // both money reservations and the client hold exist, or none do.
 const out=await db.prepare(`INSERT INTO provider_cost_reservations(tenant_id,job_id,reserved_seconds,plivo_currency,plivo_micros,sarvam_currency,sarvam_micros,created_at)
 SELECT id,?,?,?,?,?,?,? FROM tenants WHERE id=? AND status='active'
 AND NOT EXISTS(SELECT 1 FROM tenant_minute_holds WHERE tenant_id=? AND job_id=?)
 AND COALESCE((SELECT balance_seconds FROM tenant_minute_ledger WHERE tenant_id=tenants.id ORDER BY sequence DESC LIMIT 1),0)>=?+
 COALESCE((SELECT SUM(CASE WHEN state='held' THEN reserved_seconds ELSE charged_seconds END) FROM tenant_minute_holds WHERE tenant_id=tenants.id),0)
 AND ?>=?+COALESCE((SELECT SUM(CASE WHEN state='held' THEN reserved_seconds ELSE charged_seconds END) FROM tenant_minute_holds),0)
 AND NOT EXISTS(SELECT 1 FROM tenant_minute_holds h WHERE h.state='held' AND NOT EXISTS(SELECT 1 FROM provider_cost_reservations r WHERE r.tenant_id=h.tenant_id AND r.job_id=h.job_id))
 AND NOT EXISTS(SELECT 1 FROM provider_safety_events e WHERE kind='blocked' AND sequence=(SELECT MAX(sequence) FROM provider_safety_events WHERE provider=e.provider))
 AND NOT EXISTS(SELECT 1 FROM provider_cost_reservations WHERE plivo_currency<>? OR sarvam_currency<>?)
 AND ?>=?+COALESCE((SELECT SUM(COALESCE(c.actual_micros,r.plivo_micros)) FROM provider_cost_reservations r JOIN tenant_minute_holds h ON h.tenant_id=r.tenant_id AND h.job_id=r.job_id LEFT JOIN provider_cost_reconciliations c ON c.tenant_id=r.tenant_id AND c.job_id=r.job_id AND c.provider='plivo' WHERE h.state<>'released'),0)
 AND ?>=?+COALESCE((SELECT SUM(COALESCE(c.actual_micros,r.sarvam_micros)) FROM provider_cost_reservations r JOIN tenant_minute_holds h ON h.tenant_id=r.tenant_id AND h.job_id=r.job_id LEFT JOIN provider_cost_reconciliations c ON c.tenant_id=r.tenant_id AND c.job_id=r.job_id AND c.provider='sarvam' WHERE h.state<>'released'),0)`)
 .bind(job,maxSeconds,p.currency,pm,s.currency,sm,new Date(now).toISOString(),tenantId,tenantId,job,maxSeconds,globalCap,maxSeconds,p.currency,s.currency,p.capMicros,pm,s.capMicros,sm).run();
 return out.meta.changes===1?{ok:true,replayed:false,state:'held'}:{ok:false,replayed:false,state:'insufficient_or_unavailable'};
}
