# Production School voice runtime — integration contract

This work targets the existing production Worker, Control D1, shared CRM D1,
private RECORDINGS R2, Plivo and Sarvam. No staging resources, new credentials,
actual provider requests, phone calls or test phone calls are created by this PR.

## Implemented

- School-only linear production voice plan (one to three questions). The exact
  independently reviewed graph and SHA-256 digest are checked. Hinglish uses
  the existing Hindi speech recognition language; English uses en-IN.
- Canonical per-version, per-node MP3 manifest. Keys are derived under
  industry-voice/v1/<tenant>/<snapshot>/<graph digest>/<node>/<audio digest>.mp3
  in the existing private RECORDINGS bucket. Reads validate exact byte size,
  SHA-256, content type and an MP3 frame/header sanity check (not decoding or
  verification that speech matches text). Audio URLs use short-lived,
  domain-separated HMAC capabilities bound to call UUID, session and turn.
- Existing signature-verified Plivo callback routes only server-created
  phoneMeta.mode=industry_school_v1 commercial sessions to this adapter.
  The legacy Real Estate fixed questionnaire and prompt paths remain unchanged
  for their own rows. No new public session creation endpoint exists.
- Requires separate explicit School voice enablement, existing campaign/Sarvam
  disclosure flags, active tenant, matching shared minute AND provider-cost
  reservation, exact unrevoked reviewed School recipient scope, and unexpired
  session. First answer requires the recorded accepted RequestUUID plus exact
  caller, recipient and signed CallUUID. A callback arriving before the recorded
  request UUID gets 503 rather than authorizing an unbound call.
- Fixed company-named AI/recording/processing notice, explicit keypad consent;
  no recording before consent. Up to eight seconds per answer, at most two
  attempts per question; authenticated Plivo recording metadata must match the
  exact bound call, approved media host and recording path. Existing Sarvam
  STT API is used once per claimed recording/turn, no paid retry or LLM.
  Obvious identifier/credential patterns are rejected; accepted short answers
  are unverified responses, not authoritative customer facts. No raw audio,
  provider recording URL, or separate full transcript is stored by this code.
  Screening is not a complete personal-data detector.
- Atomic phase/turn/previous-state compare-and-swap. Provider cost uncertainty
  is persisted before STT; confirmed requests update existing cost-meter fields.
  A crash locks the turn; no automatic repeat. Revocation, archive, lead
  changes and opt-out rechecked during playback and speech processing.
  Explicit opt-out uses existing CRM-wide suppression. Signed hangup preserves
  evidence even after revocation or disabling (bounded late evidence window).
  The engine ends safely on invalid, stale or unsupported state; duplicate
  historical callbacks do not advance or re-transcribe.
- Answers and meters remain in the existing scripted_phone_pilots.survey_json
  under industryVoice/phoneMeta. No property CRM fields or legacy result
  records are updated by this flow. Provider-side recording deletion and
  production industry result retention/export/deletion still need integration.

## Still required before dispatch

The existing calling_jobs/calling_runs are bound to property campaign drafts.
Do not create a fake property campaign to dial School customers. Implement a
purpose-aware job/queue schema and shared concurrency, funded reservation,
carrier dispatch, unknown-outcome recovery, CDR reconciliation and result
adapter. The future dispatcher must verify the approved campaign, latest
recipient review and exact frozen manifest, claim one job before reserving,
check all audio objects, reserve shared credit/provider funds, construct
beginSchoolVoiceSession(scope, pack) only from trusted server records, insert
the server-owned session with its exact job/tenant/lead/destination/actor, and
submit the call once with the existing carrier time limit. Bind the accepted
provider request UUID before releasing any answer callback. No new sessions
are created by the present PR. The existing runtime's callback adapter is not
a dialing authorization; the new enable flag defaults closed and must not be
turned on independently of the remaining integrations.

An independently funded, one-claim Sarvam TTS preparation job must produce
and review actual MP3 assets before any manifest is approved; this PR only
implements the immutable manifest/playback contract. There is no TTS
generation, production School call dispatch, customer call or cost debit here.
Real provider interoperability, approved company/purpose/caller configuration,
recording retention and audio quality have not been independently confirmed.
Finance, banking, insurance, arbitrary branching, dynamic account details,
appointment and custom Real Estate remain out of this initial runtime scope.

Automated in-memory fixture tests use fictional numbers, synthetic MP3 headers
and mocked Plivo/Sarvam/R2. They do not connect to providers or establish real
carrier compatibility. A green CI and reviewed production deployment remain
necessary; no separate staging setup is planned.

## Audit follow-up

A signed keypad opt-out remains actionable after consent-stage hangup or revocation. For a recording already claimed before hangup, explicit spoken opt-out is committed using the exact call, turn and pending document even if hangup set needs_review. Ordinary late speech cannot advance or save an answer; its confirmed metering is retained. The default admission-interest question closes on a clear negative answer without making that an all-future-calls opt-out. Arbitrary edited questions still require explicit typed branching; a bare no is not assumed to mean refusal for unrelated questions. No dispatcher, TTS job or activation is added.

Combined reliability verification also covers a claimed opt-out finishing after company suspension, without restoring tenant access or permitting new calls.
