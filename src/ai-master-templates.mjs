// Reviewed, code-versioned Master AI templates. Do not mutate saved client
// versions when a global template changes. Never infer calling consent.
import {emptyCompanyProfile,validateCompanyProfile,compileCompanyFacts} from './company-profile.mjs';
import {validateScript,compileScript} from './calling-script-core.mjs';

export const MASTER_TEMPLATE_VERSION='2026-11-21-v1';
export const MASTER_TEMPLATES=Object.freeze([
 Object.freeze({id:'plot_sales',label:'Plot Sales',propertyType:'Residential plots'}),
 Object.freeze({id:'flat_sales',label:'Flat Sales',propertyType:'Flats / apartments'}),
 Object.freeze({id:'property_followup',label:'Property Follow-up',propertyType:'Properties'}),
 Object.freeze({id:'property_enquiry',label:'Real Estate Enquiry',propertyType:'Properties'})
]);
const VALID_FIELDS=new Set(['templateId','companyName','projectName','location','price','size','language']);
const LIMITS=Object.freeze({companyName:160,projectName:120,location:160,price:160,size:120});
const NO_CONTROL=/[\u0000-\u001f\u007f]/u;

function field(value,key){
 if(typeof value!=='string'||value.length>LIMITS[key]||NO_CONTROL.test(value))
  throw Error('invalid_'+key);
 return value.trim();
}
export function validateQuickSetup(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
   Object.keys(input).some(k=>!VALID_FIELDS.has(k)))throw Error('invalid_quick_setup');
 const template=MASTER_TEMPLATES.find(t=>t.id===input.templateId);
 if(!template)throw Error('invalid_master_template');
 const language=input.language||'hi-en';
 if(!['hi','en','hi-en'].includes(language))throw Error('invalid_language');
 return {
  template,language,
  companyName:field(input.companyName??'','companyName'),
  projectName:field(input.projectName??'','projectName'),
  location:field(input.location??'','location'),
  price:field(input.price??'','price'),
  size:field(input.size??'','size')
 };
}

function questions(kind){
 const end='यदि आप चाहें तो साइट विजिट के लिए कौन सा दिन सुविधाजनक रहेगा? यह अभी बुकिंग नहीं है।';
 const common=[
  'आप किस शहर या लोकेशन में प्रॉपर्टी देख रहे हैं?',
  'कौन सा इलाका आपकी प्राथमिकता है?',
  'आपका अनुमानित बजट कितना है?',
  'क्या आप अभी अधिक जानकारी चाहते हैं या बाद में बात करना पसंद करेंगे?'
 ];
 if(kind==='plot_sales')return [
  'आप किस तरह का प्लॉट देख रहे हैं?',
  common[0],common[1],
  'लगभग कितना प्लॉट साइज चाहिए, जैसे वर्गफुट में?',
  common[2],common[3],end
 ];
 if(kind==='flat_sales')return [
  'आप किस तरह का फ्लैट देख रहे हैं?',
  common[0],common[1],
  'कितने BHK का फ्लैट चाहिए?',
  common[2],common[3],end
 ];
 return [
  'आप फिलहाल प्लॉट, फ्लैट या घर में किस तरह की प्रॉपर्टी के बारे में जानना चाहते हैं?',
  common[0],common[1],
  'आपको लगभग कितना साइज या कितने BHK चाहिए?',
  common[2],common[3],end
 ];
}

export function buildMasterAIQuickSetup(raw,companyName){
 const d=validateQuickSetup(raw);
 if(typeof companyName!=='string'||!companyName.trim()||companyName.length>160||NO_CONTROL.test(companyName))
  throw Error('invalid_company_name');
 const company=d.companyName||companyName.trim();
 const profile=emptyCompanyProfile();
 profile.companyName=company;
 profile.propertyTypes=d.template.propertyType;
 profile.projects=d.projectName;profile.locations=d.location;
 profile.pricing=d.price;
 if(d.size)profile.additionalFacts='Company-provided property sizes: '+d.size;
 validateCompanyProfile(profile);

 const en=d.language==='en';
 const greeting=en?
  'Hello! I am the AI calling assistant for '+company+'. Is this a convenient time to talk about property information?':
  'नमस्ते! मैं '+company+' की AI कॉलिंग सहायक बोल रही हूँ। क्या अभी प्रॉपर्टी के बारे में बात करना सुविधाजनक है?';
 const faqs=[];
 // Do not duplicate mutable prices, locations or sizes in immutable FAQ
 // script versions. Reference the current approved company-facts version instead,
 // so a price-only company update can reuse the unchanged Master AI script.
 if(d.location)faqs.push({
  question:'प्रॉपर्टी की लोकेशन कहाँ है?',
  answer:'कॉल में साथ प्रकाशित कंपनी की वर्तमान स्वीकृत लोकेशन की जानकारी ही बताएं। उपलब्धता और सही रास्ते की पुष्टि सेल्स टीम से करें।'
 });
 if(d.price)faqs.push({
  question:'प्रॉपर्टी की कीमत कितनी है?',
  answer:'कॉल में साथ प्रकाशित कंपनी की वर्तमान स्वीकृत कीमत की जानकारी ही बताएं। अंतिम कीमत, उपलब्धता और ऑफर की पुष्टि टीम से करें।'
 });
 if(d.size)faqs.push({
  question:'प्रॉपर्टी का साइज कितना है?',
  answer:'कॉल में साथ प्रकाशित कंपनी की वर्तमान स्वीकृत साइज की जानकारी ही बताएं। वास्तविक यूनिट या प्लॉट उपलब्धता की पुष्टि टीम से करें।'
 });
 const config=validateScript({
  name:d.template.label+' · Master v1',
  language:d.language,
  greeting,
  questions:questions(d.template.id),
  faqs,
  rules:'पहले पूछें कि बात करना सुविधाजनक है या नहीं। केवल अधिकृत और सत्यापित ग्राहक सूची से कॉल किए जा सकते हैं; इस ड्राफ्ट से कॉल करने की अनुमति नहीं मिलती। यदि नाम और मोबाइल CRM में हैं तो अनावश्यक रूप से दोबारा न पूछें। एक समय पर एक सवाल पूछें। ग्राहक मना करे या दोबारा कॉल न करने को कहे तो तुरंत सम्मानपूर्वक समाप्त करें। सिर्फ कंपनी द्वारा दी गई जानकारी बताएं। कीमत, साइज, सुविधाएँ या सरकारी मंजूरी अनुमान से न बताएं। साइट विजिट केवल अनुरोध है, पुष्टि नहीं।',
  closing:'धन्यवाद! यदि आप चाहें तो हमारी टीम उपलब्ध जानकारी और आपकी सुविधानुसार अगले कदम की पुष्टि करेगी।'
 });
 const warnings=[];
 if(d.companyName&&d.companyName!==companyName.trim())warnings.push('Company name differs from the client account label; verify the approved legal/business name before publishing.');
 if(!d.projectName)warnings.push('Project name is not provided; AI will not invent one.');
 if(!d.location)warnings.push('Location is not provided; AI must ask or offer staff confirmation.');
 if(!d.price)warnings.push('Price is not provided; AI will not quote an invented price.');
 if(!d.size)warnings.push('Size is not provided; AI will not quote an invented size.');
 const prompt=compileScript(config)+'\n\n'+compileCompanyFacts(profile);
 return Object.freeze({templateId:d.template.id,templateVersion:MASTER_TEMPLATE_VERSION,profile,config,prompt,warnings});
}
