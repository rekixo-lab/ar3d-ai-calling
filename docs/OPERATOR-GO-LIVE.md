# AR3D AI Calling — operator-required go-live actions

**State: 2026-11-19.** The standalone app at
https://aicalling.ar3dstudio.in/app is a guarded CRM, AI conversation and
provider-protocol engineering environment. **No live phone call, actual
WebSocket streaming, vendor-signed callback, payment or invoice is enabled.**
The bootstrap secret is gone. Do not repeat first-Super-Admin bootstrap.
Do not remove the SQL no-call and no-active-agent triggers.

## 1. Exotel / India telecom — blocking manual provider work

- Create or obtain **Exotel business account** after the provider's
  KYC/business checks. Confirm **Voice AI / AgentStream Connect** is allowed
  for this account and billing region; choose India regional API.
- Confirm an **authorized ExoPhone/Caller ID** for the actual use case and
  whether outbound real estate lead calls are promotional versus an eligible
  service category. Verify current TRAI/DLT requirements and number range
  with Exotel. A previous customer inquiry is not blanket calling consent.
- Obtain **Exotel Account SID, API Key and API Token** in your own Exotel
  dashboard. Never share values in ChatGPT, GitHub issues, screenshots, docs
  or source code.
- Obtain from Exotel Support the **current outbound webhook source IP
  ranges**, retry policy, agreed caller ID, Voice AI stream protocol/capacity,
  testing numbers, concurrency and permitted local calling windows.
  A callback's CallSid, CustomField or IP alone does not prove authorization.
- Arrange **documented, purpose-specific permission/consent** for each
  recipient, working customer preference / DND lookup and an opt-out
  suppression mechanism that prevents further contact.

**Read-only Exotel credential check (optional, after credentials are approved):**

Use an isolated private terminal/password manager to export
\`EXOTEL_ACCOUNT_SID\`, \`EXOTEL_API_KEY\` and \`EXOTEL_API_TOKEN\` in the
current process session. Run:

\`\`\`bash
cd ~/Workspace/ar3d-ai-calling
git pull origin main
node scripts/check-exotel-readonly.mjs
\`\`\`

This executes **only an authenticated GET** of Exotel account call-list
metadata with \`PageSize=1\`, displays no call or customer data, and never
initiates a call. Do not paste secrets into shell history or chat. The check
can fail until provider API access is granted; do not weaken it.

Actual voice calls still require independently reviewed dial authorization,
a confidential WSS media gateway with call-state ownership, Exotel source
verification and durable idempotency. No such live dispatch endpoint exists.

Official documentation:
- https://developer.exotel.com/docs/agentstream/connect-voice-ai
- https://developer.exotel.com/docs/voice-v1/api-reference/call-details
- https://developer.exotel.com/docs/references/authentication

## 2. AI voice provider — manual choices and credentials

Approve the actual **Hindi/English streaming speech provider** or a
multi-vendor STT + LLM + TTS design, region, pricing, audio retention
and outbound caller disclosure. Obtain corresponding API credentials in
the provider's secure dashboard. Choose latency, barge-in, escalation,
hallucination/price-confirmation policy, human handoff, and the lawful
retention/deletion plan. The current AgentStream PCM tests do not generate
spoken audio; no live AI service is connected.

## 3. Payment/subscriptions — merchant manual work

Choose and activate a payment gateway (for example Razorpay **if you select
it**), complete merchant KYC, business bank account, applicable tax/GST
and billing/refund terms, and agree on plan pricing, telecom markups,
monthly quotas and provider reconciliation.

A safe optional \`src/razorpay-webhook-verification.mjs\` verifies the
official raw-body HMAC-SHA256 signature but has **no public webhook route**,
payments, subscriptions, trusted order ledger, invoices or fulfillment.
Do not configure live Razorpay webhooks to point at the Calling Worker until
that independently signed-off, durable fulfillment workflow is built.

Official documentation:
https://razorpay.com/docs/webhooks/validate-test/

## 4. Cloudflare, disaster recovery and operational security

- **Enroll Super Admin MFA** and store one-time recovery codes privately.
  This was intentionally deferred previously; remains a production gate.
- Set approved D1/R2 retention, recording notice, restricted download access,
  deletion requests, key rotation and data processing terms.
- Cloudflare D1 Time Travel supports a point-in-time recovery window, but
  that alone does not constitute tested disaster recovery. Obtain dedicated
  encrypted backups and perform a **nonproduction restore rehearsal**.
  Never restore the live customer database as a smoke test.
- Configure alert routing (auth anomalies, provider 429/5xx, callback
  authentication failures, calling quota and unusual charges), incident
  owners and rollback steps. Verify logs exclude secrets/PII/audio.
- Run an authorized security review and end-to-end browser/mobile QA against
  the real deployed Worker with synthetic tenants, plus load tests and a
  controlled consented real-number pilot **only after approval**.

Official Cloudflare D1 documentation:
https://developers.cloudflare.com/d1/reference/time-travel/

## 5. AR3D integrations and privacy

Approve a **read-only tenant-scoped AR3D Platform/Engine knowledge API**
and technical credentials. Confirm fields allowed to be shared with each
tenant (project availability, prices, plot sizes), freshness/caching and
human escalation when not verified. No existing AR3D Platform/Engine
Worker/database may be altered in this project without explicit separate
review.

## Clear acceptance boundaries

**Engineering completed so far**: isolated Cloudflare deployment,
Super Admin/CRM, tenant roles, CSV/XLSX lead import, consent evidence,
simulation, 100-call mock, Exotel request framing and 100 PCM audio frames,
offline restore test, public smoke, browser E2E, read-only provider
account/call lookup, fail-closed usage previews and optional payment webhook
signature parsing. Tests use fake accounts and never create live calls.

**Still not complete**: legal/telecom approval and certified caller ID,
verified consent/DND provider, production authenticated WSS voice gateway,
streaming STT/LLM/TTS, verified callback source/ledger, actual D1/R2 remote
restore and key rotation, MFA enrollment, usage billing, payment fulfillment,
invoice/tax, verified project knowledge and a supervised live pilot.

Do not treat code-complete mocks, presence of API keys, a green smoke test,
a webhook signature alone or a successful provider GET as permission to
call real people or collect payments. Only the operator/provider can
complete the external actions, and engineering must then wire them into
a reviewed, deliberately enabled real integration.
