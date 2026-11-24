// Bounded per-session timings: no speech, identifiers, provider calls or extra writes.
// These exclude recording/silence, network to phone, final CRM save and playback.
const MAX=25;
const valid=n=>Number.isSafeInteger(n)&&n>=0&&n<=120000;
const clean=x=>Array.isArray(x)?x.filter(s=>Array.isArray(s)&&s.length===3&&s.every(valid)).slice(-MAX):[];
export function addVoiceTiming(prior,{mediaMs,recognitionMs,interpretationMs}){
 const samples=clean(prior),next=[mediaMs,recognitionMs,interpretationMs];
 return next.every(valid)?[...samples,next].slice(-MAX):samples;
}
export function summarizeVoiceTiming(prior){
 const samples=clean(prior);
 const pct=(values,q)=>values.length?values.sort((a,b)=>a-b)[Math.ceil(values.length*q)-1]:null;
 const totals=samples.map(s=>s.reduce((a,b)=>a+b,0));
 return {basis:'successful_recorded_answer_processing_only',samples:samples.length,mediaP95Ms:pct(samples.map(s=>s[0]),.95),recognitionP95Ms:pct(samples.map(s=>s[1]),.95),interpretationP95Ms:pct(samples.map(s=>s[2]),.95),totalP50Ms:pct([...totals],.5),totalP95Ms:pct(totals,.95)};
}
