import test from 'node:test';
import assert from 'node:assert/strict';
import {addVoiceTiming,summarizeVoiceTiming} from '../src/voice-timing.mjs';
test('bounded timing evidence excludes missing values and reports nearest-rank percentiles',()=>{
 let s=addVoiceTiming(null,{mediaMs:100,recognitionMs:300,interpretationMs:10});
 s=addVoiceTiming(s,{mediaMs:200,recognitionMs:400,interpretationMs:20});
 s=addVoiceTiming(s,{mediaMs:null,recognitionMs:300,interpretationMs:10});
 const x=summarizeVoiceTiming(s);assert.equal(x.samples,2);assert.equal(x.totalP50Ms,410);assert.equal(x.totalP95Ms,620);
 assert.equal(summarizeVoiceTiming(null).totalP95Ms,null);
 for(let i=0;i<30;i++)s=addVoiceTiming(s,{mediaMs:i,recognitionMs:1,interpretationMs:1});
 assert.equal(s.length,25);assert.equal(s[0][0],5);
});
