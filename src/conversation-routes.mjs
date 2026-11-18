// Human-session-only conversation simulation; cannot dial, record, or mutate lead consent.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb,parseJsonBody} from './core.mjs';
import {beginSimulation,advanceSimulation} from './conversation-core.mjs';
import {makeSpeechPlan,processTypedTranscript} from './voice-core.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const fail=(error,status=400)=>json({error},status);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
async function payload(req){
  if(Number(req.headers.get('content-length'))>4096)throw Error('request body too large');
  // Bound chunked bodies as well as Content-Length.
  let bytes=0;const chunks=[];const reader=req.body?.getReader();
  if(!reader)throw Error('request body required');
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
    if(bytes>4096){await reader.cancel();throw Error('request body too large')}chunks.push(value)}}finally{reader.releaseLock()}
  const buf=new Uint8Array(bytes);let at=0;for(const part of chunks){buf.set(part,at);at+=part.byteLength}
  return parseJsonBody(new TextDecoder('utf-8',{fatal:true}).decode(buf),4096);
}
async function scope(env,user,tenantId,write=false){
  const tenant=await requireMembership(env.CONTROL_DB,user,tenantId,write);
  return tenant?{tenant,db:resolveCrmDb(env,tenant),tid:tenant.tenant_id}:null;
}
function publicState(s){return {status:s.status,languageMode:s.languageMode,index:s.index,questionCount:s.questions.length,answers:s.answers,turns:s.turns};}
export async function handleConversationRequest(req,env,user){
  const path=new URL(req.url).pathname,method=req.method;
  const detail=path.match(/^\/v1\/human\/simulations\/([a-f0-9-]{36})(\/(?:turn|voice-preview|speech-turn))?$/i);
  if(path!=='/v1/human/simulations'&&path!=='/v1/human/simulations/agents'&&!detail)return null;
  if(!env.CONTROL_DB)return fail('control database unavailable',503);
  try{
    if(path==='/v1/human/simulations/agents'&&method==='GET'){
      const access=await scope(env,user,new URL(req.url).searchParams.get('tenantId'));
      if(!access)return fail('forbidden',403);
      const rows=await access.db.prepare(`SELECT id,display_name AS displayName,language_mode AS languageMode,status,questions_json AS questionsJson
        FROM agents WHERE tenant_id=? AND status IN ('draft','active') ORDER BY created_at DESC LIMIT 100`)
        .bind(access.tid).all();
      return json({agents:rows.results.map(a=>({id:a.id,displayName:a.displayName,languageMode:a.languageMode,
        status:a.status,questionCount:JSON.parse(a.questionsJson).length}))});
    }
    if(path==='/v1/human/simulations'&&method==='POST'){
      const data=await payload(req),access=await scope(env,user,data.tenantId,true);
      if(!access)return fail('forbidden',403);
      if(!uuid(data.agentId))return fail('invalid agentId');
      const agent=await access.db.prepare(`SELECT id,language_mode AS languageMode,questions_json AS questionsJson
        FROM agents WHERE tenant_id=? AND id=? AND status IN ('draft','active') LIMIT 1`)
        .bind(access.tid,data.agentId).first();
      if(!agent)return fail('agent not found',404);
      const state=beginSimulation({...agent,questions:JSON.parse(agent.questionsJson)}),id=crypto.randomUUID(),at=new Date().toISOString();
      await access.db.prepare(`INSERT INTO conversation_simulations
        (tenant_id,id,agent_id,created_by,state_json,revision,created_at,updated_at,expires_at)
        VALUES(?,?,?,?,?,1,?,?,?)`).bind(access.tid,id,agent.id,user.id,JSON.stringify(state),at,at,
          new Date(Date.now()+24*60*60*1000).toISOString()).run();
      return json({id,revision:1,simulation:publicState(state),notice:'No phone call was placed.'},201);
    }
    if(detail&&uuid(detail[1])&&method==='GET'&&detail[2]==='/voice-preview'){
      const access=await scope(env,user,new URL(req.url).searchParams.get('tenantId'));
      if(!access)return fail('forbidden',403);
      const row=await access.db.prepare(`SELECT state_json AS stateJson,revision,expires_at AS expiresAt
        FROM conversation_simulations WHERE tenant_id=? AND id=? LIMIT 1`)
        .bind(access.tid,detail[1]).first();
      if(!row)return fail('simulation not found',404);
      if(Date.parse(row.expiresAt)<=Date.now())return fail('simulation expired',410);
      const state=JSON.parse(row.stateJson);
      return json({id:detail[1],revision:row.revision,speech:makeSpeechPlan(state)});
    }
    if(detail&&uuid(detail[1])&&method==='POST'&&detail[2]==='/speech-turn'){
      const data=await payload(req),access=await scope(env,user,data.tenantId,true);
      if(!access)return fail('forbidden',403);
      if(!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<1)return fail('invalid expectedRevision');
      if(Object.keys(data).some(k=>!['tenantId','expectedRevision','recognition'].includes(k)))
        return fail('invalid speech preview field');
      const row=await access.db.prepare(`SELECT state_json AS stateJson,revision,expires_at AS expiresAt
        FROM conversation_simulations WHERE tenant_id=? AND id=? LIMIT 1`)
        .bind(access.tid,detail[1]).first();
      if(!row)return fail('simulation not found',404);
      if(Date.parse(row.expiresAt)<=Date.now())return fail('simulation expired',410);
      if(row.revision!==data.expectedRevision)return fail('simulation changed; refresh',409);
      const result=processTypedTranscript(JSON.parse(row.stateJson),data.recognition);
      if(!result.mutated)return json({id:detail[1],action:result.action,revision:row.revision,
        simulation:publicState(result.state),speech:makeSpeechPlan(result.state),notice:result.note});
      const at=new Date().toISOString();
      const changed=await access.db.prepare(`UPDATE conversation_simulations SET state_json=?,revision=revision+1,updated_at=?
        WHERE tenant_id=? AND id=? AND revision=? RETURNING revision`)
        .bind(JSON.stringify(result.state),at,access.tid,detail[1],data.expectedRevision).first();
      if(!changed)return fail('simulation changed; refresh',409);
      return json({id:detail[1],action:result.action,revision:changed.revision,
        simulation:publicState(result.state),speech:makeSpeechPlan(result.state),notice:result.note});
    }
    if(detail&&uuid(detail[1])&&method==='GET'&&!detail[2]){
      const access=await scope(env,user,new URL(req.url).searchParams.get('tenantId'));
      if(!access)return fail('forbidden',403);
      const row=await access.db.prepare(`SELECT state_json AS stateJson,revision,expires_at AS expiresAt
        FROM conversation_simulations WHERE tenant_id=? AND id=? LIMIT 1`)
        .bind(access.tid,detail[1]).first();
      if(!row)return fail('simulation not found',404);
      if(Date.parse(row.expiresAt)<=Date.now())return fail('simulation expired',410);
      return json({id:detail[1],revision:row.revision,simulation:publicState(JSON.parse(row.stateJson))});
    }
    if(detail&&uuid(detail[1])&&detail[2]==='/turn'&&method==='POST'){
      const data=await payload(req),access=await scope(env,user,data.tenantId,true);
      if(!access)return fail('forbidden',403);
      if(!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<1)return fail('invalid expectedRevision');
      const row=await access.db.prepare(`SELECT state_json AS stateJson,revision,expires_at AS expiresAt
        FROM conversation_simulations WHERE tenant_id=? AND id=? LIMIT 1`)
        .bind(access.tid,detail[1]).first();
      if(!row)return fail('simulation not found',404);
      if(Date.parse(row.expiresAt)<=Date.now())return fail('simulation expired',410);
      if(row.revision!==data.expectedRevision)return fail('simulation changed; refresh',409);
      const next=advanceSimulation(JSON.parse(row.stateJson),data.message),at=new Date().toISOString();
      const updated=await access.db.prepare(`UPDATE conversation_simulations SET state_json=?,revision=revision+1,updated_at=?
        WHERE tenant_id=? AND id=? AND revision=? RETURNING revision`)
        .bind(JSON.stringify(next),at,access.tid,detail[1],data.expectedRevision).first();
      if(!updated)return fail('simulation changed; refresh',409);
      return json({id:detail[1],revision:updated.revision,simulation:publicState(next)});
    }
    return fail('method not allowed',405);
  }catch(e){
    const error=String(e?.message||'');
    if(/invalid|question|message|body|simulation already|limit|not connected|too large|must be|Agent needs|typed demo|speech preview|transcript/i.test(error))return fail(error,400);
    if(/not provisioned|not configured/i.test(error))return fail('database not provisioned',503);
    console.error('AR3D conversation simulator request failed',e);return fail('internal server error',500);
  }
}
