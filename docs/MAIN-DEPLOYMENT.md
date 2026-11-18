# AR3D AI Calling — Main Cloudflare Setup

**Status:** AR3D AI Calling is a development-grade CRM and text conversation simulator, **not a production-ready voice calling service**. The main Worker can be deployed at its own isolated workers.dev address, but use synthetic/demo data only until identity, privacy, retention, opt-out, and compliance protections are hardened. This setup does **not** make real phone calls.

This repository is public. Never commit or paste Cloudflare tokens, business IDs, database UUIDs, admin passwords, real leads, recordings, or customer data to GitHub issues, README files, or chat. GitHub Environment secrets are encrypted and not exposed in source.

## Existing Cloudflare resources (already created by the operator)

Check that they exist in the **same** Cloudflare account:

- D1 database: `ar3d-calling-control`
- D1 database: `ar3d-calling-shared-crm`
- Private R2 bucket: `ar3d-calling-recordings`

**Never** select the existing AR3D Platform D1 (`tiyansh-production`) or AR3D Engine D1 (`rekixo-3d-production`) or either project's R2 bucket. Do not change any live AR3D Workers, routes or domains. The new Worker is `ar3d-ai-calling`, published only to its own `workers.dev` URL.

## One-time GitHub setup — 4 environment secrets

