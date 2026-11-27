# Production audit follow-up (2026-11-27)

- Count uncertain calls against the shared carrier capacity until reconciliation or operator review. A company with an unknown call still cannot dial again.
- Reconcile in-flight shared CRM jobs even after suspension, without selecting suspended tenants for new dispatch.
- Recheck current held funding, tenant, job, running campaign, destination, lead version, policy, clearance, calling hours and opt-out after the durable reservation/session and immediately before the provider POST. Only a proven pre-submission cancellation releases the untouched hold, with a separate evidence label. There is still a small unavoidable race between the final cross-D1 read and external submission; a pause does not recall an accepted call.
- Allow existing customer STOP suppression even after tenant suspension; do not restore ordinary tenant access.
- Include new industry candidate/review and legacy clearance records in read-only deletion inventory. No erasure or retention policy is implemented.
- Gate lifecycle audit on the actual optimistic update. The capacity dashboard distinguishes occupied slots, reserved/submitted and uncertain.

Preserve the existing owner-approved no-daily-cap policy. No new customer calls, provider requests, live test calls, production data edits, staging resources, migration or provider setting changes are needed for these code changes. New School dispatch remains disabled/unimplemented. Automated fixtures cover races with fake numbers and mocked providers. CI and guarded production deployment must be independently checked.
