# AR3D → Exotel: approved single verified-number Voicebot test

Updated 20 November 2026. This is an engineering-only bridge for the
isolated `ar3d-ai-calling` Cloudflare Worker, **not** an outbound customer
campaign and **not** automatic customer qualification-to-CRM integration.

## What is verified, and what is NOT

The operator demonstrated a successful real outgoing call from the Exotel
Dashboard with the existing Exotel Voice Agent v4. In Exotel the App Bazaar
flow (Voicebot → Hangup) uses flow ID **1392699**. Both Voice Agent
webhook **Test URL** checks returned HTTP 200, but no independent live
transcript-to-CRM handoff has been completed. Exotel region for this account
is **Singapore** (`api.exotel.com`).

The official Exotel Connect Voice AI with Flow API uses HTTP Basic Auth
and `POST /v1/Accounts/<AccountSid>/Calls/connect`; required fields are
`From` (destination), `CallerId` (ExoPhone), `Url` (Exotel App Flow).
`StatusCallbackEvents` with a Flow URL can be rejected; this test
intentionally omits it. The built-in Exotel Managed Voicebot handles voice
STT/TTS/LLM: **no separate PCM gateway** is needed for this path.

## Secure operator test: activation and exact limits

The single-call route exists at
`POST /v1/human/engineering/exotel-self-test`, and a read-only status
at the same path using GET. Available only to signed-in **Super Admin**
with authenticator **MFA enabled**. Enforced by authenticated human session,
same-origin mutation policy, fixed self-test destination configured as a
**server-side secret**, 30-minute global cooldown and **two attempts per
rolling 24 hours**. A failed or timed-out request is recorded as rejected
or unknown and is **never retried automatically**.

Before any test is allowed, the operator must verify personally controlled
destination, account's trial restrictions and acceptable test charges. Then
set the following **only as Cloudflare Worker Production Secrets**, never
in GitHub, chat, browser JavaScript, logs or screenshots:

| Name | What to set |
|---|---|
| EXOTEL_ACCOUNT_SID | Exotel Account SID from API settings |
| EXOTEL_API_KEY | Private API key |
| EXOTEL_API_TOKEN | Private API token |
| EXOTEL_REGION | `singapore` for this confirmed account |
| EXOTEL_CALLER_ID | Provider-authorized ExoPhone/Trial Caller ID |
| EXOTEL_VOICE_AI_FLOW_ID | `1392699` for current AR3D AI Voicebot Flow |
| EXOTEL_VERIFIED_TEST_NUMBER | Personally controlled **verified** E.164 mobile, `+91...` |
| EXOTEL_OPERATOR_TEST_ENABLED | Exactly `enabled`, only when approved |

The last flag is a **manual go/no-go switch**; without it, HTTP POST
fails closed. Operator dashboard shows only destination **last four digits**.
The Browser sends **no phone number**, Flow ID, credentials or caller ID
with the POST: it sends a fixed explicit single-call acknowledgment.
All actual Exotel HTTP API requests originate on the Worker.

Use the Super Admin panel `AR3D Software → Exotel: One Verified Outgoing Voice Test`.
Clicking the button requires a browser confirmation. A confirmed Exotel
request appears as `submitted`; this means **dial requested**, not
answered or completed. If `unknown`, stop and check Exotel call logs
before any new attempt. Successful provider response is validated
against the authorized ExoPhone and outbound call direction.

Recordings are disabled (`Record=false`). This test does NOT create CRM
`calls`, does not change lead consent/DND, does not bill a client, does
not dial imported leads, and does not attach transcripts to customers.
Original CRM and agent deny triggers remain in place.

## Next engineering milestones before customer campaigns

1. Confirm required commercial KYC, real estate outreach classification
   (including caller ID / 140 vs other permitted traffic), purpose-specific
   consent and DND opt-out checks, allowed hours, tenant/provider entitlement,
   credits, billing and customer permission. Trial status does not waive them.
2. Add production call-to-tenant and lead registration with explicit opt-in
   attestation, independently verified provider CallSid and associated flow.
3. Consume Exotel Voicebot transcript turns (not just Session End) with
   idempotent event ordering, private encrypted storage, correct lead
   correlation, opt-out handling, and staff-reviewed CRM application.
4. Reconcile terminal call status using Exotel read-only Call Details;
   validate real provider status webhook security if introduced; cap spend
   and concurrency. A provider dashboard Test URL HTTP 200 is insufficient.
5. Run one verified consented test, check Exotel Interactions, receipt queue,
   CRM review and cost; then expand gradually to legitimate campaigns.
6. Maintain MFA, audit, retention, backups/restore and alerting checks.

Do **not** enable normal bulk dispatch, disable `trg_no_call_launch`, or
switch CRM consent flags to 'granted' merely because a customer was imported.

Official API reference:
https://developer.exotel.com/docs/agentstream/connect-voice-ai-flow
