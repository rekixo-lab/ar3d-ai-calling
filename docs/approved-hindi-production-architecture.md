# Approved Hindi-first production architecture (2026-11-24)

User decision: keep AR3D's own multi-tenant conversation control, memory, validation, CRM, wallet, and credit accounting. No arbitrary daily/monthly customer call quota; purchased credits, provider concurrency/rate limits, consent/DND, legal restrictions, and failure safety remain mandatory. Do not remove current release gates until credit reservations and settlement are verified.

## Cost budget (planning assumptions, INR excluding tax)
- Plivo outgoing: 0.38 per billed minute (verify actual account tariff and rounding).
- Plivo number: 200/month per number.
- Cloudflare Workers Paid: $5/month, budget INR 475 at assumed 95 INR/USD; D1/R2 included allowances only. No automatic subscription purchase.
- Sarvam Saaras v4: 0.49 per billed audio minute; use hi-IN / appropriate language and measured audio duration. No automatic third-party audio transfer.
- Sarvam 105B Conversations: candidate contextual LLM, budget 0.03 per connected minute; benchmark token consumption, current price, schema accuracy and latency before activation.
- Existing deterministic parser first, Cloudflare Qwen/Llama optional measured fallback, no separate translation, cached reviewed prompts / Plivo TTS. No automatic multi-model fanout on live calls.
- Conservative variable target 0.90/min (0.38+0.49+0.03). Optimized target 0.655/min assuming 50% billable audio. Fixed baseline 675/month for one number. These are estimates, not caps or actual invoices; tax, FX, provider minimum increments, retries, overruns, overages and extra numbers may raise them. Meter actual provider usage separately from client credit prices.

## Rollout gates
1. Replay the consented old budget recording: expected बीस लाख -> 2000000. Sarvam API key is a Worker secret SARVAM_API_KEY; never in repo/chat. Verify current model/pricing and provider policy.
2. Shorter internal recording windows, then evaluate endpointing and streaming; aim for 1–3 seconds after speech, measure real p50/p95. Do not claim achieved from synthetic tests.
3. Validate Hindi/Hinglish size, budget, ranges, locations, multi-field utterances, corrections, stop requests, ambiguous replies and partial calls. Preserve evidence, no invented values or appointment.
4. Add structured multi-field extraction and bounded context, independent schema validation and idempotent tenant-scoped CRM partial updates. LLM has no write/dial authority. Do not activate external LLM until recipient disclosure and provider data handling reviewed.
5. Reconcile real telephony, STT and LLM usage and verify concurrent credit reservations, no negative wallets or double charges; no arbitrary business quota after release gates pass. Keep telecom safety controls.
6. One explicitly approved internal call only after saved-audio recognition passes; no automated dialing or campaign enablement during development.

Current implementation is staged, not proof of accuracy or production readiness.

The saved-audio Sarvam diagnostic also exercises the direct-first interpreter with a bounded Sarvam 105B adapter when needed. Report proposed results, token counts and latency only; never write them into CRM during replay. Provider activation and full multi-field extraction remain gated.

The Super Admin Minutes & Wallet production cost planner uses integer micro-INR assumptions, separate from actual provider observations and client credits. It does not restrict calling volume or change a wallet.

After the real saved-audio test on 2026-11-24 recognized 20 लाख -> 2000000 in 710 ms with zero LLM calls, enable explicitly consented internal Sarvam recorded-answer pilot. No production campaigns activated; keep previous campaign gate unchanged. Track last recognition/interpretation latency and cumulative known STT duration/token usage; missing usage is unknown, not a verified invoice. Retain legacy diagnostics under Advanced until full live pilot passes.

