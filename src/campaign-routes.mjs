import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb,parseJsonBody} from './core.mjs';
// Non-executable campaign drafts. There is deliberately no dial or activate route.
const json=(x,s=200)=>Response.json(x,{status:s,headers:{'Cache-Control':'no-store'}});
const fail=(e,s=400)=>json({error:e},s);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const route=/^\/v1\/human\/campaigns\/([a-f0-9-]{36})(?:\/(candidates|readiness))?$/i;
async function body(req){
  if(Number(req.headers.get('content-length'))>10000)throw Error('request too large');
  const reader=req.body?.getReader();if(!reader)throw Error('request required');
  const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,s='';
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
    if(size>10000){await reader.cancel();throw Error('request too large')}s+=decoder.decode(value,{stream:true})}
    s+=decoder.decode();
  }finally{reader.releaseLock()}
  return parseJsonBody(s,10000);
}
export async function handleCampaignRequest(req,env,user){
  const url=new URL(req.url),path=url.pathname,method=req.method;
  const removal=path.match(/^\/v1\/human\/campaigns\/([a-f0-9-]{36})\/candidates\/([a-f0-9-]{36})$/i);
  const match=path.match(route)||removal;
  if(path!=='/v1/human/campaigns'&&!match)return null;
  try{
    const d=method==='POST'?await body(req):null;
    const tenantId=method==='POST'?d.tenantId:url.searchParams.get('tenantId');
    const tenant=await requireMembership(env.CONTROL_DB,user,tenantId,method==='POST'||method==='DELETE');
    if(!tenant)return fail('forbidden',403);
    const db=resolveCrmDb(env,tenant),tid=tenant.tenant_id;
    if(path==='/v1/human/campaigns'&&method==='GET'){
      const rows=await db.prepare("SELECT id,name,language_mode AS languageMode,purpose,status,created_at AS createdAt FROM call_campaign_drafts WHERE tenant_id=? ORDER BY created_at DESC LIMIT 50").bind(tid).all();
      return json({campaigns:rows.results,dialingEnabled:false});
    }
    if(path==='/v1/human/campaigns'&&method==='POST'){
      if(Object.keys(d).some(k=>!['tenantId','name','languageMode','purpose'].includes(k))||
        typeof d.name!=='string'||!d.name.trim()||d.name.trim().length>80||
        /[\u0000-\u001f]/u.test(d.name)||!['hi','en','hi-en'].includes(d.languageMode)||
        !['property_information','site_visit'].includes(d.purpose))return fail('invalid campaign');
      const id=crypto.randomUUID(),at=new Date().toISOString();
      await db.batch([
        db.prepare("INSERT INTO call_campaign_drafts(tenant_id,id,name,language_mode,purpose,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'draft',?,?,?)").bind(tid,id,d.name.trim(),d.languageMode,d.purpose,user.id,at,at),
        db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) VALUES(?,?,'human:'||?,'campaign.draft_created',?,?)").bind(tid,crypto.randomUUID(),user.id,id,at)
      ]);
      return json({id,status:'draft',dialingEnabled:false},201);
    }
    if(!match||!uuid.test(match[1]))return fail('not found',404);
    const campaignId=match[1];
    const record=await db.prepare("SELECT id,name,language_mode AS languageMode,purpose,status FROM call_campaign_drafts WHERE tenant_id=? AND id=? LIMIT 1").bind(tid,campaignId).first();
    if(!record)return fail('campaign not found',404);
    if(method==='DELETE'&&removal){
      const at=new Date().toISOString();
      const result=await db.batch([
        db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) SELECT ?,?,'human:'||?,'campaign.candidate_removed',lead_id,? FROM call_campaign_candidates WHERE tenant_id=? AND campaign_id=? AND lead_id=?")
          .bind(tid,crypto.randomUUID(),user.id,at,tid,campaignId,removal[2]),
        db.prepare('DELETE FROM call_campaign_candidates WHERE tenant_id=? AND campaign_id=? AND lead_id=?')
          .bind(tid,campaignId,removal[2])
      ]);
      return json({removed:Number(result[1]?.meta?.changes||0)>0,dialingEnabled:false});
    }
    if(method==='GET'&&!match[2])return json({campaign:record,dialingEnabled:false});
    if(method==='GET'&&match[2]==='candidates'){
      const rows=await db.prepare("SELECT cc.lead_id AS leadId,l.name,l.consent_status AS consentStatus,l.dnd_status AS dndStatus FROM call_campaign_candidates cc JOIN leads l ON l.tenant_id=cc.tenant_id AND l.id=cc.lead_id WHERE cc.tenant_id=? AND cc.campaign_id=? ORDER BY cc.created_at DESC LIMIT 100").bind(tid,campaignId).all();
      return json({candidates:rows.results});
    }
    if(method==='GET'&&match[2]==='readiness'){
      const stats=await db.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN l.consent_status='denied' OR l.dnd_status='blocked' THEN 1 ELSE 0 END),0) AS blocked FROM call_campaign_candidates cc JOIN leads l ON l.tenant_id=cc.tenant_id AND l.id=cc.lead_id WHERE cc.tenant_id=? AND cc.campaign_id=?").bind(tid,campaignId).first();
      return json({executionAllowed:false,campaignId,stats:{total:Number(stats?.total||0),blocked:Number(stats?.blocked||0)},
        reasons:['Telecom provider and caller number not approved','Independent consent and DND checks unavailable','Lawful call windows and opt-out sync not implemented']});
    }
    if(method==='POST'&&match[2]==='candidates'){
      if(Object.keys(d).some(k=>!['tenantId','leadIds'].includes(k))||!Array.isArray(d.leadIds)||
        d.leadIds.length<1||d.leadIds.length>50||d.leadIds.some(x=>typeof x!=='string'||!uuid.test(x))||
        new Set(d.leadIds.map(x=>x.toLowerCase())).size!==d.leadIds.length)return fail('invalid lead IDs');
      const at=new Date().toISOString();
      const statements=d.leadIds.map(id=>db.prepare("INSERT OR IGNORE INTO call_campaign_candidates(tenant_id,campaign_id,lead_id,created_at) SELECT ?,?,id,? FROM leads WHERE tenant_id=? AND id=? AND consent_status!='denied' AND dnd_status!='blocked'").bind(tid,campaignId,at,tid,id));
      statements.push(db.prepare("INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) VALUES(?,?,'human:'||?,'campaign.candidates_added',?,?)").bind(tid,crypto.randomUUID(),user.id,campaignId,at));
      const out=await db.batch(statements),inserted=out.slice(0,-1).reduce((n,x)=>n+Number(x.meta?.changes||0),0);
      return json({inserted,skipped:d.leadIds.length-inserted,dialingEnabled:false});
    }
    return fail('method not allowed',405);
  }catch(e){
    const message=String(e?.message||'');
    if(/invalid|request|JSON|too large/i.test(message))return fail(message);
    if(/not provisioned|not configured/i.test(message))return fail('database not provisioned',503);
    console.error('campaign draft request failed',e);return fail('internal server error',500);
  }
}
