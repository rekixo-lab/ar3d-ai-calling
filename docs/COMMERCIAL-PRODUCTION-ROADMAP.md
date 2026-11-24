# AR3D AI Calling — commercial production roadmap
Owner-approved implementation sequence (2026-11-24). Scope only this repository, Worker and isolated Calling D1/R2. Do not enable real customer campaigns or paid billing merely because code is merged. No fabricated balances or successful call results.
## Design contract
Both workspaces: navy #14243c sidebar, selected #294b77, blue #2658bc accents, white cards, #f2f5f9 canvas, consistent outlined icons, readable tables, responsive desktop/tablet/mobile, accessible controls, honest empty/error/loading states. Preserve existing routes and tenant boundaries. Keep advanced diagnostics separate from daily workflow. Use INR only when independently verified; display seconds and IST.
## Phase 1 — reliability and CRM
- [ ] Verify compact campaign job IDs for Check charge / Verify CDR (first PR).
- [ ] Real recording transport/STT diagnosis and complete Hindi/English acceptance, signed hangup and CRM save.
- [ ] Persist tenant-scoped partial accepted answers; manual review; no invented profile updates.
- [ ] Customer details property type/area/budget/size/visit preference; export CSV/XLSX.
- [ ] Device deactivate/replace with audit, consent and no lost active hangup; safe uncertain-call reconciliation.
- [ ] Update stale release readiness from verified evidence; IST timestamps and language preference.
## Phase 2 — real seconds wallet (disabled until approved)
- [ ] Immutable integer-second ledger, balances and transaction IDs; distinct provider cost and customer charge.
- [ ] Atomic allocations, purchases, recovery, refunds, reservation, settlement and release; idempotency and concurrency.
- [ ] Dispatch spend gate, insufficient funds, backing reserve, fail closed; never convert provisional INR to paid seconds silently.
- [ ] Audit reason/actor/reference and financial reconciliation; separate internal tests.
## Phase 3 — provider billing
- [ ] Final verified CDR automation, retry observation only, provider-billed versus connected seconds, discrepancies and recovery.
- [ ] Verified provider currency/funds, pricing/version, revenue/cost/margin and financial reports.
## Phase 4 — complete UI
- [ ] Super Admin Dashboard, Clients, Live Calls, Minutes, Transactions, Plans, Reports, Settings, Security.
- [ ] Client Dashboard with balance, customers, interested leads, calls, visits; Upload Excel/Add Customer/Start campaign/CRM; minutes and history.
- [ ] All actions backed by real APIs; no placeholder metrics as facts; consolidate selectors and hide irrelevant diagnostics.
- [ ] Mobile/tablet/desktop and permission E2E; loading, retry, error, and empty states.
## Phase 5 — payments
- [ ] Owner-approved gateway merchant setup, packages and verified order/capture/webhook ledger, replay prevention.
- [ ] Purchase history, invoice/tax policy, refund and reconciliation; no live collection before sign-off.
## Phase 6 — commercial release
- [ ] Provider-authorized traffic, current consent/DND, scope, account/number and completed real call acceptance.
- [ ] Production backups, isolated restore drill, retention/PII deletion, security and load/soak tests, alerts, runbook.
- [ ] Authenticated live role/action acceptance and verified release report.
Each item remains open until its specific evidence exists. Green CI and deploy are necessary, not proof of real payment or customer calling. Record PRs, CI and acceptance evidence against this checklist.
