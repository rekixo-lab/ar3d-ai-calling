# AR3D AI Calling — Boss-confirmed Basic Property Survey (19 Nov 2026)

## Approved Basic Scope

One main Calling app with tenant-specific Excel import, fixed survey and
private CRM. Name and Mobile already exist in Excel. No need to ask either
again. Both previous inquiries and unknown contacts may appear in the
spreadsheet; import is NOT consent to dial.

Seven fixed questions:
1. Plot, Flat or House?
2. City/location?
3. Preferred area/neighborhood?
4. For plot: square feet/dimensions. For Flat/House: 1BHK, 2BHK,
   3BHK, 4BHK or 5BHK+?
5. Approximate budget in INR?
6. Interested, later or not interested?
7. Preferred site visit date? Optional exact time when available.

Questions are deterministic in Hindi and English, not a generative
conversational AI model. The single source is `src/fixed-property-survey.mjs`.

## Implemented

- Client Admin: Lead Workflow & Excel Import → Details → 7 Fixed Questions
  — Property Qualification.
- Display original Excel Name/Mobile as read-only values.
- Plot Size vs BHK conditional field and Hindi/English question prompts.
- Staff may type/review answers; optional browser-only speech playback
  and microphone recognition are opt-in, browser-dependent previews.
  They are NOT real phone calls, verified transcripts or recorded calls.
  Review any recognized value before Save.
- Authenticated, tenant-isolated GET/POST to
  `/v1/human/leads/{leadId}/qualification` saves exact fields:
  City, Size, Budget, Interest and Visit Preference in existing CRM
  columns, and Type/Area/Source in `requirements_json.propertySurvey`.
  Existing Excel raw requirements preserved. CAS revision via
  `expectedUpdatedAt`; D1 batch includes audit.
- If interested with a future exact India-local date+time, inserts a
  deduplicated Site Visit with status REQUESTED; sales confirms later.
  Date only is an unconfirmed preference.
- No change to Lead Name, Mobile, DND/Consent, caller numbers, agents,
  calling eligibility, recordings, payments or other AR3D services.
- No D1 migration, VPS, AI model or new provider credentials.

## External work still needed for real phone calls

1. Approved India telecom vendor, KYC, authorized caller number and
   legally appropriate consent and DND verification.
2. Provider voice capture and validated Hindi/English speech-to-text.
3. Secure callback/voice-to-CRM turn integration with source verification,
   opt-out handling, audit and recording notice/retention.
4. Controlled small pilot with consented leads and actual provider tests.

This PR intentionally does NOT expose a live dialing or speech callback
path; it completes the fixed-question CRM workflow independently.

## Acceptance

- `tests/fixed-property-survey.test.mjs` checks seven-question contract,
  tenant isolation, input validation, atomic CRM updates, consent protection,
  version conflict, visit-request semantics and invalid-role refusal.
- `scripts/browser-e2e.mjs` runs Chrome desktop/tablet/mobile UI form
  with fictional 3BHK lead and a local API fixture only.
- `scripts/smoke-main.mjs` checks anonymous qualification API HTTP 401
  on Workers.dev and the custom domain.

## Seven-turn voice preview (no telecom provider required)

The fixed-question engine now has a deterministic Hindi/English browser
voice-preview sequence implemented in
`src/fixed-voice-turns.mjs`. It takes **speech-recognition text** as input,
never customer audio. It normalizes a property type, city, neighborhood,
conditional plot size/BHK, approximate rupee budget (including lakh/crore),
interest and prospective India-local site-visit day. Every field is checked;
ambiguous/low-confidence answers repeat at most three times, then stop for
human review. Explicit `do not call` stops the session and tells staff to
review the one-way CRM Do Not Call action. This *preview itself* is not
evidence of a verified opt-out request from a real phone call.

The authenticated, same-origin `POST /v1/human/voice-preview` endpoint
returns a short-lived, 30-minute preview state and the next fixed question.
It does **not** read or write CRM/D1, place a call, save transcripts,
grant consent or make a booking. The Client Admin can open a lead's
fixed questionnaire, click **Start 7-question voice preview**, type or
opt-in dictate one reply at a time, play the prompt using browser speech
synthesis and copy completed answers into the existing CRM review form.
Only clicking **Save Reviewed Answers to CRM** after staff confirmation
persists the information.

The main App now allows opt-in same-origin microphone access via a
restricted Permissions-Policy, but speech recognition quality depends on
the browser and its upstream speech service; it is not a private
self-hosted STT or connected telephone stream. The microphone is never
needed to type answers. The exact India-local timezone (+05:30) is used
for an optional future site-visit time instead of the computer timezone.

## Remaining vendor-dependent live setup

A real telecom channel must provide approved business account/Caller ID,
lawfully permitted outbound calling, consent/DND verification, actual
Hindi/English voice capture/transcription, a provider-authenticated and
replay-protected voice turn callback, call/visit status reconciliation
and recording permissions/retention. Only after selecting a provider
can its real callback schema/security and authorized dispatch route be
implemented and tested. The deployed preview intentionally has **no**
provider callback or live dial route.
