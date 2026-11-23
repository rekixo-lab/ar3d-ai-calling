// Deterministic phone-style seven-turn question planner for optional, local
// browser preview and future independently authenticated telecom STT adapters.
// The result is UNTRUSTED; never authorizes dialing, consent, DND or CRM writes.
import {fixedPropertyQuestions,normalizePropertySurvey} from './fixed-property-survey.mjs';

const FIELDS=['propertyType','location','area','size','budgetInr','interest','visitDate'];
const UUID_RE=/^[a-f0-9-]{36}$/i;
const STOP=/(?:stop calling|don't call|do not call|remove my number|unsubscribe|opt.?out|कॉल मत|फोन मत|दोबारा कॉल मत|नंबर हटा|नम्बर हटा|बात नहीं करनी)/iu;
const AGAIN=/^(?:repeat|again|say again|pardon|दोबारा|फिर से|एक बार और|क्या पूछा|फिर बोलो)[।.?!\s]*$/iu;
const MAX_TURNS=25;
const MAX_ATTEMPTS=3;
const MAX_TEXT=220;
const MAX_AGE_MS=30*60*1000;
const HINDI_DIGITS='०१२३४५६७८९';
const HINDI_NUMBERS=Object.freeze({
  'एक':1,'दो':2,'तीन':3,'चार':4,'पांच':5,'पाँच':5,
  'दस':10,'पंद्रह':15,'पन्द्रह':15,'बीस':20,'पच्चीस':25,
  'तीस':30,'पैंतीस':35,'चालीस':40,'पैंतालीस':45,'पचास':50,
  'साठ':60,'सत्तर':70,'अस्सी':80,'नब्बे':90,'सौ':100
});
const WEEKDAYS=Object.freeze({
  sunday:0,रविवार:0,monday:1,सोमवार:1,tuesday:2,मंगलवार:2,
  wednesday:3,बुधवार:3,thursday:4,गुरुवार:4,friday:5,शुक्रवार:5,
  saturday:6,शनिवार:6
});
function digits(value){return value.replace(/[०-९]/g,c=>String(HINDI_DIGITS.indexOf(c)))}
function cleaned(input){
  if(typeof input!=='string'||!input.trim()||input.length>MAX_TEXT||
     /[\u0000-\u001f\u007f]/u.test(input))throw Error('invalid voice preview answer');
  return digits(input.trim());
}
function smallText(str,field){
  const value=str.replace(/^[।.!?\s]+|[।.!?\s]+$/g,'').trim();
  if(value.length<2||value.length>120)throw Error('unclear '+field+'; repeat or review');
  return value;
}
function parseProperty(str){
  const variants=[
    ['plot',/(?:\bplot\b|प्लॉट|प्लाट|जमीन|ज़मीन|भूमि)/iu],
    ['flat',/(?:\bflat\b|\bapartment\b|फ्लैट|अपार्टमेंट)/iu],
    ['house',/(?:\bhouse\b|\bhome\b|घर|मकान)/iu]
  ].filter(([,re])=>re.test(str));
  if(variants.length!==1)throw Error('unclear property type; repeat or review');
  return variants[0][0];
}
function parseSize(str,propertyType){
  if(propertyType==='plot'){
    // A spoken number alone has ambiguous units: do not invent square feet.
    const value=digits(str).replace(/\s+/g,' ').trim();
    if(!/(?:\d+\s*(?:x|×|by)\s*\d+|\d+\s*(?:sq\.?\s*ft|sqft|square feet|वर्ग ?फुट|गज|yards?|ft|feet))/iu.test(value)||
       value.length>80)
      throw Error('unclear plot dimensions; say units explicitly');
    return value;
  }
  const word=str.match(/(?:^|[\s,।])(?:एक|दो|तीन|चार|पांच|पाँच)(?=\s*(?:बीएचके|bhk|bedroom))/iu);
  let n=null;
  if(word)n=HINDI_NUMBERS[word[0].trim()];
  const match=str.match(/([1-5])\s*(?:BHK|बीएचके|bedrooms?)/iu);
  if(match){if(n!==null&&n!==Number(match[1]))throw Error('conflicting BHK sizes');n=Number(match[1])}
  if(n===null)throw Error('unclear BHK; repeat or review');
  return n===5?'5BHK+':n+'BHK';
}
function parseBudget(str){
  const words=digits(str).replace(/,/g,'').toLowerCase();
  const numbers=[...words.matchAll(/\d+(?:\.\d+)?/g)].map(m=>Number(m[0]));
  let numeric;
  if(numbers.length===1)numeric=numbers[0];
  else if(numbers.length===0){
    const named=Object.entries(HINDI_NUMBERS).filter(([key])=>words.includes(key));
    if(named.length!==1)throw Error('unclear budget; repeat or review');
    numeric=named[0][1];
  }else throw Error('budget range unclear; ask for one approximate amount');
  const multiplier=/(?:crore|करोड़|करोड)/iu.test(words)?10000000:
    /(?:lakh|lac|लाख)/iu.test(words)?100000:
    /(?:thousand|हजार|हज़ार)/iu.test(words)?1000:1;
  const rupees=Math.round(numeric*multiplier);
  if(!Number.isSafeInteger(rupees)||rupees<10000||rupees>1000000000000)
    throw Error('unclear rupee budget; repeat or review');
  return rupees;
}
function parseInterest(str){
  const reject=/(?:not interested|no interest|don't want|do not want|no thanks|नहीं चाहिए|रुचि नहीं|इंटरेस्ट नहीं|नहीं देखना|नहीं लेना)/iu.test(str);
  const agree=/(?:\b(?:yes|yeah|sure)\b|हाँ|हां|जी हाँ|जरूर|ज़रूर|देखना है)/iu.test(str);
  // An explicit refusal outweighs vague "not now" / "अभी नहीं".
  // But conflicting yes/no responses must NEVER be silently saved as interested.
  if(reject){
    if(agree)throw Error('conflicting interest answer; repeat or review');
    return 'not_interested';
  }
  if(/(?:later|follow.?up|next month|not now|बाद में|अभी नहीं|फिर कभी|कुछ दिन)/iu.test(str))
    return 'later';
  if(agree||/(?:interested|चाहिए)/iu.test(str))
    return 'interested';
  throw Error('unclear interest; repeat or review');
}
function indiaDate(now){
  return new Date(now+330*60000).toISOString().slice(0,10);
}
function asUtcDay(yyyyMMdd){return Date.parse(yyyyMMdd+'T00:00:00.000Z')}
function parseDate(str,now){
  const input=digits(str),istToday=indiaDate(now),dayStart=asUtcDay(istToday);
  let date=null,match;
  if((match=input.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))){
    date=match[0];
  }else if((match=input.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/))){
    date=match[3]+'-'+match[2].padStart(2,'0')+'-'+match[1].padStart(2,'0');
  }else if(/(?:tomorrow|कल)/iu.test(input)&&!/(?:परसों|yesterday)/iu.test(input)){
    date=new Date(dayStart+86400000).toISOString().slice(0,10);
  }else{
    const days=Object.entries(WEEKDAYS).filter(([key])=>
      new RegExp('(?:^|[\\s,।])'+key+'(?:$|[\\s,।])','iu').test(input));
    if(days.length!==1)throw Error('unclear visit date; request an exact day');
    const target=days[0][1],today=new Date(dayStart).getUTCDay();
    const delta=(target-today+7)%7||7;
    date=new Date(dayStart+delta*86400000).toISOString().slice(0,10);
  }
  const epoch=asUtcDay(date);
  if(!Number.isFinite(epoch)||new Date(epoch).toISOString().slice(0,10)!==date||
     epoch<dayStart||epoch>dayStart+366*86400000)
    throw Error('invalid or past visit date');
  return date;
}
function validate(state,now){
  if(!state||typeof state!=='object'||Array.isArray(state)||
     Object.keys(state).some(k=>!['version','status','language','index','answers',
       'attempts','turns','startedAt'].includes(k))||
     state.version!==1||!['active','completed','needs_review','opted_out'].includes(state.status)||
     !['hi','en'].includes(state.language)||!Number.isSafeInteger(state.index)||
     state.index<0||state.index>7||!Number.isSafeInteger(state.attempts)||
     state.attempts<0||state.attempts>MAX_ATTEMPTS||
     !Number.isSafeInteger(state.turns)||state.turns<0||state.turns>MAX_TURNS||
     !Number.isSafeInteger(state.startedAt)||state.startedAt<0||
     state.startedAt>now+60000||now-state.startedAt>MAX_AGE_MS||
     !state.answers||typeof state.answers!=='object'||Array.isArray(state.answers)||
     Object.keys(state.answers).some(k=>!FIELDS.includes(k)))
    throw Error('invalid or expired voice preview session');
  return state;
}
function prompt(state){
  if(state.status!=='active')return null;
  if(state.index===6&&state.answers.interest!=='interested')return null;
  return fixedPropertyQuestions(state.answers.propertyType||'plot',state.language)[state.index].text;
}
function response(state,action,warning=null){
  return Object.freeze({
    action,mode:'browser_preview_only',state,
    currentField:state.status==='active'?FIELDS[state.index]:null,
    prompt:prompt(state),reviewRequired:true,
    phoneCallsStarted:0,crmWrites:0,consentGranted:false,
    dndCleared:false,verifiedSpeech:false,recordingSaved:false,
    ...(warning?{warning}:{})
  });
}
export function beginFixedVoicePreview({language='hi',now=Date.now()}={}){
  if(!['hi','en'].includes(language)||!Number.isSafeInteger(now)||now<0)
    throw Error('invalid voice preview language/time');
  return response({
    version:1,status:'active',language,index:0,answers:{},
    attempts:0,turns:0,startedAt:now
  },'started');
}
export function advanceFixedVoicePreview(current,{transcript,confidence=1,now=Date.now()}={}){
  const state=validate(current,now);
  if(state.status!=='active')throw Error('voice preview already finished');
  if(!Number.isFinite(confidence)||confidence<0||confidence>1)
    throw Error('invalid voice recognition confidence');
  const input=cleaned(transcript);
  const out={...state,answers:{...state.answers},turns:state.turns+1};
  if(out.turns>MAX_TURNS)throw Error('voice preview turn limit reached');
  if(STOP.test(input)){
    out.status='opted_out';
    return response(out,'opt_out_requested',
      'Stop further calls and verify the opt-out in the CRM; preview did not modify consent.');
  }
  let parsed;
  try{
    if(AGAIN.test(input)||confidence<0.70)throw Error('recognition unclear; repeat question');
    const field=FIELDS[state.index];
    if(field==='propertyType')parsed=parseProperty(input);
    else if(field==='location'||field==='area')parsed=smallText(input,field);
    else if(field==='size')parsed=parseSize(input,out.answers.propertyType);
    else if(field==='budgetInr')parsed=parseBudget(input);
    else if(field==='interest')parsed=parseInterest(input);
    else if(field==='visitDate')parsed=parseDate(input,now);
    else throw Error('unsupported voice question');
  }catch(e){
    out.attempts=state.attempts+1;
    if(out.attempts>=MAX_ATTEMPTS){
      out.status='needs_review';
      return response(out,'human_review', 'Answer unclear after three attempts. No answer was assumed or saved.');
    }
    return response(out,'repeat',String(e.message));
  }
  const field=FIELDS[out.index];
  out.answers[field]=parsed;
  out.attempts=0;
  out.index++;
  if(field==='interest'&&parsed!=='interested'){
    out.answers.visitDate=null;
    out.index=7;
  }
  if(out.index===7){
    out.status='completed';
    // Final validation is a second guard against unsafe or inconsistent fields.
    normalizePropertySurvey({
      propertyType:out.answers.propertyType,
      location:out.answers.location,
      area:out.answers.area||null,
      size:out.answers.size,
      budgetInr:out.answers.budgetInr??null,
      interest:out.answers.interest,
      visitDate:out.answers.visitDate||null,
      visitAt:null
    },{now});
    return response(out,'completed',
      'Staff must review all recognized answers before saving. No call or booking occurred.');
  }
  return response(out,'next_question');
}
