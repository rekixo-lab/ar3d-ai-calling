// Tenant-scoped authorization does not grant consent, review, wallet or provider approval.
import {currentSuperAdminMfa} from './human-auth.mjs';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const token=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
// Static SQL with the human_users u and tenants t aliases.
export const industryActorPredicate="u.status='active' AND ((u.global_role='super_admin' AND EXISTS(SELECT 1 FROM human_mfa_settings am WHERE am.user_id=u.id AND am.enabled_at IS NOT NULL)) OR (u.global_role='user' AND EXISTS(SELECT 1 FROM tenant_memberships am WHERE am.user_id=u.id AND am.tenant_id=t.id AND am.role='client_admin' AND am.status='active')))";
export async function currentIndustryDispatchAuthorizer(db,user,tenantId,now=Date.now()){
 if(!uuid(tenantId)||!user?.id||!token(user.token_hash)||!Number.isSafeInteger(now)||now<0)return false;
 if(user.globalRole==='super_admin')return currentSuperAdminMfa(db,user,now);
 if(user.globalRole!=='user')return false;
 return !!await db.prepare("SELECT 1 AS ok FROM human_sessions s JOIN human_users u ON u.id=s.user_id JOIN tenants t ON t.id=? JOIN tenant_memberships m ON m.tenant_id=t.id AND m.user_id=u.id WHERE u.id=? AND u.global_role='user' AND u.status='active' AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND m.role='client_admin' AND m.status='active' AND t.status='active' AND t.storage_mode='shared' AND NOT EXISTS(SELECT 1 FROM human_mfa_settings am WHERE am.user_id=u.id AND am.enabled_at IS NOT NULL AND s.created_at<am.enabled_at) LIMIT 1").bind(tenantId,user.id,user.token_hash,now).first();
}
// Explicit releases persist after logout; losing the role or active account
// prevents further funding/submission. Already placed calls still settle.
export async function activeIndustryDispatchActor(db,tenantId,actorId){
 if(!uuid(tenantId)||typeof actorId!=='string'||!actorId)return false;
 return !!await db.prepare("SELECT 1 AS ok FROM tenants t JOIN human_users u ON u.id=? WHERE t.id=? AND t.status='active' AND t.storage_mode='shared' AND "+industryActorPredicate+" LIMIT 1").bind(actorId,tenantId).first();
}
