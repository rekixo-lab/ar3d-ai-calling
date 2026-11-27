# AR3D AI Calling — Multi-Industry Implementation Blueprint
**Version:** proposed v1.0 · **Date:** 27 November 2026 · **Scope:** AR3D AI Calling repository only

> **STATUS: DESIGN PROPOSAL — NOT IMPLEMENTED.** This document changes no database, Worker, provider, phone number, existing script, client balance, campaign, Meta configuration or customer contact. No mode described below is licensed for live use merely because this document exists. All planned features are subject to engineering, operator and regulatory review.

## 1. Business outcome / प्रोडक्ट का लक्ष्य

Build **one multi-tenant AI Calling platform** that supports Real Estate, School/College, general service reminders, Finance/NBFC, regulated Banking/Insurance and other businesses without cloning an app per industry.

Each client chooses an **industry template**, defines a **purpose-specific call flow**, maps its **own approved data**, chooses **announcement / interactive / hybrid** behavior, tests it, and seeks required approval before publication. Immutable versions determine each call. Platform-controlled safety checks are never editable by the client.

**Three interaction modes:**

- **Announcement:** Approved greeting and short, currently valid notice; typically no recording/STT. If details are sensitive, verify the intended person before speaking them. Do not conflate "no marketing questions" with "no privacy checks."
- **Interactive:** One reviewed question at a time, bounded recognition, validated answers, safe branches, review on uncertainty, CRM outcome.
- **Hybrid:** Verified announcement plus limited questions, optional human callback/transfer where supported. Never promise a connected live transfer unless the provider supports and confirms it.

**Industry examples (designed, not currently callable):**

| Industry | Initial workflow | Important restriction |
| --- | --- | --- |
| Real Estate | Existing seven-question property enquiry + property matching | Preserve current production engine and property schema |
| School/College | Admission enquiry: parent/guardian, class, campus, callback | Avoid collecting unnecessary children's data |
| Generic service | Existing-customer appointment confirmation or reminder | Verify provider-approved service purpose and permission |
| Finance/NBFC | Due-date notification after identity verification and fresh account data | No third-party debt disclosure, harassment, or automatic recovery calls |
| Banking/Insurance | Account-related service/renewal reminder | Separate regulated number, purpose and authorization review |

## 2. What the repository ACTUALLY implements today

- **Tenancy:** Control D1 tenants + membership; shared CRM D1 or separately provisioned dedicated CRM D1; per-row tenant_id isolation. AR3D Platform/Engine databases are separate and must never be migrated by this repo. Source: docs/ARCHITECTURE.md.
- **Contact/CRM:** CRM leads unique by (tenant_id,mobile_e164); consent/DND statuses, audits, opt-outs, calls, and property/site-visit fields. A single phone can be attached to one current lead row, but a parent may have several students and a borrower several accounts: **new related-subject tables are required**. Source: migrations/crm/0001_init.sql.
- **Current phone engine:** src/scripted-phone-pilot.mjs has immutable flow policy **ar3d-fixed-plivo-v1** and a property-specific fixed questionnaire, optional complete tenant R2 MP3 prompt pack, or limited built-in Plivo Polly.Aditi TTS fallback. Customer callback state and CRM capture are property-specific. Sarvam speech recognition, bounded contextual assistance, signed Plivo callbacks, opt-out and hangup handling exist for this reviewed flow.
- **Existing draft scripts are not a universal live voice engine.** src/calling-script-core.mjs compiles text; src/calling-script-routes.mjs saves reviewed/versioned drafts; src/ai-master-templates.mjs defines four property-focused presets. src/agent-settings-routes.mjs explicitly denies PATCH and does not enable any agent for calling.
- **Campaign storage is property-bound:** migrations/crm/0006_campaign_drafts.sql checks purpose in ('property_information','site_visit'). migrations/crm/0011_scripted_campaign_dispatch.sql checks the same clearance purposes. src/scripted-campaign-dispatch.mjs checks one fixed flow_id and all existing carrier, funding and safety reservations.
- **Import:** src/csv-import.mjs and src/xlsx-import.mjs parse limited property-related columns; Excel import does not prove calling permission.
- **Client-owned property inventory:** migrations/crm/0023_property_catalog.sql; current WhatsApp messages and opt-in state use 0024_whatsapp_followups.sql. WhatsApp uses its own Meta connection, template approvals and consent, separate from voice.
- **Safety and billing:** call windows, per-company/global concurrency, verified holds, unknown-provider outcomes, signed callbacks, audit trails, disabled-on-fresh-deploy provider gates and emergency stop already exist.
- **Release evidence:** docs/COMMERCIAL-PRODUCTION-ROADMAP.md still identifies real phone acceptance, backed-up restoration, deletion, consent/DND and operator sign-off as open. Successful CI is NOT real provider or compliance acceptance.

