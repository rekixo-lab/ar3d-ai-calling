# AR3D AI Calling — active operations, exact manual blockers

This file concerns ONLY the isolated Cloudflare Worker **ar3d-ai-calling**
and its domain **aicalling.ar3dstudio.in**. No AR3D Platform or Engine routes,
databases, Workers or customer files are touched.

## Two automatic live services activated by this deployment

1. **Cloudflare Cron, 00:00/06:00/12:00/18:00 UTC** via
   \`triggers.crons = ["0 */6 * * *"]\`. The Worker \`scheduled()\` handler
   runs bounded, SQL-parameterized deletion of **expired** Control D1 session
   tokens, MFA challenges, invitations and old nonblocked IP login limits.
   Up to 100 rows per table per invocation; never runs the CRM conversation,
   leads, consent, opt-out, audit, recording or billing cleanup.
   An unexpected Cron expression is rejected. The static Wrangler validator
   rejects any second schedule or other trigger. The job logs numeric
   delete counts only. The first actual Cron invocation can be checked under
   Cloudflare Worker Cron Events; deployment success alone does not prove a
   scheduled invocation already occurred.
2. **Read-only GitHub scheduled monitor** at \`23 */6 * * *\` UTC in
   \`.github/workflows/monitor-production.yml\`. It checks only the exact
   custom hostname and no credentials: health JSON, Admin HTML/CSS/JS and
   all unauthenticated human/engineering endpoints returning expected 401.
   Three bounded attempts, no POST, no real calls, no writes, no customer
   PII. A GitHub Action failure appears in the repository Actions tab.
   Operators must separately configure who receives failure notifications
   and incident-response ownership.

## Live provider connection check — already coded, but no credentials

Super Admin Dashboard now exposes **Check Exotel Connection (read-only)**.
This calls authenticated, same-origin
\`POST /v1/human/engineering/provider-connectivity\`, accepting only
\`{}\`. With no approved vendor credentials it returns
\`configured:false,verified:false\` and makes **zero external requests**.
After the operator securely adds the Exotel account secret names to
**only** the Calling Worker, it performs one bounded, authenticated GET to
\`https://api.in.exotel.com/v1/Accounts/{sid}/Calls.json?PageSize=1\`,
never returning provider account secrets, customer details or a log of
existing calls. A connection success is **not** permission to call,
inference of opt-in/DND clearance, authorization of ExoPhone/Caller ID or
verification of Voice AI routing.

Operator-controlled secret bindings, when approved:
- \`EXOTEL_ACCOUNT_SID\`
- \`EXOTEL_API_KEY\`
- \`EXOTEL_API_TOKEN\`

Do not put any value into chat, screenshots, GitHub text, HTML or
commit history. Secret presence and valid read-only GET are distinct from
legal approval and real dial capability.

## External/manual tasks required before commercial production

- Exotel Business KYC + Voice AI/AgentStream approval and an explicitly
  authorized caller number in the correct Indian TRAI/DLT category.
- Purpose-specific opt-in and independent, up-to-date DND clearance,
  opt-out suppression, calling-time compliance, AI voice disclosure and
  human escalation approval.
- Live approved Hindi/English STT/LLM/TTS or real-time voice provider,
  region, cost and secrets. A deployed authenticated media gateway,
  real provider callback source authentication and durable call state
  ledger still require engineering and vendor integration.
- Merchant gateway KYC, bank/tax/account/plan pricing and payment gateway
  credentials; durable payment fulfillment and provider-reconciled invoices
  must be implemented and signed off. An HMAC-only parser is insufficient.
- MFA enrollment, real Cloudflare D1/R2 backup and nonproduction restore
  rehearsal, retention/deletion agreements, verified AR3D project API scope
  and independent security, load and supervised live-call acceptance.

Keep all unauthorized Calling and paid services **fail-closed**. The
CRM, simulator, provider contract test, offline PCM tests, monitoring,
auth cleanup and Admin read-only connectivity check can be live now; the
same is NOT true of real customer dialing, recording, speech generation
or paid subscription fulfillment.

## Verification

- \`npm test\` for all Node and Python unit/SQL tests.
- Chromium E2E for login, release panel, 100 fake calls, Exotel real-key
  connectivity button with zero provider calls in fixture and sign-out.
- \`node scripts/monitor-production.mjs\` for exact custom-domain public
  read-only smoke.
- Confirm GitHub main guarded deployment and custom-domain smoke succeeded.
- Cloudflare Worker Cron Events must be inspected after a scheduled run to
  confirm actual periodic execution. Never claim Cron has run from a green
  deploy alone.
