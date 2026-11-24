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