**Consequence:** adding five new templates to src/ai-master-templates.mjs, or saving custom questions, would **not** make those templates run on telephone calls. Engine, schemas, permissions and answer mapping must be extended together.

## 3. Architecture / क्या बदलेगा

~~~text
Client Admin UI: Industry → AI Agents → Data Fields → Flow Builder → Preview
              → Campaign → Results / Calls → Follow-ups
                            |
                Super Admin review, version approval
                            |
                 Safe Flow Compiler (no eval)
                            |
            Immutable publication + approved purpose
                            |
                Pre-dial Policy Enforcement
                (tenant, opt-in, DND, KYC,
                 number/purpose, hours, budget,
                 concurrency and fresh data)
                            |
            Call Runtime (version pinned at start)
               /                |                 \
        Announcement        Interactive         Hybrid
           TTS/MP3       MP3/TTS + STT          both
               \                |                 /
          Signed Plivo callbacks + deterministic events
                            |
       Verified result → tenant CRM → optional permitted follow-up
~~~

Keep **one AR3D Calling Worker** and existing Control/CRM D1 separation for the first phases. Add a typed flow/runtime module; do not use prompt strings as executable instructions. Keep old fixed property path untouched behind its current policy until a verified migration is ready.

Suggested new modules: src/industry-template-catalog.mjs, src/industry-profile-routes.mjs, src/call-flow-schema.mjs, src/call-flow-compiler.mjs, src/call-flow-simulator.mjs, src/call-flow-routes.mjs, src/business-records.mjs, src/data-mapping-routes.mjs, src/industry-policy.mjs, src/voice-renderer.mjs, src/multi-industry-calling.mjs. **These are planned filenames, not files already in the repo.**

### Trust boundaries

1. Industry templates: reviewed, **code-versioned** starting presets, not provider authority.
2. Tenant settings: client-managed drafts (subject to role checks); other clients never see them.
3. Publication: immutable flow revision + industry subtype + purpose + required checks + approved knowledge revision + voice pack.
4. Execution: server-only compiled plan; provider callbacks cannot accept client-supplied scripts or dynamic URLs.
5. Knowledge: approved source facts; external institution API when necessary. LLM suggests bounded interpretations but never grants consent, confirms payment, dials, updates account amounts, or bypasses the state machine.
6. Reporting: verified provider receipts and CRM audit only, not inferred success.

## 4. Core industry template catalog

Template IDs should be **stable** and versioned separately from client copies:

| Template ID | Default mode | Starter fields | Default outcome |
| --- | --- | --- | --- |
| property_enquiry_v1 | interactive | property type/location/size/budget/interest/visit preference | interested / later / declined / needs_review |
| school_admission_v1 | interactive | guardian contact/class/campus/information request | callback_requested / not_interested / needs_review |
| appointment_reminder_v1 | hybrid | appointment reference/date/location/status | acknowledged / reschedule_requested / needs_review |
| finance_due_notice_v1 | announcement or strictly reviewed hybrid | account ref masked/verified amount/due date/pay status | message_acknowledged / disputed / review_required |
| insurance_renewal_v1 | hybrid | masked policy ref/renewal date/renewal status | callback_requested / acknowledged / review_required |

**Do not ship finance/bank as enabled defaults.** Treat regulated verticals as visible **Coming after compliance approval**, with demo-only synthetic preview until number classification, lawful purpose, customer authorization, disclosure, information-sharing and operator sign-off exist.

## 5. Versioned Flow DSL / no arbitrary executable code

