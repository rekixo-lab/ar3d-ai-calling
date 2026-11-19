# AR3D AI Calling — Exotel Integration Contract & Compliance Gates

**2026-11-19: no real calling authorized.** One consolidated engineering batch
implements an Exotel India **Voice AI Connect contract**, a strict fail-closed
outbound preflight, an untrusted callback shape parser, and a 100-event
deterministic Exotel-compatible Mock Pilot. It does NOT create calls.

## Official API documentation used

- Voice AI Connect: https://developer.exotel.com/docs/agentstream/connect-voice-ai
- Authentication & callback safety: https://developer.exotel.com/docs/references/authentication
- Call Status callback fields: https://developer.exotel.com/docs/voice-v1/api-reference/call-details

The official India Voice AI API is POST
\`https://api.in.exotel.com/v1/Accounts/{AccountSid}/Calls/connect\`,
with \`From\` (number to dial), \`CallerId\` (approved ExoPhone), \`StreamUrl\`
(WSS), \`StreamType=bidirectional\`, optional \`StatusCallback\`. The live API
uses HTTP Basic Auth with vendor API Key/Token, **not** stored in source.
Our adapter validates only the request **shape**, returns a frozen contract
and never fetches the URL. In tests, fictional numbers and invalid domains are
used solely to exercise validation.

The Exotel callback examples include CallSid, Status and EventType as
form fields. These are **NOT** proof of authentic webhook origin. Exotel's
public docs emphasize HTTPS, verified vendor IP ranges, strict payload shape,
idempotency and caller-side correlation. We do not claim there is a
provider-supplied HMAC signature if no written provider-specific mechanism has
been agreed. The parser explicitly outputs \`trusted:false\` and cannot
change consent, DND, status ledger, recordings or invoices.

## Invariant non-negotiable calling gates

Before any live call workflow is designed for approval, require all of:
- Signed provider agreement, business KYC/DLT where applicable, verified
  caller resource and case-specific 140/1600 or other **authorized** number
  classification; written approval for AI/commercial use
- Purpose-specific and independently verified recipient consent; verified
  latest DND/customer preferences; no unresolved opt-outs or suppression
- Tenant-specific caller identity and provider-authorized working hours
- AI identity/purpose disclosure, human escalation, opt-out mechanism,
  recording policy and restricted retention
- A trusted, signed/correlated provider webhook delivery path, replay ledger
  and verified call-state reconciliation
- Approved bidirectional audio gateway with media authentication,
  STT/LLM/TTS, secure recording pipeline and complete independent QA
- Customer data governance, MFA, remote backup/restore drill, audit/alerts,
  production quotas and provider usage/billing reconciliation

The new pure \`assessTelecomPreflight\` reports gaps. **Even if all fictional
status flags are "independently_verified", executionAllowed is always FALSE**.
These are internal synthetic values, not sufficient legal/telecom proof.

## Super Admin engineering test

After deployment, the Admin panel has **Test Exotel Mock Provider (100 events)**.
It invokes \`POST /v1/human/engineering/provider-pilot\` under the
existing authenticated Super Admin / Same-Origin / bounded-body protections.
The result contains only counts for completed, busy, no answer, failed,
opt-out blocked, and consent/DND blocked. It never reads customer records,
calls Exotel, sends WebSockets, places calls or generates invoices.

No new Worker route for real vendor callback, no new D1 tables or migrations,
no hidden token, payment, telephony or callback credentials have been added.
The existing \`trg_no_call_launch\` and active-agent prevention remain in place.
Actual provider approval, account API keys, assigned ExoPhone, voice streaming
endpoint, DLT/legal review and costs must be supplied/verified before any
future privileged, intentionally enabled *real* integration can be built.
Do not infer commercial eligibility from this simulated contract.
