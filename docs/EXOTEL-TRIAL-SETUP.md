# Exotel trial handoff — AR3D AI Calling (19 November 2026)

## Exact answer to "Will adding Exotel account keys turn everything on?"

**No.** A new Exotel account, Account SID, API Key and API Token currently
allow only a **read-only API connectivity check**, if API access has been
granted. They do not enable real outbound phone calls, receive audio,
recognize Hindi, write call transcripts to CRM, register a webhook or
qualify a business for promotional calling. Keep production no-call
triggers in place. DO NOT disable them to make a demonstration pass.

## Cheapest first experiment: Exotel's managed Voicebot

Exotel documents a *Managed Voicebot* dashboard, Hindi/English voice
configuration, **Talk to Bot** phone testing, outbound campaigns and
transcripts/interaction history. Check which parts are included in
the account's actual free trial; they are **not guaranteed by the
generic Exotel account or basic calling credits**.

Official sources:
- https://docs.exotel.com/intelligent-voice-agents
- https://exotel.com/products/ai-voicebot-in-real-estate/
- https://developer.exotel.com/docs/agentstream/connect-voice-ai
- https://developer.exotel.com/docs/references/authentication

**Step A — operator's own Exotel account**
1. Register the intended company's account; confirm the legal owner
   with the boss. Never use a personal employee identity instead of the
   actual business without approval.
2. Complete whatever trial/business verification Exotel requests.
   Add a personally controlled **verified test recipient**; do not upload
   Excel cold leads or launch any commercial campaign.
3. Confirm the account's India region and find its Account SID. Generate
   scoped API Key and API Token only if provider access is offered.
4. Request **Managed Voicebot Trial** with Hindi/English, approved
   outbound calling to your own test number, voice transcripts, per-call
   identifier and a secure structured-result API/webhook. Ask about
   additional charges and scope.
5. In AR3D Super Admin at
   https://aicalling.ar3dstudio.in/app, use **Exotel Trial Setup —
   What Is Ready?** and **Copy 7-question Exotel Voicebot instructions**.
   Paste only those non-secret fixed instructions into Exotel's approved
   Voicebot editor and replace [BUILDER_NAME]. Review the flow before
   any test call. Do NOT use customer phone numbers in the bot prompt.
6. If Exotel approves a phone test, call only a personally controlled,
   verified number, then check the bot's Interaction History for
   recognition of BHK, budget, location and visit request.
7. For **our CRM**, use the existing staff-reviewed
   Fixed Questionnaire on the imported fictional/test lead. No real
   Voicebot-to-CRM sync has been implemented. Do not mistake the
   provider's transcript export for automatic import into AR3D.

**Step B — attach secrets privately to ONLY the isolated Calling Worker**
- Cloudflare Dashboard > Workers > the exact Worker
  "ar3d-ai-calling" > Settings > Variables / Secrets (UI labels vary).
- The existing integration expects three server-side **Secrets**:
  EXOTEL_ACCOUNT_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN.
- Never use browser JS/config, GitHub commit, PR, WhatsApp,
  screenshot or ChatGPT for credential values.
- Save the provider credentials *only when issued*. The Calling
  Super Admin's **Check Exotel Connection (read-only)** sends a
  read-only HTTPS GET to the documented India API and reports
  connectivity without displaying secrets or customer data.
- Credential presence and a successful GET are **not** permission
  to call someone, proof of DND clearance, or completion of voice
  integration.

**Step C — choose one voice integration path after account approval**

1. **Managed Voicebot** (preferred to try first for just 7 fixed
   questions): Exotel handles phone audio/speech. Request the official
   per-call transcript/structured fields API, callback **authentication
   method**, source verification, retry/idempotency schema and the
   real caller number. Then implement tenant-scoped authenticated result
   ingestion, replay protection, human review and CRM write; define a
   safe per-tenant authorized call dispatch with compliance gates.
2. **AgentStream** (only if Managed Voicebot is unavailable or too
   costly): our app must run an independently authenticated and
   low-latency **wss://** media endpoint, connect speech recognition
   and playback for Hindi/English, receive/tailor PCM frames, manage
   interrupted calls and status callbacks, verify provider identity
   independently and write safely to CRM. This is materially larger
   than attaching three account secrets. The repository currently has
   **offline PCM codec tests only**.

**Provider/business requirements for actual customer calls**
- KYC, selected legally authorized number series/caller ID, and
  Exotel approval for automated real-estate calls.
- Principal Entity/DLT and additional operator registration/mapping
  where the chosen promotional traffic requires it.
