import test from 'node:test';
import assert from 'node:assert/strict';
import {createSarvamContextualAdapter} from '../src/sarvam-contextual.mjs';
import {beginFixedVoicePreview,advanceFixedVoicePreview,advanceInternalVoice} from '../src/fixed-voice-turns.mjs';
const now=Date.now();
function budgetState(){
 let s=beginFixedVoicePreview({language:'hi',now}).state;
 for(const transcript of ['प्लॉट','रायपुर','अमलीडीह','1000 वर्ग फुट'])s=advanceFixedVoicePreview(s,{transcript,now}).state;
 return s;
}
test('Sarvam contextual adapter is direct-first: clear Hindi amount requires zero LLM calls',async()=>{
 const adapter=createSarvamContextualAdapter('test-key',async()=>{throw Error('unexpected network')});
 const {result,interpreter}=await advanceInternalVoice(adapter,budgetState(),{transcript:'बीस लाख',now});
 assert.equal(result.state.answers.budgetInr,2000000);assert.equal(interpreter,'direct');assert.equal(adapter.requests,0);assert.equal(adapter.usage,null);
});
test('Sarvam adapter uses bounded structured proposal and existing validation; no retries',async()=>{
 const adapter=createSarvamContextualAdapter('test-key',async(url,opts)=>{
  assert.equal(url,'https://api.sarvam.ai/v1/chat/completions');assert.equal(opts.redirect,'manual');
  assert.equal(opts.headers['api-subscription-key'],'test-key');
  const b=JSON.parse(opts.body);assert.equal(b.model,'sarvam-105b-conversations');assert.equal(b.max_tokens,160);assert.equal(b.response_format.json_schema.strict,true);assert.equal(b.response_format.json_schema.schema.type,'object');assert.equal(b.tools,undefined);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'answer',value:'2000000',evidence:'बीस लाख'})}}],usage:{prompt_tokens:600,completion_tokens:35}});
 });
 const {result,interpreter}=await advanceInternalVoice(adapter,budgetState(),{transcript:'मेरा बजट बीस लाख रुपये तक ही है',now});
 assert.equal(result.state.answers.budgetInr,2000000);assert.equal(interpreter,'contextual');assert.equal(adapter.requests,1);assert.deepEqual(adapter.usage,{inputTokens:600,outputTokens:35});
 await assert.rejects(adapter.run('ignored',{}));
});
test('Sarvam contextual provider redirect cannot leak credential or authorize a guessed answer',async()=>{
 const adapter=createSarvamContextualAdapter('test-key',async()=>new Response(null,{status:302,headers:{Location:'https://untrusted.invalid'}}));
 const {result,interpreter}=await advanceInternalVoice(adapter,budgetState(),{transcript:'मेरा बजट बीस लाख रुपये तक ही है',now});
 assert.equal(result.action,'repeat');assert.equal(interpreter,'contextual_unavailable');assert.equal(adapter.requests,1);
});
