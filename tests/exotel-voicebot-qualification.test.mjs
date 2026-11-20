import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileVoicebotQualification,runVoicebotQualificationFixture
} from '../src/exotel-voicebot-qualification.mjs';

const NOW=Date.parse('2026-11-20T07:30:00+05:30');

test('Exotel official transcript-shaped seven question plot and flat records are provisional only',()=>{
  for(const scenario of ['plot_complete','flat_complete','out_of_order','retry_duplicate']){
    const r=runVoicebotQualificationFixture(scenario,{now:NOW});
    assert.equal(r.status,'provisional_review_ready');
    assert.equal(r.provisionalSurvey.location,'Raipur');
    assert.equal(r.provisionalSurvey.area,'Shankar Nagar');
    assert.equal(r.provisionalSurvey.visitAt,null);
    assert.equal(r.provisionalSurvey.budgetInr,
      scenario==='flat_complete'?3500000:2500000);
    assert.equal(r.provisionalSurvey.propertyType,
      scenario==='flat_complete'?'flat':'plot');
    assert.equal(r.provisionalSurvey.size,
      scenario==='flat_complete'?'3BHK':'1200 sqft');
    assert.equal(r.humanReviewRequired,true);
    assert.equal(r.sourceAuthenticated,false);
    assert.equal(r.consentVerified,false);
    assert.equal(r.dndVerified,false);
    assert.equal(r.crmWrites,0);
    assert.equal(r.realCallsStarted,0);
    assert.equal(r.visitsConfirmed,0);
    assert.ok(!JSON.stringify(r).includes('fictional-session-2026'));
    assert.ok(!JSON.stringify(r).includes('fictional-event'));
    assert.ok(!JSON.stringify(r).includes('CAfictional'));
  }
});
test('not interested ends after six answers without fabricated visit',()=>{
  const r=runVoicebotQualificationFixture('not_interested',{now:NOW});
  assert.equal(r.status,'provisional_review_ready');
  assert.equal(r.provisionalSurvey.interest,'not_interested');
  assert.equal(r.provisionalSurvey.visitDate,null);
  assert.equal(r.customerAnswers,6);
});
test('session-end must be seen; transcript events alone cannot confirm completion',()=>{
  const r=runVoicebotQualificationFixture('incomplete',{now:NOW});
  assert.equal(r.status,'needs_human_review');
  assert.equal(r.sessionEndReceived,false);
  assert.equal(r.crmWrites,0);
});
test('opt-out transcript is never turned into a scheduled visit or a CRM edit',()=>{
  const r=runVoicebotQualificationFixture('opt_out',{now:NOW});
  assert.equal(r.status,'opt_out_needs_verification');
  assert.equal(r.optOutReviewNeeded,true);
  assert.equal(r.provisionalSurvey,null);
  assert.equal(r.crmWrites,0);
});
test('conflicting completed sequence is rejected before any state can be used',()=>{
  assert.throws(()=>runVoicebotQualificationFixture('conflict',{now:NOW}),
    /conflicting completed turn sequence/);
});
test('only bounded allowed scenarios, language and clock are accepted',()=>{
  assert.throws(()=>runVoicebotQualificationFixture('send_calls',{now:NOW}),/scenario/);
  assert.throws(()=>runVoicebotQualificationFixture('plot_complete',{now:NaN}),/time/);
  assert.throws(()=>compileVoicebotQualification([],{
    language:'hi',now:NOW
  }),/delivery count/);
});
