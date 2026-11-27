# Phase 3B — School synthetic callback/session contract

## Scope

A non-routable, synthetic-only prerequisite for a School Admission internal voice pilot.
The existing immutable graph digest is checked before starting and on every transition.
Only School graphs without private data or side-effect nodes are accepted.
All identifiers must use the synthetic namespace. A distinct test-only HMAC domain
signs the exact raw JSON bytes; it is NOT Plivo webhook authentication and must
never use a production provider token.

The session pins tenant, snapshot, graph digest, expected question and expiry.
Each signed callback supplies one answer and an exact next sequence. The transition
replays the frozen graph, emits only new hypothetical commands, rejects mismatches,
and suppresses the immediate identical retry. A conflicting retry fails closed.
No endpoint, database migration, provider command, audio playback, customer lookup,
wallet operation, outbound call, WhatsApp or live approval is introduced.

## Before any actual School pilot

- Independently verify official Plivo webhook signatures using the current provider
  scheme and canonical configured HTTPS callback URL; use a separate route and secrets.
- Store server-owned sessions and event IDs durably, with unique constraints,
  transaction/CAS updates, expiry, atomic replay protection and sanitized logs.
  This pure module only demonstrates a single transition and the immediately prior
  retry; it does not provide durable all-event idempotency or concurrency protection.
- Bind a separately reviewed call authorization to a specific tenant, frozen digest,
  verified staff-operated internal test recipient, purpose, time window and budget.
  Confirm opt-in/number ownership, opt-out/DND requirements and revocation before dialing.
  Simulation review is never live authorization.
- Create a version-pinned reviewed audio manifest with per-node text digest, language,
  immutable asset reference and integrity checks. Do not accept user-supplied audio URLs;
  verify R2/Sarvam mappings independently of legacy packs.
- Add a separate kill switch defaulting to OFF; require explicit authorization and
  independently test provider signing, retries, concurrent deliveries, limits, hangup,
  error recovery, and isolation from existing Real Estate calling.
- Run foundation/browser CI and an explicitly approved one-number internal test only.
  No public School campaign and no finance, banking or insurance calling in this phase.

## Validation

Run `node --test tests/synthetic-school-pilot.test.mjs` and `npm test`.
The tests cover sequence, pinned graph digest, signed raw body, tenant/session/version
mismatches, expiry, immediate replay, command suffix, regulated-template rejection,
and zero external effects. This contract is intentionally not imported by the Worker.
