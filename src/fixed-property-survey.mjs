// Boss-approved small, deterministic property qualification flow.
// Name and mobile already exist in Excel/CRM and must NEVER be asked again.
// No LLM, telephony, recording or inferred consent.
export const PROPERTY_TYPES=Object.freeze(['plot','flat','house']);
export const BHK_OPTIONS=Object.freeze(['1BHK','2BHK','3BHK','4BHK','5BHK+']);
export const INTERESTS=Object.freeze(['interested','later','not_interested']);
const CLEAN=/[\u0000-\u001f\u007f]/u;
const fields=Object.freeze(['propertyType','location','area','size','budgetInr',
  'interest','visitDate','visitAt']);
export function fixedPropertyQuestions(propertyType='plot',language='hi'){
  if(!PROPERTY_TYPES.includes(propertyType)||!['hi','en'].includes(language))
    throw Error('invalid qualification question settings');
  const hindi=language==='hi';
  return Object.freeze([
    {field:'propertyType',kind:'choice',text:hindi?
      'आप प्लॉट, फ्लैट या घर में से क्या देख रहे हैं?':
      'Are you looking for a plot, flat or house?',options:PROPERTY_TYPES},
    {field:'location',kind:'text',text:hindi?
      'आप किस शहर या लोकेशन में प्रॉपर्टी देख रहे हैं?':
      'Which city or location are you considering?'},
    {field:'area',kind:'text',text:hindi?
      'उस शहर में कौन-सा एरिया पसंद है?':
      'Which neighborhood or area do you prefer?'},
    {field:'size',kind:propertyType==='plot'?'text':'choice',
      text:hindi?(propertyType==='plot'?'कितने साइज का प्लॉट चाहिए, जैसे 1200 वर्गफुट?':
        'कितने BHK चाहिए, जैसे 2BHK या 3BHK?'):
        (propertyType==='plot'?'What plot size do you need, for example 1200 square feet?':
          'How many bedrooms do you need, such as 2BHK or 3BHK?'),
      ...(propertyType==='plot'?{}:{options:BHK_OPTIONS})},
    {field:'budgetInr',kind:'number',text:hindi?
      'आपका लगभग बजट कितने रुपये का है?':
      'What is your approximate budget in rupees?'},
    {field:'interest',kind:'choice',text:hindi?
      'क्या आप प्रॉपर्टी देखने में इंटरेस्टेड हैं, या बाद में बात करना चाहेंगे?':
      'Are you interested in viewing a property, or should we follow up later?',
      options:INTERESTS},
    {field:'visitDate',kind:'date',text:hindi?
      'यदि आप इंटरेस्टेड हैं, तो साइट विजिट किस तारीख को करना चाहेंगे?':
      'If interested, on which date would you prefer a site visit?'}
  ]);
}
function stringOrNull(value,label,max,{required=false}={}){
  if(value===null||value===undefined||value===''){
    if(required)throw Error('invalid '+label);
    return null;
  }
  if(typeof value!=='string'||CLEAN.test(value)||value.trim().length<2||
     value.trim().length>max)throw Error('invalid '+label);
  return value.trim();
}
function calendarDate(value){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw Error('invalid visit date');
  const date=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)
    throw Error('invalid visit date');
  return value;
}
export function normalizePropertySurvey(raw,{now=Date.now()}={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     Object.keys(raw).some(k=>!fields.includes(k))||
     !Number.isFinite(now))throw Error('invalid property survey');
  const propertyType=raw.propertyType;
  if(!PROPERTY_TYPES.includes(propertyType))throw Error('invalid property type');
  const location=stringOrNull(raw.location,'location',120,{required:true});
  const area=stringOrNull(raw.area,'area',120);
  let size=stringOrNull(raw.size,'property size',80,{required:true});
  if(propertyType!=='plot'&&!BHK_OPTIONS.includes(size))
    throw Error('invalid BHK selection');
  const budgetInr=raw.budgetInr===null||raw.budgetInr===undefined||raw.budgetInr===''?
    null:raw.budgetInr;
  if(budgetInr!==null&&(!Number.isSafeInteger(budgetInr)||budgetInr<1||
     budgetInr>1000000000000))throw Error('invalid budget');
  const interest=raw.interest;
  if(!INTERESTS.includes(interest))throw Error('invalid interest');
  const visitDate=calendarDate(raw.visitDate);
  if(interest!=='interested'&&visitDate!==null)
    throw Error('visit date only applies to interested customers');
  const visitAt=raw.visitAt===null||raw.visitAt===undefined||raw.visitAt===''?
    null:raw.visitAt;
  let visitIso=null;
  if(visitAt!==null){
    if(interest!=='interested'||visitDate===null||
       typeof visitAt!=='string'||
       !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(visitAt))
      throw Error('invalid visit time');
    const when=Date.parse(visitAt);
    if(!Number.isFinite(when)||when<now+60000||when>now+366*86400000)
      throw Error('visit time must be a valid future time');
    visitIso=new Date(when).toISOString();
    // India-local date; avoids accidentally booking the previous UTC day.
    if(new Date(when+330*60000).toISOString().slice(0,10)!==visitDate)
      throw Error('visit date and time mismatch');
  }
  return Object.freeze({propertyType,location,area,size,budgetInr,
    interest,visitDate,visitAt:visitIso});
}
export function surveyToCrm(survey){
  return Object.freeze({
    preferredLocation:survey.location,
    plotSizePreference:survey.size,
    budgetMaxInr:survey.budgetInr,
    interestStatus:survey.interest==='interested'?'interested':
      survey.interest==='later'?'followup':'not_interested',
    visitDatePreference:survey.visitDate,
    visitRequested:Boolean(survey.visitAt)
  });
}
