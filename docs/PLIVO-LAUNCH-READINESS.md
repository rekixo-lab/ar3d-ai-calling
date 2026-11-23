# AR3D AI Calling — Plivo Go-Live Readiness (2026-11-23)

**Current release:** multi-tenant CRM and scripted Hindi/English Plivo calling implementation, plus browser AI test. It is **not** an approved, full-duplex conversational AI calling SaaS. In particular, receiving Plivo KYC approval or Auth ID/Auth Token alone **does not** complete the product.

## Agreed narrow v1 scope

The owner has selected a **fixed-question Smart Voice Q&A**, not a general, realtime conversational LLM, as the first usable product. See [Smart Voice QA v1](SMART-VOICE-QA-V1.md). Realtime bidirectional streaming, human-like interruption and open-ended LLM are optional *future* features rather than v1 requirements. This scope reduction **does not** waive India carrier approval, consent/DND, internal audio tests, privacy/security review or safe rollout.

## Read-only Super Admin check

Open **/app → Super Admin → Calling Setup → Plivo Go-Live Readiness**. The **Refresh go-live checks** button reads `GET /v1/human/launch-readiness`.

- Restricted to a **current MFA-enrolled Super Admin session**. Returns no account IDs, Auth Tokens, caller numbers, phone numbers, tenant IDs, lead IDs, secret values or keys.
- Makes **no Plivo or billing API call**, no CRM writes, no DND/consent changes and no phone call; cannot change approval state. It only makes bounded private **R2 HEAD metadata reads** for the internal pilot Hindi and English voice packs.
- Lists configuration *presence only* and, separately, the **11 required MP3 object checks per language** plus optional `repeat.mp3` status. A file marked `present` means R2 reports a valid nonzero size within 512 KiB. It **does not** verify pronunciation, content, playability, provider acceptance, traffic category or business approval.
- If a human admin is not logged in or did not enroll in MFA, the route rejects with 401/403. A consumer UI or public status page cannot access the report.

## Work that can be engineered without the final Plivo credentials

1. **Optional future conversational upgrade — not a v1 blocker:** Plivo bidirectional streaming, RAG/LLM dialog, streaming TTS, barge-in and human-handoff may be added later. The **agreed v1** is already based on a bounded fixed-question flow with reviewed R2 MP3 prompts and Workers AI transcription of short answers; it must still pass a verified real-device internal test before customer use.
2. **Security / privacy:** implement retention and deletion policy for call audio and PII, recovery procedures, operator audit, rate limits and backups with an actually verified restoration drill. Independent vulnerability assessment and MFA rollout also require real-world sign-off.
3. **Consent and DND evidence:** code enforces per-lead clearance and opt-outs, but an independent live DND lookup/verification and lawful evidence workflow are still to be integrated and accepted. Never infer permission from imported Excel/CSV.
4. **Product operations:** verified carrier usage events, payment subscriptions and invoicing if charging users, durable retry reconciliation and truthful quotas. Synthetic preview of minutes or charges is not billing.
5. **Provider-independent verification:** full browser E2E, cross-tenant isolation, security scans, load/soak, callback replay, no-dial failure tests; must be signed off for production before onboarding real customers.

## Verify Hindi audio now, without KYC

After reviewing PR #125 and deploying only to the isolated Calling Worker, open **Super Admin → Calling Setup → Plivo Go-Live Readiness → Refresh go-live checks**. Its internal-pilot audio section checks `scripted-phone-pilot/hi/` and `scripted-phone-pilot/en/` in the private `ar3d-calling-recordings` R2 binding. For each language, expect **11/11** required objects and an optional `repeat.mp3` marked present if supplied. Missing, oversize and temporarily inaccessible objects are reported separately. The user-supplied Hindi upload screenshots show these names but do **not** substitute for live R2 metadata verification or a listened-to pilot. Customer campaigns do **not** reuse pilot files: their reviewed clips must be uploaded per tenant under `scripted-phone-campaigns/<tenant-uuid>/hi/` or `/en/` when customer activation is eventually approved.

## After Plivo business KYC / India route approval

- Plivo account dashboard supplies `PLIVO_AUTH_ID` and `PLIVO_AUTH_TOKEN` separately from KYC. KYC is required for Indian domestic calling/number provisioning; it does **not** necessarily generate new API credentials.
- Securely set Worker secrets and the approved Indian caller ID using operator tools. Never paste tokens into chat, PRs, files, or front-end HTML.
- Verify Indian business KYC, caller ID, permitted marketing/service traffic type, current DND restrictions, consent proof and account usage/recording policy with Plivo and your compliance owner.
- Upload reviewed Hindi/English MP3 scripted prompts into private R2, configure internal staging pilot and verify its authenticated recording, signed callbacks and completed questionnaire **on your own approved test number**. No real calls are made by the readiness page.
- Enable customer campaign flags **only** after an approved pilot, complete provider classification, operator-signed consent/DND and privacy reviews. Unknown/outcome-uncertain calls remain locked until manual reconciliation.

## Sources

- [Plivo India Calling Regulations](https://www.plivo.com/docs/voice/concepts/india-calling)
- [Plivo Auth ID and Auth Token](https://www.plivo.com/docs/voice/api/overview)
- [Plivo two-way audio streaming](https://www.plivo.com/docs/voice/api/audio-streams)
- [Fixed scripted phone pilot](scripted-phone-pilot.md)
- [Operator actions](MANUAL-ACTIONS.md)

**Do not label this as "KYC-only pending" or "production-ready".** The final provider approval is only one of several gates. This documentation is a live engineering checklist, not regulatory advice.
