# Client Credit Wallet — pre-KYC planning (not live billing)

**Status:** Provisional internal INR credit allocations only. This does **not** top up a Plivo subaccount, move money, establish billing, verify Plivo trial credits as saleable, or allow calls without the pre-existing provider/consent/DND gates.

## User workflow

- **Super Admin → Clients → Create / invite a new client:** choose an initial **planned** rupee amount such as ₹500 or ₹1,000. A **current Super Admin MFA session** is required for a positive initial allocation. The company, invitation, budget and budget audit are written in one Control D1 transaction.
- **Super Admin → Plivo balance & client credit budgets:** expand operator-only controls. The **Refresh Plivo API balance** action retrieves the Account API's `cash_credits` and account type, using only Worker server-side credentials. It never exposes tokens in API responses or the browser. Select one existing company and set its **total planned INR credit** with an audited reason; the update is optimistic and detects stale amounts. This is setting an amount, not adding an accidental repeat top-up.
- **Client Dashboard → Company overview:** a provisional ₹ amount is shown **for that client's own account only**. This explicitly says **not spendable**. No API secrets, global Plivo balance or other tenants' figures are visible to clients.
- **No balance data?** The provider preview explicitly says unavailable. It does not manufacture ₹1,000 from the screenshot or assume a USD API balance is INR.

## Provider distinction

Official Plivo [Account API](https://www.plivo.com/docs/account/api/account) documents `GET /v1/Account/{auth_id}/`, HTTP Basic credentials and `cash_credits` **in USD**. The owner's India-region console screenshot shows **₹1,000 remaining trial credits** and an expiry; these are **not** a verified, unrestricted INR-funded customer balance. An Account API response missing an explicit, documented India billing currency must **not** be converted or represented as an INR-funded pool.

**Fundability is intentionally NOT implemented yet.** Multiple provisional allocations may sum to more than the Plivo account's actual funds, but they cannot be spent, and the UI always explains this. Production must refuse to activate a funded wallet until the provider confirms available nontrial funds, currency/exchange rules, merchant/reseller compliance, India numbers and carrier-approved traffic. Implement a separate, reconciled backing reserve before marking anything spendable.

## Before real client billing or calls

- Confirm the India business account, real currency, balance definition, trial restrictions, legal sales/reseller agreements, and 140 promotional series pricing with Plivo.
- Add durable provider CDR-rated minute accounting and authoritative charges/settlement. Record idempotent per-call debit events and reserve the maximum expected spend at dispatch to avoid concurrent overspend; release unused funds only after a verified final provider CDR. Never deduct costs from unverified callbacks or inaccurate UI minutes.
- Apply positive, currency-matched available funds minus **all existing client reservations** before enabling spend. Reject allocations beyond the backed pool.
- Define billing plans, taxes, refunds, unused-credit expiry and top-ups with operator signatures and audit.
- Preserve the existing provider approval, campaign window, consent, DND and suppression checks. Creating a budget or logging in cannot bypass them.

## Migration and rollout safety

`migrations/control/0020_client_credit_planning.sql` affects only the **isolated Calling Control D1**. Newly initialized empty Control DBs receive it through the existing migration loop. For an existing production Control D1, back up and manually apply the incremental migration after operator review. **Do not apply to AR3D Engine or AR3D Platform databases.** Do not deploy feature code before confirming the migration; the UI will otherwise report that the wallet is not configured.

Test with `npm test`, then synthetic Chrome desktop/tablet/mobile checks. Neither these tests nor the read-only Plivo account endpoint attempt a real phone call.
