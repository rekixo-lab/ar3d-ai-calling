// Code-reviewed presets for the draft-only Multi-Industry Agent Builder.
// NOT a provider policy, calling permission, live call script or AI publication.
export const INDUSTRY_DRAFT_VERSION='2026-11-27-phase1';
const presets=[
 {id:'property_enquiry_v1',industry:'real_estate',label:'Real Estate Enquiry',
  description:'Property requirements and salesperson follow-up.',mode:'interactive',
  allowedModes:['interactive'],regulated:false,
  greeting:'नमस्ते, मैं आपकी कंपनी की AI सहायक हूँ। क्या अभी प्रॉपर्टी के बारे में बात करना सुविधाजनक है?',
  questions:['आप प्लॉट, फ्लैट या घर में क्या देखना चाहते हैं?','आप किस शहर में प्रॉपर्टी ढूँढ रहे हैं?','आपका अनुमानित बजट कितना है?','क्या आप आगे जानकारी चाहते हैं?'],
  closing:'धन्यवाद। हमारी टीम आपकी जानकारी की समीक्षा करेगी।'},
 {id:'school_admission_v1',industry:'school',label:'School / College Admission',
  description:'Guardian admission enquiry and authorized staff callback.',mode:'interactive',
  allowedModes:['interactive','hybrid'],regulated:false,
  greeting:'नमस्ते, मैं स्कूल की AI सहायक हूँ। क्या आप नए सत्र के admission की जानकारी लेना चाहेंगे?',
  questions:['क्या आप admission की जानकारी लेना चाहते हैं?','किस कक्षा की जानकारी चाहिए?','क्या आप हमारी admission team से संपर्क चाहते हैं?'],
  closing:'धन्यवाद। हमारी admission team आपकी enquiry की समीक्षा करेगी।'},
 {id:'appointment_reminder_v1',industry:'services',label:'Existing Customer Appointment Reminder',
  description:'General service appointment information; no private account disclosures.',mode:'announcement',
  allowedModes:['announcement','hybrid'],regulated:false,
  greeting:'नमस्ते, मैं आपकी सेवा प्रदाता कंपनी की AI सहायक हूँ। हमारी ओर से एक अपॉइंटमेंट संबंधी सूचना है।',
  questions:[],closing:'धन्यवाद। किसी बदलाव के लिए आधिकारिक कार्यालय से संपर्क करें।'},
 {id:'finance_due_notice_v1',industry:'finance',label:'Finance / NBFC Due Notice (Demo Only)',
  description:'Sensitive due-date notification requires recipient verification and current approved account records.',mode:'announcement',
  allowedModes:['announcement'],regulated:true,
  greeting:'नमस्ते, मैं वित्तीय संस्था की AI सहायक हूँ। हमारे पास खाताधारक के लिए एक निजी सूचना है। कृपया आधिकारिक माध्यम से पहचान सत्यापित करें।',
  questions:[],closing:'धन्यवाद। विवरण के लिए अधिकृत ग्राहक सेवा से संपर्क करें।'},
 {id:'banking_service_v1',industry:'banking',label:'Banking Service Information (Demo Only)',
  description:'General account-related service notification; no confidential detail without strong verification.',mode:'announcement',
  allowedModes:['announcement'],regulated:true,
  greeting:'नमस्ते, मैं बैंक की AI सहायक हूँ। हमारे पास आपके लिए एक सामान्य सेवा सूचना है।',
  questions:[],closing:'धन्यवाद। कृपया किसी सहायता के लिए बैंक के आधिकारिक चैनल का उपयोग करें।'},
 {id:'insurance_renewal_v1',industry:'insurance',label:'Insurance Renewal (Demo Only)',
  description:'Policy renewal awareness, with private policy details gated by verification.',mode:'announcement',
  allowedModes:['announcement'],regulated:true,
  greeting:'नमस्ते, मैं बीमा कंपनी की AI सहायक हूँ। एक सामान्य policy-service सूचना के लिए संपर्क किया है।',
  questions:[],closing:'धन्यवाद। किसी बदलाव के लिए आधिकारिक customer support से संपर्क करें।'}
];
export const INDUSTRY_TEMPLATES=Object.freeze(presets.map(p=>Object.freeze({
 ...p,allowedModes:Object.freeze([...p.allowedModes]),questions:Object.freeze([...p.questions]),
 callable:false,publicationAllowed:false,status:'draft_only'
})));
export const INDUSTRY_CODES=Object.freeze([...new Set(INDUSTRY_TEMPLATES.map(x=>x.industry))]);
export const getIndustryTemplate=id=>INDUSTRY_TEMPLATES.find(x=>x.id===id)||null;
const forbidden=/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
function safeText(value,min,max,label){
 if(typeof value!=='string'||value.trim().length<min||value.length>max||forbidden.test(value))
  throw Error('invalid_'+label);
 return value.trim();
}
const allowedDraftKeys=['templateId','name','mode','language','greeting','questions','closing'];
export function defaultIndustryAgentDraft(templateId,companyName=''){
 const t=getIndustryTemplate(templateId);
 if(!t)throw Error('invalid_template_id');
 const name=companyName?.trim()?companyName.trim().slice(0,85)+' · '+t.label:t.label;
 return {templateId:t.id,name,mode:t.mode,language:'hi-en',greeting:t.greeting,questions:[...t.questions],closing:t.closing};
}
export function validateIndustryAgentDraft(value,{existingTemplateId=null}={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).some(k=>!allowedDraftKeys.includes(k))||
    allowedDraftKeys.some(k=>!Object.hasOwn(value,k)))throw Error('invalid_agent_draft_fields');
 const t=getIndustryTemplate(value.templateId);
 if(!t||existingTemplateId&&existingTemplateId!==t.id)throw Error('invalid_template_id');
 if(!t.allowedModes.includes(value.mode))throw Error('invalid_call_mode');
 if(!['hi','en','hi-en'].includes(value.language))throw Error('invalid_agent_language');
 if(!Array.isArray(value.questions)||value.questions.length>12||
    (value.mode!=='announcement'&&value.questions.length===0)||
    (value.mode==='announcement'&&value.questions.length!==0))throw Error('invalid_agent_questions');
 const questions=value.questions.map(q=>safeText(q,1,250,'question'));
 return {
  templateId:t.id,name:safeText(value.name,1,120,'agent_name'),
  mode:value.mode,language:value.language,
  greeting:safeText(value.greeting,1,650,'greeting'),
  questions,
  closing:safeText(value.closing,1,450,'closing')
 };
}
export function draftOnlyPreview(config){
 const c=validateIndustryAgentDraft(config),t=getIndustryTemplate(c.templateId);
 return {
  industry:t.industry,templateId:t.id,mode:c.mode,language:c.language,
  notice:'Preview only. No voice synthesis, outbound phone call, WhatsApp message, CRM write or provider charge.',
  script:[c.greeting,...c.questions,c.closing],
  regulated:t.regulated,callable:false,publishEnabled:false
 };
}
