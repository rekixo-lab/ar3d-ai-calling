# AR3D AI Calling — customer production cutover gates (20 November 2026)

**Verdict: NO-GO for calling CRM customers or a 100-customer pilot.**
The deployed standalone Calling Worker is an **engineering-stage production
host**, not an authorized commercial telecom service. The operator's previous
successful Exotel Voicebot call and our self-test code prove basic connectivity,
not campaign legality, customer consent, authenticated transcript source,
customer call ownership, commercial pricing or ready-to-bill subscriptions.

Production endpoint: \`https://aicalling.ar3dstudio.in/app\`
New Super Admin panel: **Customer Production Launch — GO / NO-GO**.

## Software / technical evidence

| Gate | Current evidence | Next acceptance |
|---|---|---|
| Isolated Calling resources | Guarded deployment checks D1/R2 identities, own Worker and custom domain | Recheck exact production IDs and rollback artifact every release |
| CRM and Super Admin | Tenant-scoped CRUD, Excel import, existing surveys and staff-reviewed queue | Conduct access review, real staging tenant isolation and PII deletion test |
| MFA | Implemented and required for operator self-test, status, webhook health, cutover | Operator must enroll MFA and store recovery codes safely |
| No-dial database triggers | Actual Control+CRM SQL schema tested, checked by cutover endpoint | Keep them active until an entirely separate approved commercial integration exists |
| Exotel verified-number self-test | Only private fixed verified number, MFA, confirmation, 30-minute slot/two daily cap | Run an explicitly authorized human-operated trial; never auto retry unknown |
| Exotel call status | Read-only Call Details with account, caller, direction and CallSid checks | Collect provider-authorized audit evidence and failure scenarios |
| Webhook quarantine | Bearer-protected metadata-only HMAC receipt, duplicate replay checks | Independent vendor-origin attestation, documented leg and delivery schema |
| Webhook operator correlation | Existing AR3D self-test CallSid may match hashed event metadata | Not source authentication, lead matching, or proof of transcript delivery |
| Voicebot answers → CRM | Offline parser and staff-reviewed CRM v9 queue exist | Build authorized consent-aware call registry, source-verified transcript adapter, secure retention |
| Campaigns | Drafts/eligibility display, automatic outbound lead calling blocked | Reviewed dispatch, approved telecom category, consent/DND and spending/rate limits |
| Usage and payment | Hypothetical reconciler and payment-signature helper only | Durable provider metering, invoice/ledger, refunds, verified gateway fulfillment |

## External or manual P0 cutover blockers — owners and evidence to retain

1. **Business and telecom:** Exotel business KYC, approved commercial
   outbound Voicebot entitlement, permitted destination types, allowed Indian
   geography, trial/production restrictions and written platform charges.
   An API token alone is not proof.
2. **Caller identity and regulations:** Obtain provider/legal written
   classification of outbound real-estate promotional versus eligible service
   calls, and its authorized caller number/voice DLT route. TRAI's 2025
   rules distinguish automated promotional 140 and service/transactional
   series; TRAI issued an additional 1601 direction for non-BFSI/government
   service/transactional use in August 2026. Confirm what applies *to this
   project* with provider/compliance instead of inferring that an ExoPhone
   trial number is commercially approved.
3. **Lead permission and DND:** For each builder and each lead, establish
   purpose, notice/opt-in basis, verified evidence, DND/provider
   authorization, call hours, timezone, revocation, retention, suppression.
   An Excel upload and a past inquiry do not establish verified permission.
   Opt-out must block future calls even when verification is pending.
4. **Call/lead identity:** A privately created, durable, tenant/lead-
   bound authorized call intent, immutable provider CallSid mapping, account,
   flow, caller, destination and call leg independently reconciled.
   Provider callback-supplied IDs alone are not reliable identity proof.
5. **Authenticated webhook and transcript:** Obtain Exotel-supported
   sender authentication or trusted source mechanism, replay semantics and
   exact schema sample from a consented real call. Bare Bearer possession,
   an HMAC computed *by us* over the payload or a valid CallSid is not
   independent source attestation. Store encrypted, minimal per-turn text
   with role isolation and deletion schedule; require staff confirmation
   before applying answers. No provider testimonial or API response may
   silently grant DND/consent.
6. **Voicebot experience:** Verify the Exotel-managed Hindi/English
   7-question script, opt-out, repetitions, noisy calls, silence, speaking
   over AI, error/hangup, transfer/escalation, unconfirmed property prices
   and visit booking. Do not rely on offline PCM tests as speech QA.
7. **Operational controls:** Provider concurrency, per-builder ceilings,
   budget and estimated spend, time windows, emergency kill switch,
   logging with no PII, incident owner, alert delivery, rate limits,
   network retries and unknown-call safety. Never retry an ambiguous
   provider submission automatically.
8. **Data protection:** Clear customer notice, sensitive recordings/audio
   handling policy, India data processing terms if applicable, access
   review, retention/deletion procedures, breach response, backups.
   Recording is off in the current operator self-test.
9. **Disaster recovery:** Actual remote Cloudflare D1/R2 backup inventory,
   encrypted access-controlled copies and an isolated remote restore
   rehearsal. Local synthetic SQLite tests are not remote recovery evidence.
10. **Finance if selling SaaS:** Exotel price agreement, invoice/cost
    settlement, payment merchant KYC, tax/GST review, double-entry/idempotent
    ledger, disputes, credit expiry, refunds and plan quota enforcement.
    Payment verification code alone does not charge or bill correctly.
11. **Tenant AR3D knowledge:** Authorized, tenant-scoped, read-only
    property data, project-specific freshness rules, audit trail and human
    escalation for unverified prices/availability; do not change existing
    AR3D Platform or Engine data under this Calling project.
12. **Human acceptance:** One explicitly authorized controlled test,
    documented call flow, sanitized telemetry, real transcript review,
    consent and caller verification, costs, opt-out response and operator
    signoff. Only after that design an independently reviewed small pilot;
    never jump directly to 100 imported contacts.

## The new cutover audit proves only limited code/database facts

\`GET /v1/human/engineering/production-cutover\`

- Super Admin and current post-MFA session only; no query params,
  mutation, provider fetch, tenant identifier or customer phone accepted.
- Reads sqlite_master of **only the isolated Calling CONTROL_DB and CRM_DB**
  and checks key tables plus ABORT protective triggers. Missing protections
  are marked **incomplete**.
- Always reports \`verdict: NO_GO\`,
  \`customerCampaignLaunchAuthorized: false\` and
  \`hundredCustomerCallPilotAuthorized: false\` until a separate,
  independently reviewed commercial system is built and approved.
- Returns only enumerated guard names and named next-actions; no actual
  customer leads, credentials, voice content, Exotel CallSids, recorded
  audio, account numbers, or project prices.
- Setting an environment variable, a UI checkbox, or successfully passing
  this endpoint does **not** clear legal approvals or activate calling.

## Acceptance / operator handoff

Engineering verification:
\`npm test\`; responsive Chromium E2E;
guarded workflow including protected D1 schema preflight;
Cloudflare Worker deploy and both read-only smoke tests.
After merge, verify the cutover panel with a **current MFA session**.

Operator-controlled real-world verification:
- Obtain written KYC/telecom/voicebot/number category and pricing evidence;
  do not paste private keys into GitHub, chat or logs.
- Obtain and protect the exact vendor-approved webhook sender-auth contract.
- Record consent/DND procedures and test opt-out with an authorized sample.
- Perform an isolated Cloudflare backup restore and demonstrate rollback.
- Have security, compliance, business and telecom provider sign off before
  customer calling is considered. Green CI alone cannot do this.

Rollback: use a reviewed previous successful Calling Worker release via the
guarded deployment procedure; do not remove SQL no-dial triggers or touch
AR3D Platform/Engine D1/R2. Incidents: immediately disable
\`EXOTEL_OPERATOR_TEST_ENABLED\` in private Worker configuration if even
approved self-tests must stop, revoke exposed credentials, preserve sanitized
audit records and contact Exotel support.

### Official references

- https://docs.exotel.com/intelligent-voice-agents/voicebot-webhooks
- https://developer.exotel.com/docs/agentstream/connect-voice-ai-flow
- https://developer.exotel.com/docs/voice-v1/api-reference/call-details
- https://trai.gov.in/direction-allocation-and-operationalization-1601-numbering-series-service-and-transactional-voice
- https://www.trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf
- https://developers.cloudflare.com/d1/reference/time-travel/
