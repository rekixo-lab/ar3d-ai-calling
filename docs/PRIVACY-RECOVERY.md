# AR3D AI Calling — privacy deletion and disaster-recovery preparation

**Release stage:** KYC-independent engineering checks. **Not** a production backup, live recovery, completed erasure implementation, legal compliance certification, or permission to place calls. No real customer records or Cloudflare databases have been read, exported, deleted or restored by these checks.

## What has been built

- **Read-only deletion dependency check:** `GET /v1/human/leads/<lead-uuid>/deletion-readiness?tenantId=<tenant-uuid>` from a logged-in **current-MFA Super Admin** session. The authenticated human API reports only the lead/tenant identifiers, aggregated related-record counts and blockers. No name, mobile, transcript, recording bytes or credentials are returned. Client accounts and viewers cannot use it.
- Counts include `calls`, `calling_jobs`, `call_campaign_candidates`, `site_visits`, `lead_consent_evidence` and permanent `lead_opt_out_events`. These are known dependencies, **not** an exhaustive erasure map: separately inspect notes, audit logs, recordings, R2, exports, provider copies, dedicated databases and backups.
- The response **always** has `executionAllowed: false` and `piiDeleted: false`. A zero count does **not** authorize deletion, and an opt-out history must not be accidentally erased so a reimport can trigger another call.
- **Synthetic backup/restore test:** `node --test tests/privacy-synthetic-backup-restore.test.mjs` creates temporary `node:sqlite` **Control** and **CRM** files under the OS temporary directory, runs repo migrations, inserts invented records, uses SQLite's online `backup()` API, copies each archive to a separate isolated restored file, verifies `PRAGMA integrity_check`, foreign keys, schema and row counts, and proves changes in the recovered CRM cannot affect the source. Every file is deleted at the end. This tests the code path only; **Cloudflare D1 live backup and restoration are still unverified**.

## Before an actual production export or restore (human-admin steps)

1. Verify the **separate** and exact Cloudflare account/D1 database identity for `ar3d-calling-control` and `ar3d-calling-shared-crm`. Dedicated tenant D1s require their own inventories. Do **not** access the AR3D Platform or AR3D Engine databases.
2. Decide retention durations, backup expiry, encryption/access policy, authorized operator, deletion approval, lawful records to retain, recording notice and legal holds. Keep long-term customer data off GitHub and out of ChatGPT.
3. Authorize an encrypted backup workflow through Cloudflare D1-supported export/backup controls with minimal credentials. Store each backup in restricted private storage outside the repository, capture checksum, schema/version, source DB identity, timestamp and row counts. Never log PII or upload backup archives as build artifacts.
4. Restore only to **fresh, isolated test D1 databases**, never over a running production database. Verify schemas, opt-out/consent triggers, tenant count, isolation, integrity, spot checks and app functionality. Use an approved rollback procedure.
5. Audit who performed every operation; verify that restore does not silently resurrect deleted contacts or reset DND/opt-out suppressions. Agree how live data/backup copies will expire. Avoid over-retaining personal data.

## Before authorizing a real deletion request

- Confirm the requester, tenant, legal basis, scope, retention policy, records across D1/R2/provider, and backup limitations.
- Block or reconcile active call sessions, queued jobs and campaign drafts. A deleted lead must not become callable from an old import or retry.
- Preserve a minimal, policy-approved suppression/tombstone representation where required, separate from unnecessary CRM PII.
- Implement and review a transactional, audited deletion service in a later migration **only after** approved policy, snapshot/restore sign-off and cross-tenant rollback tests.
- Do not disable `trg_prevent_lead_opt_out_reversal`, `trg_block_unverified_consent_update`, `trg_no_call_launch` or other fail-closed constraints.

## Next prerequisites