## Owner amendment: manual credits and visual design (2026-11-24)
No payment gateway, online checkout, payment selection or payment collection. Boss handles external payments and provider funding. Super Admin allocates calling credits on client creation and later top-ups; audit allocations, deductions, reversals and adjustments, with optional external reference but no claim of received payments. Client sees own seconds/minutes and history, not internal provider costs. Never silently convert provisional INR budgets to spendable minutes. Preserve funding, consent and carrier gates.
Both panels use the provided chat-inspired dark references: charcoal canvas, #212121 cards, subtle neutral borders, white/gray text, blue accent, compact system sans typography, outlined icons, restrained accessible animations with reduced-motion support, responsive grids/tables. No copied proprietary font assets or simulated live values. Preserve routes and accessibility. Full visual redesign in respective UI stages.
Nine stages: 1 Cost Intelligence, 2 credit ledger, 3 credit-based dispatch, 4 smart conversation, 5 CRM/CSV, 6 Super Admin UI, 7 Client Admin UI, 8 legacy cleanup, 9 production audit. Payment gateway removed. Each stage needs tests, green CI, merge, deployment and actual acceptance where applicable.
Stage 1 first increment: signed-ended session cost observation, exact call-bound on-demand internal Plivo CDR read (currency unverified), existing campaign CDR observation join, INR tariff estimates separately, aggregate historical STT or modeled per-request rounding for new calls, LLM budget allowance not invoice; no wallet or campaign changes. Persisted internal CDR reconciliation, provider currency confirmation and exact Sarvam invoice attribution remain later increments.

Stage 2 first increment: immutable integer-second manual allocation/recovery ledger, current-MFA admin, optimistic atomic balance chain, unique idempotency reference, tenant-only history. Existing provisional INR records remain untouched. Initial allocation on client creation, backing reserve, call holds/settlement and production spending remain gated. No online payments.

Stage 2 onboarding increment: new client invitation and optional whole-minute allocation commit in one Control D1 transaction; existing company allocations are separate ledger actions. Current MFA required. Old provisional API compatibility retained until cleanup; onboarding no longer offers provisional INR packs. No online payments or spendability.

Stage 2 reservation foundation: separate Control D1 hold/terminal settlement records, 30-second pulse, atomically checked available seconds, no recovery below committed usage, immutable final records and duplicate-safe terminal transitions. Helpers are deliberately unwired; no API or provider dispatch or actual debit until verified evidence, backing and campaign integration are complete.

## Owner final integration workflow amendment (2026-11-24)
Supersedes per-stage merge/deploy/CI: all remaining implementation on `integration/production-nine-stage`; review each increment, correct and rereview, preserve evidence. No intermediate PR or full CI. After all nine code stages are ready, two integrated code rechecks, one final combined PR and complete CI/browser checks; fix failures and rerun until green, then one exact-head main merge and guarded deploy/smoke. No live campaign/funding authorization implied. Existing main releases remain intact. Manual allocation only, no payment gateway, both dark UI references unchanged.
Stage 2 integration increment: ledger shows net allocation, held, used, uncommitted and paginated call history; recovery atomically rejects consuming commitments. Explicitly not spendable while activation gates are closed. Test cases added, execution deferred to final combined CI per owner instruction. Next: evidence-backed CDR settlement and safe cross-D1 dispatch protocol; no auto-redial or inferred funding.

Stage 3 increment (integration only): explicit funding approval gate AR3D_FUNDED_CAMPAIGN_DISPATCH plus existing carrier/policy/consent gates; check available seconds, claim CRM job then atomically reserve Control seconds before Plivo POST. Failed reserve cannot dial, uncertain outcomes keep hold, exact rejected session releases, signed-ended matched CDR settles idempotently. Separate databases cannot share a transaction: crash after CRM claim intentionally locks for review. Existing daily safety cap retained until final policy review; no live flag set. Tests authored, final CI deferred. Next: recovery/reconciliation scheduler, Sarvam campaign route with disclosure, quota review and remaining stages.

Stage 3 further increment: explicit opt-in Sarvam campaign selection with independently approved disclosure and matching completed signed-ended Sarvam pilot; keypad consent still required, no recording before consent; deterministic/split-answer only for customer calls until contextual grounding is strengthened. Existing campaign setting left unchanged; no flag enabled. Manual CDR verification can retry settlement after cross-D1 crash and reports replay without a new debit. Full test execution deferred.
