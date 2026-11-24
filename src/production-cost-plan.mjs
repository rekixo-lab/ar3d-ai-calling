// Planning rates in integer micro-INR (1 INR = 1,000,000 units).
// Not invoices, wallet balances, sale prices, or a dispatch quota.
export const PRODUCTION_COST_PLAN=Object.freeze({
 version:'2026-11-24',currency:'INR',scale:1000000,
 plivoPerBilledMinute:380000,sarvamPerBilledAudioMinute:490000,
 llmBudgetPerConnectedMinute:30000,numberMonthly:200000000,
 cloudflareMonthly:475000000,cloudflareUsd:5,assumedInrPerUsd:95
});
export function estimateProductionCost({minutes,audioPercent,numbers}){
 if(!Number.isSafeInteger(minutes)||minutes<1||minutes>1000000||
    !Number.isSafeInteger(audioPercent)||audioPercent<0||audioPercent>100||
    !Number.isSafeInteger(numbers)||numbers<1||numbers>1000)throw Error('invalid estimate');
 const p=PRODUCTION_COST_PLAN;
 const perMinute={plivo:p.plivoPerBilledMinute,stt:p.sarvamPerBilledAudioMinute*audioPercent/100,llm:p.llmBudgetPerConnectedMinute};
 const variablePerMinute=perMinute.plivo+perMinute.stt+perMinute.llm;
 const fixed={numbers:p.numberMonthly*numbers,cloudflare:p.cloudflareMonthly};
 const fixedTotal=fixed.numbers+fixed.cloudflare,variableTotal=variablePerMinute*minutes;
 return {plan:p,inputs:{minutes,audioPercent,numbers},perMinute,variablePerMinute,fixed,fixedTotal,variableTotal,total:variableTotal+fixedTotal,
  conservativePerMinute:p.plivoPerBilledMinute+p.sarvamPerBilledAudioMinute+p.llmBudgetPerConnectedMinute,
  status:'planning_only',actualProviderBillingVerified:false,clientCreditsDebited:false};
}
