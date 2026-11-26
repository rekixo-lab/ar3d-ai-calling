import {FUNDING_CONTEXT} from './funding-context.mjs';
import {fundingCap,providerFundingCaps} from './minute-holds.mjs';
import {moneyBudgetConfig,providerBudgetPosition} from './provider-cost-reservations.mjs';
import {MANUAL_CALLING_COSTS} from './manual-calling-costs.mjs';

const MAX=999999999999;
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const attach=(env,value)=>({...env,[FUNDING_CONTEXT]:value});
const closed=(source,status,settings=null)=>({source,status,settings,globalCap:null,config:null,
 caps:{combined:null,plivo:null,sarvam:null},automaticProviderSync:false});
export const fundingNotice='Copy each provider dashboard’s full current available INR balance and Sync. Each sync replaces that provider’s earlier balance; it does not add a recharge twice. Calls share this balance and estimates update automatically. No Worker variable edit or deployment is needed. Provider balances and account restrictions remain authoritative.';

export function publicFundingSettings(row){
 return row?{mode:row.mode,plivoCurrency:row.plivo_currency,plivoPulseMicros:row.plivo_pulse_micros,
  sarvamPulseMicros:row.sarvam_pulse_micros,revision:row.revision,evidenceRef:row.evidence_ref,updatedAt:row.updated_at}:null;
}
export function validFundingSettings(d){
 return d&&Object.keys(d).sort().join(',')==='evidenceRef,expectedRevision,mode,plivoCurrency,plivoPulseMicros,sarvamPulseMicros'&&
  ['journal','disabled'].includes(d.mode)&&['INR','USD'].includes(d.plivoCurrency)&&
  int(d.plivoPulseMicros,1,1000000000)&&int(d.sarvamPulseMicros,1,1000000000)&&
  int(d.expectedRevision,0,2147483646)&&typeof d.evidenceRef==='string'&&
  d.evidenceRef.trim().length>=10&&d.evidenceRef.length<=160&&!/[\u0000-\u001f\u007f]/u.test(d.evidenceRef);
}

// Compare-and-set the entire reviewed policy and write its audit in one D1
// transaction. A stale tab cannot restore a disabled policy or older tariff.
export async function saveFundingSettings(db,d,actor,now=Date.now()){
 if(!validFundingSettings(d)||typeof actor!=='string'||!int(now,0,8640000000000000))throw Error('invalid funding settings');
 const at=new Date(now).toISOString(),revision=d.expectedRevision+1;
 const values=[d.mode,d.plivoCurrency,d.plivoPulseMicros,d.sarvamPulseMicros,revision,d.evidenceRef.trim(),actor,at];
 const statement=d.expectedRevision===0?
  db.prepare(`INSERT INTO calling_funding_settings(id,mode,plivo_currency,plivo_pulse_micros,sarvam_currency,sarvam_pulse_micros,revision,evidence_ref,updated_by,updated_at)
   SELECT 1,?,?,?,'INR',?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM calling_funding_settings WHERE id=1)`).bind(...values):
  db.prepare(`UPDATE calling_funding_settings SET mode=?,plivo_currency=?,plivo_pulse_micros=?,sarvam_pulse_micros=?,revision=?,evidence_ref=?,updated_by=?,updated_at=?
   WHERE id=1 AND revision=?`).bind(...values,d.expectedRevision);
 const results=await db.batch([statement,
  db.prepare(`INSERT INTO tenant_audit_events(id,actor,action,target_id,detail_json,created_at)
   SELECT ?,?,'funding.settings_changed','provider-funding',?,? WHERE changes()=1`)
   .bind(crypto.randomUUID(),actor,JSON.stringify({mode:d.mode,revision,plivoCurrency:d.plivoCurrency,
    plivoPulseMicros:d.plivoPulseMicros,sarvamPulseMicros:d.sarvamPulseMicros,evidenceRef:d.evidenceRef.trim()}),at)
 ]);
 return results[0].meta.changes===1;
}

