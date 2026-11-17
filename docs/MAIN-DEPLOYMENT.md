# AR3D AI Calling — Main Cloudflare setup (no staging)

The main infrastructure has separate names from the existing AR3D Platform and AR3D Engine services. The new workflow **never** changes Platform/Engine Workers or databases and **never** runs database migrations automatically.

**Current software is an early multi-tenant CRM / text simulator, NOT production-ready calling software.** The deployment below is for an isolated main Worker with synthetic demo data only. Do not import real clients' leads, phone numbers or recordings until security, consent, retention, privacy, and calling compliance requirements are completed.

## 1. Main resources (Cloudflare)

Create or verify these exact names in one Cloudflare account:

- D1: `ar3d-calling-control`
- D1: `ar3d-calling-shared-crm`
- R2 private bucket: `ar3d-calling-recordings`

Never use the existing `tiyansh-production`, `rekixo-3d-production`, or their R2 buckets.

## 2. GitHub production environment

1. In [GitHub Environments](https://github.com/rekixo-lab/ar3d-ai-calling/settings/environments), create `production` (lowercase).
2. Restrict environment deployments to branch `main`. If available, require a human deployment reviewer.
3. Add four **Environment secrets** in this environment:

| Secret name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Scoped Cloudflare token with permission to deploy this Worker and read the main D1 databases. Never paste in source, an issue, or chat. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID: **32 hexadecimal characters** (not a D1 UUID). |
| `AR3D_MAIN_CONTROL_DB_ID` | UUID of D1 `ar3d-calling-control`. |
| `AR3D_MAIN_CRM_DB_ID` | UUID of D1 `ar3d-calling-shared-crm`. |

Never store the admin password or bootstrap token in GitHub source. Use a least-privilege Cloudflare API token; do not use the Global API Key.

## 3. Initialize the two newly-created main D1 databases (one time)

Only for these **brand-new, empty** D1 databases. Check exact names before every operation. Apply SQL files in **this order**. Use the Cloudflare D1 SQL Console by pasting the corresponding migration, or an authorized local Wrangler session:

Control database:
1. `migrations/control/0001_init.sql`
2. `migrations/control/0002_human_access.sql`

Shared CRM database:
1. `migrations/crm/0001_init.sql`
2. `migrations/crm/0002_lead_workflow.sql`
3. `migrations/crm/0003_conversation_simulator.sql`

Example for local Wrangler after `npx wrangler login`, with `wrangler.jsonc` populated from `wrangler.example.jsonc` using the two **main** D1 IDs (this config is Git-ignored):

```sh
npx wrangler d1 execute ar3d-calling-control --remote --config wrangler.jsonc --file migrations/control/0001_init.sql
npx wrangler d1 execute ar3d-calling-control --remote --config wrangler.jsonc --file migrations/control/0002_human_access.sql
npx wrangler d1 execute ar3d-calling-shared-crm --remote --config wrangler.jsonc --file migrations/crm/0001_init.sql
npx wrangler d1 execute ar3d-calling-shared-crm --remote --config wrangler.jsonc --file migrations/crm/0002_lead_workflow.sql
npx wrangler d1 execute ar3d-calling-shared-crm --remote --config wrangler.jsonc --file migrations/crm/0003_conversation_simulator.sql
```

**Never re-run additive ALTER TABLE migrations on already-initialized data.** The deploy workflow verifies key tables, but does not mutate schema.

## 4. Verify and deploy manually from GitHub

1. In [Actions](https://github.com/rekixo-lab/ar3d-ai-calling/actions), choose `AR3D AI Calling - main Cloudflare deploy (manual)`.
2. Select branch `main`.
3. Set `confirm` to `AR3D_MAIN_ONLY`.
4. Select `operation=verify` first. This runs tests and verifies exact D1 names/IDs and migrated tables. No deployment.
5. If verification passes and you explicitly authorize deployment, repeat with `operation=deploy`.
6. Workflow uses `ar3d-ai-calling` as the **main** Worker name and enables its isolated `workers.dev` URL (not existing AR3D domains).

## 5. First login and safety

After deploy, set a one-time `ADMIN_BOOTSTRAP_TOKEN` secret (32+ unpredictable characters) **directly on the new Worker in Cloudflare**. Bootstrap the first Super Admin from a trusted HTTPS server-to-server request (see README). Verify that login succeeds at `/app`. Remove the bootstrap secret from Cloudflare after bootstrap to disable machine-bootstrap credentials.

A deployment is **not** evidence that AI voice calling, subscriptions, real phone numbers, or privacy/compliance work are completed. Until these are complete, use synthetic records only and do not open the service to paying clients.