Cloudflare **production** D1 backup/restore trial with verified test accounts and a human operator; agreed privacy retention/deletion policy; a complete dependency inventory and approved mutation logic; R2/provider recording inventory; independent security review; India Plivo KYC, permitted traffic and verified consent/DND remain separate call-launch blockers.

Client dashboard behavior is unchanged. This privacy work is for AR3D operators; it does not add extra forms to the client calling flow.

The read-only inventory additionally includes direct lead notes, staff assignments, intent proposals, job-linked survey results and verified cost observations, direct lead-target audit events, and Control D1 phone sessions. Indirect audit targets, provider/R2 objects, export copies and backups still require operator inventory. No erasure or retention policy is implied.

## Low-cost operator backup archive (no extra service)
D1 Time Travel is the existing Cloudflare recovery facility; review its actual retention and current bookmarks for each exact isolated Calling database: https://developers.cloudflare.com/d1/reference/time-travel/. For an independent encrypted offline copy, use the existing authenticated Wrangler CLI on a trusted Linux machine. Confirm both database names/IDs and the account before export. Pause writes during the two independent exports if a consistent pair is required; these are not a cross-D1 atomic snapshot. No automatic production restore is provided.

```sh
umask 077
mkdir -p "$HOME/ar3d-private-backups"
# Generate once; keep key separately backed up in secure private storage.
# Never overwrite an existing key.
(set -C; head -c 32 /dev/urandom > "$HOME/ar3d-private-backups/key.bin")
# Run from the isolated Calling repo using its verified Wrangler configuration.
wrangler d1 export ar3d-calling-control --remote --output="$HOME/ar3d-private-backups/control.sql"
wrangler d1 export ar3d-calling-shared-crm --remote --output="$HOME/ar3d-private-backups/crm.sql"
node scripts/backup-archive.mjs seal "$HOME/ar3d-private-backups/control.sql" "$HOME/ar3d-private-backups/crm.sql" "$HOME/ar3d-private-backups/key.bin" "$HOME/ar3d-private-backups/calling-2026-11-24.enc"
node scripts/backup-archive.mjs verify "$HOME/ar3d-private-backups/calling-2026-11-24.enc" "$HOME/ar3d-private-backups/key.bin"
```

Only private 0600 files outside the repository and private output directories are accepted. Archive uses AES-256-GCM with random nonce and authenticated per-dump checksums. Maximum 64 MiB per dump; for larger exports use an approved streaming backup procedure. The utility authenticates bytes, not DB identity or SQL semantics. After verification, remove plaintext exports according to approved secure storage policy. To extract, use the `extract <archive> <key> <new-private-dir>` command; it refuses existing destinations. Import only to explicitly identified isolated test databases, run integrity/schema/suppression/tenant tests, then remove plaintext. R2 prompt objects, dedicated databases, Worker secrets and provider copies require separate approved backups. No production backup has been executed by CI.

### One-command local export (optional scheduler-compatible)
On a trusted operator computer, install/authenticate Wrangler separately and provide the existing Cloudflare environment values `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CONTROL_DB_ID`, `CRM_DB_ID` using a secure local credential source. Use a private 0700 directory and a separately stored private 32-byte key. Run:

```sh
node scripts/backup-export-local.mjs EXPORT_TWO_VERIFIED_CALLING_DATABASES "$HOME/ar3d-private-backups" "$HOME/ar3d-private-backups/key.bin"
```

This first checks exact Calling resources/schema using the existing guarded read-only preflight, then exports only the two Calling bindings via the locally installed Wrangler CLI and creates an authenticated encrypted archive. Temporary plaintext exports are removed on ordinary completion or failure; abrupt termination may leave a private `.calling-export-*` directory, so inspect and securely clean it. No cross-D1 atomic snapshot, no automatic restore, no R2/secret export. The command deliberately rejects CI. A local cron/systemd timer can invoke it only after the operator chooses retention, credentials, disk quota and an acceptable consistency/write-pause policy; no scheduler is installed or enabled by this change. No production export was run during development.
