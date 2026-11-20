# Exotel operator test ↔ webhook receipt correlation preview

**Status:** safe, read-only correlation candidates only. No production
customer transcript-to-CRM ingestion, real customer dialing or consent grants.

## Why

Exotel's Voicebot webhook delivers *turn* events. AR3D currently quarantines
authenticated deliveries as HMAC fingerprints in the isolated Control D1 table,
without storing customer audio, phone numbers or transcript text. A separately
approved one-time AR3D operator self-test stores an Exotel CallSid privately,
but it never registers a CRM customer/tenant.

The new read-only correlation preview lets the *original Super Admin* see
whether HMAC fingerprints in the quarantine could correspond to this very
specific AR3D self-test. It does **not** attempt to join any CRM Lead.

## How it works

1. Admin signs in via a session created after MFA enrollment.
2. In Engineering > **AR3D Software → Exotel: One Verified Outgoing Voice Test**,
   the existing GET endpoint reads only that actor's original self-test calls.
3. For a call submitted by AR3D with a privately persisted provider CallSid,
   use the existing private webhook token to compute HMAC-SHA256 call keys
   in the same format as \`exotel-voicebot-inbound.mjs\`.
4. Query unexpired, quarantined receipt rows against **exact candidates**:
   \`external_id === privately registered CallSid\` and
   \`metadata.call_sid\` either equals it or was omitted. Account ID must
   equal the configured Exotel account ID or have been omitted by the webhook.
5. Return only unique event counts, completed transcript turn count,
   session-end count, possible opt-out *event* flags, unique session count
   and latest receipt timestamp. **No provider CallSid is returned to the
   browser**, and no tenant/lead data, raw transcript or phone number is read.
6. Different \`metadata.call_sid\` is **not** assumed to be the same leg. Those
   legitimate separate-leg deliveries can be missed; their identity still
   requires provider-verified call-leg reconciliation.

A matching fingerprint only indicates data with this identifier arrived
through the Bearer-authenticated webhook and was quarantined. **It does not
independently authenticate the sender** and is not definitive proof of call
identity or customer opt-out. A zero count could mean no receipt, expired
receipt, external/leg SID mismatch, an Exotel dashboard-only call, or a
different sender payload. Missing credentials/schema/query failure is shown as
\`unavailable\` rather than falsely showing zero.

## Strict non-goals and next approval gates

- No external Exotel network request is made by this preview.
- No new customer call, campaign, transcript storage, CRM update, review
  proposal, site-visit confirmation, consent grant, DND override or billing.
- No database migration or new external secret. The Control D1 quarantine
  and operator status tables already exist; the CRM call-deny triggers remain.
- An actual customer linking workflow needs an independently verified
  provider-authenticated delivery/source, server-created authorized call
  registry containing tenant + lead + verified number, provider Call Details
  matching the correct account/call/leg/customer and approved caller,
  purpose-specific lawful consent and opt-out checks, secure per-turn
  transcript storage/retention, and mandatory staff review.
- **Do not infer lead mapping from matching phone numbers or webhook claims.**

Test using \`npm test\`. Includes synthetic end-to-end Exotel parser,
quarantine HMAC, real SQLite 0008 receipts, duplicate/replay checks,
cross-leg mismatch, opt-out signal and MFA/cross-actor checks. Verify desktop,
tablet, mobile Chrome and guarded main deploy before declaring live.

References:
- https://docs.exotel.com/intelligent-voice-agents/voicebot-webhooks
- https://developer.exotel.com/docs/voice-v1/api-reference/call-details
