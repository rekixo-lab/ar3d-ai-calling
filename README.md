# AR3D AI Calling

**Phase 1 starter only** — independent multi-tenant CRM and AI-agent configuration API for AR3D clients. Product branding is **AR3D AI Calling**. This is NOT a working outbound AI calling system yet.

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

## Cloudflare setup (later, with authorized account)

1. Create a **new** Cloudflare Worker project/repository named `ar3d-ai-calling`.
2. Provision NEW D1 databases `ar3d-calling-control` and `ar3d-calling-shared-crm` and a NEW R2 bucket `ar3d-calling-recordings`.
3. Copy `wrangler.example.jsonc` to `wrangler.jsonc`; replace placeholder D1 IDs. This file is ignored by Git.
4. Apply `migrations/control/0001_init.sql` to the control D1 and `migrations/crm/0001_init.sql` to the shared CRM D1. Never run these on AR3D Platform or Engine D1.
5. Set `ADMIN_BOOTSTRAP_TOKEN` as a **Worker secret** with at least 32 random characters. Do not commit or send it to the browser.
6. Only after security review, test the Worker in an isolated staging environment. Do not enable public calling.

## API examples (staging only)

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

**First Super Admin (staging only, manual bootstrap):** after `ADMIN_BOOTSTRAP_TOKEN` has been set as a Worker secret and both new D1 databases provisioned, invoke the one-time POST endpoint with an HTTPS server-to-server request:

```sh
curl -X POST https://YOUR-AR3D-CALLING-HOST/v1/human/bootstrap \
  -H "Authorization: Bearer $ADMIN_BOOTSTRAP_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"email":"owner@example.com","password":"REPLACE_WITH_A_UNIQUE_STRONG_PASSWORD"}'
```

The secret is never sent to the browser. Replace the example password; use a password manager and secure out-of-band handoff. One-time bootstrap is guarded by a transactionally unique claim. Sign in at `/app`, add a company, and create a one-time invitation. Send the invitation URL privately to the client; the client sets their own password and can then manage only their tenant. All new leads remain `consent=unknown,dnd=unknown`. Dedicated D1 tenants remain unavailable until Cloudflare binds their database separately.

**Production caveats:** This Phase 2 is a staging-grade initial prototype, not production-ready identity or paid calling. Add managed email verification, MFA for Super Admin, Cloudflare WAF and distributed rate limiting, verified invite delivery, password recovery and session management, operational audit events, PII encryption and deletion, subscription enforcement, D1 provisioning and R2 retention policies. Calling requires telecom onboarding, KYC/DLT where applicable, lead consent/DND checks, AI disclosure and correct recording notices. There is no billing, live AI voice, dialing, automatic number provisioning or deployed Cloudflare service in this phase.


## Phase 3 — Lead Workflow / CSV Import (historical milestone)

- Phase 3 introduced CSV UTF-8 imports (up to 200 rows / 160 KB); Phase 4 adds native `.xlsx`.
- Strict RFC4180 quoting, mobile normalization, budget validation, duplicate-in-file rejection; pre-existing CRM numbers are skipped, not overwritten.
- Every imported lead has `consent_status=unknown` and `dnd_status=unknown`. Import neither places calls nor authorizes them.
- Client role permissions: `client_admin` can update lead interest/location/budgets/followups, keep notes and request site visits; `viewer` is read-only.
- No cross-tenant reads/edits. New migration `migrations/crm/0002_lead_workflow.sql` must be applied to both shared CRM and every dedicated CRM database.
- Staging-only Cloudflare setup instructions and safe-config validator: [docs/STAGING.md](docs/STAGING.md). This repo does **not** automatically deploy.
- Strict limits: 200 CSV customer rows, 160 KB file, 50 leads displayed per CRM search, 100 max API page size. Additional pagination UX and larger batch imports remain future work.


## Phase 4: native XLSX lead import and staged deployment gate

- `/app` accepts `.xlsx` (up to 1 MiB; first visible worksheet, max 200 leads) or CSV UTF-8 (160 KB). Both require validation/preview before commit.
- XLSX import uses bounded ZIP/DEFLATE parsing without additional npm dependencies; rejects formulas, macros, external links, encrypted files, invalid headers, duplicate phones and oversized files. No user data leaves the CRM Worker for parsing.
- New imports still set consent/DND to `unknown`; they never start calls and never overwrite existing leads.
- `.github/workflows/deploy-staging.yml` is a **manual-only** staging deployment gate. It requires protected GitHub Environment secrets and pre-provisioned Cloudflare resources/migrations; it is never automatic.
- `docs/STAGING.md` describes manual Cloudflare setup. Existing AR3D Platform and Engine production resources must remain untouched.
