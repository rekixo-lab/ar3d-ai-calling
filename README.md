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

Human Super Admin / Client Admin UI or login, Excel/XLSX uploader, phone number provisioning, live AI conversation, voice WebSocket, outbound calling, subscription charging, 140-series numbers, KYC/DLT, consent verification, real-call recordings and on-site visit scheduling automation. Provider service approval is required before real calling. Do not deploy as a production CRM without completing security work in `docs/ARCHITECTURE.md`.

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
