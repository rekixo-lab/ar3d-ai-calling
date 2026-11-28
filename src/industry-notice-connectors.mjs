// Server-only connectors for four notice industries. No live call permission,
// public route or credential issuer. Future voice adapter must own the scope,
// recheck live eligibility and atomically claim any sensitive utterance.
import {INDUSTRY_NOTICE_CONTRACTS,validIndustryNoticeScope,verifyIndustryNoticeRecord,buildVerifiedIndustryNotice} from './industry-verified-notice.mjs';
import {readBoundedBytes} from './scripted-speech.mjs';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const key=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)&&!/^0{64}$/.test(x);
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const validTime=x=>Number.isSafeInteger(x)&&x>=0&&x<=8640000000000000;
const contracts=new Map(INDUSTRY_NOTICE_CONTRACTS.map(x=>[x.templateId,x]));
const recordURL='https://industry-record.internal/v1/approved-notice';
const identityURL='https://industry-identity.internal/v1/recipient-proof';
// Worker secret only. Reject reused signer keys across both issuers and all tenants.
function registry(env){
 const raw=env.AR3D_NOTICE_ISSUER_KEYS_JSON;
 if(typeof raw!=='string'||!raw.length||raw.length>65536||new TextEncoder().encode(raw).length>65536)return null;
 try{
  const rows=JSON.parse(raw);
  if(!Array.isArray(rows)||!rows.length||rows.length>200)return null;
  const seen=new Set(),tenants=new Map();
  for(const row of rows){
   if(!exact(row,['tenantId','identityKeyHex','recordKeyHex'])||!uuid(row.tenantId)||
     row.tenantId!==row.tenantId.toLowerCase()||tenants.has(row.tenantId)||
     !key(row.identityKeyHex)||!key(row.recordKeyHex)||row.identityKeyHex===row.recordKeyHex||
     seen.has(row.identityKeyHex)||seen.has(row.recordKeyHex))return null;
   seen.add(row.identityKeyHex);seen.add(row.recordKeyHex);
   tenants.set(row.tenantId,Object.freeze({...row}));
  }
  return tenants;
 }catch{return null}
}
function bindings(env){
 const record=env.INDUSTRY_NOTICE_RECORD_SERVICE,identity=env.INDUSTRY_NOTICE_IDENTITY_SERVICE;
 return {record:typeof record?.fetch==='function'?record:null,identity:typeof identity?.fetch==='function'?identity:null};
}
// No network. Report configuration availability, not issuer health or permission.
export function industryNoticeConnectorStatus(env,tenantId){
 const {record,identity}=bindings(env);
 const configured=uuid(tenantId)&&!!registry(env)?.get(tenantId);
 const independent=!!record&&!!identity&&record!==identity;
 return {state:configured&&independent?'configured_unverified':'setup_required',
  recordBindingPresent:!!record,identityBindingPresent:!!identity,
  independentBindings:independent,tenantKeysConfigured:configured,dispatchReady:false};
}
async function envelope(binding,url,body){
 const res=await binding.fetch(new Request(url,{method:'POST',redirect:'manual',
  headers:{'Content-Type':'application/json','Accept':'application/json','Cache-Control':'no-store'},
  body:JSON.stringify(body),signal:AbortSignal.timeout(5000)}));
 if(!(res instanceof Response)||res.status!==200||
  res.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'){
  try{await res?.body?.cancel()}catch{}
  return null;
 }
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBytes(res,12288));
 const data=JSON.parse(raw);
 return exact(data,['payload','signature'])&&typeof data.payload==='string'&&typeof data.signature==='string'?data:null;
}
const unavailable=state=>({ok:false,state,speech:null,dispatchReady:false});
// assertCurrent must check exact active session, recipient clearance, current
// consent/revocation and wallet hold. No browser fields or verification flags.
// This retrieves verified text, not a one-use speech permit. Never log speech.
export async function retrieveVerifiedIndustryNotice(env,{scope,assertCurrent,now=Date.now(),clock=Date.now}={}){
 try{
  if(!validIndustryNoticeScope(scope)||typeof assertCurrent!=='function'||typeof clock!=='function'||!validTime(now))return unavailable('invalid_notice_scope');
  const started=clock();
  if(!validTime(started))return unavailable('invalid_notice_scope');
  const currentTime=()=>{const elapsed=clock()-started;return Number.isSafeInteger(elapsed)&&elapsed>=0&&elapsed<=15000?now+elapsed:NaN};
  const {record,identity}=bindings(env),trusted=registry(env)?.get(scope.tenantId);
  if(!trusted||!record||!identity||record===identity)return unavailable('notice_connectors_required');
  const s=Object.freeze({...scope}),contract=contracts.get(s.templateId);
  const stillCurrent=async()=>{const ts=currentTime();return validTime(ts)&&await assertCurrent(s,ts)===true};
  if(!await stillCurrent())return unavailable('notice_scope_changed');
  const request={version:1,purpose:contract.purpose,source:contract.source,scope:s};
  const approved=await envelope(record,recordURL,request);
  const observed=currentTime();
  if(!validTime(observed))return unavailable('notice_scope_changed');
  const verified=await verifyIndustryNoticeRecord({scope:s,record:approved,trusted,now:observed});
  if(!verified)return unavailable('notice_record_unavailable');
  if(!await stillCurrent()||!validTime(currentTime())||currentTime()>=verified.validUntil)return unavailable('notice_scope_changed');
  // Never send record fields to identity issuer; only exact scope and digest.
  const proof=await envelope(identity,identityURL,{...request,recordSha256:verified.recordSha256});
  if(!await stillCurrent())return unavailable('notice_scope_changed');
  const finalTime=currentTime();
  if(!validTime(finalTime))return unavailable('notice_scope_changed');
  const result=await buildVerifiedIndustryNotice({scope:s,identity:proof,record:approved,trusted,now:finalTime});
  if(!result.ok)return unavailable('notice_identity_unavailable');
  if(!await stillCurrent()||!validTime(currentTime())||currentTime()>=result.validUntil)return unavailable('notice_scope_changed');
  return result;
 }catch{return unavailable('notice_connector_unavailable')}
}
