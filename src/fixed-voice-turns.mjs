// Deterministic phone-style seven-turn question planner for optional, local
// browser preview and future independently authenticated telecom STT adapters.
// The result is UNTRUSTED; never authorizes dialing, consent, DND or CRM writes.
import {fixedPropertyQuestions,normalizePropertySurvey} from './fixed-property-survey.mjs';

const FIELDS=['propertyType','location','area','size','budgetInr','interest','visitDate'];
const UUID_RE=/^[a-f0-9-]{36}$/i;
const STOP=/(?:stop calling|don't call|do not call|remove my number|unsubscribe|opt.?out|कॉल मत|फोन मत|दोबारा कॉल मत|नंबर हटा|नम्बर हटा|बात नहीं करनी)/iu;
// Explicit repair requests override ordinary field parsing. In particular, speech
// about a bad audio connection is NOT a city, neighborhood or plot preference.
const AGAIN=/^(?:(?:please|कृपया|जरा|ज़रा|माफ कीजिए|माफ़ कीजिए)\s+)?(?:repeat(?: please| that| question)?|again|say again|pardon|come again|can you repeat|could you repeat|what did you say|दोबारा(?: बोलिए| बताइए| पूछिए)?|दुबारा(?: बोलिए| बताइए| पूछिए)?|फिर से(?: बोलिए| बताइए| पूछिए)?|एक बार और|एक बार फिर|क्या पूछा|फिर बोलो)[।.?!\s]*$/iu;
const NOT_HEARD=/(?:सुनाई\s+नहीं|सुन\s+नहीं\s+पा|समझ\s+नहीं\s+आ|(?:आवाज|आवाज़).{0,24}(?:नहीं\s+आ|कट\s+रही|साफ\s+नहीं)|\b(?:cannot|can't|couldn't|could not|didn't|did not)\s+(?:hear|understand)\b|\b(?:voice|audio)\s+(?:is\s+)?(?:breaking|cutting)\b|\bwhat\s+did\s+you\s+say\b|क्या\s+(?:बोला|कहा))/iu;
// A correction or a question about what the agent said is not a geographic
// answer. This also applies at all later survey steps; never guess intent.
const MISUNDERSTOOD=/(?:गलत.{0,28}(?:समझ|सुन|बोल|कह|पूछ)|(?:समझ|सुना|सुन).{0,28}गलत|क्या\s+(?:बोल|कह|पूछ)\s+रहे|(?:कौन\s*सा|क्या)\s+सवाल\s+था|(?:you\s+(?:misheard|misunderstood)\s+me|you\s+(?:got|heard|understood)\s+(?:it|me|that)\s+wrong|that(?:'s| is)\s+not\s+what\s+i\s+said|what\s+(?:are|were)\s+you\s+(?:saying|asking)|please\s+ask\s+(?:the\s+question\s+)?again)|(?:dobara|dubara|phir\s+se)\s+(?:bolo|boliye|pucho|poochho|batao|bataiye)|(?:sunai\s+nahi|awaz\s+nahi\s+aa))/iu;
const NON_ANSWER=/^(?:yes|yeah|no|ok(?:ay)?|hello|hi|hmm+|uh+|हाँ|हां|जी|जी हाँ|जी नहीं|नहीं|ठीक|ठीक है|अच्छा|ओके|हेलो|नमस्ते|पता नहीं|मालूम नहीं|pata nahi|not sure|i don't know|i do not know)[।.!?\s]*$/iu;
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
  if(NON_ANSWER.test(value)||NOT_HEARD.test(value)||MISUNDERSTOOD.test(value))
    throw Error('not a location or area answer; repeat or review');
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
// Parse an entire explicit quantity, not a substring of a price, range or
// another number. Hindi ASR often writes spoken numerals as words, including
// "बारह सौ", and varies between फीट/फुट or English equivalents.
const SPOKEN_NUMBERS=Object.freeze({...HINDI_NUMBERS,
  'शून्य':0,'छह':6,'छः':6,'छे':6,'सात':7,'आठ':8,'नौ':9,
  'ग्यारह':11,'बारह':12,'तेरह':13,'चौदह':14,'सोलह':16,'सत्रह':17,'अठारह':18,'उन्नीस':19,
  'इक्कीस':21,'बाईस':22,'बाइस':22,'तेईस':23,'चौबीस':24,'छब्बीस':26,'सत्ताईस':27,'अट्ठाईस':28,'उनतीस':29,
  'इकतीस':31,'बत्तीस':32,'तैंतीस':33,'चौंतीस':34,'छत्तीस':36,'सैंतीस':37,'अड़तीस':38,'उनतालीस':39,
  'इकतालीस':41,'बयालीस':42,'तैंतालीस':43,'चवालीस':44,'छियालीस':46,'सैंतालीस':47,'अड़तालीस':48,'उनचास':49,
  'इक्यावन':51,'बावन':52,'तिरपन':53,'चौवन':54,'पचपन':55,'छप्पन':56,'सत्तावन':57,'अट्ठावन':58,'उनसठ':59,
  'इकसठ':61,'बासठ':62,'तिरसठ':63,'चौंसठ':64,'पैंसठ':65,'छियासठ':66,'सड़सठ':67,'अड़सठ':68,'उनहत्तर':69,
  'इकहत्तर':71,'बहत्तर':72,'तिहत्तर':73,'चौहत्तर':74,'पचहत्तर':75,'छिहत्तर':76,'सतहत्तर':77,'अठहत्तर':78,'उनासी':79,
  'इक्यासी':81,'बयासी':82,'तिरासी':83,'चौरासी':84,'पचासी':85,'छियासी':86,'सत्तासी':87,'अट्ठासी':88,'नवासी':89,
  'इक्यानवे':91,'बानवे':92,'तिरानवे':93,'चौरानवे':94,'पचानवे':95,'छियानवे':96,'सत्तानवे':97,'अट्ठानवे':98,'निन्यानवे':99,
  zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
  eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,
  twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90,
  ek:1,do:2,teen:3, char:4,paanch:5,panch:5,chhe:6,saat:7,aath:8,nau:9,das:10,gyarah:11,barah:12,terah:13,chaudah:14,pandrah:15,solah:16,bees:20,pachis:25,pachees:25,tees:30,chalis:40,pachas:50,
  'वन':1,'टू':2,'थ्री':3,'फोर':4,'फाइव':5,'टेन':10,'ट्वेल्व':12,'ट्वेंटी':20,'थर्टी':30,'फोर्टी':40,'फिफ्टी':50
});
const SPOKEN_SCALES=Object.freeze({'सौ':100,'हजार':1000,'हज़ार':1000,'लाख':100000,'करोड़':10000000,'करोड':10000000,hundred:100,thousand:1000,lakh:100000,lac:100000,crore:10000000,sau:100,hazar:1000,hazaar:1000,'हंड्रेड':100,'थाउजेंड':1000,'थाउज़ेंड':1000,'थाउजंड':1000});
function quantityText(value){
  return digits(value.normalize('NFC')).toLowerCase().trim().replace(/[।.!?]+$/u,'').trim()
    .replace(/^(?:(?:जी|हाँ|हां|मुझे|हमको|हमें|लगभग|करीब|about|around|approximately|i (?:want|need))\s+)+/iu,'')
    .replace(/\s+(?:(?:का|की)\s+प्लॉट\s+)?(?:चाहिए|चाहिये|लेना है|का चाहिए|का प्लॉट|please)$/iu,'').trim();
}
function spokenQuantity(value){
  const s=value.trim().replace(/(?<=\d),(?=\d{2,3}(?:,|\b))/g,'');
  if(/^\d+(?:\.\d+)?$/.test(s))return Number(s);
  const tokens=s.split(/\s+/);
  let total=0,group=null,lastScale=Infinity,previousWord=false;
  for(const token of tokens){
    if(Object.hasOwn(SPOKEN_SCALES,token)){
      const scale=SPOKEN_SCALES[token];
      if(scale>=lastScale||group===0||group===null)return null;
      total+=group*scale;group=null;lastScale=scale;previousWord=false;continue;
    }
    const n=/^\d+$/.test(token)?Number(token):Object.hasOwn(SPOKEN_NUMBERS,token)?SPOKEN_NUMBERS[token]:null;
    if(n===null||!Number.isSafeInteger(n)||n<0)return null;
    if(group===null){group=n;previousWord=/^(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)$/.test(token)}
    else if(previousWord&&n>0&&n<10){group+=n;previousWord=false}
    else return null;
  }
  if(group!==null&&group>=lastScale)return null;
  const result=total+(group??0);
  return Number.isSafeInteger(result)&&result>0?result:null;
}
const AREA_UNIT=/(वर्ग\s*(?:फुट|फीट|फीट्|फिट)|स्क्वेयर\s*(?:फुट|फीट|फिट)|स्क्वायर\s*(?:फुट|फीट|फिट)|square\s*(?:feet|foot)|sq\.?\s*(?:ft\.?|feet|foot)|sqft|sq\s*feet|वर्ग\s*गज|square\s*yards?|sq\.?\s*yds?|गज|yards?|फीट|फुट|फिट|feet|foot|ft\.?)$/iu;

function unclearPlotSize(){throw Error('unclear plot dimensions; say one size and its units explicitly')}
function parseSize(str,propertyType){
  if(propertyType==='plot'){
    const value=quantityText(str);
    if(value.length>120)return unclearPlotSize();
    // Dimensions preserve both numbers; never turn a range into one area.
    const dimension=value.match(/^(.+?)\s*(?:×|x|\bby\b|बाय|गुणा)\s*(.+?)(?:\s*(?:फुट|फीट|feet|foot|ft))?$/iu);
    if(dimension){
      const a=spokenQuantity(dimension[1]),b=spokenQuantity(dimension[2]);
      if(Number.isFinite(a)&&a>0&&a<=100000&&Number.isFinite(b)&&b>0&&b<=100000)
        return a+' x '+b+( /(?:फुट|फीट|feet|foot|ft)$/iu.test(value)?' ft':'');
      return unclearPlotSize();
    }
    const unit=value.match(AREA_UNIT);
    if(!unit)return unclearPlotSize();
    const n=spokenQuantity(value.slice(0,unit.index).trim());
    if(!Number.isFinite(n)||n<=0||n>100000000)return unclearPlotSize();
    const unitText=unit[0];
    if(/(?:गज|yard|yd)/iu.test(unitText))return n+' वर्ग गज';
    return n+' वर्ग फुट';
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
  // A bare "no / नहीं" with "yes / हाँ" is contradictory, not consent
  // or interest. Do not silently mark an interested customer.
  if(agree&&/(?:\b(?:no|nope|nah)\b|नहीं)/iu.test(str))
    throw Error('conflicting interest answer; repeat or review');
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
    if(AGAIN.test(input)||NOT_HEARD.test(input)||MISUNDERSTOOD.test(input)||confidence<0.70)
      throw Error('recognition unclear; repeat question');
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
