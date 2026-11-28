import {AUTH_MAINTENANCE_CRON,pruneExpiredAuth} from './auth-maintenance.mjs';
import {CAMPAIGN_CRON,runScriptedCampaignCron,dispatchSettings} from './scripted-campaign-dispatch.mjs';
import {runAutomaticMinuteSettlement,automaticMinuteSettlementApproved} from './plivo-cost-reconcile-routes.mjs';
import {resolveFundingEnv} from './provider-funding.mjs';
import {runIndustrySchoolTick} from './industry-school-dispatch.mjs';
import {runIndustryNoticeTick} from './industry-notice-dispatch.mjs';

export async function handleCallingCron(controller,env,{apiFetch=fetch,cdrFetch=fetch}={}){
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
 // Resolve the snapshot once for both dispatch and settlement. Up to four
 // reads happen outside dispatch's meter; include them in its reserved budget.
 env=await resolveFundingEnv(env);
 const settings=await dispatchSettings(env);
 const automatic=automaticMinuteSettlementApproved(env);
 // Alternate bounded industry work and legacy property work. Consider
 // recovery even with new School dispatch disabled.
 const industryMinute=Math.floor(now/60000)%2===1;
 if(industryMinute&&settings.queryBudget>=40){
  const runner=Math.floor(now/60000)%4===1?runIndustrySchoolTick:runIndustryNoticeTick;
  const lane=runner===runIndustrySchoolTick?['fund','dial','recover'][Math.floor(now/240000)%3]:null;
  const industry=await runner(env,{now,apiFetch,cdrFetch,maxQueries:Math.min(950,settings.queryBudget-5),lane,rotationIndex:Math.floor(now/720000)});
  if(industry)return {processed:0,dialed:industry.state==='submitted'?1:0,industry};
 }
 // A matched CDR can use ten statements including an idempotent/racing
 // settlement, plus up to three queue reads. Free-tier ticks settle one call
 // so their remaining budget can still dispatch one new customer call.
 const maxCalls=settings.queryBudget>=80?3:1;

 // After industry inspection, reserve budget for actual CDR attempts rather
 // than hypothetical work. Empty recovery queues must not starve property calls.
 const inspected=industryMinute&&settings.queryBudget>=40;
 let settlement;
 if(automatic&&inspected)settlement=await runAutomaticMinuteSettlement(env,{now,maxCalls,fetcher:cdrFetch});
 const attempted=settlement?.attempted;
 const count=Number.isSafeInteger(attempted)&&attempted>=0&&attempted<=maxCalls?attempted:maxCalls;
 const reserve=(automatic?3+10*count:0)+(maintenance?4:0)+4+4+(inspected?2:0);
 const campaign=await runScriptedCampaignCron(env,{now,apiFetch,settings:{...settings,queryBudget:Math.max(10,settings.queryBudget-reserve)}});
 if(automatic&&!inspected)settlement=await runAutomaticMinuteSettlement(env,{now,maxCalls,fetcher:cdrFetch});
 return {...campaign,maintenance,...(settlement?{settlement}:{})};
}
