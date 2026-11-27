# AR3D AI Calling Repository Recheck — 27 November 2026

## Scope
Reviewed the tracked source tree and examined the voice calling scheduler, WhatsApp queue, visit updates, and related tests on branch `audit/full-repo-2026-11-26`. The branch was originally identical to `main`; the previously mentioned 20 uncommitted fixes were not present in GitHub at the start of this continuation. This report documents verifiable, newly submitted changes only; it is not a claim that every execution path has been exhaustively validated.

## Findings addressed
1. **WhatsApp delivery starvation:** with only one message processed per invocation, an old `pending_setup` row could repeatedly block a newer `scheduled` row. Prioritize ready scheduled rows while retaining pending-setup retries and all provider authorization checks.
2. **Visit audit integrity:** a concurrent status change could make an optimistic UPDATE fail yet a second audit INSERT still succeed. Gate the audit on the preceding UPDATE's `changes()=1` in the same D1 batch.
3. **Global calling concurrency:** two overlapping cron invocations could each observe free platform capacity before reserving; add a global count predicate to the same atomic calling-job reservation statement. Preserve tenant-specific limits and no-redial semantics.

## Tests
Added regression tests for queued versus pending WhatsApp messages, concurrent visit status writes, and two overlapping call schedulers. CI result and production deploy evidence must be recorded after this branch is tested; no real customer calls or messages are part of these tests.

## Limits and follow-up checks
- Review financial reconciliation of late callbacks and provider-reported costs against existing minute holds.
- Verify STOP/opt-out propagation and webhook replay behavior under concurrent bursts with the production queue.
- Verify manual balance sync reflects provider spend outside AR3D and does not imply provider balance reads when they are unavailable.
- Run guarded CI/browser tests before any merge or deploy; do not infer production readiness from unit tests alone.
- Meta WhatsApp connection, business/template approvals, and recipient permission remain independent operational prerequisites.
