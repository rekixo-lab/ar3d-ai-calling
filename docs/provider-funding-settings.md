# Provider funding without Worker variable updates

## Current workflow: manual available-balance sync

The owner-selected workflow is **Super Admin → Dashboard → Sync Plivo balance /
Sync Sarvam balance**. Copy the provider console's **full current available INR
balance**, including any remaining old credit. Paste it into the corresponding
Sync dialog. A sync replaces the previous observation; it never treats the full
total as an additional recharge. Both providers have the same workflow. There is
no recurring funding variable, budget variable, receipt entry or deployment step.

Use **Enable client calling** once to record the authenticated owner's activation
for all current active/trial companies. The action activates the app company and
sets client-declared customer consent, a 180-second maximum and a 365-day policy.
It does not recharge a provider, change the Plivo account plan, start a draft,
allocate client minutes, or assert recipient consent. Suspended companies remain
suspended. Clients upload CSV / enter numbers, declare their actual consent
source, select their campaign and start it. Opt-outs and blocked DND entries stay
excluded. A client must still have sufficient allocated calling minutes.

The authenticated owner action is the application activation record. It is not
a claim that the carrier has supplied written permission. Existing configured
caller credentials, provider restrictions, signed internal test, recording
notice, caller eligibility and customer consent checks continue to apply. When
a per-company recorded question pack is absent, manual mode can use Plivo's
built-in Hindi/English Speak voice with the company name, AI/recording disclosure,
keypad consent and the same seven-question flow. Existing private recordings
remain preferred; the internal test flow is unchanged.

### Remaining balance and call accounting

The cards show the last pasted balance and an **estimated available** balance
after new usage and outstanding call reservations. The latter is not a live
provider reading. Separate budgets for Plivo and Sarvam, plus client minutes,
determine the longest affordable call in complete 30-second pulses. The maximum
is shortened to 30/60/etc. seconds when necessary; there is no fixed cash reserve
or percentage cutoff. Either provider having insufficient funds prevents a new
call. Existing unknown submissions stay held and are never redialed on a sync.

Default estimates are versioned in `src/manual-calling-costs.mjs`:

| Provider | Allowance per 30 seconds | Basis |
| --- | ---: | --- |
| Plivo | ₹0.2242 | Published India domestic ₹0.38/min, plus an 18% tax allowance |
| Sarvam | ₹0.3068 | Published ₹0.49/min STT plus ₹0.03/min planning allowance for LLM, plus 18% |

These are estimates, not account-specific prices or guaranteed maximum costs.
The Sarvam token amount can exceed its planning allowance. Complete measured
STT seconds and tokens update estimated settled usage, and verified Plivo billed
seconds reduce unused time reserves. Missing/failed/in-flight speech metrics
retain their full money reservation. Exact evidenced reconciliation takes
precedence. No estimate is inserted as a provider invoice or client cash debit.
Do not promise exact exhaustion to ₹0: provider billing pulses, pending charges
and external spending can differ from the app's estimate.

