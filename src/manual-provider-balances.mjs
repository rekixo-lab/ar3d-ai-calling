// Manual current-balance observations authorized by a current-MFA owner route.
// No provider request, payment, currency conversion or receipt is invented.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const fields='sequence,id,provider,currency,balance_micros AS balanceMicros,actor,created_at AS createdAt';
const controlFields='enabled,revision,updated_by AS updatedBy,updated_at AS updatedAt';
const publicControl=r=>r?{...r,enabled:r.enabled===1}:null;
const validActor=actor=>typeof actor==='string'&&actor.length>0&&actor.length<=160;
export function validManualBalanceSync(d){
 return d&&Object.keys(d).sort().join(',')==='balanceMicros,expectedRevision,id,provider'&&UUID.test(d.id||'')&&
  ['plivo','sarvam'].includes(d.provider)&&int(d.balanceMicros,0,999999999999)&&int(d.expectedRevision,0,Number.MAX_SAFE_INTEGER);
}
export async function readManualBalances(db){
 const [rows,control]=await Promise.all([
  db.prepare(`SELECT ${fields} FROM provider_balance_snapshots s
   WHERE sequence=(SELECT MAX(sequence) FROM provider_balance_snapshots WHERE provider=s.provider)`).all(),
  db.prepare(`SELECT ${controlFields} FROM provider_manual_funding_control WHERE id=1`).first()
 ]);
 return {plivo:rows.results.find(r=>r.provider==='plivo')??null,
  sarvam:rows.results.find(r=>r.provider==='sarvam')??null,control:publicControl(control)};
}
async function existing(db,id){
 return db.prepare(`SELECT ${fields},COALESCE((SELECT MAX(sequence) FROM provider_balance_snapshots
  WHERE provider=s.provider AND sequence<s.sequence),0) AS previousRevision
  FROM provider_balance_snapshots s WHERE id=?`).bind(id).first();
}
function replay(row,d,actor){
 return row&&row.id===d.id&&row.provider===d.provider&&row.currency==='INR'&&
  row.balanceMicros===d.balanceMicros&&row.actor===actor&&row.previousRevision===d.expectedRevision;
}
function snapshot(row){if(!row)return null;const {previousRevision,...value}=row;return value;}
export async function syncManualBalance(db,d,actor,now=Date.now()){
 if(!validManualBalanceSync(d)||!validActor(actor)||!int(now,0,253402300799999))throw Error('invalid manual balance sync');
 const old=await existing(db,d.id);
 if(old)return replay(old,d,actor)?{ok:true,replayed:true,snapshot:snapshot(old)}:{ok:false,replayed:false,reason:'conflicting_sync_id'};
 const at=new Date(now).toISOString(),eventId='manual-balance:'+d.id,auditId=crypto.randomUUID();
 const results=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO provider_balance_snapshots(id,provider,currency,balance_micros,actor,created_at)
   SELECT ?,?,'INR',?,?,? WHERE COALESCE((SELECT MAX(sequence) FROM provider_balance_snapshots WHERE provider=?),0)=?`)
   .bind(d.id,d.provider,d.balanceMicros,actor,at,d.provider,d.expectedRevision),
  // The per-invocation audit marker exists only when this transaction created
  // the observation. A concurrent request reusing an ID cannot re-run any of
  // its effects, even if that ID was inserted after the initial replay read.
  db.prepare(`INSERT INTO tenant_audit_events(id,actor,action,target_id,detail_json,created_at)
   SELECT ?,actor,'funding.balance_synced',provider,?,created_at FROM provider_balance_snapshots WHERE changes()=1 AND id=?`)
   .bind(auditId,JSON.stringify({source:'manual_provider_dashboard',currency:'INR',balanceMicros:d.balanceMicros,previousRevision:d.expectedRevision}),d.id),
  db.prepare(`INSERT OR IGNORE INTO provider_balance_covered_calls(provider,tenant_id,job_id,snapshot_sequence)
   SELECT s.provider,r.tenant_id,r.job_id,s.sequence FROM provider_balance_snapshots s
   CROSS JOIN provider_cost_reservations r JOIN tenant_minute_holds h ON h.tenant_id=r.tenant_id AND h.job_id=r.job_id
   WHERE EXISTS(SELECT 1 FROM tenant_audit_events WHERE id=?) AND s.id=? AND h.state='settled'
   AND h.closed_at<=strftime('%Y-%m-%dT%H:%M:%fZ',s.created_at,'-60 seconds')`).bind(auditId,d.id),
  db.prepare(`INSERT INTO provider_manual_funding_control(id,enabled,revision,updated_by,updated_at)
   SELECT 1,1,1,actor,created_at FROM provider_balance_snapshots WHERE id=?
   AND EXISTS(SELECT 1 FROM tenant_audit_events WHERE id=?)
   AND NOT EXISTS(SELECT 1 FROM provider_manual_funding_control WHERE id=1)`).bind(d.id,auditId),
  // A newer owner-supplied positive balance is the explicit billing-only
  // review requested by the owner. Never hide an unresolved auth/overrun fault
  // behind a later 402; a provider account or route rejection remains blocked.
  db.prepare(`INSERT INTO provider_safety_events(provider,kind,code,evidence_ref,actor,created_at)
   SELECT e.provider,'reviewed','manual_balance_sync',?,s.actor,s.created_at
   FROM provider_balance_snapshots s JOIN provider_safety_events e ON e.provider=s.provider
   WHERE s.id=? AND EXISTS(SELECT 1 FROM tenant_audit_events WHERE id=?)
   AND s.balance_micros>0 AND e.kind='blocked' AND e.code='http_402'
   AND e.created_at<=s.created_at
   AND e.sequence=(SELECT MAX(sequence) FROM provider_safety_events WHERE provider=e.provider)
   AND NOT EXISTS(SELECT 1 FROM provider_safety_events n WHERE n.provider=e.provider AND n.kind='blocked' AND n.code<>'http_402'
     AND n.sequence>COALESCE((SELECT MAX(sequence) FROM provider_safety_events WHERE provider=e.provider AND kind='reviewed'),0))
   AND NOT EXISTS(SELECT 1 FROM provider_safety_events WHERE provider=e.provider AND kind='reviewed' AND evidence_ref=?)`)
   .bind(eventId,d.id,auditId,eventId)
 ]);
 const row=await existing(db,d.id);
 if(results[0].meta.changes===1)return {ok:true,replayed:false,snapshot:snapshot(row)};
 return replay(row,d,actor)?{ok:true,replayed:true,snapshot:snapshot(row)}:
  {ok:false,replayed:false,reason:row?'conflicting_sync_id':'balance_changed'};
}
export async function setManualFundingEnabled(db,d,actor,now=Date.now()){
 if(!d||Object.keys(d).sort().join(',')!=='enabled,expectedRevision'||typeof d.enabled!=='boolean'||
    !int(d.expectedRevision,0,2147483646)||!validActor(actor)||!int(now,0,253402300799999))throw Error('invalid manual funding control');
 const at=new Date(now).toISOString(),revision=d.expectedRevision+1;
 const statement=d.expectedRevision===0?
  db.prepare(`INSERT INTO provider_manual_funding_control(id,enabled,revision,updated_by,updated_at)
   SELECT 1,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM provider_manual_funding_control WHERE id=1)`)
   .bind(d.enabled?1:0,revision,actor,at):
  db.prepare(`UPDATE provider_manual_funding_control SET enabled=?,revision=?,updated_by=?,updated_at=?
   WHERE id=1 AND revision=?`).bind(d.enabled?1:0,revision,actor,at,d.expectedRevision);
 const result=await db.batch([statement,
  db.prepare(`INSERT INTO tenant_audit_events(id,actor,action,target_id,detail_json,created_at)
   SELECT ?,?,'funding.manual_control_changed','manual-provider-funding',?,? WHERE changes()=1`)
   .bind(crypto.randomUUID(),actor,JSON.stringify({enabled:d.enabled,revision}),at)
 ]);
 const control=publicControl(await db.prepare(`SELECT ${controlFields} FROM provider_manual_funding_control WHERE id=1`).first());
 return result[0].meta.changes===1?{ok:true,control}:{ok:false,reason:'control_changed',control};
}
