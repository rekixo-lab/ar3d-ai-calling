# AR3D AI Calling — commercial production roadmap
Owner-approved implementation sequence (2026-11-24). Scope only this repository, Worker and isolated Calling D1/R2. Do not enable real customer campaigns or paid billing merely because code is merged. No fabricated balances or successful call results.
## Design contract
Owner amendment 2026-11-24: both workspaces use chat-inspired dark reference styling: charcoal canvas, #212121 cards, subtle neutral borders, blue accent, compact system sans typography, outlined icons, restrained reduced-motion-aware animations, readable responsive tables, accessible controls, honest empty/error/loading states. Preserve existing routes and tenant boundaries. Keep advanced diagnostics separate from daily workflow. Use INR only when independently verified; display seconds and IST.
## Phase 1 — reliability and CRM
- [x] Verify compact campaign job IDs for Check charge / Verify CDR (PR #156, CI 45323227387, production 45323433020; synthetic provider evidence only).
- [ ] Real recording transport/STT diagnosis and complete Hindi/English acceptance, signed hangup and CRM save.
- [ ] Persist tenant-scoped partial accepted answers; manual review; no invented profile updates. Implementation in this change saves accepted prefix on terminal signed hangup via campaign reconciliation; live acceptance still pending.
- [ ] Customer details property type/area/budget/size/visit preference; export CSV/XLSX.
- [ ] Device deactivate/replace with audit, consent and no lost active hangup; safe uncertain-call reconciliation.
- [ ] Update stale release readiness from verified evidence; IST timestamps and language preference.
## Phase 2 — real seconds wallet (disabled until approved)
- [x] Immutable integer-second ledger, balances and transaction IDs; distinct provider cost and customer charge.
- [x] Atomic allocations, purchases, recovery, refunds, reservation, settlement and release; idempotency and concurrency.
- [x] Dispatch spend gate, insufficient funds, backing reserve, fail closed; never convert provisional INR to paid seconds silently.
- [x] Audit reason/actor/reference and financial reconciliation; separate internal tests.
## Phase 3 — provider billing
- [x] Final verified CDR automation, retry observation only, provider-billed versus connected seconds, discrepancies and recovery.
- [x] Verified provider currency/funds, pricing/version, revenue/cost/margin and financial reports.
## Phase 4 — complete UI
- [x] Super Admin Dashboard, Clients, Live Calls, Minutes, Transactions, Plans, Reports, Settings, Security.
- [x] Client Dashboard with balance, customers, interested leads, calls, visits; Upload Excel/Add Customer/Start campaign/CRM; minutes and history.
- [x] All actions backed by real APIs; no placeholder metrics as facts; consolidate selectors and hide irrelevant diagnostics.
- [ ] Mobile/tablet/desktop and permission E2E; loading, retry, error, and empty states.
## Phase 5 — external payment / manual credit allocation (no payment gateway)
- [x] Boss handles payments externally; Super Admin allocates minutes on creation and later top-ups, with audited references and reversals.
- [x] No checkout, payment selection, payment gateway integration or in-app payment collection. Transaction history records credits, not unverified revenue.
## Status recheck 2026-11-24
Ticked items above are implemented in code with automated tests (PRs #191–#202 and the UI simplification change). They are not live acceptance: no real provider invoice, real customer call or commercial launch is implied.
- UI simplification: client Home tab (overview, quick actions, follow-ups) instead of repeating the overview on every tab; refresh keeps the open client tab; plain labels (Available / Used / On hold / Total received); duplicate Results count table removed; admin safety/settlement/funding review, provider reports and pilot test tools folded under Advanced sections with a "Needs attention" summary.
- Still open and operator-only: real Hindi/English call acceptance, Plivo KYC/DLT/caller number, consent and DND evidence, reviewed provider budgets, production backup/restore and deletion, load/soak tests, alerts and runbook.

## Phase 6 — commercial release
- [ ] Provider-authorized traffic, current consent/DND, scope, account/number and completed real call acceptance.
- [ ] Production backups, isolated restore drill, retention/PII deletion, security and load/soak tests, alerts, runbook.
- [ ] Authenticated live role/action acceptance and verified release report.
Each item remains open until its specific evidence exists. Green CI and deploy are necessary, not proof of real payment or customer calling. Record PRs, CI and acceptance evidence against this checklist.

## Urgent voice quality acceptance (owner requested)
- Internal pre-consented tests: direct question after short AI/recording notice, no keypad. The operator must have actual recipient consent before dialing. Legacy and customer campaign consent gates remain unchanged.
- Improve short-answer capture and bounded media availability retry; show reason and accepted question count. Verify on actual Hindi and English calls; do not assume synthetic tests prove recognition or enable live campaigns.
- Natural recorded direct opening may replace synthesized notice only after reviewing that it preserves notice. Evaluate streaming/ASR separately if batch recording still fails; verify provider charges and language before enabling.

## Single speech provider
- Sarvam Saaras v4 handles recorded-answer recognition in both internal and customer flows. Sarvam 105B Conversations provides bounded, evidence-validated contextual proposals only when the deterministic interpreter cannot resolve a response and the required disclosures are approved.
- Keep signed Plivo callbacks, recording URL allowlists, retry limits, consent, DND and provider funding gates. Do not automatically switch providers, redial, or enable a customer campaign.
- The isolated Sarvam realtime research probe is not a live call route. Real-device acceptance, measured latency and actual invoice verification remain required.

Superseding implementation sequence: see approved-hindi-production-architecture.md owner amendment for nine stages. Stage 1 increment is read-only per-call cost intelligence, no client debit or campaign enablement.
