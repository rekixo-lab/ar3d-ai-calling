# AR3D AI Calling

**Development foundation (Phases 1–5)** — independent multi-tenant CRM, personal admin dashboard, lead imports and deterministic text conversation simulator for AR3D clients. Product branding is **AR3D AI Calling**. **No real outbound calls or live generative AI voice conversations are implemented.**

## What works in this starter

- Separate tenant registry and shared/premium storage selection.
- Shared CRM D1 schema with tenant-scoped leads, draft AI agents, call and visit tables.
- Premium/dedicated D1 selector that refuses access until a dedicated database binding has been provisioned.
- Server-to-server Admin and tenant API-key authentication. Keys are SHA-256 hashed in the control DB.
- Create tenants, issue server API keys, create/list private leads and draft agents.
- Imported leads default to **unknown** consent and DND status; no call-launch endpoint is implemented.
- Node + Python/SQLite tests for access-control behaviors and cross-tenant storage constraints.

## What is intentionally NOT built yet

Phone number provisioning, live AI conversation, voice WebSocket, outbound calling, subscription charging, 140-series numbers, KYC/DLT, consent verification, real-call recordings and automated site visit execution. Provider service approval is required before real calling. Do not deploy as a production CRM without completing security work in `docs/ARCHITECTURE.md`.

## Two existing GitHub repositories reviewed

