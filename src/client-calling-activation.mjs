// A current-MFA owner's explicit dashboard action enables company calling.
// This records operator authorization only; it neither asserts carrier approval
// nor creates customer consent, campaign runs, jobs, credits or provider calls.
import {resolveCrmDb} from './core.mjs';
import {SCRIPTED_CALLING_POLICY} from './scripted-phone-pilot.mjs';

export const validCallingActivationReference=value=>typeof value==='string'&&
 value.trim().length>=4&&value.length<=160&&!/[\u0000-\u001f\u007f]/u.test(value);

export async function enableClientCalling(env,{reference,actor,now=Date.now()}={}){
 if(!validCallingActivationReference(reference)||typeof actor!=='string'||!actor||
    !Number.isSafeInteger(now)||now<0)throw Error('invalid_client_calling_activation');
 const at=new Date(now).toISOString(),expiresAt=new Date(now+365*86400000).toISOString();
 reference=reference.trim();
 const tenants=(await env.CONTROL_DB.prepare(`SELECT t.id AS tenant_id,t.display_name AS name,
  t.storage_mode,t.dedicated_binding,t.status,s.consent_mode
  FROM tenants t LEFT JOIN calling_company_settings s ON s.tenant_id=t.id
  WHERE t.status IN ('trial','active') ORDER BY t.display_name,t.id LIMIT 1001`).all()).results;
 // One bounded action supports the shared fleet and up to four CRM databases.
 // Never silently report a partially enumerated fleet as fully enabled.
 if(tenants.length>1000)throw Error('client_calling_activation_fleet_limit');
 const groups=new Map(),outcomes=new Map();
 for(const tenant of tenants){
  let db;try{db=resolveCrmDb(env,tenant)}catch{
   outcomes.set(tenant.tenant_id,{name:tenant.name,status:'blocked',reason:'company_database_unavailable'});continue;
  }
  if(!groups.has(db)){
   if(groups.size>=4){outcomes.set(tenant.tenant_id,{name:tenant.name,status:'blocked',reason:'company_database_batch_limit'});continue}
   groups.set(db,[]);
  }
  groups.get(db).push(tenant);
 }
 for(const [db,companies] of groups){
  try{
   const ids=JSON.stringify(companies.map(t=>t.tenant_id));
   const policies=(await db.prepare(`SELECT tenant_id,enabled,flow_id,approval_reference,
    expires_at,max_seconds FROM calling_policies WHERE tenant_id IN(SELECT value FROM json_each(?))`).bind(ids).all()).results;
   const existing=new Map(policies.map(p=>[p.tenant_id,p]));
   // Repeating the same action must not move the approval timestamp, which
   // would invalidate customer clearances created after the original action.
   const policyChanges=companies.filter(t=>{
    const p=existing.get(t.tenant_id);
    return !p||p.enabled!==1||p.flow_id!==SCRIPTED_CALLING_POLICY||
     p.approval_reference!==reference||p.expires_at<=at||p.max_seconds!==180;
   });
   const changedPolicyIds=new Set(policyChanges.map(t=>t.tenant_id));
   const changes=companies.filter(t=>changedPolicyIds.has(t.tenant_id)||t.status==='trial'||t.consent_mode!=='client_declared');
   if(policyChanges.length){
    const changed=JSON.stringify(policyChanges.map(t=>t.tenant_id));
    await db.batch([
     db.prepare(`INSERT INTO calling_policies(tenant_id,enabled,flow_id,approval_reference,
      expires_at,daily_limit,max_seconds,updated_by,updated_at)
      SELECT value,1,?,?,?,100,180,?,? FROM json_each(?) WHERE true
      ON CONFLICT(tenant_id) DO UPDATE SET enabled=1,flow_id=excluded.flow_id,
       approval_reference=excluded.approval_reference,expires_at=excluded.expires_at,
       max_seconds=excluded.max_seconds,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(SCRIPTED_CALLING_POLICY,reference,expiresAt,actor,at,changed),
     db.prepare(`INSERT INTO crm_audit_events(tenant_id,id,actor,action,target_id,created_at)
      SELECT value,lower(hex(randomblob(16))),'human:'||?,'calling.owner_activated',value,?
      FROM json_each(?)`).bind(actor,at,changed)
    ]);
   }
   if(changes.length){
    const changed=JSON.stringify(changes.map(t=>t.tenant_id));
    await env.CONTROL_DB.batch([
     env.CONTROL_DB.prepare(`INSERT INTO calling_company_settings(tenant_id,consent_mode,updated_by,updated_at)
      SELECT value,'client_declared',?,? FROM json_each(?) WHERE true
      ON CONFLICT(tenant_id) DO UPDATE SET consent_mode=excluded.consent_mode,
       updated_by=excluded.updated_by,updated_at=excluded.updated_at
      WHERE calling_company_settings.consent_mode!='client_declared'`).bind(actor,at,changed),
     env.CONTROL_DB.prepare(`UPDATE tenants SET status='active',updated_at=?
      WHERE status='trial' AND id IN(SELECT value FROM json_each(?))`).bind(at,changed),
     env.CONTROL_DB.prepare(`INSERT INTO tenant_audit_events(id,tenant_id,actor,action,target_id,detail_json,created_at)
      SELECT lower(hex(randomblob(16))),value,?,'tenant.calling_activated',value,?,?
      FROM json_each(?)`).bind(actor,JSON.stringify({authorization:'owner',reference,
       consentMode:'client_declared',maxSeconds:180}),at,changed)
    ]);
   }
   const changedIds=new Set(changes.map(t=>t.tenant_id));
   for(const tenant of companies)outcomes.set(tenant.tenant_id,{name:tenant.name,
    status:changedIds.has(tenant.tenant_id)?'enabled':'already_enabled'});
  }catch{
   // CRM/control are separate databases. A retry safely repairs an incomplete
   // action; no draft or job is started by either part of this operation.
   for(const tenant of companies)outcomes.set(tenant.tenant_id,{name:tenant.name,
    status:'blocked',reason:'company_activation_unavailable'});
  }
 }
 const companies=tenants.map(t=>outcomes.get(t.tenant_id));
 return {enabled:companies.filter(t=>t.status==='enabled'||t.status==='already_enabled').length,companies};
}
