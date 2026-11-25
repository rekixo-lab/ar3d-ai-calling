// Short provider back-off shared by the speech path and the scheduler. A
// Sarvam 429 pauses NEW dispatch briefly so live calls keep their capacity.
export async function providerThrottledUntil(env){
 try{const r=await env.CONTROL_DB.prepare("SELECT MAX(throttled_until) AS until FROM calling_capacity_signals").first();return Number(r?.until)||0}catch{return 0}
}
export async function signalProviderThrottle(env,provider,now=Date.now(),ms=120000){
 try{await env.CONTROL_DB.prepare(`INSERT INTO calling_capacity_signals(provider,throttled_until,updated_at) VALUES(?,?,?)
  ON CONFLICT(provider) DO UPDATE SET throttled_until=MAX(throttled_until,excluded.throttled_until),updated_at=excluded.updated_at`)
  .bind(provider,now+ms,new Date(now).toISOString()).run()}catch{}
}
