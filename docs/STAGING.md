# AR3D AI Calling — isolated Cloudflare staging setup

**Not deployed by this repository.** Account authorization and production-grade security review are prerequisites. The GitHub CI only runs tests; it does not deploy or hold Cloudflare secrets.

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

7. First-time human admin bootstrap requires a backend-to-backend HTTPS POST to `/v1/human/bootstrap` with the bearer bootstrap token and a new admin email/password. After a successful bootstrap, **remove** the bootstrap secret (`wrangler secret delete ADMIN_BOOTSTRAP_TOKEN --config wrangler.staging.jsonc`) to disable the legacy machine admin endpoints. Do this only after the Super Admin can sign in. Store credentials in a secrets manager.

**Important limitations:** No live calling, no provider, no phone numbers, no payment processing, no XLSX binary parser, no automated invitation email, no real call recordings. Use Excel `Save As → CSV UTF-8` for imports. Do not upload real client leads to staging without a documented data-processing basis, retention policy, and explicit authorization.

**Security gates before production:** harden account-based and IP-level login rate limits; add audit review, backup/restore, consent evidence/opt-out management, DND processing, encryption/access control for PII and recordings, privacy retention/deletion, per-tenant quotas, per-tenant provisioning reconciliation, database migration rollback/backups, telecom/DPDP legal review, and provider onboarding. Public GitHub never contains tokens or customer data.
