import {verifyPublishedAssistant} from './calling-script-provider.mjs';
import {readSharedGateway,verifySharedGatewayLive} from './shared-voice-gateway.mjs';
export async function requirePublishedAgent(env,tenantId,flowId,{fetcher=fetch,verifyProvider=true,allowStaged=false}={}){
 if(env.EXOTEL_REQUIRE_PUBLISHED_AGENT!=='enabled')return {legacy:true};
 const db=env.CONTROL_DB,runtime=await readSharedGateway(env);
 const publication=await db.prepare("SELECT p.* FROM calling_agent_publications p WHERE p.tenant_id=? AND p.provider_state='ready' AND NOT EXISTS(SELECT 1 FROM calling_agent_publications q WHERE q.tenant_id=p.tenant_id AND q.provider_state IN('sending','unknown')) AND p.script_revision=(SELECT MAX(revision) FROM calling_script_versions WHERE tenant_id=p.tenant_id) AND p.profile_revision=(SELECT MAX(revision) FROM company_profile_versions WHERE tenant_id=p.tenant_id) ORDER BY p.created_at DESC LIMIT 1").bind(tenantId).first();
 if(!runtime||!(['ready',...(allowStaged?['staged']:[])].includes(runtime.state))||runtime.flow_id!==flowId||!publication||publication.provider_bot_id!==runtime.bot_id||!publication.provider_assistant_id)throw Error('publish_latest_company_agent_and_verify_shared_gateway');
 const binding={bot_id:runtime.bot_id,assistant_id:publication.provider_assistant_id,source_version:publication.provider_version};
 if(verifyProvider){await verifySharedGatewayLive(env,runtime,{fetcher});await verifyPublishedAssistant(env,binding,publication,{fetcher})}
 return {binding,publication,runtime};
}