// All credits come from the existing immutable, receipt-deduplicated provider
// journal. Unattributed expenses lower the envelope. Attributed expenses are
// deducted by providerBudgetPosition instead, exactly once. Never infer a
// recharge from a successful AI request or from a balance-only observation.
export async function resolveFundingEnv(env){
 if(env?.[FUNDING_CONTEXT])return env;
 let row;
 try{row=env.CONTROL_DB?await env.CONTROL_DB.prepare(`SELECT f.*,m.enabled AS manualEnabled,m.revision AS manualRevision,
  m.updated_at AS manualUpdatedAt FROM (SELECT 1) seed
  LEFT JOIN calling_funding_settings f ON f.id=1 LEFT JOIN provider_manual_funding_control m ON m.id=1`).first():null;}
 catch{return attach(env,closed('unavailable','funding_settings_unavailable'));}
 if(row?.manualRevision!=null)return resolveManualFunding(env,row);
 if(!row?.id){
  const globalCap=fundingCap(env),config=moneyBudgetConfig(env);
  return attach(env,{source:'legacy_environment',status:globalCap!==null&&config?'configured':'setup_required',
   settings:null,globalCap,config,caps:providerFundingCaps(env),automaticProviderSync:false});
 }
 const settings=publicFundingSettings(row);
 if(row.mode==='disabled')return attach(env,closed('disabled','disabled',settings));
 if(row.mode!=='journal'||!['USD','INR'].includes(row.plivo_currency)||row.sarvam_currency!=='INR'||
    !int(row.plivo_pulse_micros,1,1000000000)||!int(row.sarvam_pulse_micros,1,1000000000)||!int(row.revision,1,2147483647))
  return attach(env,closed('recorded_provider_ledger','settings_review_required',settings));
 try{
  const amounts=await env.CONTROL_DB.prepare(`SELECT
   COALESCE((SELECT MAX(sequence) FROM provider_financial_journal),0) AS journalSequence,
   COALESCE(SUM(CASE WHEN j.provider='plivo' AND j.currency=? THEN CASE WHEN j.kind<>'expense' THEN j.amount_micros WHEN r.journal_id IS NULL THEN -j.amount_micros ELSE 0 END ELSE 0 END),0) AS plivo,
   COALESCE(SUM(CASE WHEN j.provider='sarvam' AND j.currency='INR' THEN CASE WHEN j.kind<>'expense' THEN j.amount_micros WHEN r.journal_id IS NULL THEN -j.amount_micros ELSE 0 END ELSE 0 END),0) AS sarvam,
   COUNT(CASE WHEN j.provider='plivo' AND j.currency=? THEN 1 END) AS plivoEntries,
   COUNT(CASE WHEN j.provider='sarvam' AND j.currency='INR' THEN 1 END) AS sarvamEntries,
   COUNT(CASE WHEN (j.provider='plivo' AND j.currency<>?) OR (j.provider='sarvam' AND j.currency<>'INR') THEN 1 END) AS currencyMismatch,
   COALESCE((SELECT SUM(CASE WHEN state='held' THEN reserved_seconds ELSE charged_seconds END) FROM tenant_minute_holds),0) AS committedSeconds
   FROM provider_financial_journal j LEFT JOIN provider_cost_reconciliations r ON r.journal_id=j.id`)
   .bind(row.plivo_currency,row.plivo_currency,row.plivo_currency).first();
  if(!amounts||!int(amounts.journalSequence,0,Number.MAX_SAFE_INTEGER)||
     !int(amounts.plivo,-MAX,MAX)||!int(amounts.sarvam,-MAX,MAX)||!int(amounts.committedSeconds,0,MAX)||amounts.currencyMismatch!==0)
   return attach(env,closed('recorded_provider_ledger','currency_or_amount_review_required',settings));
  if(!amounts.plivoEntries||!amounts.sarvamEntries)
   return attach(env,closed('recorded_provider_ledger','provider_funding_records_required',settings));
  const config={plivo:{currency:row.plivo_currency,capMicros:Math.max(0,amounts.plivo),pulseMicros:row.plivo_pulse_micros},
   sarvam:{currency:'INR',capMicros:Math.max(0,amounts.sarvam),pulseMicros:row.sarvam_pulse_micros},
   fundingGuard:{revision:row.revision,journalSequence:amounts.journalSequence}};
  const money=await providerBudgetPosition(env.CONTROL_DB,config);
  // Time capacity is derived from the remaining money, including existing
  // time commitments. It is not a second manually replenished lifetime cap.
  const globalCap=Math.min(MAX,amounts.committedSeconds+money.remainingSeconds);
  return attach(env,{source:'recorded_provider_ledger',status:money.ready?'ready':money.reason,
   settings,globalCap,config,caps:{combined:globalCap,plivo:globalCap,sarvam:globalCap},automaticProviderSync:false});
 }catch{return attach(env,closed('recorded_provider_ledger','funding_records_unavailable',settings));}
}
export const resolvedFunding=env=>env?.[FUNDING_CONTEXT]??null;

