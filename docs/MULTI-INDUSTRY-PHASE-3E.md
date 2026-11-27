# Phase 3E — one-device School voice staging runtime

## Implementation

- New isolated **stage Worker entrypoint**: src/school-stage-worker.mjs.
  The production Worker entrypoint, wrangler production configuration, cron,
  deployment workflow, CRM, Real Estate call path, credits and wallet are not
  touched. The stage entrypoint is not deployed by this PR.
- D1 migration 0038 reserves a conservative reviewed Plivo USD and Sarvam INR
  amount for one staff call atomically with the single dispatch claim. A lost
  API response is terminal/unknown: no auto-redial, and no new pilot while any
  earlier request is unresolved. Reserves are never automatically released.
  These are operator-approved envelopes, not vendor balance or CDR settlement;
  TTS prep has separate explicit approval and a one-use character limit.
- Dedicated stage Plivo account (must differ from configured legacy account),
  separate Sarvam credential, stage HTTPS origin, private audio bucket and
  separate stage control database binding. No shared production credentials,
  secrets, database contents, or customer numbers should be copied.
- Authenticated MFA Super Admin API-only controls: approve, prepare-audio,
  dispatch and stop. Existing login/MFA endpoints are allowlisted. No stage
  dashboard UI or bootstrap route. A stage admin/tenant and frozen School
  snapshot must be provisioned and simulation-reviewed in the separate DB.
- Verify each immutable reviewed MP3 before dialing and serving. Playback is
  through short-lived HMAC capability URLs bound to permit/call/node/turn;
  no public R2 URLs or arbitrary media paths.
- Answer callback binds signed RequestUUID and CallUUID, then uses keypad
  recording/AI consent. Only an opted-in internal staff participant may use
  fictional answers. Up to three linear reviewed questions, max eight seconds
  recording per answer; authenticated recording metadata must match call ID,
  bounded private Plivo media download and one Sarvam STT per claimed turn.
  Unclear/empty or explicit stop response ends the call. No transcript, speech
  content or recording URL saved to app DB; only recording ID digests and
  turn counters. Provider-side recording retention still needs review.
- Carrier request sets time_limit <=60s, ring_timeout=15 and hangup_on_ring.
  Super Admin revokes permission first and can request DELETE of the exact
  signed call UUID on the dedicated account only. A 204 is an accepted hangup
  request, not evidence of completion; signed hangup still required.
  Call UUID unavailable or unknown request outcome requires manual provider
  review; no account-wide DELETE or automatic retry.

## Deployment checklist (not executed)

1. Create a separate stage Worker and private stage D1/R2 resources, never use
   the existing production CONTROL_DB/RECORDINGS resources. Apply all required
   control migrations in order to the new stage database, including 0036–0038.
   Bind as SCHOOL_STAGE_CONTROL_DB and SCHOOL_PILOT_AUDIO. The new Worker
   explicitly refuses the same binding object as CONTROL_DB; operator must
   independently verify physical resource IDs.
2. Provision separate stage Super Admin and MFA, an internal test tenant, client
   draft and frozen reviewed School snapshot with 1–3 fictional questions.
   Provision the stage authentication settings needed by existing login/MFA
   functions. No production sessions or personal customer data.
3. Set AR3D_SCHOOL_STAGE_ORIGIN, AR3D_SCHOOL_STAGE_ISOLATED_DB_CONFIRMED=yes,
   AR3D_SCHOOL_STAGE_PLIVO_AUTH_ID/TOKEN, AR3D_SCHOOL_STAGE_SARVAM_API_KEY,
   AR3D_SCHOOL_STAGE_MEDIA_SECRET (independent random secret),
   AR3D_SCHOOL_STAGE_RECORDING_AUTH=confirmed (after enabling provider recording
   HTTP auth), PLIVO_AUTH_ID (legacy account ID only, for difference check),
   AR3D_SCHOOL_PILOT_TENANT_ID, AR3D_SCHOOL_PILOT_CALLER,
   AR3D_SCHOOL_PILOT_VERIFIED_STAFF_NUMBER, AR3D_SCHOOL_PILOT_BINDING_SECRET,
   and operator-reviewed caps/reserves/funding reference:
   AR3D_SCHOOL_STAGE_PLIVO_CAP_USD_MICROS / PLIVO_RESERVE_USD_MICROS,
   AR3D_SCHOOL_STAGE_SARVAM_CAP_INR_MICROS / SARVAM_RESERVE_INR_MICROS,
   AR3D_SCHOOL_STAGE_FUNDING_REF (each full name starts AR3D_SCHOOL_STAGE_).
   Leave enable switches disabled until reviewed; approval, audio, and stage
   enable flags are separate. Provision secrets through secure Worker settings,
   not GitHub or chat. No credential values belong in config files.
4. Verify carrier-approved number, opted-in staff recipient, permitted purpose,
   DND/opt-out and recording authorization. Independently review funding,
   prompt audio quality, provider signature/recording metadata vectors and
   callback readiness. Validate staging D1/R2 semantics, including R2 conditional
   writes and media playback. Consent/approval references are attestations,
   not proof of the underlying approval.
5. Only then enable approved stage flags and sign in to the stage origin.
   Same-origin POST /v1/human/school-stage/approve with Phase 3D permit schema;
   prepare-audio with tenantId, permitId, confirm
   ONE_STAGE_AUDIO_JOB_WITH_REVIEWED_TTS_BUDGET. Independently listen to the
   exact immutable MP3 manifest. Dispatch with tenantId, permitId,
   manifestSha256 and confirm ONE_STAGE_STAFF_CALL_AUDIO_LISTENED_AND_FUNDING_APPROVED.
   Stop accepts tenantId and permitId. Never run dispatch from deployment or cron.
6. Reconcile actual charges/recording retention and signed hangup before any
   later permit. Do not enable customer calls, finance, banking or insurance.

References: https://docs.plivo.com/docs/voice/api/calls ,
https://docs.plivo.com/docs/voice/xml/record ,
https://docs.plivo.com/docs/voice/api/recordings ,
https://docs.plivo.com/docs/voice/concepts/signature-validation .

Tests in tests/school-pilot-phase3e.test.mjs use the SQLite-backed fixture,
mocked responses, synthetic secrets and fictional numbers. Real provider
recording URLs, signature variations (including the narrow GET query subset),
media fetch timing, STT, carrier time limits and physical stage resource
isolation remain unverified. The fixed linear flow tests speech connectivity,
not production admission qualification or generalized branching. The stage
entrypoint deliberately has no production activation path.
