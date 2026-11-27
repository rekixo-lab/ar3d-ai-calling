// Independent operator interlock for NEW commercial calls only.
// An absent/unreadable table fails closed. Existing calls and settlement
// use their own evidence paths; never change funding or consent here.
const SELECT_PAUSED="COALESCE((SELECT paused FROM calling_dispatch_pause_events ORDER BY revision DESC LIMIT 1),0)";
export const dispatchPausePredicate=SELECT_PAUSED+"=0";
export async function readDispatchPause(db){
 const r=await db.prepare('SELECT revision,paused,reason,created_at AS updatedAt FROM calling_dispatch_pause_events ORDER BY revision DESC LIMIT 1').first();
 if(!r)return {revision:0,paused:false,reason:null,updatedAt:null};
 if(!Number.isSafeInteger(r.revision)||r.revision<1||![0,1].includes(r.paused))throw Error('invalid dispatch pause state');
 return {...r,paused:r.paused===1};
}
// One Control D1 read replaces the existing provider-safety read in the
// scheduler, preserving its bounded per-invocation query budget.
export async function campaignDispatchInterlock(db){
 const row=await db.prepare(`SELECT ${SELECT_PAUSED} AS paused,
  EXISTS(SELECT 1 FROM provider_safety_events e WHERE e.kind='blocked'
    AND e.sequence=(SELECT MAX(sequence) FROM provider_safety_events WHERE provider=e.provider)) AS providerBlocked`).first();
 if(!row||![0,1].includes(row.paused)||![0,1].includes(row.providerBlocked))throw Error('dispatch interlock unavailable');
 return {paused:row.paused===1,providerBlocked:row.providerBlocked===1};
}
export async function changeDispatchPause(db,d,user,now=Date.now()){
 if(!d||Array.isArray(d)||Object.keys(d).sort().join(',')!=='expectedRevision,paused,reason'||
  typeof d.paused!=='boolean'||!Number.isSafeInteger(d.expectedRevision)||d.expectedRevision<0||d.expectedRevision>=Number.MAX_SAFE_INTEGER||
  typeof d.reason!=='string'||d.reason.trim().length<10||d.reason.trim().length>160||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(d.reason))throw Error('invalid dispatch pause request');
 if(user?.globalRole!=='super_admin'||typeof user.token_hash!=='string'||!/^[a-f0-9]{64}$/.test(user.token_hash))return {ok:false};
 const paused=d.paused?1:0;
 // Authorization and expected revision are checked in the same INSERT.
 // A stale/duplicate request cannot overwrite a later pause or resume.
 const out=await db.prepare(`INSERT INTO calling_dispatch_pause_events(revision,paused,reason,actor,created_at)
 SELECT ?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM calling_dispatch_pause_events),0)=?
 AND ${SELECT_PAUSED}<>?
 AND EXISTS(SELECT 1 FROM human_sessions s JOIN human_users u ON u.id=s.user_id
 JOIN human_mfa_settings m ON m.user_id=u.id
 WHERE u.id=? AND u.global_role='super_admin' AND u.status='active'
 AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND m.enabled_at IS NOT NULL AND s.created_at>=m.enabled_at)`)
 .bind(d.expectedRevision+1,paused,d.reason.trim(),user.id,new Date(now).toISOString(),d.expectedRevision,paused,user.id,user.token_hash,now).run();
 return {ok:out.meta.changes===1,state:await readDispatchPause(db)};
}
