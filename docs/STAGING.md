# AR3D AI Calling — isolated Cloudflare staging setup

**Not yet deployed.** Account authorization and production-grade security review are prerequisites. Normal GitHub CI runs tests only. A separate `workflow_dispatch` staging deployment is available for approved operators; it never runs automatically.

1. Use a Cloudflare account with explicit permission to create resources. Install/login to Wrangler on a local machine. Do not share credentials in GitHub/ChatGPT.
2. Create entirely **new staging-only resources** (never point at `tiyansh-production`, `rekixo-3d-production`, or their R2 buckets):

```sh
npx wrangler d1 create ar3d-calling-control-staging
npx wrangler d1 create ar3d-calling-shared-crm-staging
npx wrangler r2 bucket create ar3d-calling-recordings-staging
```

3. Copy `wrangler.staging.example.jsonc` to `wrangler.staging.jsonc`. Paste the *staging database IDs only* in the two placeholders. This file is intentionally `.gitignore`d. Run:

```sh
npm run check:staging
```

4. **On new empty staging databases only**, apply migrations in strict order. Keep `PRAGMA foreign_keys` enabled. Confirm the selected account and database names before executing commands:

```sh
npx wrangler d1 execute ar3d-calling-control-staging --remote --config wrangler.staging.jsonc --file migrations/control/0001_init.sql
npx wrangler d1 execute ar3d-calling-control-staging --remote --config wrangler.staging.jsonc --file migrations/control/0002_human_access.sql
npx wrangler d1 execute ar3d-calling-shared-crm-staging --remote --config wrangler.staging.jsonc --file migrations/crm/0001_init.sql
npx wrangler d1 execute ar3d-calling-shared-crm-staging --remote --config wrangler.staging.jsonc --file migrations/crm/0002_lead_workflow.sql
```

5. Review security caveats in `docs/ARCHITECTURE.md`. Add a one-time 32+ character random bootstrap token via Wrangler secret (never commit it). Keep the token out of browser JS and URL logs. Do not reuse a real admin password for the token:

```sh
npx wrangler secret put ADMIN_BOOTSTRAP_TOKEN --config wrangler.staging.jsonc
```

6. After security review and account approval, manually deploy **staging only**:

```sh
npm test
npm run check:staging
npx wrangler deploy --config wrangler.staging.jsonc
npm run smoke:staging -- https://ar3d-ai-calling-staging.<account>.workers.dev
```

7. **Optional manual GitHub Actions deployment after resources/migrations exist:** Create a protected `staging` GitHub Environment and store `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `AR3D_STAGING_CONTROL_DB_ID`, and `AR3D_STAGING_CRM_DB_ID` as **Environment secrets**. The API token must be scoped to only the necessary Cloudflare staging resources. Run **AR3D AI Calling — deploy staging (manual)** against `main` with the confirmation `DEPLOY_STAGING_ONLY`. This does *not* create D1/R2 resources or run migrations, and requires a Cloudflare account owner to approve. The environment should require reviewer approval. Bootstrap credentials remain outside GitHub Actions.

8. First-time human admin bootstrap requires a backend-to-backend HTTPS POST to `/v1/human/bootstrap` with the bearer bootstrap token and a new admin email/password. After a successful bootstrap, **remove** the bootstrap secret (`wrangler secret delete ADMIN_BOOTSTRAP_TOKEN --config wrangler.staging.jsonc`) to disable the legacy machine admin endpoints. Do this only after the Super Admin can sign in. Store credentials in a secrets manager.

**Important limitations:** No live calling, no provider, no phone numbers, no payment processing, no automated invitation email, no real call recordings. Excel `.xlsx` (first visible worksheet, up to 200 lead rows, maximum 1 MB) and CSV UTF-8 (160 KB) are supported. Formula cells, encrypted/macro workbooks, external links, excessive rows and oversized ZIP payloads are rejected; export to values-only CSV if an unsupported workbook is encountered. Cloudflare Workers runtime compatibility of `DecompressionStream('deflate-raw')` must be confirmed in staging before allowing client data. Do not upload real client leads to staging without a documented data-processing basis, retention policy, and explicit authorization.

**Security gates before production:** harden account-based and IP-level login rate limits; add audit review, backup/restore, consent evidence/opt-out management, DND processing, encryption/access control for PII and recordings, privacy retention/deletion, per-tenant quotas, per-tenant provisioning reconciliation, database migration rollback/backups, telecom/DPDP legal review, and provider onboarding. Public GitHub never contains tokens or customer data.
