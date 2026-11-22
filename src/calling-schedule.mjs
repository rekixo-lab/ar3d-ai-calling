import {AUTH_MAINTENANCE_CRON,pruneExpiredAuth} from './auth-maintenance.mjs';
import {CAMPAIGN_CRON,runScriptedCampaignCron} from './scripted-campaign-dispatch.mjs';

export async function handleCallingCron(controller,env){
 const cron=controller?.cron,now=controller?.scheduledTime??Date.now();
 if(cron===AUTH_MAINTENANCE_CRON)return pruneExpiredAuth(env,{now});
 if(cron!==CAMPAIGN_CRON)throw Error('unknown Calling Worker cron expression');
 const maintenance=Math.floor(now/60000)%360===0?await pruneExpiredAuth(env,{now}):undefined;
 return {...await runScriptedCampaignCron(env,{now}),maintenance};
}
