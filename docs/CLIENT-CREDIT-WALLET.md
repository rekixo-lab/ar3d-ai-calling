# Client Credit Wallet — pre-KYC planning (not live billing)

**Status:** Provisional internal INR credit allocations only. Pack choices: ₹0 (no-credit trial), ₹100, ₹200, ₹300, ₹400, ₹500. One provisional AR3D credit is defined here as ₹1 of an internal planning budget, **not** Plivo funds or free minutes. This does **not** top up a Plivo subaccount, move money, establish billing, verify Plivo trial credits as saleable, or allow calls without the pre-existing provider/consent/DND gates.

## User workflow

- **Super Admin → Clients → Create / invite a new client:** choose a **planned** pack of 100, 200, 300, 400 or 500 credits (or 0 for a no-credit trial). A **current Super Admin MFA session** is required for a positive initial allocation. The company, invitation, budget and budget audit are written in one Control D1 transaction.
- **Super Admin → Plivo balance & client credit budgets:** expand operator-only controls. The **Refresh Plivo API balance** action retrieves the Account API's `cash_credits` and account type, using only Worker server-side credentials. It never exposes tokens in API responses or the browser. Select one existing company and set its **total planned INR credit** to one of the same pack amounts with an audited reason; the update is optimistic and detects stale amounts. This is setting an amount, not adding an accidental repeat top-up. Previously configured legacy amounts (for example ₹1,000) remain readable but can only be changed to the new pack choices.
- **Client Dashboard → Company overview:** a provisional ₹ amount is shown **for that client's own account only**. This explicitly says **not spendable**. No API secrets, global Plivo balance or other tenants' figures are visible to clients.
- **No balance data?** The provider preview explicitly says unavailable. It does not manufacture ₹1,000 from the screenshot or assume a USD API balance is INR.

## Plivo live API connection check (no call)

Super Admin (current MFA) → **Plivo balance & client credit budgets (operator)** → **Check Plivo API & rented numbers**. Uses only Worker-side `PLIVO_AUTH_ID` and `PLIVO_AUTH_TOKEN` to make two read-only official requests: `GET /v1/Account/{auth_id}/` and `GET /v1/Account/{auth_id}/Number/?limit=20`. Shows whether authentication succeeded, masked last-four-digit numbers, whether a configured caller matches that first page, and whether Plivo marks voice enabled. No secret value, full provider number, account ID, customer number, recording or PII is sent to the browser.

This diagnostic is **not** a KYC verification, permission-to-call check, number purchase, number configuration, cost reservation or test call. Plivo India compliance status still must be reviewed inside Plivo **Phone Numbers → KYC**; the chosen company traffic classification and rented India caller ID must be independently approved. Never set `AR3D_SCRIPTED_CAMPAIGNS_ENABLED=enabled` merely because this check succeeds.

## Provider distinction

Official Plivo [Account API](https://www.plivo.com/docs/account/api/account) documents `GET /v1/Account/{auth_id}/`, HTTP Basic credentials and `cash_credits` **in USD**. The owner's India-region console screenshot shows **₹1,000 remaining trial credits** and an expiry; these are **not** a verified, unrestricted INR-funded customer balance. An Account API response missing an explicit, documented India billing currency must **not** be converted or represented as an INR-funded pool.

**Fundability is intentionally NOT implemented yet.** Multiple provisional allocations may sum to more than the Plivo account's actual funds, but they cannot be spent, and the UI always explains this. Production must refuse to activate a funded wallet until the provider confirms available nontrial funds, currency/exchange rules, merchant/reseller compliance, India numbers and carrier-approved traffic. Implement a separate, reconciled backing reserve before marking anything spendable.

## On-demand per-call Plivo charge check (read-only)

Client Admin → **Results / CRM → Campaign results & customer answers** may select **Check charge** for an ended call. The Worker reads only the corresponding tenant's completed/failed `calling_jobs` and, when it has a provider-confirmed call UUID, queries the official Plivo Calls API `GET /v1/Account/{auth_id}/Call/{call_uuid}/` with Worker-only credentials. It rejects mismatched origin/destination, account, UUID, direction and malformed amounts; never returns customer phone numbers, provider secrets or call recordings to the browser.

It shows the provider-reported amount and billed seconds, with **currency unverified for the India account**. No INR conversion, budget deduction, automatic charge, client money transfer or call attempt occurs. Unanswered or uncertain submissions do not get automatic redials. Provider authorization, actual CDR settlement and final credit balance accounting remain blocked until KYC/currency and commercial approval are verified.

## Before real client billing or calls

- Confirm the India business account, real currency, balance definition, trial restrictions, legal sales/reseller agreements, and 140 promotional series pricing with Plivo.
- Add durable provider CDR-rated minute accounting and authoritative charges/settlement. Record idempotent per-call debit events and reserve the maximum expected spend at dispatch to avoid concurrent overspend; release unused funds only after a verified final provider CDR. Never deduct costs from unverified callbacks or inaccurate UI minutes.
- Apply positive, currency-matched available funds minus **all existing client reservations** before enabling spend. Reject allocations beyond the backed pool.
- Define billing plans, taxes, refunds, unused-credit expiry and top-ups with operator signatures and audit.
- Preserve the existing provider approval, campaign window, consent, DND and suppression checks. Creating a budget or logging in cannot bypass them.

## Migration and rollout safety

`migrations/control/0020_client_credit_planning.sql` affects only the **isolated Calling Control D1**. Newly initialized empty Control DBs receive it through the existing migration loop. For existing Cloudflare D1s, the guarded `deploy-production.yml` now accepts **only** the exact additive `control_credit_upgrade` and/or `crm_staff_upgrade` states after verifying both Calling database IDs, names, all other tables, CRM safety triggers and private R2. On a green main push it creates only the missing new tables, re-runs full `ready` inspection, then deploys. Any unrelated partial schema or wrong database stops before changes. **Do not apply these migrations to AR3D Engine or Platform**. These migrations do not make credits spendable.

Test with `npm test`, then synthetic Chrome desktop/tablet/mobile checks. Neither these tests nor the read-only Plivo account endpoint attempt a real phone call.
