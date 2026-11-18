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
2. **`initialize`** — **one-time only, for newly created empty AR3D Calling D1 databases**. Repeats the exact name and empty checks, runs the Control migrations `0001` → `0002` and CRM migrations `0001` → `0002` → `0003` → `0004` using Wrangler `--remote --yes`, and verifies all expected tables and key columns. Will refuse to run on an already initialized or partially migrated database. Do not use it to update a running database.
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
