**Active 48-hour execution:** See [48H-SPRINT.md](48H-SPRINT.md). The first step is GitHub production Environment secrets followed by the manual preflight. Do not initialize databases until both are confirmed fresh.

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


### Privacy and usage reporting foundation

Clients can securely export paginated lead JSON through the Client Admin dashboard. It contains mobile numbers and other personal information; export/download only to trusted devices and handle according to applicable policy. Exports are audited in CRM D1. API and UI provide read-only record counts, **not** telecom minutes, charges or invoices. Before launching paid SaaS, implement real provider usage event verification, privacy retention/deletion, backups, payment/reconciliation and plan agreement; the code does not assert these are complete.


### Tenant suspension and retention

The Super Admin Dashboard can suspend or resume a client company with an audit reason. This is access administration, **not billing**. For existing Control D1 databases, back up before applying `migrations/control/0006_tenant_lifecycle.sql` incrementally; for brand-new empty D1 it is included in one-time initialize. Retention helpers have no cron trigger or HTTP route; enabling scheduled cleanup and deleting real customer records must wait for an approved privacy, retention and backup policy.


### Optional encrypted storage / inbox foundations

Control v7 introduces a **quarantine-only** event inbox. The private R2 recording helper is disabled and never exposed through HTTP; do not set `RECORDING_STORAGE_ENABLED=true` until verified caller number, consent, recording notice, scoped access, secure retention expiration/deletion and operator approval are available. `RECORDING_ENCRYPTION_KEY` must be a strong independent server secret and never logged or put into GitHub source. Encryption key rotation and disaster recovery remain unimplemented. Genuine provider webhook signing is vendor-specific and still must be built after selecting a provider.


### Safer first Super Admin bootstrap

After isolated Worker deploy, configure Worker-only LOGIN_RATE_LIMIT_SECRET and MFA_ENCRYPTION_KEY; then set a temporary ADMIN_BOOTSTRAP_TOKEN. From a trusted computer run:

    python3 scripts/bootstrap-main.py https://ar3d-ai-calling.<workers-subdomain>.workers.dev

This locally prompts for token/password invisibly rather than putting secrets in command arguments. Delete ADMIN_BOOTSTRAP_TOKEN once the Super Admin is created, sign into /app and securely save Authenticator recovery codes. Do not send login credentials, KYC scans or D1 UUIDs in chat.

### Browser speech permission

Only /app/simulator is allowed same-origin microphone access for explicitly user-initiated SpeechRecognition; main dashboard and other pages still block microphone.


## Bootstrap 401: exact-token mismatch troubleshooting (non-secret)

The live `POST /v1/human/bootstrap` returns HTTP 401 when the presented Bearer token is absent, differs from the Worker-only `ADMIN_BOOTSTRAP_TOKEN`, or the binding is absent/too short. Token values are intentionally inaccessible from the Cloudflare dashboard. The bootstrap helper now strips accidental surrounding paste whitespace, reports entered token character count **only**, and never logs the token/password. The Worker normalizes accidental surrounding whitespace before checking a constant-time hash comparison. Normal login and API tokens are unrelated.

After a main auto-deploy, CI uses the Cloudflare Workers **read-only list-secrets-metadata endpoint** to report whether the standalone Worker has the required `LOGIN_RATE_LIMIT_SECRET` and `MFA_ENCRYPTION_KEY` bindings and whether temporary `ADMIN_BOOTSTRAP_TOKEN` exists. **No values or hashes are ever logged or returned.** If the name exists but bootstrap still returns 401, check the exact 32+ char one-time token in your *private* password manager and Cloudflare Production Worker; update only that isolated Worker secret then retry with fresh local clipboard. Do not print, screenshot, paste or send it into chat. After first Super Admin bootstrap, immediately delete only `ADMIN_BOOTSTRAP_TOKEN` and retain the two permanent auth secrets. Rotation of a bootstrap secret invalidates previously copied old values.


## If the first Super Admin bootstrap repeatedly returns 401 despite a 44-character token

Cloudflare secret-binding metadata can confirm **only the secret name exists**, not that its value matches what was pasted. Do **not** keep rotating/copying the same token. On a trusted Linux Mint terminal in `~/Workspace/ar3d-ai-calling`, run `npx --yes wrangler@4 login` once and authorize the Cloudflare account containing the existing standalone `ar3d-ai-calling` Worker. Then run:

