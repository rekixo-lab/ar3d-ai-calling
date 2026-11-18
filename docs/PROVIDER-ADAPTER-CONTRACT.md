# Telecom Provider Adapter Contract (code-only; NOT live)

This module is **a private internal normalization contract**, not a specification for any real telecom vendor. No provider is selected, no routes receive its webhooks, and no dialing, recording, billing, or consent clearance has been enabled. The database still blocks adding call records.

## Before writing a real vendor adapter

1. Select an authorized India telecom provider and complete KYC/caller-number registration, DLT/DND/consent validation, calling-hour rules and relevant disclosures with qualified reviewers.
2. Implement that provider's **documented** webhook authentication (actual header format, signature scheme, raw-body bytes, nonce/timestamp and rotation), plus a durable idempotency store keyed by tenant+provider+event ID. The internal HMAC verifier is **not interchangeable with vendor authentication**.
3. Normalize only an authenticated event to \`validateProviderEnvelope\` with explicit tenant ownership and known call mapping, and validate legal state transitions. Never trust tenant ID, caller ID, charge amount, recording URL or consent claims directly from raw webhook JSON.
4. Keep the consent/DND and call-launch SQL deny-all triggers in place until an approved, fully tested integration with additional safeguards is ready. Do not enable any endpoint from this module simply because its unit tests pass.
5. Require raw-body size cap, event-timestamp freshness, replay protection persisted in D1, minimum needed PII, strict recording retention, provider retry reconciliation, monitoring and operational incident response.

### Provider-neutral helper functions

- \`encodeSignedMessage\`, \`verifySignedWebhook\`: verify the **project's own synthetic internal event protocol** only, using a 32+-character HMAC secret and a 5-minute timestamp window. No HTTP route is exposed.
- \`validateProviderEnvelope\`: accept only a bounded, typed normalized event schema; refuse unknown fields and unauthorized event types such as consent grants. Output explicitly says \`executable:false\` and \`billable:false\`.
- \`planCallStatusTransition\`: pure state-machine validation. It writes no call records and sends no requests.

A production provider adapter and secure transport remain entirely unimplemented. This is testable groundwork to reduce future integration mistakes, not live functionality.


The optional browser SpeechRecognition/SpeechSynthesis playground in `/app/simulator` is NOT a server-side or telecom provider adapter. Audio processing may be handled by the browser vendor and is outside this project's Worker. Do not treat browser speech tests as evidence of Hindi-language production performance or compliance.
