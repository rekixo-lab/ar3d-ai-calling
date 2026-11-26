# Provider funding without Worker variable updates

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
