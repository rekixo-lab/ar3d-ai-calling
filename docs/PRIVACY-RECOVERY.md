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