```bash
cd ~/Workspace/ar3d-ai-calling
git pull origin main
python3 scripts/bootstrap-main.py --sync-worker-secret https://ar3d-ai-calling.ai-8f3.workers.dev
```

This mode generates one 256-bit random bootstrap token in process memory, uploads it **directly** to the named `ar3d-ai-calling` Worker with authenticated Wrangler, and calls the existing bootstrap endpoint using the identical in-memory token. **No token/secret value is passed in process arguments, saved to a file, or shown in terminal output.** No separate clipboard paste. The Wrangler command runs from a temporary empty directory to avoid inadvertently using a config for AR3D Platform/Engine; it targets only the exact new Worker name. If authentication/upload fails, account creation does not run. This operation is for **first bootstrap only**; never use it to reset an existing Super Admin. Wrangler `secret put` creates a new Worker version. Once the Super Admin exists and you can sign in, immediately delete the temporary Worker-only `ADMIN_BOOTSTRAP_TOKEN`; keep `LOGIN_RATE_LIMIT_SECRET` and `MFA_ENCRYPTION_KEY`.


### Exact Bootstrap 401 diagnosis and single-token propagation retry

The read-only Wrangler secret list confirms **names**, not values. An intentionally
invalid Bearer token returning 401 with the expected JSON proves the Bootstrap
route rejects invalid input, not that a previous real token was accepted.

The guarded synchronized flow uploads exactly one token, then reuses the **same
in-memory token and password** for up to four requests when (and only when) the
Worker responds with the exact JSON 401. Retry delays are 5, 10 and 15 seconds;
there are no extra secret writes. HTTP 403/409, upstream 401, transport errors,
and unexpected responses stop without retry. The script never displays token,
password or the raw HTTP body. Persistent 401 may be a deployment or secret
value mismatch: investigate before trying another rotation. Never bootstrap an
existing Super Admin.


### Python urllib / workers.dev Browser Integrity Check (403 / error 1010)

Cloudflare documents that the default Python urllib User-Agent can trigger an
unavoidable Browser Integrity Check on workers.dev before the Worker runs.
The trusted one-time bootstrap helper now sends the descriptive application
User-Agent `AR3D-AI-Calling-Bootstrap/1.0 (+https://ar3d-ai-calling.ai-8f3.workers.dev)` on the existing isolated HTTPS endpoint, not a fake
browser identity. This fixes a known 403 risk without disabling Cloudflare
security or changing other Workers. For an explicit Cloudflare error 1010 the
helper prints a safe classification, never the raw HTTP body. Any other 403
still stops immediately. A prior 403 alone does not prove error 1010 without
its response body or Cloudflare logs. Keep existing one-time bootstrap and
secret-removal rules.

Cloudflare documentation: https://developers.cloudflare.com/workers/configuration/routing/workers-dev/


### Bootstrap 500 root cause: workerd PBKDF2 iteration ceiling (2026-11-19)

A Cloudflare Worker 401 (while a newly published secret propagates) followed
by a 500 after the **same** bootstrap token strongly suggests the application
proceeded past token authorization but failed while hashing the password.
The previous `src/human-auth.mjs` requested **240,000** iterations in one
native `crypto.subtle.deriveBits(PBKDF2)` operation, while workerd caps a
single PBKDF2 operation at **100,000**. The source is the most likely root
cause; confirm with Cloudflare runtime logs where available. References:
https://github.com/cloudflare/workerd/issues/1346 and
https://github.com/payloadcms/payload/issues/18274

New passwords use versioned chained PBKDF2-SHA256 with **three** separately
salted 100,000-iteration rounds and a 128-bit random per-user salt. Stored
`password_iterations=300000` identifies this V2 scheme; it is not the same
hash as one vanilla PBKDF2 operation with 300k iterations. Each individual
PBKDF2 call complies with the Workers limit. No D1 schema rewrite/reset or
relaxation of the existing >=200000 constraint is required. Historical
`password_iterations=240000` rows still mean the original legacy algorithm
and require separately reviewed credential migration if present, as live
workerd cannot verify them. Do NOT silently rehash old credentials.

Before retrying first Super Admin bootstrap after a previous 500, verify
whether a Super Admin or singleton claim was created in the dedicated Control
D1 (read-only counts, no email/password disclosure). A 500 response alone is
not proof that the transaction did not commit. Do not regenerate credentials
until state has been checked. For paid SaaS production security, review a
memory-hard password KDF / dedicated identity provider: three chained rounds
are a compatibility workaround, not a claim of equivalence to a standards-
recommended single high-cost or memory-hard KDF.
