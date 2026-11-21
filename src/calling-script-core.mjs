import {verifyQuestions} from './conversation-core.mjs';
const text=(v,max,optional=false)=>typeof v==='string'&&(optional||v.trim())&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
export const defaultScript=()=>({name:'Property enquiry',language:'hi-en',greeting:'नमस्ते! मैं कंपनी की AI सहायक हूँ। क्या अभी बात करना सुविधाजनक है?',questions:['आप किस प्रकार की प्रॉपर्टी देख रहे हैं?','आपका अनुमानित बजट क्या है?','आप किस लोकेशन में प्रॉपर्टी चाहते हैं?','क्या आप साइट विजिट करना चाहेंगे?'],faqs:[],rules:'एक बार में एक सवाल पूछें। ग्राहक के जवाब के अनुसार अगला प्रासंगिक सवाल पूछें।',closing:'आपके समय के लिए धन्यवाद। हमारी टीम आगे संपर्क करेगी।'});
export function validateScript(d){
 if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!['name','language','greeting','questions','faqs','rules','closing'].includes(k))||!text(d.name,100)||!['hi','en','hi-en'].includes(d.language)||!text(d.greeting,1000)||!text(d.rules,5000,true)||!text(d.closing,1000)||!Array.isArray(d.faqs)||d.faqs.length>25||d.faqs.some(f=>!f||Object.keys(f).sort().join(',')!=='answer,question'||!text(f.question,300)||!text(f.answer,1000)))throw Error('invalid_script');
 return {name:d.name.trim(),language:d.language,greeting:d.greeting.trim(),questions:verifyQuestions(d.questions),faqs:d.faqs.map(f=>({question:f.question.trim(),answer:f.answer.trim()})),rules:d.rules.trim(),closing:d.closing.trim()};
}
export function compileScript(value){
 const d=validateScript(value);
 return ['AR3D customer conversation instructions',
 'You are the company’s AI calling assistant. Identify yourself as AI. These instructions do not grant calling consent or authorize CRM changes.',
 'Use a female assistant persona. In Hindi refer to yourself in the feminine: बोल रही हूँ, कर सकती हूँ, समझ गई. Do not assume the customer’s gender.',
 'Language: '+d.language+'. Follow the customer’s preferred supported language. Speak naturally and briefly; ask one question at a time.',
 'If the customer declines, asks not to be called, or withdraws consent: acknowledge and end the call immediately. Never continue persuasion.',
 'Use only the approved facts below. Never invent prices, availability, discounts, legal approvals, appointments or confirmed site visits. If uncertain, offer a team follow-up. Never claim that an action or booking succeeded without a confirmed tool result.',
 'Opening: '+d.greeting,'Questions in preferred order:',...d.questions.map((q,i)=>(i+1)+'. '+q),
 'Approved answers:',...d.faqs.map(f=>'Q: '+f.question+'\nA: '+f.answer),
 'Company conversation rules (subject to the above requirements):\n'+d.rules,'Closing: '+d.closing].join('\n\n');
}
