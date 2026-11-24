import test from 'node:test';
import assert from 'node:assert/strict';
import {beginFixedVoicePreview,advanceFixedVoicePreview,advanceContextualVoice} from '../src/fixed-voice-turns.mjs';
const now=Date.parse('2026-11-24T09:00:00Z');
const advance=(state,transcript)=>advanceFixedVoicePreview(state,{transcript,now});
const location=()=>advance(beginFixedVoicePreview({now}).state,'प्लॉट').state;
test('spoken city and area wrappers are removed without inventing geography',()=>{
 for(const [input,expected] of [['मुझे शहर कोरबा में चाहिए','कोरबा'],['जी रायपुर में चाहिए','रायपुर'],['I prefer New Town please','New Town'],['  Sector   17  ','Sector 17'],['नया अज्ञात नगर','नया अज्ञात नगर']]){
  const result=advance(location(),input);
  assert.equal(result.action,'next_question',input);
  assert.equal(result.state.answers.location,expected,input);
 }
 const city=advance(location(),'कोरबा').state;
 assert.equal(advance(city,'मुझे बस स्टैंड के पास चाहिए').state.answers.area,'बस स्टैंड के पास');
});
test('questions, ambiguous alternatives and non-specific answers cannot become geographic data',async()=>{
 for(const input of ['रायपुर या दुर्ग','Raipur or Durg','आपके पास कहाँ है','Where is the project?','कहीं भी','मुझे पता नहीं','12345']){
  const state=location();
  const result=advance(state,input);
  assert.equal(result.action,'repeat',input);
  assert.equal(result.state.answers.location,undefined,input);
  let calls=0;
  const contextual=await advanceContextualVoice({async run(){calls++;return {response:{action:'answer',value:'दुर्ग',evidence:'दुर्ग'}}}},state,{transcript:input,now});
  assert.equal(contextual.result.action,'repeat',input);
  assert.equal(calls,0,input);
 }
});
