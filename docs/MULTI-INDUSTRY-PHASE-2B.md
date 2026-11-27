# Multi-Industry Phase 2B: Immutable Simulation Snapshots and MFA Review

**Scope:** Frozen, integrity-checked TEXT-ONLY rehearsals. Never live multi-industry calling.

## Implemented workflow

A client admin selects a saved draft, saves changes, then clicks **Freeze draft for simulation review**. The server records the current draft revision and a deterministic graph, computes a SHA-256 integrity digest, and stores the result under the client's tenant in Calling Control D1. Later draft edits do not alter this snapshot. A maximum of 30 snapshots per draft is enforced.

Client admins can select and rehearse a frozen version with fictional answers. Snapshot state is always simulation_only. Its independent operator review status is awaiting_review, simulation_reviewed or simulation_rejected.

A Super Admin using a current MFA-backed session can inspect the immutable snapshot and record a **simulation-only** review. Client roles cannot self-approve. Reviews are final and immutable. A different decision requires a new saved draft revision and a new snapshot.

## Authenticated APIs

- GET /v1/human/ai-flow-snapshots?tenantId=...&flowId=...: Tenant member or current-MFA Super Admin lists snapshot metadata.
- POST /v1/human/ai-flow-snapshots: Client admin, body tenantId + flowId + baseRevision. Atomic freeze, with revision and duplicate protection.
- GET /v1/human/ai-flow-snapshots/:id?tenantId=...: Read integrity-checked frozen graph, with tenant scoping.
- POST /v1/human/ai-flow-snapshots/:id/simulate: Client admin, body tenantId + fictional answers. Only text response and hypothetical effects.
- POST /v1/human/ai-flow-snapshots/:id/review: Current-MFA Super Admin, body tenantId, decision (simulation_reviewed or simulation_rejected), reason (3-300 chars), and acknowledgeSimulationOnly=true.

Operator review currently uses the API, not a client-facing approval control. A reviewed simulation is NOT approved to place live calls.

## Persistence and deployment

Migration migrations/control/0035_ai_flow_simulation_snapshots.sql adds ai_flow_snapshots and ai_flow_preview_reviews only to the isolated Calling Control D1, not CRM or other Rekixo resources. Composite tenant/flow keys, append-only UPDATE/DELETE triggers, a SHA-256 digest and an explicit simulation_only state keep this separate from calling_agent_publications and voice_call_routes.

The guarded production workflow recognizes only the exact two-table additive upgrade when the rest of the existing Control and CRM schema is already complete. It verifies columns and immutability triggers on deployed state. Mixed or partial schemas must still be blocked.

Retention/deletion of immutable historical records requires a separately reviewed privacy/erasure design. Do not equate CI passing with compliance approval.

## Explicit exclusions

No Plivo, Sarvam STT/TTS, R2 voice change, Meta WhatsApp message, real account lookup, customer contact, live calling activation, campaign binding, credit change, consumer consent alteration, or editing the legacy fixed property calling script.

Any future live mode requires separate compliance review, approved purpose/number routes, real consent/DND, identity validation, fresh customer records, provider acceptance and verified funding.

## Verification

Test stale revisions, duplicate freezes, cross-tenant reads/writes, viewer restrictions, absent/stale MFA, review rejection and one-time decisions, immutable content and review triggers, recorded digest validity, unchanged old property calling, no CRM/provider mutation, exact Cloudflare preflight, and synthetic desktop/mobile browser preview.