The Flow Builder emits *validated JSON*, not JavaScript, SQL, arbitrary HTTP URLs or unrestricted freeform prompts.

Allowed node types in v1:
- greeting
- speak_static
- speak_verified_field
- verify_recipient
- ask_choice
- ask_text_bounded
- branch_exact
- fetch_approved_snapshot
- create_human_task
- save_reviewed_outcome
- end_call

Each node: stable ID, explicit transitions and fixed limits. Compiler must reject missing IDs/edges, unreachable terminal states, unbounded loops, unknown field types, forbidden template variables, dynamic provider URLs, abusive content, and attempts to remove mandatory safeguards.

**School example — conceptual schema, not current API:**

~~~json
{
  "schemaVersion": 1,
  "templateId": "school_admission_v1",
  "mode": "interactive",
  "purpose": "school_admission_enquiry",
  "language": "hi-en",
  "nodes": [
    {"id":"start","type":"greeting","next":"interest"},
    {"id":"interest","type":"ask_choice","field":"admission_interest",
      "choices":["yes","no","later"],"branches":{"yes":"class","no":"end","later":"review"}},
    {"id":"class","type":"ask_choice","field":"class_requested",
      "choices":["1","2","3","4","5","other"],"next":"review"},
    {"id":"review","type":"create_human_task","kind":"admission_callback","next":"end"},
    {"id":"end","type":"end_call"}
  ]
}
~~~

**Finance example — conceptual policy; no live debt information before verification:**

~~~json
{
  "schemaVersion": 1,
  "templateId": "finance_due_notice_v1",
  "mode": "hybrid",
  "purpose": "existing_customer_due_notice",
  "requires": ["permitted_number","customer_authorization","fresh_account_snapshot","recipient_verification"],
  "nodes": [
    {"id":"start","type":"greeting","next":"verify"},
    {"id":"verify","type":"verify_recipient","onVerified":"refresh","onFailure":"generic_end"},
    {"id":"refresh","type":"fetch_approved_snapshot","resource":"finance_account","onFresh":"notice","onUnavailable":"human_review"},
    {"id":"notice","type":"speak_verified_field","fields":["amount_due","due_date"],"next":"end"},
    {"id":"generic_end","type":"end_call"},
    {"id":"human_review","type":"create_human_task","kind":"account_review","next":"end"},
    {"id":"end","type":"end_call"}
  ]
}
~~~

The words spoken before verification must never reveal overdue amount, loan, institution/account details if doing so could disclose private information to a third party. Do not ask for banking PIN, OTP, CVV, full card details, payment credentials or financial account secrets. Do not threaten or use abusive recovery language.

## 6. Proposed additive database architecture

**Do not alter the existing rigid purpose CHECKs in-place as a shortcut.** This repository's migrations and safety checks assume property-only purpose and fixed flow. Use **new parallel structures** and an audited transition. Suggested numbering is provisional; allocate actual next migration numbers at implementation time.

### Control D1 — tenant-level configuration / approvals

| Proposed table | Main fields / invariants |
| --- | --- |
| tenant_industry_profiles | tenant_id PK; industry_code; regulated_subtype; approved_purpose_set; revision; status; updated_by/at |
| ai_flow_definitions | tenant_id + flow_id composite PK; industry_code; display_name; owner; state draft/disabled |
| ai_flow_versions | tenant_id + flow_id + revision; immutable definition_json; sha256; compiler_version; created_by/at |
| ai_flow_publications | tenant_id + publication_id; exact flow/revision/hash; approval references; reviewed_by/at; status; no in-place edit of content |
| ai_voice_profiles | tenant_id + profile_id; approved language; R2 pack path/revision or TTS voice; voice quality and disclosure status |
| tenant_industry_policies | tenant_id + purpose; permitted number class; permitted hours; identity proof tier; purpose status; review expiry/version |

Cross-check current tenant status and operator MFA, and ensure approvals expire/revoke; do not grant rights just by selecting an industry. Flow revision must be pinned to campaign and to call at creation.

### CRM D1 — one contact, many business subjects

Keep **leads** (existing phone and consent identity) and all existing property/site-visit rows unchanged. Add:

