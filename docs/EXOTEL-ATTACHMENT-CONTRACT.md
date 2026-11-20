# Exotel attachment contract — provider and operator handoff

Updated 20 November 2026. Applies only to the isolated AR3D AI Calling Worker.
Never put API keys, tokens, KYC scans or actual customer phone records into
GitHub, chat, screenshots, URLs or browser configuration.

## After the business Exotel dashboard arrives

1. Verify the legal business/KYC owner, India account, Account SID, API access,
   and actual enabled products: Managed Voicebot, AgentStream, campaigns,
   outbound telephony and transcript/webhook API.
2. Confirm the Exotel account region. `my.exotel.com` normally indicates
   `singapore` (`api.exotel.com`); a Mumbai account uses `india`
   (`api.in.exotel.com`). Set `EXOTEL_REGION` to the verified region.
   Set EXOTEL_ACCOUNT_SID, EXOTEL_API_KEY and EXOTEL_API_TOKEN as private
   Cloudflare Secrets for Worker ar3d-ai-calling, not as browser JavaScript.
3. From signed-in Super Admin, use Check Exotel Connection (read-only).
   This does not launch any calls or approve the caller identity.
4. Obtain written approval for the appropriate number/traffic classification,
   documented consent/DND procedure, legal calling hours and 100-call costs.
5. Prefer Managed Voicebot for the fixed seven Hindi/English questions if
   enabled. Copy the scripted prompt from Super Admin and test only with a
   provider-approved, personally controlled number.
6. Request Exotel's actual transcript_events sample, per-call identification,
   delivery retries and webhook authentication method. Public docs do not
   promise a particular HMAC header or guarantee all features in a trial.
7. Use Super Admin -> Test Voicebot Answers to CRM Review (offline) to check
   synthetic seven-field mapping, conflict/retry handling and opt-out review.

## Exotel Voicebot webhook attachment (v2 paused; no live calls)

The Exotel Voice Agents UI offers Bearer authentication for each webhook.
Use a **separate** 64-hex token generated with `openssl rand -hex 32`,
stored as a private **production Secret** named
`EXOTEL_VOICEBOT_WEBHOOK_TOKEN` in the isolated `ar3d-ai-calling`
Cloudflare Worker. Do not reuse `EXOTEL_API_TOKEN`, display bearer
tokens in screenshots or include them in webhook URLs.

After the additive Control D1 migration is verified and the new Worker
passes CI/deployment, the **Transcript Events** configuration is:

- Webhook URL: `https://aicalling.ar3dstudio.in/v1/provider/exotel/voicebot/transcript-events`
- Authentication: `Bearer`
- Bearer token: use the SAME private 64-hex token already bound to Worker
- Timeout: 10 seconds (provider UI offers 1–30 seconds)
- Max retry: 2
- Retry interval: 2 seconds (provider UI offers 1–5 seconds)
- Optional Headers: leave blank

The separately supported **Session End** URL is
`https://aicalling.ar3dstudio.in/v1/provider/exotel/voicebot/session-end`
with the same dedicated Bearer token. Configure session-end only after
verifying receipt testing and account/voice permissions.

These routes accept **only** Exotel's documented JSON event format,
require exact header authentication before parsing, reject unexpected
Origin, mismatched account ID, invalid oversized bodies and conflicting
event replays. Each accepted vendor event produces a private, immutable
30-day-expiring **HMAC receipt only** in isolated Control D1. The existing
6-hour Worker cron deletes expired receipts in bounded batches. The
response uses Exotel's official `{"http_code":200,"response":{"data":{}}}`
acknowledgment for accepted events.

**Important limits:** A valid Bearer token authenticates a delivery to
our endpoint; it does not prove the call was made by our platform or
establish tenant/lead identity. The endpoint deliberately does not store
raw transcripts, phone numbers or callback bodies, does not auto-update
the CRM or DND, never dispatches calls, and does not authorize billable
usage. In particular, a conversational opt-out is marked as an
unattributed metadata review signal, **not** a confirmed phone-level DND
change. A later independently verified call ledger, approved caller IDs,
tenant-lead mapping and encrypted consented transcript storage are still
needed for production auto-CRM saves. No traffic should be allocated to
v2 until those gates pass.

