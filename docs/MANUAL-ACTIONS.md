# AR3D AI Calling — operator-only remaining actions

Do the following only when at your own secure computer. This checklist is not proof of deployment, DND approval, telecom onboarding or billing readiness.

## Cloudflare and GitHub

1. Verify the private D1 databases named ar3d-calling-control and ar3d-calling-shared-crm, plus private R2 bucket ar3d-calling-recordings. Never reuse the AR3D Platform or Engine databases.
2. In the GitHub production Environment on main, store CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, AR3D_MAIN_CONTROL_DB_ID and AR3D_MAIN_CRM_DB_ID. Do not send these values in chat, issues, screenshots or commits.
3. On the main GitHub Actions workflow run preflight. For BOTH brand-new empty D1 databases run initialize ONCE; otherwise back up and apply only missing incremental migrations after an operator schema review. If a partial initialize failed, do not repeat it blindly.
4. Run deploy only after the schema and exact database identities are verified. This creates the isolated ar3d-ai-calling Worker URL, not an AR3D Platform/Engine deployment.
5. Set Worker-only LOGIN_RATE_LIMIT_SECRET (32+ random characters) and MFA_ENCRYPTION_KEY (32+ random characters). Keep both secret values outside GitHub code. Create ADMIN_BOOTSTRAP_TOKEN only long enough for first Super Admin bootstrap, then delete it immediately after successful login. OPTIONAL server-to-server admin endpoints require a *different* ADMIN_API_TOKEN (32+ random characters); leave unset if unused.
6. Test /health, /app, admin login, MFA recovery and tenant isolation using **synthetic** leads. Test from a real Cloudflare request so CF-Connecting-IP is present. Configure monitoring, backups and incident response separately before collecting customer data.

## Real calling and paid SaaS — human or provider actions

- Choose and contract with an India-compliant calling provider, obtain the authorized caller number(s), and complete required KYC, DLT/telecom registration and permitted traffic categories with the provider.
- Arrange independently verifiable opt-in proof, DND/suppression lookup, call-time windows, disclosure, recording notifications and deletion/retention rules. The current software **does not verify these**.
- Choose and fund Hindi/English STT, TTS and LLM/realtime services. Keep keys in Cloudflare Worker secrets, not browser code. Agree on usage pricing, privacy processing and region.
- Choose payment processor, subscriptions, rates, tax/invoice policy, usage quotas and refunds. Billing and automatic minute charging are not implemented.
- Approve explicit, permission-scoped read-only AR3D Platform/Engine project APIs and integration credentials. A pending link is not verified project data.
- Verify backups, data-retention deletion workflows, provider callback signatures, duplicate event handling, live audio latency and telecom compliance before any actual call can be enabled.
- Never remove the fail-closed campaign/call trigger just to make a demo call.

## Pending engineering modules

Real provider webhook adapter and signature verification; call initiation and phone-number inventory; realtime media transport; production STT/TTS/LLM prompts and human fallback; provider DND sync; consent verification; calls/transcripts/recordings handling and retention; usage metering, customer billing and payment processing; per-plan limits; AR3D knowledge verification; secure data deletion and full disaster recovery. All of these require additional implementation and/or provider access.

The build may be deployed to a main Worker for synthetic tests; it is **not production-ready for live calls or customer PII**.


**New migration:** CRM D1 schema v7, `migrations/crm/0007_agent_safety.sql`, is required after v6. It is automatic only on brand-new empty CRM initialization. Existing independently created D1 needs a backup and reviewed incremental application. Do not activate real AI agents/calls by dropping safety triggers.


### Recheck: guarded resource identity

Before production deploy, the main-only preflight checks Control/CRM D1 names and IDs, migrated columns and critical SQL triggers, plus the dedicated private R2 bucket metadata. The Cloudflare API token therefore requires **R2 bucket read** permission as well as required D1 access. Treat any missing trigger or unexpected bucket as a stop condition. Do not disable `trg_no_call_launch`, opt-out/consent triggers or agent-activation triggers. Apply missing migrations only after verified backup and review.


### If a backend integration key is compromised

Use the separately configured `ADMIN_API_TOKEN` only from a trusted backend to list key metadata via `GET /v1/admin/tenants/:tenantId/keys` and revoke the affected ID with `DELETE /v1/admin/tenants/:tenantId/keys/:keyId`. After a key is revoked, the existing `tenantAuth` access path will reject it. The list endpoint intentionally does not return or reissue plaintext keys. Rotate exposed credentials and audit access separately. The machine token is optional; if not configured, these endpoints remain disabled.
