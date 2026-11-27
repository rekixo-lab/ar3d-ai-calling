# Phase 2A: Offline typed flow compiler and fictional text simulator

**Status:** Preview-only design and implementation, not live calling. Phase 1 has provided tenant-owned drafts and a text preview. Phase 2A introduces only an **offline deterministic graph** from those drafts and a **bounded synthetic conversation rehearsal**. It must not be advertised as a real callable agent.

## Implementation

- \`src/call-flow-dsl.mjs\` validates a versioned schema 1 DAG (<=40 nodes). Allowed step types: greeting, speak_static, ask_text_bounded, ask_choice, branch_exact, verify_recipient, fetch_approved_snapshot, speak_verified_field, create_human_task, save_reviewed_outcome, end_call.
- Compiler converts stored greeting/questions/closing into a finite linear non-callable graph, retaining template mode/language/regulated category. Every edge must be defined and reachable; no loops, extra schema keys, unknown steps, arbitrary provider URLs or runaway answers.
- Private fields can exist in synthetic DSL samples only if **every path** to disclosure passes an explicit recipient verification node AND a fresh approved snapshot node. The text simulator always sends recipient verification down the failure path and never loads finance/account snapshots or renders the private fields. This is not a substitute for a real authentication integration.
- \`POST /v1/human/ai-flows/:id/simulate\` accepts \`{tenantId,answers:["fictional ..."]}\` (max 12 answers * 160 chars); requires an authenticated client admin with membership. Server reads only that tenant's existing draft, runs in memory and returns a **text transcript and hypothetical actions**, not persisted CRM outcomes.
- The My AI Agents UI provides "Run fictional conversation (no calls)" and a short text area for *fictional*, not actual, answers. Users must save any edits first.

## Explicit exclusions

No Worker cron changes, Plivo phone calls, Sarvam STT/LLM/TTS, R2 file use, Meta messages, CRM/customer data reads or writes, sensitive finance data lookup, content publication, approval, calling number enablement, wallet adjustment or customer charges. A template remains draft-only regardless of simulated success.

## Next work, not included

Persist immutable reviewed graph versions, UI branching/conditional editor, purpose-scoped campaign bindings (disabled by default), end-to-end voicemail/announcement and human escalation runtime, provider-approved caller numbers and regulated institution onboarding. Do not call finance debtors or publish new industry agents until separate documented operator, telecom and privacy approvals.

## Acceptance

\`npm test\` and Chrome UI tests must pass. Negative tests cover cross-tenant denial, viewer cannot simulate, forged publish endpoint, missing authorization, unknown/malformed graph node, graph cycle, unsafe private disclosure, refusal to simulate real verified identity, missing synthetic answer and zero provider/CRM side effects.
