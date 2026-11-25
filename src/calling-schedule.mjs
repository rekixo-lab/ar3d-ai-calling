import {AUTH_MAINTENANCE_CRON,pruneExpiredAuth} from './auth-maintenance.mjs';
import {CAMPAIGN_CRON,runScriptedCampaignCron,dispatchSettings} from './scripted-campaign-dispatch.mjs';
import {runAutomaticMinuteSettlement} from './plivo-cost-reconcile-routes.mjs';

export async function handleCallingCron(controller,env){
 const cron=controller?.cron,now=controller?.scheduledTime??Date.now();
 if(cron===AUTH_MAINTENANCE_CRON)return pruneExpiredAuth(env,{now});
 if(cron!==CAMPAIGN_CRON)throw Error('unknown Calling Worker cron expression');
 // The one-minute Worker trigger already exists. Sweep up to 100 expired
 // auth rows per table every hour instead of every six hours: 4x100/hour
 // for large client fleets, without touching CRM/calling, changing the cron
 // configuration or increasing per-invocation SQL work.
 // Every invocation remains fail-closed on invalid schedule timestamps.
 if(!Number.isSafeInteger(now)||now<0)throw Error('invalid Calling Worker schedule time');
 const maintenance=Math.floor(now/60000)%60===0?await pruneExpiredAuth(env,{now}):undefined;
 // Leave room in the per-invocation D1 budget for settlement (up to 3 calls,
 // several statements each) that runs after dispatch in the same invocation.
 const settings=await dispatchSettings(env);
 const reserve=(env.AR3D_AUTO_CDR_SETTLEMENT==='approved'?15:0)+(maintenance?4:0)+4;
 const campaign=await runScriptedCampaignCron(env,{now,settings:{...settings,queryBudget:Math.max(10,settings.queryBudget-reserve)}});
 const settlement=env.AR3D_AUTO_CDR_SETTLEMENT==='approved'?await runAutomaticMinuteSettlement(env,{now}):undefined;
 return {...campaign,maintenance,...(settlement?{settlement}:{})};
}
