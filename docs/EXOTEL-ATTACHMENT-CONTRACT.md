# Exotel attachment contract — provider and operator handoff

Updated 20 November 2026. Applies only to the isolated AR3D AI Calling Worker.
Never put API keys, tokens, KYC scans or actual customer phone records into
GitHub, chat, screenshots, URLs or browser configuration.

## After the business Exotel dashboard arrives

1. Verify the legal business/KYC owner, India account, Account SID, API access,
   and actual enabled products: Managed Voicebot, AgentStream, campaigns,
   outbound telephony and transcript/webhook API.
2. Set EXOTEL_ACCOUNT_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN as private
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

## Code attachment map

- Account read-only probe: src/provider-connectivity.mjs
- Seven-question managed-bot prompt: src/exotel-trial-readiness.mjs
- Official per-turn webhook event parser: src/exotel-voicebot-webhook-contract.mjs
- Provisional seven-field survey mapper: src/exotel-voicebot-qualification.mjs
- Staff-reviewed CRM form: src/property-qualification-routes.mjs
- AgentStream PCM: src/exotel-media-protocol.mjs
- Exotel request staging: src/exotel-http-preparation.mjs
- Fail-closed consent/DND checks: src/telecom-preflight.mjs
- Usage estimate, not billing: src/usage-reconciliation.mjs

## Real integration is still a separate release gate

Provider callbacks may be retried or arrive out of order. Session-end does
NOT carry all transcript turns. We validate documented formats offline, but
no authenticated real webhook route is registered. No durable, provider-
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
