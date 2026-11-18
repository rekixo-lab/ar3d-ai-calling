// Authenticated, tenant-scoped agent draft editor. No agent activation or dialing.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb,parseJsonBody} from './core.mjs';
import {verifyQuestions} from './conversation-core.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(error,status=400)=>json({error},status);
const agentPath=/^\/v1\/human\/agents\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
async function payload(req){
  if(Number(req.headers.get('content-length'))>12000)throw Error('request body too large');
  const reader=req.body?.getReader();if(!reader)throw Error('request body required');
  let size=0,str='';const dec=new TextDecoder('utf-8',{fatal:true});
  try{
    while(true){const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>12000){await reader.cancel();throw Error('request body too large')}
      str+=dec.decode(value,{stream:true});
    }
    str+=dec.decode();
  }finally{reader.releaseLock()}
  return parseJsonBody(str,12000);
}
function validate(existing,d){
  const allowed=['tenantId','displayName','languageMode','questions','status'];
  if(Object.keys(d).some(key=>!allowed.includes(key)))throw Error('invalid agent update field');
  if(!allowed.slice(1).some(key=>Object.hasOwn(d,key)))throw Error('no agent updates supplied');
  const name=Object.hasOwn(d,'displayName')?d.displayName:existing.displayName;
  const language=Object.hasOwn(d,'languageMode')?d.languageMode:existing.languageMode;
  const questions=Object.hasOwn(d,'questions')?d.questions:JSON.parse(existing.questionsJson);
  const status=Object.hasOwn(d,'status')?d.status:existing.status;
  if(typeof name!=='string'||!name.trim()||name.trim().length>120||
     /[\u0000-\u001f]/u.test(name)||!['hi','en','hi-en'].includes(language)||
     !['draft','paused'].includes(status))throw Error('invalid agent configuration');
  return {name:name.trim(),language,questions:verifyQuestions(questions),status};
}
export async function handleAgentSettingsRequest(req,env,user){
  const u=new URL(req.url),path=u.pathname,method=req.method;
  const match=path.match(agentPath);
  if(path!=='/v1/human/agents'&&!match)return null;
  try{
    if(path==='/v1/human/agents'&&method==='POST')return null; // existing create endpoint
    if(!['GET','PATCH'].includes(method))return fail('method not allowed',405);
    const d=method==='PATCH'?await payload(req):null;
    const tenantId=method==='GET'?u.searchParams.get('tenantId'):d.tenantId;
    const member=await requireMembership(env.CONTROL_DB,user,tenantId,method==='PATCH');
    if(!member)return fail('forbidden',403);
    const db=resolveCrmDb(env,member),tid=member.tenant_id;
    if(method==='GET'&&!match){
      const rows=await db.prepare("SELECT id,display_name AS displayName,language_mode AS languageMode,questions_json AS questionsJson,status,created_at AS createdAt,updated_at AS updatedAt FROM agents WHERE tenant_id=? ORDER BY created_at DESC,id DESC LIMIT 100").bind(tid).all();
      return json({agents:rows.results.map(r=>({id:r.id,displayName:r.displayName,languageMode:r.languageMode,
        questions:JSON.parse(r.questionsJson),status:r.status,createdAt:r.createdAt,updatedAt:r.updatedAt})),
        notice:'Only draft/paused agents are editable. No agent is enabled for calling.'});
    }
    const id=match[1];
    const existing=await db.prepare("SELECT id,display_name AS displayName,language_mode AS languageMode,questions_json AS questionsJson,status FROM agents WHERE tenant_id=? AND id=?").bind(tid,id).first();
    if(!existing)return fail('agent not found',404);
    if(method==='GET')return json({agent:{...existing,questions:JSON.parse(existing.questionsJson)}});
    if(existing.status==='active')return fail('active agent requires reviewed deactivation migration',409);
    const next=validate(existing,d),stamp=new Date().toISOString();
    const result=await db.batch([
      db.prepare("UPDATE agents SET display_name=?,language_mode=?,questions_json=?,status=?,updated_at=? WHERE tenant_id=? AND id=? AND status IN ('draft','paused')")
        .bind(next.name,next.language,JSON.stringify(next.questions),next.status,stamp,tid,id),
      db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) SELECT ?,?,'human:'||?,'agent.updated',id,? FROM agents WHERE tenant_id=? AND id=? AND status IN ('draft','paused')")
        .bind(tid,crypto.randomUUID(),user.id,stamp,tid,id)
    ]);
    if(Number(result[0]?.meta?.changes||0)!==1)return fail('agent changed; refresh',409);
    return json({id,status:next.status,notice:'Agent saved in non-calling mode.'});
  }catch(e){
    const message=String(e?.message||'');
    if(/invalid|question|body|too large|no agent updates|Agent needs/i.test(message))return fail(message);
    if(/not provisioned|not configured/i.test(message))return fail('database not provisioned',503);
    console.error('AR3D agent settings error',e);return fail('internal server error',500);
  }
}
