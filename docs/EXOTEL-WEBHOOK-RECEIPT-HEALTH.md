# Exotel Voicebot webhook receipt health — read only

This operator-only diagnostic answers one narrow question: **has AR3D persisted
any Exotel Voicebot webhook event metadata?** It is not a provider-origin
attestation, call/lead join, transcript reader, consent record, DND decision,
or proof of successful CRM qualification.

## Using the dashboard

1. Sign in as **Super Admin** with an MFA-authenticated current session.
2. Visit **Production Readiness** → **Exotel Webhook Receipt Health**.
3. Click **Check saved Exotel webhooks (read-only)**.
4. Observe unexpired unique receipts, transcript and session-end event counts,
   completed/in-progress turns, distinct hashed sessions, potential opt-out
   flags, and the last accepted receipt timestamp.

Behind the button:
`GET /v1/human/engineering/exotel-webhook-health`

This endpoint takes **no query parameters, CallSid, phone number, tenant ID
or user-chosen provider URL**. It requires an active Super Admin session
created after MFA enrollment, and selects only aggregates from the
isolated Control D1 `exotel_voicebot_event_receipts` table.

No provider HTTP request, dialer, new call, recording, payment, CRM mutation,
transcript retrieval, customer identity or consent change is made.
No new DB migration or external secret is required.

## Correct interpretation

- All counts represent **unique, unexpired stored receipts**, not attempted
  deliveries. Identical replay deliveries are deduplicated in the existing
  webhook quarantine and cannot be counted from this table.
- Exotel dashboard **Test URL probes** are acknowledged without saving
  a receipt. Therefore zero receipts does not by itself mean a broken URL.
- The webhook Bearer token is necessary but is **not independent cryptographic
  or network-origin verification of the sender**. `sourceVerified` remains
  false until a vendor-supported verified source contract is implemented.
- `possibleOptOutSignals` is a count of flagged **events**, not people or
  unique opt-out requests. The quarantine intentionally stores **no phone
  numbers or text**. Operators must independently investigate potential
  suppression cases; **never infer consent or silently auto-dial**.
- There is no safe way to infer CRM lead identity from this report.
  Provider-approved authenticated call-to-lead correlation and staff-reviewed
  real transcript ingestion remain separate future milestones.

Existing quarantine data retention and all customer campaign no-dial
safeguards are unchanged.

## Verification

`node --test tests/exotel-webhook-health.test.mjs`

Full regression acceptance: `npm test`, browser E2E, and guarded Cloudflare
release workflow. Only merge on successful CI.
