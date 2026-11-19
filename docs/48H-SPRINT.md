# AR3D AI Calling — 48-hour operator + developer execution

Start: 18 Nov 2026 ~22:30 IST. Target: 20 Nov 2026 ~22:30 IST.
This is an engineering timebox, NOT a promise of regulated live outbound calls or payment processing. No changes to AR3D Platform/Engine databases, Workers, R2 buckets or routing. Single main Worker only, no staging.

## Phase 1 (hours 0–4): Cloudflare infrastructure — OPERATOR NOW

1. Verify isolated D1 databases ar3d-calling-control and ar3d-calling-shared-crm, and private R2 ar3d-calling-recordings, in the same Cloudflare account. Never select older AR3D production resources.
2. At https://github.com/rekixo-lab/ar3d-ai-calling/settings/environments create/open production; restrict deployment to main; configure four environment secrets (do not share values):
   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, AR3D_MAIN_CONTROL_DB_ID, AR3D_MAIN_CRM_DB_ID.
   Grant only necessary Workers Scripts Edit, D1 read/write and R2 metadata read permissions to the new scoped API token.
3. At https://github.com/rekixo-lab/ar3d-ai-calling/actions/workflows/deploy-production.yml use main, confirm AR3D_MAIN_ONLY, operation preflight. Share ONLY the run link and ready/fresh/error status. DO NOT initialize before inspecting results.
4. If both D1 databases are FRESH: run initialize ONCE; Control migrations 0001–0007 and CRM migrations 0001–0007. If READY: skip initialize. If partial/mixed: STOP, back up and inspect before incremental migration; never blindly rerun initialize.
5. When both are ready, run deploy. Capture the isolated public https://ar3d-ai-calling.<subdomain>.workers.dev URL (no tokens in URL).

Gate: actual Worker /health=200, /app=200 and unauthenticated /v1/human/me=401. Green GitHub CI alone does NOT prove deployment.

## Phase 2 (hours 4–12): secure human onboarding — OPERATOR + DEVELOPER

1. On NEW ar3d-ai-calling Worker ONLY, set distinct Worker secrets LOGIN_RATE_LIMIT_SECRET and MFA_ENCRYPTION_KEY (32+ random characters each), plus temporary ADMIN_BOOTSTRAP_TOKEN (distinct).
2. On trusted terminal after cloning/updating the repository run:
   python3 scripts/bootstrap-main.py https://ar3d-ai-calling.<subdomain>.workers.dev
   It asks privately for email, token and password. Delete ADMIN_BOOTSTRAP_TOKEN from Cloudflare immediately on successful first Super Admin bootstrap.
3. Log in at /app, enable MFA, save unique recovery codes in a private password manager. Create a fictional demo tenant, client_admin and viewer. Test import, opt-out, campaign draft, agent simulator, audit and tenant separation.
4. On /app/simulator, browser mic permission is opt-in and synthetic speech only. Test on HTTPS.

Gate: verified live Worker auth and synthetic CRM without real customer PII.

## Phase 3 (hours 12–28): telecom and voice provider — OPERATOR DECISIONS

1. Choose an India-compliant outbound calling provider with AI media streaming, approved calling number and your verified traffic classification. Candidate: Exotel Connect Voice AI; documentation: https://developer.exotel.com/docs/agentstream/connect-voice-ai . Bidirectional WebSocket does not imply account permission to call.
2. Choose STT, TTS and LLM services with account enablement, realtime protocol compatibility and data privacy terms. Candidate: Sarvam realtime STT https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming and TTS https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/streaming-api/web-socket .
3. With provider confirm applicable sender/DLT registration, customer consent/DND preference checks, lawful calling hours, AI/recording disclosures, approved CLI and any prior declaration of Application-to-Person (A2P) voice calls required under the Nov 2026 regulatory framework: https://trai.gov.in/sites/default/files/2026-11/CR_10112026.pdf .
4. Report only provider names, product/API type, account status (not started / pending / approved), caller ID approval and public API documentation links. NEVER send secrets, KYC scans, customer numbers, or recording data.

Gate: actual account/provider contract and legal authorization. If pending, use only synthetic/mock integration.

## Phase 4 (hours 28–40): integrations and privacy

Implement/review provider-specific signed callbacks, replay/idempotency, real media transport, DND/consent, AI prompts and handoff only after approvals. Choose payment provider, pricing/usage policy and invoices; current CRM metrics are NOT billable telecom minutes. Agree authorized read-only AR3D knowledge APIs, tenant-scoped recording encryption/retention/erasure, key rotation, backups, restore tests and monitoring. Do NOT remove call-launch deny-all or agent activation triggers to force a demo.

Gate: verified real-provider end-to-end tests and legal safeguards or remain mock-only.

## Phase 5 (hours 40–48): go/no-go

Run npm test, GitHub main CI, actual Worker health/login/MFA/tenant-isolation checks with fictional leads, monitor alerts and backup review. Release one of two explicit results:
(A) live isolated CRM + text/browser speech demo if providers remain pending;
(B) controlled compliant voice-calling pilot ONLY after approved number, valid consent/DND, real streaming transport, signed provider callbacks and security checks exist.
Full paid multi-tenant commercial production remains a separate sign-off.

## Safe reply for this conversation

Send ONLY: GitHub preflight run link and fresh/ready/error; isolated Worker public URL after deploy; telecom provider NAME plus KYC/approved number status; speech/LLM provider NAMES and account status; payment gateway choice and whether it must be live for the 48-hour MVP. Never paste API token/password/TOTP seed/database ID.

Current code has CRM, synthetic browser speech, disabled encrypted R2 adapter and quarantined synthetic event inbox. Real calls, certified DND checks, vendor webhooks, full billable subscriptions, complete customer-data erasure and production voice AI are NOT done.

## Boss-confirmed requirements (Nov 19 WhatsApp)

- Source: Excel. Previous enquiry and unknown/new contact customers are both supported.
- AI should initiate outbound calls once telecom onboarding, consent and DND clearance are proven.
- Language: Hindi and English options. Desired data: name, budget, location, plot size and visit preference.
- Interested customer: request/confirm a site visit. A preferred date is not a confirmed appointment.
- Call recordings requested; real recordings disabled pending approval, notice, retention and provider setup.
- Daily call quantity is dependent on company data; pilot with minimum viable paid provider costs.
- Telecom service, DLT registration and approved number: not yet available according to Boss.
- Unanswered: fixed questions only, or autonomous answers to customer questions? Boss replied about language instead.

CRM v8 optional Excel columns: Customer Type, Plot Size, Visit Date Preference (YYYY-MM-DD).
Valid customer types: prior inquiry, unknown contact or unclassified. Missing defaults to unclassified.
Customer type alone NEVER grants calling consent or permission. CRM v8 must be backed up
and applied incrementally on existing Calling D1; new empty D1 initialize includes it.


## 19 Nov update: automatic setup enabled on main merge

After four production GitHub secrets are available and preflight confirms BOTH independent databases fresh, the main branch's Cloudflare deployment workflow is designed to run automatically upon each `main` push. It runs the full tests, fresh-only migrations (on first setup), verifies ready and safety triggers, deploys the isolated Worker, and attempts read-only HTTPS smoke. User no longer needs to click `initialize`/`deploy` for normal code changes; the manual workflow remains as a fallback for controlled incident recovery. Any partial or mixed schema stops. Future external/provider setup, login/MFA secrets, initial Super Admin account creation and regulated telecom approval still require trusted operator action.
