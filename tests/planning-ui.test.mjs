import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {js} from '../src/app-assets.mjs';
test('planning UI has valid browser JS and no call launch UI',()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  assert.match(js,/Calling Campaign Drafts/);
  assert.match(js,/AR3D Project Links/);
  assert.match(js,/No call started/);
  assert.doesNotMatch(js,/\/v1\/human\/calls\/start/);
});

test('CRM campaign editor has bounded candidate and lead paging controls',()=>{
  assert.match(js,/Previous candidates/);
  assert.match(js,/Next candidates/);
  assert.match(js,/candidateSearch/);
  assert.match(js,/offset='\+candidateOffset/);
});


test('dashboard sidebar has distinct block navigation and accessible sign-out spacing',async()=>{
  const {css,js}=await import('../src/app-assets.mjs');
  assert.match(css,/\.sidebar\{display:flex;flex-direction:column;align-items:stretch;gap:14px/);
  assert.match(css,/\.sidebar \.navitem\{display:block;margin:0/);
  assert.match(css,/\.sidebar>\.btn\{align-self:flex-start;max-width:100%;margin-top:4px/);
  assert.match(css,/\.sidebar a:focus-visible,\.sidebar button:focus-visible/);
  assert.match(js,/href:'\/app\/simulator',class:'navitem',text:'Test AI Conversation'/);
  assert.match(js,/btn\('Sign out',logout,true\)/);
});