| Proposed table | Main fields / invariants |
| --- | --- |
| business_subjects | tenant_id,subject_id PK; lead_id FK; kind property_enquiry/student_enquiry/loan_account/appointment/order; masked external_ref; state; revision |
| subject_field_definitions | tenant_id,kind,field_key; approved type and validation; sensitivity; format; allowed source; display permission |
| business_subject_snapshots | tenant_id,subject_id,revision; encrypted/restricted data; source; verified_at; expires_at; audit ref; immutable history |
| tenant_import_mappings | tenant_id,mapping_id,revision; CSV/XLSX column names -> allowlisted subject/field keys; status draft/approved |
| campaign_flow_bindings | tenant_id,campaign_id; immutable publication reference; purpose; data mapping/revision |
| flow_call_sessions | tenant_id,session_id; job_id; publication revision; subject_id; current node; state; completed/updated_at |
| flow_event_receipts | tenant_id,session_id,event_key UNIQUE; provider callback receipt hash, step/turn, timestamp |
| flow_outcomes | tenant_id,job_id UNIQUE; validated disposition + source/review status; audit references |
| agent_tasks | tenant_id,lead_id/subject_id; type; assignee; source call; status; due_at |

For sensitive financial fields use **integer paise**, typed dates, masked reference IDs, encryption at rest and strict field-level read permissions. Prefer a short-lived server-side authorized bank/NBFC account lookup rather than broad CSV copies of debt balances. Never put raw sensitive datasets in R2 public shares, client JS, prompt logs, WhatsApp variables or generic CRM notes. Data retention/erasure and backups require separate sign-off.

The current UNIQUE(tenant_id,mobile_e164) is **not** sufficient as a loan-account or student identifier; do not remove it. Relate several business_subjects to one lead/contact, and differentiate entities with a tenant-scoped, validated external reference hash. A shared family number does not prove which borrower/child answered.

**Cross-database concern:** The Control and CRM D1s do not support a single cross-database transaction. Use durable IDs, explicit state transitions, idempotency, reconciliation and audit; never pretend two separate DB writes are atomic.

## 7. Data mapping and freshness

1. Import CSV/XLSX in preview-only mode; preserve current file limits and untrusted ZIP/XML safeguards.
2. Client selects industry, record kind and reviewed column mapping. Required fields, type/range and date parsing must be explicit. Example: Name -> contact.name; Mobile -> contact.mobile; Loan Ref -> finance.account_ref; EMI -> finance.amount_due_paise; Due Date -> finance.due_date.
3. Show per-row error counts, same-phone/different-subject count, duplicates, missing data, and current caller permission/DND status **separately**. Never infer consent from upload.
4. Save under tenant scope with stable import batch ID, idempotency key and restricted audit. Map masked account/student refs to many subjects per contact.
5. Before a sensitive call, verify snapshot source and timestamp. Payment completed, dispute open, stale amount, unverified borrower or unavailable authorized API => no detailed statement; mark needs_review.
6. Don't delete or rewrite existing property requirements_json automatically. Offer migration only after review and reversible mapping.

## 8. Proposed API contracts (all authenticated, tenant-scoped, not yet implemented)

| Endpoint | Role | Function |
| --- | --- | --- |
| GET /v1/human/industry-templates | current membership | List reviewed templates and modes; regulated modes marked unavailable |
| GET/PATCH /v1/human/industry-profiles | client_admin draft; Super Admin approval | Industry subtype/profile; optimistic revision check |
| GET/POST /v1/human/ai-flows | client_admin within tenant | Create/list draft-only flows |
| POST /v1/human/ai-flows/validate | client_admin | Validate typed graph, fields, content and warnings; no dial |
| POST /v1/human/ai-flows/simulate | client_admin | Fictional-data dry-run with safe events; no provider |
| POST /v1/human/ai-flows/publish | current-MFA Super Admin | Verify exact revision+hash, purpose/number/disclosure approvals, then create immutable publication |
| POST /v1/human/import-mappings/preview | client_admin | Bounded file parsing and per-row errors; no customer mutations |
| POST /v1/human/import-mappings | client_admin | Save confirmed mapping / import with revision and audit |
| GET/POST /v1/human/campaign-flow-bindings | client_admin (subject to review) | Pin published version to eligible campaign; no dial from binding |
| GET /v1/human/industry-call-results | tenant member with result permission | Verified outcomes and role-redacted subject data |

