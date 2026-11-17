import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyQuestions,beginSimulation,advanceSimulation} from '../src/conversation-core.mjs';
const agent={languageMode:'hi-en',questions:['आपका नाम क्या है?','कहाँ प्लॉट चाहिए?','बजट कितना है?']};
test('questions need strict validated limits',()=>{
  assert.throws(()=>verifyQuestions([]),/1–25/);
  assert.throws(()=>verifyQuestions(Array(26).fill('a')),/1–25/);
  assert.throws(()=>verifyQuestions(['  ']),/1–25/);
  assert.deepEqual(verifyQuestions(['  मेरा बजट? ']),['मेरा बजट?']);
});
test('simulator asks each configured question and records only raw answers',()=>{
  let s=beginSimulation(agent);
  assert.match(s.turns[0].text,/आपका नाम/);
  s=advanceSimulation(s,'सुमित');assert.equal(s.answers[0].answer,'सुमित');assert.equal(s.index,1);
  s=advanceSimulation(s,'इंदौर');assert.equal(s.index,2);
  s=advanceSimulation(s,'25 लाख');assert.equal(s.status,'completed');assert.equal(s.answers.length,3);
  assert.throws(()=>advanceSimulation(s,'extra'),/finished/);
});
test('repeat does not consume question',()=>{
  const s=advanceSimulation(beginSimulation(agent),'फिर से');assert.equal(s.index,0);assert.equal(s.answers.length,0);
  assert.match(s.turns.at(-1).text,/नाम/);
});
test('skip records null and advances',()=>{
  const s=advanceSimulation(beginSimulation(agent),'skip');assert.equal(s.index,1);assert.equal(s.answers[0].answer,null);
});
test('opt-out stops simulation without changing CRM permissions',()=>{
  const s=advanceSimulation(beginSimulation(agent),'कॉल मत करना');assert.equal(s.status,'opted_out');assert.equal(s.index,0);
  assert.match(s.turns.at(-1).text,/असली नंबर/);
});
test('unsupported real estate facts are not invented',()=>{
  const s=advanceSimulation(beginSimulation(agent),'What is the plot price?');assert.equal(s.index,0);
  assert.match(s.turns.at(-1).text,/Verified pricing/);assert.equal(s.answers.length,0);
});
test('empty, control codes and oversized input rejected',()=>{
  for(const v of ['', 'a'.repeat(501), 'hello\u0001'])assert.throws(()=>advanceSimulation(beginSimulation(agent),v));
});
test('English and Hindi agents honor their language modes',()=>{
  assert.match(beginSimulation({...agent,languageMode:'en'}).turns[0].text,/Hello/);
  assert.doesNotMatch(beginSimulation({...agent,languageMode:'hi'}).turns[0].text,/Hello/);
});
test('draft simulation state limits guard corrupted or unexpected sessions',()=>{
  assert.throws(()=>advanceSimulation({status:'active',version:1,answers:[],turns:[],questions:[],index:0},'hi'));
});