- Documented purpose-specific customer consent, current DND
  verification, suppression/opt-out, calling hours, AI disclosure
  and human escalation; a name/number in Excel is not consent.
- Written contract/permission for offering multiple Builders
  separate caller identities on the main AR3D platform.
- Production secure callback and CRM reconciliation, accurate
  recording notice and retention (if recording is enabled), MFA,
  backups, alerts and a controlled end-to-end pilot.

## Pre-built Exotel Managed Voicebot transcript contract (offline)

On 19 November 2026, Exotel's official
[VoiceBot Webhooks](https://docs.exotel.com/intelligent-voice-agents/voicebot-webhooks)
documented a JSON envelope with session_id, conversation_id, external_id,
session_state, trigger_reason, network_type, metadata.call_sid and events.
Transcript events include sequence, status (inprogress/completed), speaker and
text segments. These callbacks are retried and may be OUT OF ORDER.
**The session_end event does not carry the complete transcript.**

Our code now prepares a **pure offline parser/reconciler** in
src/exotel-voicebot-webhook-contract.mjs. It:
- Validates IDs, event types, bounded text, completed turn sequences and
  timestamps; checks call/session/account equality against supplied expected
  references (not proof of authenticity).
- Ignores nonfinal 'inprogress' transcripts, deduplicates exact retries
  and rejects conflicting duplicate event IDs or turn sequences.
- Sorts completed turns by sequence and flags potential "don't call"
  opt-out wording for immediate human review.
- Discards contact_uri, landing_number, custom params and other phone/PII
  from every Admin-visible result. No transcript text returned to the UI.
- Exposes a Super Admin-only TEST button **Test Exotel Voicebot Transcript
  Webhooks (offline)** for fictional seven-question, reordered, retried
  and opt-out scenarios. No real customer payload may be supplied there.
- Does NOT register a public webhook, verify Exotel source, place a call,
  import a CRM lead, save transcripts, mutate opt-out/DND, confirm visits,
  or charge any customer. Those gates remain CLOSED.

**After Exotel account activation, request exactly:**

1. Is **Managed Voicebot** in our trial? Can we 'Talk to Bot' using one
   personally controlled verified mobile number? Which costs apply?
2. Are the seven Hindi/English questions and *per-turn transcript_events*
   available, including structured answer extraction? Exotel documentation
   shows raw transcripts; it does **not** guarantee a seven-field answer API.
3. What is the supported webhook authentication (e.g. an approved shared
   auth header / IP allowlist), real delivery IPs, retries and event IDs?
   The public docs do not guarantee an HMAC signature. NEVER deploy a
   public webhook before agreeing on the exact authenticated contract.
4. Can we correlate the approved test call SID to a particular tenant,
   Builder and Excel Lead without using guessable phone-only matching?
5. Can the trial use an approved Caller ID, and what KYC/DLT and consent
   rules apply for the different production promotional traffic type?
6. What is the pricing for 100 calls including minutes, Voicebot, STT,
   assigned number and fees? Does multi-Builder usage need an agreement?

Our next integration after a REAL sample/provider contract is a secure,
authenticated/replay-proof per-call **durable inbox** and authorized
tenant-to-CRM mapping with staff verification; later a narrow, expressly
approved dial/campaign path. No blind automatic write from a random
webhook, HTTP URL or untrusted transcript.

## What the deployed code guarantees

- Isolated Client CRM, Excel name/mobile, fixed questions, review form,
  browser-only speech preview and manual site-visit REQUEST workflow.
- Super Admin-only Exotel trial readiness status with **presence flags
  only**, copy-ready non-secret bilingual seven-question Voicebot text,
  clear manual and engineering blockers.
- Existing Super Admin-only real Exotel account connectivity probe
  remains GET-only. The new trial endpoint is GET-only, reads zero
  customer rows and makes zero provider requests.
- No new Worker, schema migration, live calling, public webhook,
  vendor source authentication, auto CRM ingestion or payment.
  Other AR3D services and databases remain unchanged.

## Acceptance checklist

- A real call to an approved personally controlled test number is
  confirmed in the provider call logs.
- Hindi/English each completes seven fixed questions; the respondent
  can repeat and refuse/opt out.
- Caller number, account, campaign and lead correlation are verified.
- Only authenticated per-call results are mapped to the correct tenant
  and imported lead, never cross-tenant or invented.
- Staff verifies transcription of budgets and site visit dates,
  and a requested visit remains unconfirmed until sales approves.
- Call costs and failure modes are checked under a small cap.
**None of these real-phone/provider tests has yet been conducted.**