Integrate under src/human-routes.mjs only after route/method/auth tests. Use current requireMembership and current-MFA patterns. Every mutation must enforce JSON/schema allowlist, payload bound, ETag/base revision and audit. A tenantId query/body is never authority. Do not add a public "start call" shortcut.

## 9. Runtime and provider integration plan

**Stage R0 (no provider):** compile flows into a deterministic, finite node graph; playback uses synthetic data. Save drafts and simulation runs separately; no CRM mutation from a simulation.

**Stage R1 (parallel, no legacy change):** add a new call-flow session type in a separate callback namespace with signed Plivo identity, replay/dedupe, immutable publication hash, purpose/subject binding and per-node idempotency. Preserve the old ar3d-fixed-plivo-v1 in full. No production feature flag enabled by default.

**Stage R2 (approved announcement):** a safe non-sensitive service/appointment notice using approved number, actual recipient permission, verified data and explicit identity/notice policy. End and save minimal outcome. No STT unless needed for verified recipient input.

**Stage R3 (school interactive):** support bounded choice/text capture, retry/human review, Hindi/English audio and validated CRM outcomes. Test guardian identity and child data minimization. No autonomous admission booking or fee promise.

**Stage R4 (finance/banking, separate gate):** integrate a source-authenticated, fresh, purpose-scoped read-only account snapshot with deny-by-default borrower verification. Stale/suppressed/disputed cases never speak dues. Legal/provider compliance and live authorized-number acceptance are release blockers.

**Keep from old scheduler:** fund reservation + provider budget, global/tenant concurrency, per-tenant uncertain outcome lock, verified release, call time windows, consent and DND, signed callbacks, recording notice, immutable evidence and provider-cost reconciliation. Do not replace the per-tenant protections with generic LLM actions. New attempts need a purpose-scoped clearance distinct from old property-only clearances.

## 10. Voice and R2 policy

- Static, reviewed **R2 MP3** for greeting, standard disclosure, fixed prompts, repeat and close; versioned by tenant/agent/language/flow.
- Dynamic customer data uses approved TTS **after permitted identity level**, with sanitized numbers, locale-aware dates/currency and maximum utterance length. Avoid provider voice changing abruptly between pre-recorded and synthesized sections.
- Announcement-only mode should not incur unnecessary STT/LLM cost. Interactive mode keeps bounded question turns, same-turn deduping and manual review after recognition failure.
- Plivo's current Polly.Aditi built-in prompt fallback is not evidence that a client has a complete recorded pack. Show readiness in UI.
- No unrestricted dynamic model output; optional Sarvam context only helps interpret recognized answers against reviewed schema and never supplies facts or decides permissions.
- Recordings, if applicable, require notice, purpose-specific retention and access controls. Do not play other clients' R2 files or expose recorded customer speech publicly.

## 11. Compliance policy engine (operator-reviewed, not legal certification)

Pre-dial evaluation MUST check:
- Tenant, membership, approved publication/flow/purpose and customer identity relation.
- Actual recipient consent or other applicable lawful basis, DND and irreversible opt-out (voice and WhatsApp are independent), source evidence and expiry.
- Approved Plivo caller/number **for this specific purpose/vertical**, authorized telecom route, registration/KYC/DLT and provider terms. An existing Bengaluru 080 voice number does NOT automatically authorize promotional or regulated recovery traffic.
- Purpose-specific local calling window and frequency caps. Default 09:00–20:00 in the existing engine is not a universal allowed window.
- Account data freshness, no sensitive disclosure before verification, global/tenant concurrency, funded minutes and provider balance reservations.
- Human escalation, pause/kill switch, audit and ability to revoke eligibility at any step.