async function resolveManualFunding(env,row){
 const rates=MANUAL_CALLING_COSTS;
 const settings={mode:'manual_balance',revision:row.manualRevision,enabled:row.manualEnabled===1,
  updatedAt:row.manualUpdatedAt,plivoCurrency:'INR',plivoPulseMicros:rates.plivoPulseMicros,
  sarvamPulseMicros:rates.sarvamPulseMicros,rateVersion:rates.version,estimatedRates:true};
 if(row.manualEnabled!==1)return attach(env,closed('manual_balance','disabled',settings));
 try{
  const snapshot=await env.CONTROL_DB.prepare(`SELECT
   (SELECT sequence FROM provider_balance_snapshots WHERE provider='plivo' ORDER BY sequence DESC LIMIT 1) AS plivoSequence,
   (SELECT balance_micros FROM provider_balance_snapshots WHERE provider='plivo' ORDER BY sequence DESC LIMIT 1) AS plivo,
   (SELECT sequence FROM provider_balance_snapshots WHERE provider='sarvam' ORDER BY sequence DESC LIMIT 1) AS sarvamSequence,
   (SELECT balance_micros FROM provider_balance_snapshots WHERE provider='sarvam' ORDER BY sequence DESC LIMIT 1) AS sarvam,
   COALESCE((SELECT SUM(CASE WHEN state='held' THEN reserved_seconds ELSE charged_seconds END) FROM tenant_minute_holds),0) AS committedSeconds`).first();
  if(!snapshot?.plivoSequence||!snapshot?.sarvamSequence)
   return attach(env,closed('manual_balance','provider_balance_sync_required',settings));
  if(!int(snapshot.plivo,0,MAX)||!int(snapshot.sarvam,0,MAX)||!int(snapshot.committedSeconds,0,MAX))
   return attach(env,closed('manual_balance','balance_review_required',settings));
  const config={plivo:{currency:'INR',capMicros:snapshot.plivo,pulseMicros:rates.plivoPulseMicros},
   sarvam:{currency:'INR',capMicros:snapshot.sarvam,pulseMicros:rates.sarvamPulseMicros},
   fundingGuard:{kind:'manual_balance',revision:row.manualRevision,plivoSequence:snapshot.plivoSequence,sarvamSequence:snapshot.sarvamSequence}};
  const money=await providerBudgetPosition(env.CONTROL_DB,config);
  const globalCap=Math.min(MAX,snapshot.committedSeconds+money.remainingSeconds);
  return attach(env,{source:'manual_balance',status:money.ready?'ready':money.reason,settings,config,globalCap,
   caps:{combined:globalCap,plivo:globalCap,sarvam:globalCap},automaticProviderSync:false,estimatedRates:true,rateVersion:rates.version});
 }catch{return attach(env,closed('manual_balance','funding_records_unavailable',settings));}
}
