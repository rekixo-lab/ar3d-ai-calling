// Explicit, operator-reviewed conservative money envelopes, not live cash
// balances or verified tariffs. All values use integer millionths of currency.
import {FUNDING_CONTEXT} from './funding-context.mjs';
import {MANUAL_CALLING_COSTS} from './manual-calling-costs.mjs';
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
function number(raw,min,max){return typeof raw==='string'&&/^\d{1,12}$/.test(raw)&&int(Number(raw),min,max)?Number(raw):null;}
export function moneyBudgetConfig(env){
 if(env?.[FUNDING_CONTEXT])return env[FUNDING_CONTEXT].config;
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
// In manual mode an observation supersedes only the specific settled calls
// covered by it. Uncertain calls remain reserved. Estimated usage is separate
// from the immutable, evidenced reconciliation journal and never fabricates
// a provider invoice or converts the Plivo CDR's unverified currency.
function manualCostRows(config){
 const g=config.fundingGuard,rates=MANUAL_CALLING_COSTS;
 const doc="CASE WHEN json_valid(q.survey_json) THEN q.survey_json ELSE '{}' END";
 const value=k=>`json_extract(${doc},'$.phoneMeta.${k}')`;
 const known=k=>`json_type(${doc},'$.phoneMeta.${k}')='integer' AND ${value(k)} BETWEEN 0 AND 1000000000`;
 const metered=`q.hangup_at IS NOT NULL AND q.phase IN('completed','declined','ended','needs_review') AND
  ${value('engine')}='sarvam' AND ${value('costMeterVersion')}=1 AND
  ${['sttRoundedSeconds','sttFailedRequests','sttDurationUnknown','llmRequests','llmInputTokens','llmOutputTokens','llmUsageUnknown'].map(known).join(' AND ')}
  AND ${value('sttFailedRequests')}=0 AND ${value('sttDurationUnknown')}=0 AND ${value('llmUsageUnknown')}=0
  AND COALESCE(${value('technicalFailure')},0)=0`;
 const aiCost=`((((${value('sttRoundedSeconds')}*${rates.sttMinuteMicros}+59)/60+
  ${value('llmInputTokens')}*${rates.llmInputTokenMicros}+${value('llmOutputTokens')}*${rates.llmOutputTokenMicros})*${rates.taxNumerator}+${rates.taxDenominator-1})/${rates.taxDenominator})`;
 return {sql:`SELECT h.state,
  CASE WHEN h.state='released' OR pc.snapshot_sequence IS NOT NULL THEN 0 ELSE
   COALESCE(p.actual_micros,CASE WHEN h.state='settled' AND r.plivo_currency='INR'
    THEN (r.plivo_micros*h.charged_seconds+r.reserved_seconds-1)/r.reserved_seconds ELSE r.plivo_micros END) END AS plivo,
  CASE WHEN h.state='released' OR sc.snapshot_sequence IS NOT NULL THEN 0 ELSE
   COALESCE(s.actual_micros,CASE WHEN h.state='settled' AND r.sarvam_currency='INR' AND ${metered}
    THEN ${aiCost} ELSE r.sarvam_micros END) END AS sarvam,
  CASE WHEN h.state<>'released' AND ((pc.snapshot_sequence IS NULL AND r.plivo_currency<>'INR') OR
   (sc.snapshot_sequence IS NULL AND r.sarvam_currency<>'INR')) THEN 1 ELSE 0 END AS mismatch
  FROM provider_cost_reservations r JOIN tenant_minute_holds h ON h.tenant_id=r.tenant_id AND h.job_id=r.job_id
  LEFT JOIN provider_cost_reconciliations p ON p.tenant_id=r.tenant_id AND p.job_id=r.job_id AND p.provider='plivo'
  LEFT JOIN provider_cost_reconciliations s ON s.tenant_id=r.tenant_id AND s.job_id=r.job_id AND s.provider='sarvam'
  LEFT JOIN scripted_phone_pilots q ON q.tenant_id=r.tenant_id AND q.job_id=r.job_id
  LEFT JOIN provider_balance_covered_calls pc ON pc.tenant_id=r.tenant_id AND pc.job_id=r.job_id AND pc.provider='plivo' AND pc.snapshot_sequence<=?
  LEFT JOIN provider_balance_covered_calls sc ON sc.tenant_id=r.tenant_id AND sc.job_id=r.job_id AND sc.provider='sarvam' AND sc.snapshot_sequence<=?`,
  values:[g.plivoSequence,g.sarvamSequence]};
}
export async function providerBudgetPosition(db,config){
 if(!config)return {configured:false,ready:false,remainingSeconds:0,reason:'reviewed_money_budgets_missing',accounts:[]};
 const manual=config.fundingGuard?.kind==='manual_balance',rows=manual?manualCostRows(config):null;
 const stats=manual?db.prepare(`WITH cost_rows AS (${rows.sql}) SELECT
  COALESCE(SUM(plivo),0) AS plivo,COALESCE(SUM(sarvam),0) AS sarvam,COALESCE(SUM(mismatch),0) AS mismatch,
  COALESCE(SUM(CASE WHEN state='held' THEN plivo ELSE 0 END),0) AS plivoHeld,
  COALESCE(SUM(CASE WHEN state='held' THEN sarvam ELSE 0 END),0) AS sarvamHeld FROM cost_rows`).bind(...rows.values):
  db.prepare(statsSql).bind(config.plivo.currency,config.sarvam.currency);
 const [r,legacy]=await Promise.all([stats.first(),db.prepare(legacySql).first()]);
 const valid=int(r.plivo,0,Number.MAX_SAFE_INTEGER)&&int(r.sarvam,0,Number.MAX_SAFE_INTEGER)&&r.mismatch===0&&legacy.n===0;
 const accounts=['plivo','sarvam'].map(provider=>{const c=config[provider],committedMicros=valid?r[provider]:null,remainingMicros=valid?Math.max(0,c.capMicros-committedMicros):null;
  return {provider,...c,committedMicros,remainingMicros,...(manual?{heldMicros:valid?r[provider+'Held']:null,usedMicros:valid?committedMicros-r[provider+'Held']:null,estimated:true}:{}),low:remainingMicros===null?null:remainingMicros<=Math.floor(c.capMicros/5)};});
 const remainingSeconds=valid?Math.min(...accounts.map(a=>Math.floor(a.remainingMicros/a.pulseMicros)*30),999999999999):0;
 return {configured:true,ready:valid&&remainingSeconds>=30,remainingSeconds,reason:!valid?'legacy_hold_or_currency_review':remainingSeconds<30?'money_budget_exhausted':null,accounts};
}
export async function reserveBudgetedMinutes(db,{tenantId,job,maxSeconds,now=Date.now(),globalCap,config}){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(tenantId||'')||!/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(job||'')||!int(maxSeconds,30,600)||maxSeconds%30||!int(globalCap,0,999999999999)||!config)throw Error('invalid budget reservation');
 for(const p of ['plivo','sarvam'])if(!['INR','USD'].includes(config[p]?.currency)||!int(config[p]?.capMicros,0,999999999999)||!int(config[p]?.pulseMicros,1,1000000000))throw Error('invalid budget configuration');
 const p=config.plivo,s=config.sarvam,pm=maxSeconds/30*p.pulseMicros,sm=maxSeconds/30*s.pulseMicros;
 const guard=config.fundingGuard;
 const manual=guard?.kind==='manual_balance';
 if(guard&&(!int(guard.revision,1,2147483647)||(manual?
  !int(guard.plivoSequence,1,Number.MAX_SAFE_INTEGER)||!int(guard.sarvamSequence,1,Number.MAX_SAFE_INTEGER):
  !int(guard.journalSequence,0,Number.MAX_SAFE_INTEGER))))throw Error('invalid funding revision');
 const guardSql=manual?`EXISTS(SELECT 1 FROM provider_manual_funding_control WHERE id=1 AND enabled=1 AND revision=?)
  AND (SELECT MAX(sequence) FROM provider_balance_snapshots WHERE provider='plivo')=?
  AND (SELECT MAX(sequence) FROM provider_balance_snapshots WHERE provider='sarvam')=?`:
  guard?`NOT EXISTS(SELECT 1 FROM provider_manual_funding_control WHERE id=1) AND EXISTS(SELECT 1 FROM calling_funding_settings WHERE id=1 AND mode='journal' AND revision=?)
  AND COALESCE((SELECT MAX(sequence) FROM provider_financial_journal),0)=?`:
  'NOT EXISTS(SELECT 1 FROM calling_funding_settings WHERE id=1) AND NOT EXISTS(SELECT 1 FROM provider_manual_funding_control WHERE id=1)';
 const rows=manual?manualCostRows(config):null;
 const guardValues=manual?[guard.revision,guard.plivoSequence,guard.sarvamSequence]:guard?[guard.revision,guard.journalSequence]:[];
 const costCondition=manual?`NOT EXISTS(SELECT 1 FROM cost_rows WHERE mismatch<>0)
  AND ?>=?+COALESCE((SELECT SUM(plivo) FROM cost_rows),0)
  AND ?>=?+COALESCE((SELECT SUM(sarvam) FROM cost_rows),0)`:
  `NOT EXISTS(SELECT 1 FROM provider_cost_reservations WHERE plivo_currency<>? OR sarvam_currency<>?)
 AND ?>=?+COALESCE((SELECT SUM(COALESCE(c.actual_micros,r.plivo_micros)) FROM provider_cost_reservations r JOIN tenant_minute_holds h ON h.tenant_id=r.tenant_id AND h.job_id=r.job_id LEFT JOIN provider_cost_reconciliations c ON c.tenant_id=r.tenant_id AND c.job_id=r.job_id AND c.provider='plivo' WHERE h.state<>'released'),0)
 AND ?>=?+COALESCE((SELECT SUM(COALESCE(c.actual_micros,r.sarvam_micros)) FROM provider_cost_reservations r JOIN tenant_minute_holds h ON h.tenant_id=r.tenant_id AND h.job_id=r.job_id LEFT JOIN provider_cost_reconciliations c ON c.tenant_id=r.tenant_id AND c.job_id=r.job_id AND c.provider='sarvam' WHERE h.state<>'released'),0)`;
 // SQLite serializes the predicates and the AFTER INSERT trigger. Either
 // both money reservations and the client hold exist, or none do.
 const out=await db.prepare(`${manual?`WITH cost_rows AS (${rows.sql}) `:''}INSERT INTO provider_cost_reservations(tenant_id,job_id,reserved_seconds,plivo_currency,plivo_micros,sarvam_currency,sarvam_micros,created_at)
 SELECT id,?,?,?,?,?,?,? FROM tenants WHERE id=? AND status='active' AND ${guardSql}
 AND NOT EXISTS(SELECT 1 FROM tenant_minute_holds WHERE tenant_id=? AND job_id=?)
 AND COALESCE((SELECT balance_seconds FROM tenant_minute_ledger WHERE tenant_id=tenants.id ORDER BY sequence DESC LIMIT 1),0)>=?+
 COALESCE((SELECT SUM(CASE WHEN state='held' THEN reserved_seconds ELSE charged_seconds END) FROM tenant_minute_holds WHERE tenant_id=tenants.id),0)
 AND ?>=?+COALESCE((SELECT SUM(CASE WHEN state='held' THEN reserved_seconds ELSE charged_seconds END) FROM tenant_minute_holds),0)
 AND NOT EXISTS(SELECT 1 FROM tenant_minute_holds h WHERE h.state='held' AND NOT EXISTS(SELECT 1 FROM provider_cost_reservations r WHERE r.tenant_id=h.tenant_id AND r.job_id=h.job_id))
 AND NOT EXISTS(SELECT 1 FROM provider_safety_events e WHERE kind='blocked' AND sequence=(SELECT MAX(sequence) FROM provider_safety_events WHERE provider=e.provider))
 AND ${costCondition} RETURNING tenant_id,job_id,reserved_seconds`)
 .bind(...(manual?rows.values:[]),job,maxSeconds,p.currency,pm,s.currency,sm,new Date(now).toISOString(),tenantId,...guardValues,tenantId,job,maxSeconds,globalCap,maxSeconds,...(manual?[]:[p.currency,s.currency]),p.capMicros,pm,s.capMicros,sm).first();
 // D1 meta.changes includes the AFTER INSERT trigger's minute-hold row. Use
 // this statement's returned identity, so a successful two-row write is not
 // mistaken for a rejected reservation. A replay returns no row and cannot dial.
 return out?.tenant_id===tenantId&&out.job_id===job&&out.reserved_seconds===maxSeconds?
  {ok:true,replayed:false,state:'held'}:{ok:false,replayed:false,state:'insufficient_or_unavailable'};
}
