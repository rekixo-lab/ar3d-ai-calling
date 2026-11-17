# AR3D AI Calling — Architecture v0.1

## Source review

- AR3D Platform (`rekixo-lab/rekixo-ar3d-platform`) is a project-scoped multi-tenant site/admin platform. A client login contains a `projectId`. It owns project records and public plot data in its own D1; it does not define one universal SaaS organization ID.
- AR3D Engine (`rekixo-lab/rekixo-ar3d-engine`) has a separate project registry, D1/R2 resources, client roles and client portal. Its 3D project identifiers must not be conflated with Platform project identifiers.
- The established Platform–Engine integration is a versioned, read-only HTTP contract, not a shared database. Preserve that boundary.

References:
- https://github.com/rekixo-lab/rekixo-ar3d-platform/blob/main/README.md
- https://github.com/rekixo-lab/rekixo-ar3d-platform/blob/main/app/admin-auth.ts
- https://github.com/rekixo-lab/rekixo-ar3d-platform/blob/main/docs/STAGE-5-PLATFORM-ENGINE-INTEGRATION.md
- https://github.com/rekixo-lab/rekixo-ar3d-engine/blob/main/README.md
- https://github.com/rekixo-lab/rekixo-ar3d-engine/blob/main/workers/project-client-portal.mjs

## Independent SaaS boundary

This codebase is **AR3D AI Calling**, not a Platform or Engine migration. Its control D1 and CRM D1 are NEW databases. DO NOT run any migration from this repository on `tiyansh-production` or `rekixo-3d-production`.

```
AR3D Platform (websites, plot inventory) ──┐
                                           ├── signed, scoped, versioned project APIs ──> AR3D AI Calling
AR3D Engine (3D project knowledge) ───────┘                                  |
                                                                     Control Plane D1
                                                               tenants / keys / number assignments
                                                                               |
                                                           storage adapter chosen by tenant settings
                                                             /                         \
                                                       Shared CRM D1             Dedicated CRM D1
                                                 all low-tier tenants             premium tenant A
                                             strict tenant_id per record          (provisioned separately)
                                                                               |
                                                                      R2 recordings (later)
```

## Identity vs project

- `tenant_id`: SaaS customer / paying organization. The only authority for CRM isolation.
- `project_link`: maps this tenant to an AR3D Platform or Engine project; `source` and immutable external ID are always explicit.
- `agent_id`: AI agent within one tenant. The default can serve multiple permitted projects; future agents can be project-specific.
- `phone_number_id`: separately assigned telecom calling identity; do not claim this is automatically available.

A client may own multiple projects. No client-owned API may select `tenant_id` from request query, URL, JSON body or unverified HTTP header. It is derived from authentication only.

## Storage tiers

- Starter: shared CRM D1, composite `tenant_id` keys and tenant-scoped SQL. R2 uses `tenants/<tenant-id>/...` object keys with server authorization. Client data is private, not shared with other clients.
- Enterprise: a separate, manually provisioned CRM D1. Dedicated Worker D1 bindings are established through audited configuration/deployment. The router MUST fail closed if a configured binding does not exist. This starter intentionally does not self-provision per-customer D1 resources.
- Growth: keep configurable; it can begin in shared mode. Plan migration must be transactional, verified and reversible (not built yet).
- Each tenant's quota, plan, billing and provider usage to be metered separately in future versions.

## Main modules to add next

1. Human-authenticated Super Admin + client admin: project/tenant linked SSO, membership and per-user RBAC; the current backend keys must never be embedded in browser code.
2. Excel import with source/consent provenance, normalization, duplicate reports and preview.
3. AI agent editor: fixed questions, dynamic follow-ups, Hindi/English conversation, model/STT/TTS adapters.
4. Lead CRM + activities, call history, full-text search, site visits and agent disposition.
5. Telecom integration: number inventory, KYC/DLT statuses, provider-approved caller identity, call/audio WebSocket, campaign schedules, recording notice and retention.
6. Subscriptions and quotas with usage metering and suspensions.
7. Signed project knowledge endpoint with permissions; no direct reads of other app's D1.
8. Super Admin onboarding and client-facing UI. Prefer isolated rollout behind feature flags.

## Calling safety/eligibility

A spreadsheet of unknown numbers does NOT confer consent. On import, consent/DND status is `unknown`. The backend has no real call-launch route in this starter. Before enabling promotional calling, implement provider-side permissions, applicable registration, verified consent/DND checks, allowed calling hours, suppression lists, accurate AI identity disclosure, recording notices, data-retention policy, opt-out workflow and audit. Do not enable unknown-lead auto-dial through a personal SIM.

## Security concerns before production

- API keys in this starter are server-to-server ONLY. No browser/client login or RBAC is built.
- Rate limiting, key rotation UI, audit middleware, billing, consent verification, DND provider check, PII encryption strategy, retention/deletion, private recordings with signed access, backup and recovery, observability and incident handling are required before production.
- D1 does not supply application-level tenant row isolation automatically. Every query must scope `tenant_id` and every foreign key must be composite where applicable; include negative cross-tenant regression tests.
- Do not mix AR3D Platform, Engine and AI Calling production databases.
