# Phase 3D — School internal voice pilot integration candidate

This is a repository implementation, not a live call. No Worker route, deployment
workflow, Cloudflare migration, provider credentials, production bucket, dialing,
CRM, billing, legacy Real Estate, WhatsApp or credit behavior is changed.

## Implemented

- Additive migration 0037 with one active approval per configured tenant enforced
  by an atomic conditional insert, immutable scope (tenant/snapshot/digest/staff
  binding/expiry), audio job state, one request UUID per permit, and evidence
  sequence guard. Existing MFA-protected Super Admin session plus an explicit
  separate approval and evidence reference are required. The reference must
  represent real verified staff ownership/opt-in, DND/purpose and provider
  approval; the code does not establish their truth. The recipient is configured
  on the server, not supplied by a client. Target HMAC pins tenant + caller +
  recipient without persisting plaintext phone numbers.
- One-use audio claim, max 4,000 Unicode characters, max 14 prompts, max 1 MiB
  per asset, fixed documented Bulbul v3/Shubh MP3 stream, language hi-IN (including
  code-mixed) or en-IN. No arbitrary endpoint, redirect, dynamic speaker or auto
  retry. Header check is only a lightweight MP3 sanity check, not full decoding.
- Dedicated unbound SCHOOL_PILOT_AUDIO private R2 binding (not RECORDINGS);
  tenant-prefixed version/content-addressed keys; conditional create-only writes,
  SHA-256 check, readback verification and frozen manifest. Partial failed jobs
  may leave orphan content-addressed objects; separate retention/cleanup review
  required. Actual audio must be listened to/decoded and independently approved
  before playback.
- Signed GET callback evidence follows the existing V3 verifier and checks
  RequestUUID, CallUUID, exact From/To, Direction, Event and CallStatus. A trusted
  future funded dispatcher may record an accepted request UUID once; never accept
  it from a user body. Atomic updates bind the first call UUID and deduplicate
  answer and hangup events; no provider commands emitted. Hangup evidence is
  accepted after stop/expiry within the bounded evidence window. No GET/POST route
  is registered; actual Plivo SDK/provider vectors and callback timing/format
  compatibility remain untested.
- Super Admin stop irreversibly revokes a permit and blocks subsequent preparation
  and new answer evidence. This is **not** a live carrier hangup/kill switch.
  An already in-flight Sarvam request may finish; no subsequent approved work.
- 60-second maximum intended call and character cap are scope limits, **not**
  actual provider monetary reservation or enforced carrier time limit. No dialer
  exists; the live status remains hard closed.

## References

Sarvam MP3 stream: https://docs.sarvam.ai/api-reference/text-to-speech/convert-stream
Plivo calls: https://docs.plivo.com/docs/voice/api/calls
Plivo signature: https://docs.plivo.com/docs/voice/concepts/signature-validation
R2 conditional writes: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/

## Required before activation

Review and test all code; separately provision a private R2 binding and secrets,
apply reviewed migrations with production safety checks; confirm a real opted-in
staff-owned device and provider-approved purpose; review actual script and audio,
implement funded atomic provider reservation, a one-dispatch claim before any
outbound request, handle unknown submission outcomes without redial, reconcile
provider cost and enforce carrier time limit. Implement a distinct authenticated
admin route and signed provider route, verified private asset playback, actual
voice question/answer transport, hangup/kill-switch behavior and persistent live
session retention. Test genuine provider signature vectors and callbacks, staged
D1/R2 behavior and carrier interoperability before a single explicit test call.

No financial/banking/insurance or customer campaign is enabled. CI uses fictional
data and mocked Sarvam/R2/Plivo; it cannot verify real provider connectivity.