**External verification references (as of 27 Nov 2026; require legal review per regulated client):**
- TRAI commercial voice numbering and 140 promotional vs 1600 service/transactional obligations: https://trai.gov.in/sites/default/files/2025-11/PR_No.135of2025.pdf and https://cms.trai.gov.in/sites/default/files/rti/RTI_June_18072025.pdf
- RBI 2022 recovery-agent obligations including privacy/harassment and restrictions on calls before 08:00 or after 19:00 in specified scenarios: https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12378. Rules differ by institution, loan/product and current directions; do not hardcode one 08:00–19:00 window as universal permission.
- DPDP Rules, 2025 commencement is phased; current privacy/children/guardian requirements and vendor-processing approvals must be reviewed: https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf
- Existing project privacy/restore implementation is **not** a certified live deletion/backup mechanism: docs/PRIVACY-RECOVERY.md.

**Hard exclusions:** no caller-side OTP/PIN/CVV collection, no automated threat/harassment, no disclosure of loans to family/third parties, no inventing EMI/discount/fee/appointment, no unauthorized DND bypass, no promotional upsell in a service call, no unreviewed payment link, no live autopilot for regulated collections.

The owner previously requested **not** to add a WhatsApp invitation sentence to the call script. Preserve that instruction; lawful AI identity/recording disclosures remain independent and mandatory where applicable.

## 12. WhatsApp and reporting integration

Current WhatsApp is property-details / followup / confirmed site-visit oriented. Keep its current Meta setup, actual user permission, approved templates, webhook verification, retries, idempotency, delivery acknowledgement and customer STOP rules. Do not treat voice-call "interest" as WhatsApp opt-in.

Later introduce purpose-versioned message templates and outbox categories for school/appointment/finance, with scope-specific consent evidence and external approval. A phone call does not open a WhatsApp 24-hour customer-service window. Do not allow an uploaded loan spreadsheet to trigger automatic WhatsApp debt notifications.

Reports per client: campaigns, caller purpose, attempted/connected, announcements delivered vs acknowledged, qualified leads, callback tasks, disputed notices, approved opt-outs, human reviews, Plivo cost, Sarvam STT/TTS cost, reserves/settlements and Meta messaging charges **separately**. Provider acceptance is not proof the person heard or understood a notice.

## 13. Client and Super Admin UI

**Client Admin workspace:** Company overview; My AI Agents (industry, mode, draft/published); Flow Builder; Company Knowledge; Contacts; Business Records; Excel Mapping; Campaigns; Voice Library; Test Preview; Calling Results; Follow-ups/WhatsApp; Usage & Costs. Show draft, simulation-only and approved-live states distinctly.

**Super Admin workspace:** Global template registry; publish/revoke review; industry compliance packs; number-purpose authorization; sensitive-data integration registry; provider gates/credit reserves; audit, read-only diagnostics and emergency kill switches. Regulated flows require documented client approval and a distinct AR3D operator reviewer; do not assume current Super Admin alone substitutes for a regulated entity's authorization.

Keep existing dark responsive UI, no duplicate parallel dashboards and no plaintext secrets.

## 14. Proposed work packages / PR order

| PR | Scope | Safe acceptance |
| --- | --- | --- |
| MI-01 | Code-versioned templates + industry profile drafts + mock Flow Builder | Only GET/draft mutations; real estate unchanged; no calling side effect |
| MI-02 | Typed graph schema/compiler + offline simulated outcomes | Property/school/finance fixtures, mandatory safeguards, invalid graphs rejected |
| MI-03 | Additive subject/contact relationships + import field registry/mapping | Multiple accounts/students per contact, legacy CSV untouched, no inferred consent |
| MI-04 | Immutable publications, purpose policies and campaign-flow binding **disabled** | Current-MFA/hashes/tenant isolation; historical versions retained |
| MI-05 | New callback/session route + runtime, synthetic Plivo only | Signed call identity, idempotency, no re-dial on unknown provider result, credit holds intact |
| MI-06 | Non-sensitive service announcement test + dynamic voice under reviewed provider route | Explicitly consented internal acceptance, authenticated proof, known duration/cost |
| MI-07 | School interactive/hybrid pilot + guardian-aware records | Validated results, child data minimization, human callback and negative tests |
| MI-08 | Finance regulated pilot **only after external approvals** | Identity before details, fresh read-only account feed, dispute/payment suppression |
| MI-09 | Domain reports, per-mode costs, scoped WhatsApp templates, recovery/backup/retention | Verified delivery and invoice evidence; load/soak and rollback runbook |

