# AR3D AI Calling — Plivo Go-Live Readiness (2026-11-23)

**Current release:** multi-tenant CRM and scripted Hindi/English Plivo calling implementation, plus browser AI test. It is **not** an approved, full-duplex conversational AI calling SaaS. In particular, receiving Plivo KYC approval or Auth ID/Auth Token alone **does not** complete the product.

## Read-only Super Admin check

Open **/app → Super Admin → Calling Setup → Plivo Go-Live Readiness**. The **Refresh go-live checks** button reads `GET /v1/human/launch-readiness`.

- Restricted to a **current MFA-enrolled Super Admin session**. Returns no account IDs, Auth Tokens, caller numbers, phone numbers, tenant IDs, lead IDs, secret values or keys.
- Makes **no Plivo or billing API call**, no CRM writes, no DND/consent changes and no phone call; cannot change approval state.
- Lists configuration *presence only*. `configured: true` does **not** mean the provider accepted the key, granted a traffic category, rented a number or approved a business.
- If a human admin is not logged in or did not enroll in MFA, the route rejects with 401/403. A consumer UI or public status page cannot access the report.

## Work that can be engineered without the final Plivo credentials

1. **Real-time conversational agent:** implement authenticated Plivo bidirectional audio streaming, bounded streaming sessions, India Hindi/English STT, customer-specific RAG grounded in approved company/project knowledge, LLM turn logic, speech synthesis, interruption/human handoff, verified callback identity, and guard against stale/out-of-order sessions. The current browser test does not supply this. The scripted phone flow uses prerecorded R2 MP3 prompts + Workers AI transcription for short answers, which is a different, restricted feature.
2. **Security / privacy:** implement retention and deletion policy for call audio and PII, recovery procedures, operator audit, rate limits and backups with an actually verified restoration drill. Independent vulnerability assessment and MFA rollout also require real-world sign-off.
3. **Consent and DND evidence:** code enforces per-lead clearance and opt-outs, but an independent live DND lookup/verification and lawful evidence workflow are still to be integrated and accepted. Never infer permission from imported Excel/CSV.
4. **Product operations:** verified carrier usage events, payment subscriptions and invoicing if charging users, durable retry reconciliation and truthful quotas. Synthetic preview of minutes or charges is not billing.
5. **Provider-independent verification:** full browser E2E, cross-tenant isolation, security scans, load/soak, callback replay, no-dial failure tests; must be signed off for production before onboarding real customers.

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
