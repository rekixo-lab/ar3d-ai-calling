# Seven-module implementation recheck — 2026-11-23

Scope: **only** `rekixo-lab/ar3d-ai-calling` and its isolated Cloudflare Worker.
No AR3D Platform/Engine database was queried or changed for this audit.
No provider writes, production calls, consent grants, DND resets or customer data modifications were performed.

## Code-backed verification matrix

| Module | Reviewed path(s) | Result |
| --- | --- | --- |
| 1. Super Admin | `human-routes`, `client-account-routes`, `client-access-routes`, `human-auth`, `mfa` | Invitation/access revocation, MFA and tenant isolation are covered by negative tests. **Fixed** 100-row directory truncation with bounded search/pages and accurate directory counts. |
| 2. Client Dashboard | `app-assets`, `human-routes.overview`, Client Dashboard browser E2E | Company-specific server-authorized overview, Viewer versus Admin controls and async tenant-switch version guard tested. Client selectors search all tenant pages. |
| 3. CRM | `crm-routes`, `csv-import`, `xlsx-import`, `data-portability-routes`, `consent-routes` | Bounded CSV/XLSX, same-company duplicate phone guard, no implicit contact permission, one-way opt-out, audit/export protections. |
| 4. AI Testing | `fixed-voice-turns`, `fixed-voice-preview-routes` | Deterministic seven-question typed demo, safe incomplete/low-confidence/stop handling, no telephone dial from preview. Not actual live speech validation. |
| 5. Auto CRM Update | `ai-test-crm-routes`, `fixed-property-survey` | Server-authenticated, opt-in, tenant/customer-bound signed progress, optimistic concurrency, single audited completion. **Fixed** minimum-budget erasure and overwrites of converted/verified/suppressed customers. |
| 6. 1,000+ Clients | `scripted-campaign-dispatch`, `admin-usage`, `human-routes.listTenants` | Prior synthetic 1,025-tenant rotation/kill-switch tests. **Fixed** client directory search/pagination and analytics query scoping. Work limit remains two tenant attempts per minute. |
| 7. Security & Automation | `auth-maintenance`, `calling-schedule`, `operations-report-routes`, `inspect-main-secrets`, `guarded-worker-recovery` | Session cleanup hourly and bounded, provider-unknown manual review, read-only tenant reports, guarded auth-secret preservation and public auth-barrier smoke tests. |

## New audit corrections

1. The Super Admin UI previously showed only the **first 100 tenants**. All client management/approval sections must now support searching a company by name, slug or email. API returns `total`, `active`, `members`, `matched`, `limit`, `offset` and a bounded 100-row page.
2. Previously each Super Admin usage query grouped the **entire** shared CRM database. Analytics now uses a parameterized allowlist of tenant IDs from the current page. No usage for an unprovisioned dedicated CRM is invented.
3. Auto-save from a **simulated browser** previously set `budget_min_inr=NULL`, even for an established customer. It now preserves that field and refuses incompatible budget ranges. It also refuses simulated overwrites of a converted lead, non-simulated qualification, verified phone survey or opted-out contact. All declines return a conflict; user must manually review the real CRM.
4. The automatic-operations documentation was updated from outdated six-hour cleanup to the already implemented hourly bounded cleanup.

## Automated evidence to verify at merge

- `npm test`: full JavaScript and SQLite schema tests, including tenant separation, MFA, CSV/XLSX, campaign reservation, signed webhook, no-retry safeguards, session retention, multiple frontend views.
- Chrome browser acceptance on desktop, tablet and mobile using synthetic localhost data.
- New regression: >1,100 synthetic tenant directory and page after #1,000, search, invalid requests, authenticated permission barriers, page-scoped CRM analytics.
- New regression: simulated AI test preserves minimum budget; refuses 5 unsafe real-record scenarios and a verified opt-out event.
- Production deploy is **not** accepted until the isolated Cloudflare Worker, both D1 schema/safety checks, required authentication secret names, Worker smoke and custom-domain smoke pass.

## Explicitly not proven / operator blockers

1. **The discontinued carrier adapter is not used by the current Plivo implementation.** Historical external-provider records must not be retried, reconnected or deleted without separate verified operator reconciliation.
2. Plivo customer calling requires carrier permissions, a separately verified internal pilot, DND/opt-in evidence, registered caller identity and recorded consent. The synthetic webhook tests do **not** establish live carrier acceptance.
3. Browser AI Testing is typed input with optional browser speech. This does **not** certify human real-time STT/TTS/LLM latency or full-duplex calls.
4. The bounded rotating scheduler does **not** provide 1,000 simultaneous calls or guarantee carrier quotas, Worker resources or per-client SLA. Real load/soak testing is still required.
5. Independent verified backup schedules, restore-to-production drill, deletion/retention rules for customer PII/recordings, provider-billed-minute reconciliation, payments and legal/compliance sign-off remain open.
6. Historical password hashes using a single 240,000-round PBKDF2 operation need a supervised migration before those accounts can reliably authenticate in Cloudflare workerd; the current V2 password scheme uses three workerd-compatible rounds.
7. A green GitHub CI / read-only production smoke is **not** a substitute for authenticated live user acceptance testing or a complete independent security penetration test.

**Go/no-go:** Safe to test the authenticated CRM and browser demo with fictional data after successful guarded deployment. **Not approved as a fully autonomous real-calling or paid SaaS launch.**
