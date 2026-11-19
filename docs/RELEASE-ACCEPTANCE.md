# AR3D AI Calling — Production Release Gates

As of 2026-11-19, this is a **deployed engineering CRM + sandbox**, not a live
voice-dialing or paid SaaS production platform. Green CI means tests passed,
not that legal/provider approvals, real browser E2E or disaster recovery passed.

## One engineering batch / three workstreams

### A. Security, acceptance and operations
- Existing sessions, roles, origin enforcement, IP login guard, MFA capability,
  SQL tenant boundaries and guarded Cloudflare deployment remain in place.
- New Super Admin-only read-only \`GET /v1/human/engineering/status\` reports
  immutable release gates. Unauthorized users get 401 or 403; no real provider
  readiness can be inferred or toggled by API parameters.
- Engineering routes do not query customer CRM records. They neither use
  Cloudflare credentials nor allow dialing or payments.
- Pending before customer production: operator MFA enrollment (skipped by request
  for now), independent authenticated browser/mobile E2E, privacy review,
  session/access review, backups and *tested* D1/R2 restore, alerting and incident
  response drills. Do not represent these as completed.

### B. Calling engine groundwork, always synthetic
- New \`POST /v1/human/engineering/pilot\` accepts strictly bounded JSON:
  \`{"count":100,"scenario":"mixed","quotaCalls":100}\`.
- Only a logged-in Super Admin may run it. It executes **in-memory**, never
  sends a request to telecom APIs or receives real customer data.
- Runs deterministic Hindi/English conversation paths: completion, explicit
  opt-out, repeat prompts, unknown price deferred to a human, and low-confidence
  transcription requesting repetition.
- Checks provider-independent state transitions and synthetic voice-plan
  contracts. Neither playback/audio generation nor a real dialer is present.
- Returns aggregate counts only, not real numbers, phone records, transcripts
  or provider identities.
- Remaining: approved Indian telecom provider and number, caller classification,
  consent/DND verification, call-time windows, actual vendor-signed webhook,
  retries/idempotency with a durable authenticated ledger, real bidirectional
  media streaming, STT/TTS/LLM, recordings/retention and human escalation.
  SQL \`trg_no_call_launch\` and agent safety triggers remain enforced.

### C. SaaS metering foundation, not real billing
- \`src/sandbox-usage.mjs\` calculates a hypothetical per-call rounded usage
  preview with a sample call quota, deterministic replay deduplication and
  conflict detection. It rejects all non-synthetic event sources and phone fields.
- Optional \`ratePaisePerMinute\` is an operator-provided **hypothetical sandbox**
  number and must never be interpreted as a provider invoice or price agreement.
- The response always states \`billable:false\`,
  \`paymentCollected:false\`, \`invoiceGenerated:false\`.
- Remaining: provider-reconciled usage events, durable tenant ledger,
  subscription lifecycle, gateway webhooks/signatures, per-plan enforcement,
  invoices/tax/refunds, payouts, customer support, and verified signed AR3D
  knowledge API. Do not activate paid subscriptions from these preview totals.

## How to test the batch

1. Run \`npm test\` in the repository (Node 22+, Python 3). It includes
   RBAC/CSRF, strict pilot validation, Hindi/English opt-out, exact event replay,
   conflicts, quotas and billing-off assertions, along with the existing suite.
2. The guarded GitHub \`main\` workflow repeats all tests, verifies the exact
   Calling D1/R2 identities and call-blocking triggers, then deploys ONLY
   \`ar3d-ai-calling\`.
3. Production read-only smoke validates \`/health\`, \`/app\`, CSS/JS, unauthenticated
   \`/v1/human/me\` and unauthenticated engineering status. Both
   \`workers.dev\` and \`aicalling.ar3dstudio.in\` are checked.
4. Sign in to \`https://aicalling.ar3dstudio.in/app\`, open the
   **Production Readiness & Safe AI Calling Pilot** card, then run the
   **100 Synthetic Calls** action. Expected: exactly 100 synthetic calls,
   zero real calls, zero audio generated, no payment, no D1 write.
5. Use a separate fictitious Client account to verify engineering status/pilot
   is unavailable (403). Never use production customer phone numbers for tests.
6. Visual QA on desktop, tablet and phone plus authenticated browser automation
   must still be signed off separately.

## No-go conditions

A green 100-call mock test does NOT mean 100 live phone calls.
Customer PII and real dial execution remain blocked until the provider,
consent/DND, security, recording and data-governance gates are independently
completed and tested. The first Super Admin bootstrap must never be repeated;
\`ADMIN_BOOTSTRAP_TOKEN\` stays removed. Other AR3D Platform/Engine services
and their databases must remain unchanged.

## Production hardening acceptance (next engineering batch)

- **Actual Chromium browser E2E** is a separate GitHub CI job after the original
  Node/Python foundation suite. It opens the real shipped Login/Admin UI at an
  in-process **127.0.0.1-only synthetic HTTP fixture** on desktop, tablet and
  mobile sizes. It verifies login form, Admin release gates, the 100-call mock,
  billing-off text, sidebar layout and sign-out. **No real account, Cloudflare
  production DB, telecom API, phone number or charge** is accessed. No production
  credentials or secrets are required.
- **SQLite backup/restore drill** loads every Control + CRM migration from source
  into *in-memory fictional databases*, checks integrity/foreign keys and copies
  them using SQLite's backup API. It verifies the resulting restores retain
  tenant boundaries, opt-out history, active-agent prohibition and call-launch
  deny-all triggers. It does **not** back up Cloudflare remote D1/R2 or count as
  a verified production disaster recovery procedure.
- **Provider synthetic inbox replay hardening** rejects duplicate signed event
  IDs whose immutable payload digest, event type or quarantine state differs.
  Exact duplicates remain idempotent; mismatched or missing rows fail closed.
  There is still no real provider webhook or call launch endpoint.
- A production release still requires actual **Cloudflare D1/R2 backup, access-
  controlled encrypted backup storage, restore rehearsal**, browser tests on
  deployed security settings, telecom approvals, data protection/retention,
  MFA enrollment, vendor callbacks, real-time voice, and billing reconciliation.

Run the existing \`npm test\`, and (after installing its temporary Playwright
dependency) \`node scripts/browser-e2e.mjs\`. The GitHub PR CI performs both.


## Exotel Voice AI adapter and mock lifecycle (2026-11-19)

The Exotel India Voice AI Connect *request shape* is now documented and tested
without API credentials or external network calls. Super Admins may run
100 fictional Exotel mock events under strict origin/session/field limits.
The adapter rejects malformed numbers/URLs, unexpected headers and untrusted
callbacks. All caller/consent/DND checks remain fail-closed and can never
authorize dialing from these mock inputs. Real provider approval, callback
source verification, live bidirectional WSS transport, calling-time validation,
and billing reconciliation remain P0 blockers. See
[Exotel Provider Gates](EXOTEL-PROVIDER-GATES.md).

## Provider integration hardening: AgentStream PCM and request preparation

The isolated calling Worker now has a Super Admin-only
`POST /v1/human/engineering/media-protocol` with strict request bounds,
session/CSRF checks, 100 fictional PCM frames, and deterministic
8000/16000/24000 Hz encode/decode and start/stop verification. It does
not accept user audio or phone numbers, and cannot start a telephone call.
The production public smoke checks that unauthenticated users receive 401;
Chromium Browser E2E checks the new Button and 100-frame count.

Vendor HTTP Basic Auth + multipart Connect Voice AI requests are serializable
server-side but NOT sent. Exotel CallSid + nonce callback correlation remains
unverified and quarantined. A future verified source/IP/Details API callback
stage, real WSS media gateway, approved provider/caller ID, lawful consent,
DND verification, STT/LLM/TTS and commercial billing are **not** complete.

## Provider read-only verification and operator readiness

Read-only Exotel Account/Call Details checks are implemented with a fixed
India API host, private Basic Auth, bounded JSON, no redirect and strict
CallSid/Status/AccountSid/Caller ID verification. No fetched phone numbers,
recordings, tokens or charges are displayed or persisted. The optional
Razorpay raw-body HMAC verifier explicitly does **not** fulfill paid
subscriptions, and a duplicate-aware provider usage preview never invoices.

The Super Admin Production Readiness panel shows only yes/no presence for
Worker bindings and a separate manual approval checklist. Presence alone
does not authorize telecom calling, consent, DND, AI voice or payments.
The browser E2E job checks this panel using a localhost-only fixture.

Real provider accounts, verified caller ID, KYC/DLT, legal consent/DND,
signed or allowlisted callback origins, production media gateway, speech AI,
D1/R2 disaster recovery, MFA, lawful billing and end-to-end supervised
calls are still separate signed-off release gates. See
[Operator Go-Live Checklist](OPERATOR-GO-LIVE.md).
