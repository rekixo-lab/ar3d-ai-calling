// No login, provider call or database mutation: locked-stage smoke test only.
const origin=process.env.SCHOOL_STAGE_ORIGIN;
if(typeof origin!=='string'||!/^https:\/\/ar3d-ai-calling-school-stage\.[a-z0-9-]{1,63}\.workers\.dev$/.test(origin))throw Error('Invalid stage origin');
const get=(path,opts={})=>fetch(origin+path,{redirect:'error',signal:AbortSignal.timeout(10000),...opts});
let health;
for(let i=0;i<4;i++){
 try{const r=await get('/health');if(r.ok){health=await r.json();break}}catch{}
 if(i<3)await new Promise(resolve=>setTimeout(resolve,2000));
}
if(health?.service!=='school-internal-stage'||health.production!==false||health.stageDatabaseVerified!==true||health.liveEnabled!==false)
 throw Error('Stage health or live lock verification failed');
const denied=await get('/v1/human/school-stage/dispatch',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
if(denied.status!==403)throw Error('Unauthorized dispatch not denied');
const legacy=await get('/v1/human/scripted-phone-pilot');
if(legacy.status!==404)throw Error('Legacy route not isolated');
console.log('Stage health, locked live flag, unauthorized dispatch denial and legacy route isolation verified.');
