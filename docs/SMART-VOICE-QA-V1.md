# AR3D Smart Voice Q&A — agreed v1 scope (23 November 2026)

## Product decision

Build the smallest reliable, consent-gated, *fixed-question* Hindi/English real-estate phone assistant on the existing AR3D stack. **Do not train or buy a large general-purpose LLM** for v1. The assistant asks the reviewed questions, captures short spoken replies, understands a bounded set of answers, asks again when the audio/content is unclear, and sends only validated outcomes to the CRM.

- **AR3D-owned:** CRM, customer imports, review dashboard, company isolation, consent gates, seven-question state machine, answer parsing, replay protection, retries and human-review outcome.
- **External dependencies:** Plivo for authorized Indian telephone connections; Cloudflare Workers/Workers AI for backend and short speech-to-text; private R2 for reviewed Hindi/English prerecorded MP3 prompts; D1 for CRM records.
- **Not in v1:** general ChatGPT-like conversation, large-model training, open-ended sales promises, unsolicited calls, autonomous booking, realtime barge-in or unlimited background dialogue. Natural two-way streaming is a separate later upgrade.
- **Cost:** software logic is ours; provider telephone minutes and potentially Cloudflare AI usage are not guaranteed free. Never suggest free real phone calling.

## Acceptance behavior

1. Ask one approved question at a time; preserve the current question and customer answers in a bounded, reviewed state machine.
2. Normalize supported replies (property type, area, location, size, budget, interest and proposed visit day). Do not invent missing numbers, units, dates or interests.
3. If a recording is missing, recognized as a repeat request, describes bad audio, or fails field validation: **repeat the same prompt** and do not advance or save that field. Sample replies: "आवाज नहीं आ रही", "दोबारा बोलिए", "मुझे सुनाई नहीं दिया", "can you repeat?".
4. If three attempts fail, end in **needs_review**. An uninterpretable answer is never a valid location/area or presumed permission to call again.
5. "कॉल मत करना" / explicit opt-out takes priority over ordinary question parsing; actual customer-phone opt-out must be persisted via the existing verified campaign path, not through an unauthenticated browser preview.
6. Do not confuse asking for a site-visit date with making a confirmed booking.
7. Preserve tenant isolation, DND/consent checks, signed provider callbacks, campaign kill-switch, no-redial-on-uncertain-result and existing CRM manual-review protection.
8. Test Hindi, Hinglish and English repair phrases, misheard/corrected questions, mixed yes/no interest replies, and three-failure review. A customer saying "आप गलत समझ रहे हो" is not a city or an agreement. An STT transcript is **not** proof of accurate transcription; providers may not supply calibrated recognition confidence.

## Existing versus still needed

Existing: fixed 7-question engine, browser preview, Plivo scripted pilot/campaign code, R2 prompts, Worker STT adapter, CRM status/review flow, and operator readiness checks.

This increment: strengthen deterministic repair detection so an audio complaint or filler cannot be saved as a city/area; add repeat/review regression tests.

Still needed before real customer calling: provider account + approved Indian number / route; operator-verified permitted traffic category, DND and customer consent evidence; staging internal-phone tests with reviewed voice prompts; real Hindi accent/noise tests, monitoring and privacy/backup sign-off. A polished spoken "माफ कीजिए, दोबारा बताइए" apology would require a reviewed extra audio clip (or a separately approved speech provider). Until then the system safely **replays the question**; do not claim it speaks an apology.

## Manual operator actions (never send credentials in chat)

- Complete Plivo business/India KYC and get an approved caller number plus permitted call purpose. Configure secret Auth ID/Token on the isolated Calling Worker, not in source code.
- Provide permitted Hindi/English MP3 recordings for the scripted prompts in private R2. Prepare one *authorized* internal test number and synthetic CRM lead.
- Supply verifiable recipient consent and DND evidence for actual campaigns, plus recording notice and privacy policy.
- Confirm staging test results, provider recording/authentication, approved caller, backups, operator MFA and a stop/rollback plan before customer campaign activation.

## Rollout discipline

This is a code-only incremental change. No phone calls or vendor updates during tests, no schema changes, no migrations, no new secret values and no other AR3D Platform/Engine project edits. A green CI suite is required but alone does **not** prove live speech quality or authorize production calls. Review branch/PR first; enable only an explicitly approved internal pilot after manual checks.