The Exotel UI **Test URL** may send a synthetic body instead of a valid
live event (not specified in the public webhook contract). A real UI test
confirmed a full set of documented top-level fields, but some values or
nested structures did not satisfy the production call validator. The Worker
also recognizes the **exact placeholder example published in official Exotel
VoiceBot Webhook docs** as a no-write connectivity sample, ONLY after Bearer
authentication. Other fake/malformed call envelopes continue to be rejected.

When a Test URL still returns HTTP 400, the private authenticated response
now reports a fixed validation category (including account, metadata,
call-reference mismatch, transcript segment, etc.) plus boolean format
checks for the main session/network/event fields; **never** raw values.
This is intentionally diagnostic rather than blindly accepting malformed
production callbacks. The operator can share a screenshot of the response
without any auth values; leave real traffic and CRM writes off.

The Exotel UI **Test URL** may send a synthetic body instead of a valid
live event (not specified in the public webhook contract). The endpoint
now accepts tiny **explicitly marked test/ping/verification JSON objects**
ONLY after a valid Bearer token has been authenticated, acknowledging them
without writing a D1 receipt or changing the CRM. Actual call/session keys
are never permitted in these verification probes. This is NOT a general
bypass for malformed real events.

If an Exotel Test URL still returns `invalid_webhook_payload`, its
authenticated HTTP 400 response lists only a fixed, PII-safe subset of
present **field names**, plus a static validation category. This helps
identify the undocumented test JSON format without echoing field values,
tokens, names, transcripts or customer numbers. Never turn off Bearer
authentication to make Exotel testing pass. Inspect the response and
adjust only after the actual test shape is verified with vendor docs or
an approved sample. A test URL 200 is connectivity-only, not proof of a
genuine call, CRM delivery or any compliance approval.

## Code attachment map

- Account read-only probe: src/provider-connectivity.mjs
- Seven-question managed-bot prompt: src/exotel-trial-readiness.mjs
- Official per-turn webhook event parser: src/exotel-voicebot-webhook-contract.mjs
- Production Bearer inbound quarantine: src/exotel-voicebot-inbound.mjs
- Isolated immutable D1 receipt schema: migrations/control/0008_exotel_voicebot_receipts.sql
- Provisional seven-field survey mapper: src/exotel-voicebot-qualification.mjs
- Staff-reviewed CRM form: src/property-qualification-routes.mjs
- AgentStream PCM: src/exotel-media-protocol.mjs
- Exotel request staging: src/exotel-http-preparation.mjs
- Fail-closed consent/DND checks: src/telecom-preflight.mjs
- Usage estimate, not billing: src/usage-reconciliation.mjs

## Real integration is still a separate release gate

Provider callbacks may be retried or arrive out of order. Session-end does
NOT carry all transcript turns. We validate documented formats offline, but
an authenticated quarantine-only webhook route is implemented. No durable, provider-
authenticated call-to-tenant-to-lead correlation, outbound dial execution,
verified consent/DND, commercial recording flow or automatic CRM save exists.

Do not bypass the database call-launch and agent-activation denial triggers.
A CallSid inside an HTTP request is not authentic Exotel proof. Before
enabling a real callback, agree on provider-supported authentication,
independently verify account/caller and call details, use a replay-safe durable
inbox, stage staff review, and test opt-out, busy/no-answer and retries.
A past inquiry or Excel phone number alone is not consent.

Official references:
https://docs.exotel.com/intelligent-voice-agents/voicebot-webhooks
https://developer.exotel.com/docs/agentstream/connect-voice-ai
https://developer.exotel.com/docs/references/authentication

A successful connection check, green CI, simulated webhook or bot preview
does NOT mean production voice-calling readiness. Operator MFA, backup/restore,
privacy policy, telecom approval and approved-number pilot remain separate.