- [AR3D Platform](https://github.com/rekixo-lab/rekixo-ar3d-platform) — existing project sites and client-admin D1.
- [AR3D Engine](https://github.com/rekixo-lab/rekixo-ar3d-engine) — separate 3D project registry and client portal.

This starter deliberately DOES NOT change either repo or their production D1/R2 resources.

## Quick test

```bash
npm test
```

## Main Cloudflare deployment (single environment)

Only one main AR3D AI Calling Worker and its own databases are used. Nothing here touches AR3D Platform or AR3D Engine production services. Main setup is **manual** and must not be used for real client data until the security and compliance work below is complete.

- D1: `ar3d-calling-control` (new), `ar3d-calling-shared-crm` (new).
- Private R2: `ar3d-calling-recordings` (new).
- GitHub: create environment `production` and four environment secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `AR3D_MAIN_CONTROL_DB_ID`, and `AR3D_MAIN_CRM_DB_ID`.
- Actions: **AR3D AI Calling - main Cloudflare setup (manual)**. Run `preflight` → `initialize` (once for empty new databases only) → `deploy` after verifying results.
- To check the isolated Worker URL after authorized deployment, run `npm run smoke:main -- https://ar3d-ai-calling.<workers-subdomain>.workers.dev`.

Complete instructions: [Main Cloudflare Deployment](docs/MAIN-DEPLOYMENT.md). There is no automatic deployment from pushes. No real phone calls, billing, telecom numbers or voice AI are available in the current code.

## API examples (server-to-server development only)

- `GET /health`
- `POST /v1/admin/tenants` — admin bearer secret, JSON `{"slug":"demo-builder","displayName":"Demo Builder","plan":"starter","storageMode":"shared"}`
- `POST /v1/admin/tenants/:tenantId/keys` — admin bearer secret, JSON `{"name":"server integration"}`; key returned once.
- `GET /v1/me` — tenant bearer key.
- `GET /v1/leads` and `POST /v1/leads` — tenant key, JSON `{"name":"Example","mobile":"9876543210","sourceType":"excel"}`.
- `GET /v1/agents` and `POST /v1/agents` — tenant key, JSON `{"displayName":"AI Sales Assistant","languageMode":"hi-en","questions":["Which location do you prefer?","What is your budget?"]}`.

**No tenant ID parameter is accepted on client CRM APIs.** The tenant identity is resolved from the server-side key record. Never expose these API keys in a public website.

## Next milestones

- M1: client membership + secure login + Super Admin/Client UI; add tenant-scoped acceptance tests.
- M2: CRM, CSV/XLSX import, agent settings, site visits and recording storage policies.
- M3: provider onboarding and compliance; calling number assignments, realtime AI audio and minute metering.
- M4: verified AR3D Platform/Engine knowledge integration, billing and production rollout.

Full design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Phase 2: human Super Admin and Client Dashboard (development)

A browser UI is now available at **`/app`**, with private JSON endpoints at `/v1/human/*`. It adds human password login, server-side hashed/salted PBKDF2 credentials, secure HttpOnly sessions, user memberships, one-time tenant invites, client lead/agent management and a separate Super Admin client onboarding overview. Backend API keys remain exclusively for server integrations and must **never** be placed in the browser. No live calls are possible.

**New migration:** apply `migrations/control/0002_human_access.sql` to the **AR3D AI Calling control D1 only** (after `0001_init.sql`). CRM migrations are unchanged.

**First Super Admin (after an authorized main Worker deploy):** after `ADMIN_BOOTSTRAP_TOKEN` has been set as a Worker secret and both new D1 databases provisioned, invoke the one-time POST endpoint with an HTTPS server-to-server request:

```sh
curl -X POST https://YOUR-AR3D-CALLING-HOST/v1/human/bootstrap \
  -H "Authorization: Bearer $ADMIN_BOOTSTRAP_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"email":"owner@example.com","password":"REPLACE_WITH_A_UNIQUE_STRONG_PASSWORD"}'
```

The secret is never sent to the browser. Replace the example password; use a password manager and secure out-of-band handoff. One-time bootstrap is guarded by a transactionally unique claim. Sign in at `/app`, add a company, and create a one-time invitation. Send the invitation URL privately to the client; the client sets their own password and can then manage only their tenant. All new leads remain `consent=unknown,dnd=unknown`. Dedicated D1 tenants remain unavailable until Cloudflare binds their database separately.

**Production caveats:** This Phase 2 is a development-grade initial prototype, not production-ready identity or paid calling. Add managed email verification, MFA for Super Admin, Cloudflare WAF and distributed rate limiting, verified invite delivery, password recovery and session management, operational audit events, PII encryption and deletion, subscription enforcement, D1 provisioning and R2 retention policies. Calling requires telecom onboarding, KYC/DLT where applicable, lead consent/DND checks, AI disclosure and correct recording notices. There is no billing, live AI voice, dialing, automatic number provisioning or deployed Cloudflare service in this phase.


## Phase 3 — Lead Workflow / CSV Import (historical milestone)

- Phase 3 introduced CSV UTF-8 imports (up to 200 rows / 160 KB); Phase 4 adds native `.xlsx`.
- Strict RFC4180 quoting, mobile normalization, budget validation, duplicate-in-file rejection; pre-existing CRM numbers are skipped, not overwritten.
- Every imported lead has `consent_status=unknown` and `dnd_status=unknown`. Import neither places calls nor authorizes them.
- Client role permissions: `client_admin` can update lead interest/location/budgets/followups, keep notes and request site visits; `viewer` is read-only.
- No cross-tenant reads/edits. New migration `migrations/crm/0002_lead_workflow.sql` must be applied to both shared CRM and every dedicated CRM database.
- Main Cloudflare deployment is manual and gated by resource identity and schema checks: [docs/MAIN-DEPLOYMENT.md](docs/MAIN-DEPLOYMENT.md). This repo does **not** automatically deploy.
- Strict limits: 200 CSV customer rows, 160 KB file, 50 leads displayed per CRM search, 100 max API page size. Additional pagination UX and larger batch imports remain future work.


## Phase 4: native XLSX lead import and deployment safeguards

- `/app` accepts `.xlsx` (up to 1 MiB; first visible worksheet, max 200 leads) or CSV UTF-8 (160 KB). Both require validation/preview before commit.
- XLSX import uses bounded ZIP/DEFLATE parsing without additional npm dependencies; rejects formulas, macros, external links, encrypted files, invalid headers, duplicate phones and oversized files. No user data leaves the CRM Worker for parsing.
- New imports still set consent/DND to `unknown`; they never start calls and never overwrite existing leads.
- `.github/workflows/deploy-production.yml` is the **manual-only** main deployment workflow with exact resource validation, one-time database initialization and a deploy gate. Existing AR3D Platform and Engine production resources remain untouched.


## Phase 5 — safe, text-only AI conversation simulator

- The **Test AI Conversation** navigation link opens `/app/simulator` for signed-in clients. Each client can select their own draft agent and try an entirely synthetic customer dialogue. It uses that agent's stored question list.
- `GET /v1/human/simulations/agents?tenantId=...` lists only the signed-in user's tenant agents. `POST /v1/human/simulations` starts a demo; `GET /v1/human/simulations/:id?tenantId=...` reads it and `POST /v1/human/simulations/:id/turn` advances it with `expectedRevision` for concurrency safety. All POSTs require same-origin human sessions, tenant write membership, and bounded request bodies.
- The offline logic supports **repeat, skip, opt-out, and question-by-question raw-answer storage**. Unknown prices and availability are never invented. It does **not** answer arbitrary questions using an LLM, infer facts from speech, capture real audio, change consent/DND records, or schedule actual site visits.
- New database migration `migrations/crm/0003_conversation_simulator.sql` applies only to AR3D AI Calling CRM D1 databases (shared and separately provisioned dedicated DBs).
- Demo state expires after 24 hours. Production deployment must additionally schedule deletion of expired rows and apply a data retention/privacy policy. Always use fictional customer details during testing.
- Run `npm test` locally; CI uses the same command. Calling-provider onboarding, realtime audio transport, verified project knowledge, compliance and Cloudflare deployment remain separate, pending work.

## Phase 6 — One-way client lead opt-out (manual suppression)

- Signed-in `client_admin` can block an owned lead through **Do Not Call / Block number** and view a tenant-scoped opt-out event history. `viewer` can read but cannot change the contact preference.
- `POST /v1/human/leads/:id/opt-out` takes `{tenantId,source,reason?}`, where `source` is `customer_request`, `admin_action` or `other`. It never grants calling consent or dials a lead.
- Database migration: `migrations/crm/0004_lead_opt_out.sql`. Run on NEW CRM databases after `0003` or use an approved incremental migration process for an existing database (see [Main Deployment](docs/MAIN-DEPLOYMENT.md)). The database trigger prevents reversing a recorded opt-out through ordinary SQL updates.
- Already-imported blocked numbers remain blocked if the same Excel/CSV number is uploaded again; imports do not overwrite existing lead records.
- Still missing: provider-driven opt-out webhooks, DND API integration, cross-tenant/legal suppression design, and privacy retention/deletion policy. Do not mistake manual CRM suppression for compliance clearance.


## Phase 7 — secure login IP budget (main only)

- Human login requires a secret-backed HMAC of the verified Cloudflare \`CF-Connecting-IP\`, stored in Control D1 \`human_ip_login_limits\` (no raw address). Request headers such as \`X-Forwarded-For\` are ignored.
- A separate per-IP login budget (60 attempts per 15 minutes, 429 lockout) complements the existing per-email failure lockout. The budget includes both successful and unsuccessful login attempts; clients sharing one public IP may be affected.
- **Deployment requirement:** set \`LOGIN_RATE_LIMIT_SECRET\` as a Worker secret (32+ random characters) on \`ar3d-ai-calling\` before first human login. If the secret or trusted client-IP header is missing, login fails closed (503).
- New Control migration: \`migrations/control/0003_ip_login_limits.sql\`. Included in one-time initialization for **new empty databases**; existing databases require reviewed incremental migration after backup. More production controls (MFA, WAF, password recovery, retention) are still outstanding.

## Phase 8 — optional Super Admin Authenticator MFA

- Encrypted TOTP setup for `super_admin` in the Human Dashboard, with 6-digit 30-second Authenticator Codes. The setup secret is displayed only during pending enrollment and stored AES-GCM encrypted in Control D1.
- After MFA is enabled, password login returns a 5-minute challenge instead of a session; `POST /v1/human/login/mfa` completes it after TOTP verification (max 5 attempts, non-replayable step). Other sessions are revoked on activation.
- **Required Worker secret:** `MFA_ENCRYPTION_KEY` (32+ randomly generated characters), never commit/share it. Missing key rejects MFA access. Back up the key securely; rotating/loss prevents decryption.
- **Recovery codes/recovery workflow are not yet implemented.** Enrollment is optional; do not enable this on a sole administrator until an independently verified recovery plan is in place.
- Migration: `migrations/control/0004_super_admin_mfa.sql` (new Control D1 only, after 0003). Existing initialized databases require reviewed incremental migration.

## Phase 9 — Super Admin one-time MFA recovery codes

- MFA activation now generates **8 one-time 128-bit recovery codes**. Codes are shown once, never stored in plaintext and never logged; Control D1 stores only user-scoped HMAC-SHA256 digests keyed with `MFA_ENCRYPTION_KEY`.
- Password-validated MFA challenges may be completed with one unused recovery code instead of TOTP. A successful use marks the code consumed and creates a session only after challenge consumption. Wrong/used codes count toward challenge attempts; login per-IP limits still apply.
- A logged-in Super Admin can **replace all backup codes** by re-entering their current password and a fresh authenticator code. An active session alone cannot rotate codes.
- Accepting a client invitation with an existing MFA-enabled account now requires the MFA challenge rather than silently creating a password-only session. Invitation acceptance uses IP attempt limits.
- Control D1 migration `0005_mfa_recovery.sql` is included for new empty databases. Existing databases must be backed up and upgraded incrementally. Full managed admin account recovery remains out of scope; do not lose both your authenticator and unused recovery codes.


## Phase 10 — consent evidence intake and call-readiness guard

- Authenticated `client_admin` users can submit a tenant-scoped evidence **reference** with purpose, source, capture time and pending-review status. Viewer members can read their own tenant's evidence.
- Records are **not independently verified** and never change `leads.consent_status` or `leads.dnd_status`. No telecom provider lookup, calling number, or dialing functionality is enabled.
- The read-only `/v1/human/leads/:id/call-readiness?tenantId=...` API always returns `eligible:false` until verified provider integrations, caller-number approval and lawful calling-hours checks exist.
- CRM migration `migrations/crm/0005_consent_evidence.sql` stores evidence references and database triggers that block direct SQL updates/inserts setting `consent_status='granted'` or `dnd_status='allowed'` before independent verification is implemented. This trigger must only be changed with a reviewed future compliance integration.
- Run the existing main-only manual initialization on **new empty** D1 databases. Already initialized CRM D1 requires an operator-approved incremental migration with a backup; never rerun `initialize`.


## Phase 11 — Bilingual speech plan and typed-STT simulation (NO real voice)

- New provider-independent `src/voice-core.mjs` converts the last simulated agent message into bounded Hindi/English text segments with `hi-IN` or `en-IN` locale hints. No TTS audio, speech-to-text, phone call, microphone, voice cloning, or external AI service is connected.
- `GET /v1/human/simulations/:id/voice-preview?tenantId=...` returns safe text segments only for a signed-in member of the owning tenant. The simulator UI includes a **Preview next spoken turn** button.
- `POST /v1/human/simulations/:id/speech-turn` (human-client-admin only) takes `{tenantId,expectedRevision,recognition:{source:"typed_demo",transcript:"...",confidence:0.95}}`. It treats the submitted transcript as a **synthetic** STT result, returns "repeat requested" without a write for silence/low confidence, and otherwise advances only the existing tenant-scoped demo state with revision checks. Provider claims are rejected.
- The existing opt-out rule ends the **demo** without touching CRM consent/DND or placing any calls. No schema migration is required in this phase. This is groundwork for a future verified, compliant realtime voice adapter—not a functioning voice AI integration.


## Phase 12 — safe campaign and AR3D metadata planning

- The human CRM supports tenant-scoped draft campaigns, candidate lead references and non-executable readiness reports. There is no activation or dialing API. Campaign status is constrained to draft, and the v6 CRM database migration prevents inserting actual call records.
- Signed-in client admins may register AR3D Platform or Engine project metadata in the isolated control D1. Such links remain pending and do not fetch other projects, verify ownership or provide property facts.
- Optional backend-only machine admin endpoints now need a separate ADMIN_API_TOKEN, never the one-time human ADMIN_BOOTSTRAP_TOKEN. If unset, machine-admin routes return unauthorized.
- For manual Cloudflare/telecom/provider/payment requirements, see docs/MANUAL-ACTIONS.md.


## Site visit status updates

Client admins can transition an owned visit from `requested` to `confirmed`/`cancelled`, and from `confirmed` to `completed`/`cancelled` through `PATCH /v1/human/visits/:id` with `{tenantId,status}`. The CRM UI provides controls and every transition creates a tenant-scoped audit event. No calendar booking, call or customer notification is performed. No SQL migration is required.


### Draft campaign candidate removal

Client admins can remove an incorrect lead candidate from their own non-executable draft with `DELETE /v1/human/campaigns/:id/candidates/:leadId?tenantId=...`. The Dashboard lists candidates for the selected draft with a remove control. Removal writes a tenant-scoped audit event only for an existing candidate; it **never** updates the underlying lead, Consent/DND fields, or initiates calls. A viewer cannot remove candidates. No new SQL migration is required.


## Machine API key inventory and revocation (administrative security)

- With a separately configured optional `ADMIN_API_TOKEN`, a trusted server-side operator can call `GET /v1/admin/tenants/:tenantId/keys` to list up to 100 integration key **metadata** records: ID, name, role, active state, creation/revocation time. API key plaintext and its SHA-256 digest are **never returned**.
- `DELETE /v1/admin/tenants/:tenantId/keys/:keyId` revokes only an active key belonging to that tenant, recording `revoked_at` and an isolated Control D1 audit event. Repeated revoke attempts are idempotent. Revoked keys fail existing `tenantAuth` checks immediately on subsequent requests.
- These machine-admin endpoints stay unavailable unless the separate `ADMIN_API_TOKEN` Worker secret is set. Never use `ADMIN_BOOTSTRAP_TOKEN` or put machine tokens into browser or mobile code. No new database migration is required.
