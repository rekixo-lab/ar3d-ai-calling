# Phase 3A: Virtual Voice-Turn Contract (no provider calls)

**Released scope:** A deterministic, version-pinned, text-only virtual voice-turn preview. This is a stepping stone toward a future provider adapter; it is NOT a phone runtime and produces no actual audio.

## Implementation

- New \`src/virtual-voice-turns.mjs\` validates the existing typed DAG, then deterministically replays each fictional answer against the exact stored flow. It emits reviewed-text virtual commands, an explicit wait-for-reply command, a hypothetical end command, and hypothetical human-task/outcome events. It accepts no cursor, caller ID, account data, provider URL or verification claim.
- New authenticated \`POST /v1/human/ai-flow-snapshots/:id/voice-turn-preview\`. Body strictly \`{tenantId,answers:[...]}\` with 0–12 fictional entries, ≤160 characters each. Client Admin only, tenant-scoped, CSRF/origin protected. It retrieves and SHA-256-verifies the frozen snapshot first. The response includes only virtual commands, transcript and explicit zero-count provider/CRM/billing effects.
- New **Preview virtual voice turns (no calls)** button in **My AI Agents → Frozen versions**. Use the existing fictional answer box: start with no lines to see the first question, add one fictional answer per line to advance, then preview again. It displays the would-speak/would-wait/would-end contract and never invokes audio, phone or payment services.
- Same snapshot and answers always produce an identical response; repeated requests cause no external side effects or persistent session writes. Unverified financial data can never be spoken: fictional identity verification always follows the failure branch, and any private field is redacted.
- Existing Real Estate seven-question Plivo policy and R2 MP3 packs are untouched.

## Deliberate exclusions / next production gates

There is no microphone, voice activity detection, actual STT/TTS, recording, real Plivo XML, real call event receipt, customer database mapping, number/purpose permission, customer contact, call scheduling, WhatsApp send or credit deduction. No finance/banking mode is approved to dial.

A *subsequent* phase must implement a separate, signed, idempotent actual provider session adapter, robust recipient authorization, tenant number/purpose compliance, budget and DND holds, and one authorized real-device school pilot. Review/immutable snapshot status alone can NEVER authorize calling.

## Test requirements

Unit: valid school and announcement flows, bounded one-answer advances, deterministic replay, exact branch choices, invalid inputs and extra replies, no private-data disclosure. HTTP: tenant isolation, viewer/superadmin denial, immutable snapshot version pinning, exact request schema and zero audits/wallet/call routes. Chrome: fictional School preview on synthetic localhost, with no calls or charges. CI and Cloudflare smoke tests must pass.
