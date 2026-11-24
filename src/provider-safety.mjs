// Financial/authentication faults remain blocked until explicit operator review.
const allowed={plivo:new Set(['http_401','http_402','http_403']),sarvam:new Set(['http_401','http_402','http_403'])};
export async function recordProviderFault(db,provider,status,evidenceRef,now=Date.now()){
 const code='http_'+status;
 if(!Object.hasOwn(allowed,provider)||!allowed[provider].has(code))return false;
 if(typeof evidenceRef!=='string'||!/^[-a-zA-Z0-9:_]{4,160}$/.test(evidenceRef))throw Error('invalid provider evidence');
 await db.prepare("INSERT INTO provider_safety_events(provider,kind,code,evidence_ref,actor,created_at) VALUES(?,'blocked',?,?,'system',?) ON CONFLICT(provider,kind,evidence_ref) DO NOTHING").bind(provider,code,evidenceRef,new Date(now).toISOString()).run();
 return true;
}
export async function providerSafety(db){
 const rows=(await db.prepare("SELECT provider,sequence,kind,code,created_at AS createdAt FROM provider_safety_events e WHERE sequence=(SELECT MAX(sequence) FROM provider_safety_events WHERE provider=e.provider)").all()).results;
 return ['plivo','sarvam'].map(provider=>{const r=rows.find(x=>x.provider===provider);return {provider,blocked:r?.kind==='blocked',sequence:r?.sequence??null,code:r?.code??null,createdAt:r?.createdAt??null};});
}
export async function providerFaultBlocked(db){return (await providerSafety(db)).some(r=>r.blocked);}
export async function reviewProviderFault(db,{provider,expectedSequence,evidenceRef,actor,now=Date.now()}){
 if(!Object.hasOwn(allowed,provider)||!Number.isSafeInteger(expectedSequence)||expectedSequence<1||typeof evidenceRef!=='string'||!/^[A-Za-z0-9][A-Za-z0-9 ._:/-]{9,159}$/.test(evidenceRef)||typeof actor!=='string'||!actor)throw Error('invalid provider review');
 const r=await db.prepare(`INSERT INTO provider_safety_events(provider,kind,code,evidence_ref,actor,created_at)
 SELECT provider,'reviewed','operator_review',?,?,? FROM provider_safety_events e WHERE provider=? AND sequence=? AND kind='blocked'
 AND sequence=(SELECT MAX(sequence) FROM provider_safety_events WHERE provider=e.provider)
 AND NOT EXISTS(SELECT 1 FROM provider_safety_events WHERE provider=e.provider AND kind='reviewed' AND evidence_ref=?)`)
 .bind(evidenceRef,actor,new Date(now).toISOString(),provider,expectedSequence,evidenceRef).run();
 return r.meta.changes===1;
}
