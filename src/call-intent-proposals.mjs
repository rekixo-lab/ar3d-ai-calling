// Tenant-bound BLOCKED call-intent proposals only. This is NOT an
// authorized outbound call ledger. No number, provider SID or transcript.
import {requireMembership} from './human-auth.mjs';
import {resolveCrmDb,parseJsonBody} from './core.mjs';

const PATH='/v1/human/call-intent-proposals';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const H={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'};
const json=(data,status=200)=>Response.json(data,{status,headers:H});
const fail=(error,status=400)=>json({error},status);
async function parseBody(req){
  if(!req.body||Number(req.headers.get('content-length'))>512)
    throw Error('invalid request body');
  const reader=req.body.getReader();
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let size=0,raw='';
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>512){await reader.cancel();throw Error('invalid request body')}
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
  }finally{reader.releaseLock()}
  return parseJsonBody(raw,512);
}
function validPost(data){
  return data&&typeof data==='object'&&!Array.isArray(data)&&
    Object.keys(data).length===4&&
    Object.keys(data).every(k=>
      ['tenantId','campaignId','leadId','acknowledgeNoDial'].includes(k))&&
    UUID.test(data.tenantId)&&UUID.test(data.campaignId)&&
    UUID.test(data.leadId)&&data.acknowledgeNoDial===true;
}
export async function handleCallIntentProposals(req,env,user){
  const url=new URL(req.url);
  if(url.pathname!==PATH)return null;
  if(req.method!=='GET'&&req.method!=='POST')
    return fail('method_not_allowed',405);
  let data=null;
  if(req.method==='POST'){
    try{data=await parseBody(req)}
    catch{return fail('invalid_or_oversized_request')}
    if(!validPost(data))return fail('invalid_blocked_proposal');
    if(url.search)return fail('query_not_supported');
  }
  const tenantId=req.method==='POST'?data.tenantId:url.searchParams.get('tenantId');
  if(!UUID.test(tenantId||''))return fail('invalid_tenant_id');
  try{
    const member=await requireMembership(env.CONTROL_DB,user,tenantId,
      req.method==='POST');
    if(!member)return fail('forbidden',403);
    const db=resolveCrmDb(env,member),tid=member.tenant_id;
    if(req.method==='GET'){
      if([...url.searchParams.keys()].some(k=>
        !['tenantId','limit','offset'].includes(k)))
        return fail('query_not_supported');
      const rawLimit=url.searchParams.get('limit')??'25';
      const rawOffset=url.searchParams.get('offset')??'0';
      if(!/^[1-9][0-9]?$|^50$/.test(rawLimit)||
         !/^(0|[1-9][0-9]{0,5})$/.test(rawOffset)||
         Number(rawOffset)>100000)return fail('invalid_pagination');
      const limit=Number(rawLimit),offset=Number(rawOffset);
      const result=await db.prepare(
        'SELECT p.id,p.lead_id AS leadId,p.campaign_id AS campaignId,'+
        'c.name AS campaignName,p.purpose,p.state,p.created_at AS createdAt,'+
        'l.consent_status AS consentStatus,l.dnd_status AS dndStatus,'+
        'EXISTS(SELECT 1 FROM lead_opt_out_events o WHERE o.tenant_id=p.tenant_id '+
        'AND o.lead_id=p.lead_id) AS optOutRecorded '+
        'FROM call_intent_proposals p JOIN call_campaign_drafts c '+
        'ON c.tenant_id=p.tenant_id AND c.id=p.campaign_id '+
        'JOIN leads l ON l.tenant_id=p.tenant_id AND l.id=p.lead_id '+
        'WHERE p.tenant_id=? ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?'
      ).bind(tid,limit,offset).all();
      if(!Array.isArray(result?.results))throw Error('database unavailable');
      return json({proposals:result.results.map(x=>({
        id:x.id,leadId:x.leadId,campaignId:x.campaignId,
        campaignName:x.campaignName,purpose:x.purpose,
        state:'blocked',createdAt:x.createdAt,
        consentStatus:x.consentStatus,dndStatus:x.dndStatus,
        optOutRecorded:Number(x.optOutRecorded)===1,
        executionAllowed:false,sourceVerified:false
      })),limit,offset,customerCallsStarted:0,executionAllowed:false,
      notice:'Blocked planning records only; no consent/DND clearance, provider CallSid, transcript or live dialing.'});
    }
    const id=crypto.randomUUID(),at=new Date().toISOString();
    // Atomic insert+audit scoped to the existing draft candidate.
    // Revalidate CURRENT lead opt-out and block states at insert time. This
    // must NEVER infer verified consent from a prior enquiry or Excel upload.
    const results=await db.batch([
      db.prepare(
        'INSERT INTO call_intent_proposals '+
        '(tenant_id,id,campaign_id,lead_id,purpose,state,created_by,created_at) '+
        "SELECT ?,?,c.id,l.id,c.purpose,'blocked',?,? "+
        'FROM call_campaign_drafts c '+
        'JOIN call_campaign_candidates cc ON cc.tenant_id=c.tenant_id AND cc.campaign_id=c.id '+
        'JOIN leads l ON l.tenant_id=cc.tenant_id AND l.id=cc.lead_id '+
        "WHERE c.tenant_id=? AND c.id=? AND cc.lead_id=? AND c.status='draft' "+
        "AND l.consent_status!='denied' AND l.dnd_status!='blocked' "+
        'AND NOT EXISTS(SELECT 1 FROM lead_opt_out_events o '+
        'WHERE o.tenant_id=l.tenant_id AND o.lead_id=l.id) '+
        'ON CONFLICT(tenant_id,campaign_id,lead_id) DO NOTHING'
      ).bind(tid,id,user.id,at,tid,data.campaignId,data.leadId),
      db.prepare(
        'INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at) '+
        "SELECT ?,?,'human:'||?,'call_intent.proposal_blocked',id,? "+
        'FROM call_intent_proposals WHERE tenant_id=? AND id=? AND created_by=? AND created_at=?'
      ).bind(tid,crypto.randomUUID(),user.id,at,tid,id,user.id,at)
    ]);
    if(Number(results[0]?.meta?.changes)!==1)
      return fail('candidate_missing_blocked_or_already_proposed',409);
    if(Number(results[1]?.meta?.changes)!==1)
      throw Error('audit not written');
    return json({id,state:'blocked',executionAllowed:false,
      providerCallCreated:false,leadUpdated:false,consentGranted:false,
      customerCallsStarted:0,
      notice:'Recorded a blocked call intent for human planning only. This cannot launch an Exotel call.'},201);
  }catch{
    return fail('call_intent_proposals_unavailable',503);
  }
}