1. Open [AR3D AI Calling → Settings → Environments](https://github.com/rekixo-lab/ar3d-ai-calling/settings/environments).
2. Create or open environment `production` (lowercase). Restrict deployments to `main`; enable required reviewers if your GitHub plan supports them.
3. Under **Environment secrets**, add these 4 names:

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | New Cloudflare API token scoped to this account with Workers Scripts Edit and D1 Write permissions; grant only the required resources. Use Cloudflare's **API Tokens**, not the Global API Key. |
| `CLOUDFLARE_ACCOUNT_ID` | 32-character hexadecimal Cloudflare account ID. |
| `AR3D_MAIN_CONTROL_DB_ID` | D1 UUID shown on the `ar3d-calling-control` database details page. |
| `AR3D_MAIN_CRM_DB_ID` | Different D1 UUID from `ar3d-calling-shared-crm`. |

An API token used to initialize databases needs **D1 Write** (D1 Read is not enough). Revoke the token after setup if it is no longer needed; rotate tokens if exposed. Do not send any secret values to ChatGPT.

## Three GitHub Actions operations — no local terminal or manual SQL copy

Go to [Actions](https://github.com/rekixo-lab/ar3d-ai-calling/actions) and choose **AR3D AI Calling - main Cloudflare setup (manual)**. Use branch `main`, type `AR3D_MAIN_ONLY`, then run the following choices in order:

1. **`preflight`** — read-only Cloudflare API checks. Validates account format, distinct database IDs, the **exact D1 database names**, and whether both schemas are both empty or both complete. No deployment, SQL changes, or existing AR3D changes.
2. **`initialize`** — **one-time only, for newly created empty AR3D Calling D1 databases**. Repeats the exact name and empty checks, runs the Control migrations `0001` → `0002` → `0003` → `0004` → `0005` and CRM migrations `0001` → `0002` → `0003` → `0004` → `0005` using Wrangler `--remote --yes`, and verifies all expected tables and key columns. Will refuse to run on an already initialized or partially migrated database. Do not use it to update a running database.
3. **`deploy`** — checks that all required tables and columns exist, then deploys only the `ar3d-ai-calling` Worker with its two new D1 bindings and new R2 bucket. It does not modify the existing AR3D Platform/Engine Workers, routes, or databases.

The same workflow is **manual-only**; there is no auto deploy on push. If any run fails, inspect the error. **Do not repeat `initialize` after a partial failure; reconcile the migration state deliberately before proceeding.** The workflow does not create databases or buckets; those must already exist. If GitHub Secrets are missing, it fails without changing Cloudflare.

## After deploy: bootstrap Super Admin securely

The first human Super Admin still needs one manual credential setup. Set `ADMIN_BOOTSTRAP_TOKEN` to a random 32+ character Worker secret on **the new** `ar3d-ai-calling` Worker only; create the first Super Admin from a secure machine using `/v1/human/bootstrap` as documented in [README](../README.md). Once the `/app` admin sign-in succeeds, **remove** the Worker bootstrap secret immediately and invalidate any one-time credential copies. Never place bootstrap tokens in query strings, browser JavaScript, or GitHub workflow logs.

## Before real clients and live calls

Complete MFA/email verification for admins, rate limiting, data protection, consent/DND audit evidence, retention/deletion, tenancy limits, disaster recovery, and Indian telecom provider onboarding. Lead imports do **not** authorize outbound calls. Paid subscriptions, telephony, AI voice streaming, dedicated D1 provisioning, billing and recordings are not live yet.


## CRM opt-out protection (schema v4)

CRM migration `migrations/crm/0004_lead_opt_out.sql` creates a tenant-scoped opt-out event history and a database trigger to prevent changing an opted-out lead back to callable statuses. It runs automatically on **new, empty** main D1 databases through the one-time `initialize` option. Imported duplicates do not overwrite existing suppression.

**If the main CRM D1 was already initialized before schema v4:** do not run `initialize` again. Back up the CRM D1 and have an authorized operator inspect its schema and apply only the incremental `0004_lead_opt_out.sql` migration to `ar3d-calling-shared-crm`, then re-run `preflight`. No automatic existing-database upgrade is authorized by this workflow.

The CRM UI provides a one-way manual `Do Not Call` action with a source and optional reason. It records `lead_opt_out_events` plus `crm_audit_events` and forces `consent_status='denied'`, `dnd_status='blocked'`. This is an internal suppression feature, **not** verified DND provider sync or a full India telecom compliance solution. Real calling remains disabled. Human/privacy deletion and controlled data correction workflows are still required.


## Login IP security — Control D1 schema v3

New Control migration \`migrations/control/0003_ip_login_limits.sql\` stores an HMAC-SHA256 digest of the verified Cloudflare \`CF-Connecting-IP\` header, never the raw IP. The \`LOGIN_RATE_LIMIT_SECRET\` Worker secret (at least 32 unpredictable characters) **must be created on the new AR3D AI Calling Worker** before anyone can log in. If this secret or Cloudflare's verified client-IP header is absent, login fails closed (HTTP 503). The default budget is 60 login requests per IP in a 15-minute window; additional requests receive 429 until the block expires. Account-based email lockout remains in addition. An IP-based budget cannot replace Cloudflare WAF, bot controls, MFA or anti-credential-stuffing defenses.

For a newly created empty Control D1, the one-time manual \`initialize\` GitHub workflow applies this migration after \`0002\`. If Control D1 was already initialized, **do not rerun initialize**: back up the data, inspect schema, and apply only \`0003_ip_login_limits.sql\` to the new AR3D AI Calling Control D1 using an authorized incremental migration process. The deploy preflight checks for its table.

Before first admin login: create both \`LOGIN_RATE_LIMIT_SECRET\` and \`ADMIN_BOOTSTRAP_TOKEN\` as secrets on the new \`ar3d-ai-calling\` Worker. Delete only \`ADMIN_BOOTSTRAP_TOKEN\` once Super Admin login succeeds; retain \`LOGIN_RATE_LIMIT_SECRET\` for all future login requests. This Worker remains demo-only until broader production controls are complete.

## Super Admin Authenticator MFA (Control schema v4)

The new **optional** Super Admin Authenticator MFA uses TOTP SHA-1/6-digit/30-second codes. A password-authenticated enabled Super Admin receives a short-lived, five-attempt challenge; **no login cookie is issued until TOTP succeeds**. The TOTP seed is stored AES-GCM encrypted with the Worker-only `MFA_ENCRYPTION_KEY` secret (use a random string of 32+ characters). Configure it on **ar3d-ai-calling** before starting enrollment, and retain it securely: losing or rotating this key without migration will prevent enrolled admins from logging in. Enrollment requires entering the current authenticator code, and other existing sessions are revoked after activation.

MFA activation now issues 8 unique one-time recovery codes, visible exactly once. Each is a 128-bit random secret; only a user-scoped keyed HMAC is saved in Control D1. A recovery code can replace one TOTP login challenge, but it never replaces the password. The Super Admin can regenerate all codes with both the current password and unused authenticator code; old codes then stop working. **These codes are not a managed account-recovery service**: losing both your authenticator and all unused codes still requires an independently authorized manual recovery procedure. MFA enrollment is not yet mandatory; production account access still requires further hardening. To enable after reviewing recovery options, log in at `/app`, find the Super Admin MFA section, set up your authenticator and confirm its code. Never post the setup secret/URI in GitHub, chat, screenshots or logs.

New empty Control D1 initialization includes `migrations/control/0004_super_admin_mfa.sql` followed by `migrations/control/0005_mfa_recovery.sql`. For already initialized Control D1, back up the data and apply only the missing incremental migrations in order after a schema review; do not rerun `initialize`. Existing MFA-enabled admins must regenerate codes after schema upgrade, using their current password and authenticator. Cloudflare production deployment remains manually authorized and voice calling disabled.


## Consent evidence and DND fail-closed gate (CRM schema v5)

Run `migrations/crm/0005_consent_evidence.sql` on new empty CRM D1 after v4 during one-time `initialize`. For an already initialized independent AR3D Calling CRM D1, first back it up and inspect schema; apply the **incremental v5 only** using an authorized migration procedure. The main deployment preflight now requires the `lead_consent_evidence` table.

Client admins can record only a pending reference to claimed customer consent. This does **not** make the consent verified, change the lead's consent/DND flags or permit calls. New SQL triggers prevent direct `granted`/`allowed` updates or inserts until a separately reviewed provider-based consent/DND integration is implemented. A read-only readiness report always says `eligible:false`. Do not put real customer evidence or documents into the public GitHub repository. In the app, use only synthetic data until privacy retention and lawful use are established.
