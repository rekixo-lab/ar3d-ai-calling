# Multi-Industry Phase 1 — Draft-only Agent Builder
**Status:** implementation candidate for review, not approved live calling.

## Scope

This PR adds independently versionable client draft data to the *Calling Control D1 only*, reviewed industry template presets, a client/viewer UI section (**My AI Agents**) and authenticated, tenant-scoped draft endpoints. Templates include Real Estate, School Admission, General Appointment Reminder, Finance/NBFC, Banking and Insurance. Regulated templates are explicitly marked demo-only. Presets do not carry live number/purpose approval.

A client can choose a business category, create a draft from a reviewed template, edit name/greeting/closing/questions/language within allowed modes, and preview the words on screen. Viewers can read but cannot save. Drafts use optimistic revisions, audit events, bounded JSON bodies and a limit of 25 drafts per tenant. No actual voice synthesis or phone call occurs.

New endpoints:
- \`GET /v1/human/industry-templates?tenantId=<id>\`
- \`GET/PATCH /v1/human/industry-profiles\`
- \`GET/POST /v1/human/ai-flows\`
- \`GET/PATCH /v1/human/ai-flows/<id>\`

All endpoints require authenticated current tenant membership. POST/PATCH requires \`client_admin\` and existing CSRF/origin checks. There are **no** publish, execute, campaign binding or customer communication endpoints.

## Persistence and migrations

New \`migrations/control/0034_multi_industry_drafts.sql\` creates only:
- \`tenant_industry_profiles\` (tenant business preference, with optimistic revision)
- \`ai_flow_definitions\` (draft-only config + immutable template ID; \`status\` constrained to \`draft\`)

Do not modify existing CRM, credit wallet, number assignment, Plivo, Sarvam, R2, WhatsApp or AR3D Platform/Engine databases. Existing scripted property-calling code remains untouched.

**IMPORTANT:** Main's guarded Cloudflare preflight requires a reviewed whole-group migration. Do NOT merge this code before the isolated Control D1 schema preflight and workflow have been updated and tested for this new migration. If that guard is not included in the final PR, keep the PR unmerged until separate operator-approved migration work is done.

## Deferred work (not part of Phase 1)

- Real voice runtime, flow compiler, branching, dynamic TTS, custom Excel mapping, multi-subject CRM, regulated verification, publishing, calling authorization.
- Calling a finance customer, revealing private due amounts or importing their financial dataset.
- Changing existing Real Estate seven-question route or WhatsApp scripts.

## Verification

Run \`npm test\` and Chrome desktop/tablet/mobile browser tests in CI. Tests cover catalog rules, viewer read-only, client tenant isolation, role denial, revision conflicts, no-call default, draft schema, and missing publish endpoints. UI tests must confirm simulated/no-call labels.
