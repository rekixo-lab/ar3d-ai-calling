# Phase 3C — Durable synthetic School pilot readiness

## Additive changes, no production activation

- Migration `0036_synthetic_school_sessions.sql`: dedicated synthetic-namespace
  session table, immutable graph/session identity, bounded event history (12),
  sequence guard and expiry index. No alteration of existing tables.
- `synthetic-school-store.mjs`: stores a frozen graph, accepted fictional answers
  and event IDs/body digests. A single compare-and-swap UPDATE commits the next
  state and replay ledger together. An identical, still-fresh historical retry
  is authenticated against its original predecessor and emits no commands.
  Conflicting IDs, expired sessions and wrong sequence fail closed. Concurrent
  writers can emit at most one accepted synthetic transition. A stale replica
  may cause a safe conflict rather than successful retry.
- `school-pilot-readiness.mjs`: disconnected candidate for Plivo Voice V3 GET
  signature validation at a separate exact HTTPS callback path, following the
  existing GET canonicalization and official documentation. POST and ambiguous
  query values are intentionally rejected. The verifier does NOT consume
  nonces, verify actual provider call identities or grant live permissions.
  Reference: https://docs.plivo.com/docs/voice/concepts/signature-validation
- Offline Sarvam/R2 manifest contract: every frozen speech node has a text hash,
  asset hash and bounded byte size; content-addressed private object key derived
  locally. Exact reviewed manifest digest and bytes must match. No provider
  request, object read/write or actual MP3 decoding/format validation.
- Hard closed live status, not a configurable activation switch.

## Remaining before a real device pilot

No Worker routes, deployment workflow, production database, audio packs, legacy
Real Estate policy, wallet, CRM, WhatsApp or provider configuration are modified.
Do not apply the migration to production or connect these helpers to a provider
until reviewed. The storage is for synthetic identifiers and fictional answers
only, not actual guardian/student/customer data. A reviewed retention policy
is needed before long-lived storage; no cleanup or external route exists yet.

Before a real pilot: independently verify actual Plivo SDK/provider signature
vectors for all intended callbacks, add durable nonce and call UUID binding,
strictly authorize a single opted-in staff-owned test recipient, separate
tenant/number/purpose approval, budget and DND/opt-out checks, and an audited
kill switch. Synthesize reviewed prompts through authorized Sarvam credentials
and validate actual MP3s, immutable R2 asset ownership and private access.
Use approved separate live state/retention and actual provider command delivery
semantics (including network timeouts and hangup). This synthetic CAS proves
state updates, not exactly-once delivery of external audio/calls. Do not expose
financial/banking/insurance flows. Do not make any real call automatically.

## Tests

`node --test tests/synthetic-school-pilot.test.mjs tests/school-pilot-phase3c.test.mjs`
and `npm test`. Tests use the repository's local SQLite D1-compatible fixture,
fictional numbers and keys, no real provider traffic. Verify foundation and
browser CI before considering merge. Production D1 concurrency and carrier
interoperability remain untested.