Migrations MUST use the next available numbers, apply only to isolated Calling Control and CRM databases, and pass the existing identity/schema guard before enabling a new Worker. Additions should use safe no-call defaults. No provider, cloud plan, billing, secret or resource is provisioned by a template installation.

## 15. Automated tests and release gates

**Static/Unit:**
- Valid/invalid flow grammar, bounded nodes/turns, conditional branches, cycle detection, approved variables and Hindi/Hinglish/English dates/amounts.
- Dynamic TTS escaping, no unsafe XML, identity-gated fields; mp3 pack readiness; stable version hashes.
- Legacy property survey seven questions and all approved prompts unchanged.

**Database/Isolation:**
- Cross-tenant access and record-forgery negative tests; tenant+subject composite keys; MFA role checks; idempotent import; revision races; one contact with multiple student/loan subject records.
- No accidental data transfer between Control CRM or dedicated tenants; no unencrypted sensitive values in logs / audit; opt-out stays blocked after reimport.
- Concurrent scheduler and minute/funding hold tests; callback retries, duplicate events, simultaneous status updates, unknown provider response.

**Simulation and Browser:**
- School: yes/no/later, grade, branch, uncertain STT, human review.
- Finance: wrong person, shared family phone, paid-but-stale amount, disputed account, no identity proof, callback loss, invalid due date; no debt spoken and no unintended retry.
- Purpose authorization mismatch, expired permission, DND, unsupported 080 number, outside-hours, missing R2, absent Meta templates.
- Desktop/tablet/mobile, full role matrix, no secrets and actual data states vs placeholders.

**Before real calling** (manual evidence, not satisfied by CI):
- Regulated entity/telecom/operator approval, correct caller number purpose and customer consent/DND records.
- One authorized consented real-device call per approved scenario, audible voice review, recording disclosure, verified recipient data, proper stop; incident pause and rollback.
- Current provider tariffs, billed calls, credits, fund reservation/reconciliation, load/soak, backup-and-restore of isolated test resources, retention/deletion plan and security review.
- Legacy property campaigns regression; no automatic re-enablement of anything disabled.

## 16. Explicit go/no-go decisions

1. **Approve now:** MI-01 to MI-04 *draft/simulate only*, industry templates, validated data mapping, role-safe interface. These do not dial.
2. **Gate later:** MI-05/MI-06 behind test flag, explicit operator approval and real-device proof.
3. **Separate regulated release:** MI-08 requires relevant institution's written policies, registration and provider number approval. Do NOT turn on because a finance client uploads data.
4. **Do not change:** old 7-question production policy, live customer call flags, current client budgets/credits, Plivo number assignment, current WhatsApp opening, AR3D Platform/Engine production databases.
5. **Success condition:** a client can create an approved industry-specific flow with validated facts, see a deterministic synthetic call, publish a frozen revision through appropriate review, and ultimately run only explicitly authorized calls with verifiable CRM outcomes and spend.

---

### Repository sources used for this proposal

- docs/ARCHITECTURE.md and README.md
- docs/CUSTOMER-CALLING.md; docs/SMART-VOICE-QA-V1.md; docs/COMMERCIAL-PRODUCTION-ROADMAP.md
- docs/WHATSAPP-FOLLOWUPS.md; docs/PRIVACY-RECOVERY.md
- src/ai-master-templates.mjs; src/calling-script-core.mjs; src/calling-script-routes.mjs; src/agent-settings-routes.mjs
- src/scripted-phone-pilot.mjs; src/scripted-campaign-dispatch.mjs; src/scripted-campaign-routes.mjs; src/index.mjs
- src/csv-import.mjs; src/xlsx-import.mjs; src/campaign-routes.mjs; src/whatsapp-queue.mjs
- migrations/crm/0001_init.sql, 0006_campaign_drafts.sql, 0011_scripted_campaign_dispatch.sql, 0023_property_catalog.sql, 0024_whatsapp_followups.sql
- migrations/control/0001_init.sql, 0011_calling_scripts.sql, 0013_agent_publications.sql

**Document ownership:** architecture proposal, not deploy instructions, operator authorization, legal advice or proof of production readiness.
