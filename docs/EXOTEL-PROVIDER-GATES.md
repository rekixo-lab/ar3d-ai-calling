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

## AgentStream audio protocol and HTTP request staging

Official references (checked 2026-11-19):
- https://developer.exotel.com/docs/agentstream/websocket-protocol
- https://developer.exotel.com/docs/agentstream/connect-voice-ai
- https://developer.exotel.com/docs/references/webhooks

`src/exotel-http-preparation.mjs` builds a real-format, India-region
`POST /v1/Accounts/{AccountSid}/Calls/connect` `Request` with HTTP
Basic Auth and multipart form fields, but **never submits it**. The exported
`submitExotelConnect()` explicitly refuses all dispatch. No customer or
vendor credentials are loaded by production Worker routes. The request
object must never be logged, exposed to the browser or serialized.

`src/exotel-media-protocol.mjs` validates the AgentStream JSON frames
`connected`, `start`, `media`, `dtmf`, `mark`, `stop`; it also creates
outgoing `media`, `mark`, `clear` JSON objects. PCM is 16-bit little endian
mono with `audio/x-raw`, supported 8000/16000/24000 Hz, base64 chunks
3200–100000 bytes in multiples of 320. It rejects duplicate/rewound
sequences, out-of-order frames, another stream SID, malformed payloads,
unsupported rates and unexpected fields. No socket, audio stream, STT,
TTS, LLM or provider connection is launched.

The engineering endpoint `POST /v1/human/engineering/media-protocol`
is Super Admin session- and same-origin-protected. It sends exactly 100
fictional 3200-byte frames through the pure codec and reports aggregate
counts only. This is **not an end-to-end live voice test**.

`src/exotel-callback-correlation.mjs` checks untrusted CallSid and an
application-generated correlation nonce against a previously expected
context. Neither matching values nor a TLS connection proves Exotel
authorship; it returns *quarantine pending provider verification*. Before
launch, real callback handling must implement documented Exotel source IP
verification at the edge, durable replay-idempotency, independent call
details reconciliation and authorized tenant/call correlation. No public
provider callback route has been activated.

### What remains blocked before a first approved live call

1. Exotel account and AI Calling permission, API Key, Token, Account SID,
   approved ExoPhone/CallerId and traffic classification (verify KYC/DLT
   and the correct 140/1600/other-number use case with Exotel).
2. Independently reviewed recipient consent and fresh DND clearance,
   opted-out contacts excluded, legal calling window and AI disclosure.
3. Authenticated and replay-protected media gateway (WSS) with a
   deliberately enabled private dispatch path, provider callback source
   checks, call-state ledger, and error/timeout handling.
4. Connected STT + LLM + TTS or approved conversational voice provider,
   transcript handling and human transfer, recording/retention safeguards.
5. QA against Exotel's *actual* account/region and test number, cost
   ceiling, concurrency, alarms, call reconciliation, remote backups
   and recovery controls. MFA enrollment remains deferred by operator
   instruction but is still a production release blocker.

Do not remove `trg_no_call_launch` or agent activation blockers to make
the demo appear operational. They protect real customer data until the
separately approved launch milestone.
