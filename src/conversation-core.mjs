// Deterministic, offline conversation simulator. No LLM, phone calls, or verified property facts.
// Never use simulator transcripts as proof of customer consent or DND clearance.
const MAX_QUESTIONS=25;
const MAX_TURNS=70;
const MAX_UTTERANCE=500;
const MAX_MESSAGES=150;
const optOut=/\b(?:stop calling|do not call|don't call|dont call|unsubscribe|opt\s*out|remove my number|no more calls)\b|कॉल मत|कॉल बंद|फोन मत|बात नहीं करनी|नंबर हटा|नम्बर हटा|दोबारा कॉल मत/iu;
const repeat=/^(?:repeat|again|say again|please repeat|दोबारा|फिर से|एक बार और|क्या पूछा|फिर बोलो)[।.!?\s]*$/iu;
const skip=/^(?:skip|pass|next question|पता नहीं|छोड़ो|अगला सवाल|नहीं बताना)[।.!?\s]*$/iu;
const pricing=/\b(?:price|rate|cost|availability|available|inventory|discount|loan|rera)\b|कितना रेट|क्या रेट|कीमत|प्राइस|उपलब्ध|छूट|दाम/iu;
const phrase=(lang,hi,en)=>lang==='en'?en:lang==='hi'?hi:`${hi} / ${en}`;
export function verifyQuestions(value){
  if(!Array.isArray(value)||value.length<1||value.length>MAX_QUESTIONS||value.some(q=>typeof q!=='string'||!q.trim()||q.trim().length>300))
    throw Error('Agent needs 1–25 non-empty questions, each up to 300 characters');
  return value.map(q=>q.trim());
}
export function beginSimulation(agent){
  const questions=verifyQuestions(agent?.questions);
  const lang=agent?.languageMode||'hi-en';
  if(!['hi','en','hi-en'].includes(lang))throw Error('invalid language mode');
  const greeting=phrase(lang,'नमस्ते! यह केवल AI Calling का टेस्ट है, असली कॉल नहीं।','Hello! This is only an AI Calling test, not a real call.');
  return {version:1,status:'active',languageMode:lang,index:0,questions,answers:[],
    turns:[{role:'agent',text:`${greeting}\n${questions[0]}`} ]};
}
function agentResponse(state,text){return {role:'agent',text}}
function validateState(state){
  if(!state||state.version!==1||!Array.isArray(state.turns)||!Array.isArray(state.answers)||!Array.isArray(state.questions)||state.turns.length>MAX_MESSAGES)
    throw Error('invalid simulation state');
  verifyQuestions(state.questions);
  if(!Number.isSafeInteger(state.index)||state.index<0||state.index>state.questions.length||!['active','completed','opted_out'].includes(state.status))
    throw Error('invalid simulation state');
}
export function advanceSimulation(current,message){
  validateState(current);
  if(current.status!=='active')throw Error('simulation already finished');
  if(typeof message!=='string'||!message.trim()||message.trim().length>MAX_UTTERANCE||/[\u0000-\u0008\u000b\u000e-\u001f]/u.test(message))
    throw Error('message must be 1–500 printable characters');
  if(current.turns.length>=MAX_TURNS)throw Error('simulation turn limit reached');
  const input=message.trim(),lang=current.languageMode;
  const state={...current,answers:current.answers.map(a=>({...a})),turns:[...current.turns,{role:'customer',text:input}]};
  if(optOut.test(input)){
    state.status='opted_out';state.turns.push(agentResponse(state,phrase(lang,
      'समझ गई। इस टेस्ट बातचीत को यहीं बंद करते हैं। असली नंबर की कॉलिंग अनुमति में कोई बदलाव नहीं किया गया।',
      'Understood. This test conversation is now closed. No real contact preferences were changed.')));
  }else if(repeat.test(input)){
    state.turns.push(agentResponse(state,state.questions[state.index]));
  }else if(pricing.test(input)&&input.endsWith('?') || pricing.test(input)&&/(बताओ|बताइए|क्या है|कितना है)/u.test(input)){
    state.turns.push(agentResponse(state,phrase(lang,
      'प्रोजेक्ट की सत्यापित कीमत या उपलब्धता अभी इस टेस्ट में नहीं जुड़ी है। टीम से पुष्टि करनी होगी।',
      'Verified pricing and availability are not connected to this test. Please confirm with the team.')+'\n'+state.questions[state.index]));
  }else{
    state.answers.push({questionIndex:state.index,question:state.questions[state.index],answer:skip.test(input)?null:input});
    state.index+=1;
    if(state.index>=state.questions.length){
      state.status='completed';state.turns.push(agentResponse(state,phrase(lang,
        'धन्यवाद। टेस्ट पूरा हुआ। आपकी जानकारी केवल सिमुलेशन में सेव हुई है, कोई कॉल या साइट विजिट बुक नहीं हुई।',
        'Thank you. Test completed. Responses are saved in simulation only; no call or visit was booked.')));
    }else state.turns.push(agentResponse(state,state.questions[state.index]));
  }
  if(state.turns.length>MAX_MESSAGES)throw Error('simulation message limit reached');
  return state;
}
