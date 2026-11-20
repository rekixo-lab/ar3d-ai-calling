# AR3D ↔ Exotel: read-only existing call status reconciliation

Scope: **only calls initiated through the operator-owned AR3D verified-number self-test**.
This uses Exotel's documented single-call read-only Call Details GET endpoint.
It DOES NOT initiate a telephone call, dial customer leads, infer their
consent/DND, import Dashboard-only call histories, or stage CRM survey
reviews. No new secrets are needed beyond `EXOTEL_ACCOUNT_SID`,
`EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_REGION`, and the
original authorized `EXOTEL_CALLER_ID`.

## User experience

1. Super Admin signs in with MFA (session created after MFA was enabled).
2. AR3D Calling Dashboard → Engineering → the existing Exotel verified
   test panel shows the latest self-tests.
3. A test with `submitted` status shows **Check existing Exotel call
   status (read-only)**. This requires an existing AR3D-created call SID
   recorded at the original dispatch time. **No arbitrary CallSid,
   phone number, URL or Tenant ID is accepted from the browser.**
4. Clicking it performs one provider **GET**, verifies AccountSid,
   PhoneNumberSid, Direction and CallSid; it reads Status and Duration
   (if available) and stores an immutable Control D1 audit observation.
5. Latest observed status and duration appear in the operator history.
   This is **not** proof that a call was answered by a human, converted,
   billable, or that the transcript was delivered or attached to CRM.

Exotel documents states `queued`, `in-progress`, `completed`,
`failed`, `busy`, `no-answer`. Duration/Price can update
asynchronously after a completed call (approximately 2 minutes).
We do not expose Price or create an invoice.

There is a global per-call dedupe reservation: only one check per
5-minute time slot, at most twelve checks per original call, and
every check is persisted BEFORE the Exotel request. Unexpected provider
responses or HTTP errors become **unknown**, not a fabricated call state.
The call is never retried or restarted by a check.

## Data integrity and privacy

The additive `migrations/control/0010_exotel_operator_status_checks.sql`
is applied only to the isolated Calling Control D1. It stores a
UUID attempt ID, an internal original call reference, actor user,
five-minute slot, verified provider status, optional integer duration,
and timestamp. No raw Exotel JSON, telephone numbers, recording URLs,
transcripts, or secret values are persisted in this table.

Every observation is immutable once finalized; the 5-minute unique
constraint prevents concurrent duplicate provider checks. No updates
to CRM D1, consent/DND status, customer visits, lead mapping or
telecom launch/agent deny triggers.

## Important remaining work before 100 real estate customer calls

* Exotel Voicebot's successful Dashboard-only demonstration call is
  **not** an AR3D-registered test call. It will not appear in these
  operator observations. First complete the private operator-only
  Worker secret/MFA setup described in
  `docs/EXOTEL-SINGLE-TEST-INTEGRATION.md` and perform one authorized
  AR3D test from its button.
* Verify the live transcript schema with a real permitted call;
  corroborate account/call/tenant/lead identity and consent with
  a signed or independently authenticated provider delivery, before
  any review queue or CRM updates.
* Add compliant caller classification, provider-entitled outbound
  campaigns, consent and DND checks, opt-out enforcement, controlled
  rate/budget limits, alerting, reporting and cost reconciliation.
* Obtain commercial KYC, approved caller identity, regulatory
  clearances and Exotel's written platform pricing for the pilot.

Official references:
- https://developer.exotel.com/docs/voice-v1/api-reference/call-details
- https://developer.exotel.com/docs/agentstream/connect-voice-ai-flow