Official pricing checked 2026-11-26:
[Plivo India](https://www.plivo.com/voice/pricing/in/) and
[Sarvam API pricing](https://docs.sarvam.ai/api/getting-started/pricing).
Plivo's raw Account API USD value is never multiplied by an exchange-rate guess
or relabeled as INR. The owner supplies INR directly from their account console.

### Replacement, concurrency and fault recovery

Each sync has a UUID and the previous provider snapshot revision. An uncertain
network retry reuses the exact UUID and payload; stale editors must refresh and
paste again. Snapshot, audit and liability coverage are transactional. Only
settled calls closed at least 60 seconds earlier are covered by the new balance;
running, unknown and recently closed calls remain reserved. Covered call
identities are immutable, so later cost reconciliation cannot mint capacity
from a numerical baseline or charge historical calls a second time.

Atomic reservations recheck the enablement revision, both provider snapshot
sequences, current shared provider costs and client minutes. Concurrent clients
cannot consume the same remaining budget. Copied zero is accepted and pauses new
calls. A new positive sync can recover a billing-only HTTP402 fault; it cannot
hide an unresolved authentication, route or cost-over-reserve fault. Explicit
manual disablement survives later balance syncs. An explicit owner activation
can enable it again. Matched CDR settlement runs automatically in manual mode;
it does not need another environment approval variable.

Migration `0031_manual_provider_balances.sql` adds observations, covered-call
identities and enablement control, without seeding balances or activation. The
production workflow applies it to the exact prior schema or a fresh database
and verifies the immutable/revision guards. Manual mode takes precedence over
both older journal settings and environment ceilings, including when disabled.

## Legacy journal workflow

The remaining sections describe the older receipt-based mode for installations
without manual-balance control. They are not additional setup steps for the
Dashboard workflow above. Its rate form is hidden while manual mode is active.

Super Admin → Credit transactions → **Provider funding setup** stores reviewed
provider costs in Calling Control D1. In recorded-funding mode, the Worker
derives both monetary limits and available calling seconds from the immutable
provider financial journal. Recording a recharge does not require changing
Cloudflare variables or deploying the Worker.

## What is and is not automatic

- Recorded opening balances, recharge receipts, refunds, expenses and call
  reservations automatically change calling capacity.
- Queued work remains subject to client credits, company approval, consent,
  provider safety, the calling window and the existing dispatch switches.
- Neither provider is charged or recharged by this feature.
- Provider recharge detection is **not connected**. A Super Admin must record
  each actual receipt or use the existing Sarvam dashboard balance sync.
- A successful speech request and a provider account balance preview are not
  funding transactions. They cannot add credits to this journal.

## One-time setup

1. Confirm paid, usable provider funds and the currencies on the actual account.
   Do not use a trial credit or an example amount as commercial funding.
2. Record the actual opening funds and receipt references in **Provider
   financial journal**, once in the correct currency. If the existing journal
   already contains those funds, review it rather than entering them again.
3. In **Provider funding setup**, select the independently confirmed Plivo
   currency and enter conservative maximum costs for each 30-second call pulse.
   Sarvam uses INR and its allowance must cover STT and all bounded AI
   clarification requests. Include relevant taxes and fees. These are maximum
   cost allowances, not an invented account tariff.
4. Enter the evidence reference, review the paid-funds statement and save.
   Saving performs a read-only Plivo Account check and requires a paid prepaid
   account with positive credits. The check does not establish caller-route or
   customer consent approval.
5. Review Calling Setup for the company and client calling state. Enabling this
   funding source does not supply a missing carrier approval or start a campaign.

After a recharge, record the receipt or sync the actual Sarvam **Credits Left**
value. Limits are then recalculated on the next request/cron invocation. No
funding environment variable or deployment change is needed. Change reviewed
pulse costs when the provider tariffs or application cost bounds change.

## Accounting and concurrency

The money envelope equals recorded incoming funds minus expenses not already
attributed to a call. Attributed expenses are deducted by the reservation
accounting exactly once. Held and uncertain calls retain their full reserves;
settled calls also retain their reserve until exact provider expense evidence
is attributed. Consequently the displayed spendable capacity is conservative
and may be smaller than a provider dashboard's balance.

Time capacity is derived from the remaining money plus existing time
commitments. It is not a separately replenished lifetime ceiling. Both providers
must have matching-currency records and reviewed costs. Mixed currencies,
invalid totals and unavailable records block managed funding.

Each atomic reservation rechecks the settings revision and journal sequence,
in addition to current money/client holds and provider fault state. A stale
browser or cron invocation cannot reserve against an older, larger allowance.
Exact receipt duplicates remain rejected by the provider journal. Recording
funds never clears authentication, billing or over-reserve safety faults, and
never retries an uncertain submission.

The settings update uses current Super Admin MFA, same-origin requests, revision
compare-and-set and a transactional audit record. **Disable journal funding**
retains the disabled row. Old environment values cannot reactivate calling.
Legacy environment limits remain supported only when no settings row exists.

## Provider API limitation

Plivo's official [Account API](https://www.plivo.com/docs/account/api/account)
documents `cash_credits` as USD. It distinguishes a `standard` paid account from
a `developer` trial, and prepaid from postpaid billing. This integration never
labels that observed USD value as INR or converts it into a journal receipt.

Sarvam documents an organization-wide prepaid balance in
[Settings → Billing](https://docs.sarvam.ai/api/platform/billing). A supported
balance/recharge API was not verified in its current public
[API reference index](https://docs.sarvam.ai/api-reference/llms.txt). Until an
authenticated provider billing source is available, an admin update is required
after a recharge. Fully unattended wallet reconciliation remains separate work
tracked by issue #207.

## Deployment

Migration `migrations/control/0030_calling_funding_settings.sql` adds only the
isolated Calling Control settings table and its revision/no-delete guards. It
seeds no money, costs or activation. The production workflow recognizes the
exact preceding schema, checks existing safety guards, applies the additive
migration, and deploys with existing runtime variables retained.
