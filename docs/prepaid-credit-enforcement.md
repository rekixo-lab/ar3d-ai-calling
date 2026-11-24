# Prepaid calling enforcement (phase 1)

One credit means one billable calling minute; integer seconds are stored, with no expiry or monthly reset. India-region 30-second pulse must be verified against actual account CDRs before launch. A new call is limited to the lowest full billing pulse of the approved per-call limit, uncommitted tenant seconds and remaining shared funding. The reservation and Plivo time_limit are identical. The existing consent, DND, time window, policy expiry, tenant activation, concurrency and operator approvals remain mandatory. No automatic commercial launch.

Before approving dispatch, the operator must set THREE independently reviewed cumulative second ceilings:
- AR3D_FUNDED_CUMULATIVE_SECONDS (combined risk ceiling)
- AR3D_PLIVO_FUNDED_CUMULATIVE_SECONDS
- AR3D_SARVAM_FUNDED_CUMULATIVE_SECONDS

Missing/invalid values fail closed. Use verified nontrial funds, conservative worst-case unit costs, pending commitments, internal test expenditure and a safety buffer. Do not reset cumulative ceilings on recharge; include previously committed/settled campaign seconds. These are capacity budgets, NOT actual cash balances or a full independent provider money ledger. The effective cap is their minimum. No FX estimate is acceptable funding evidence.

Further required: append-only provider recharge/expense ledgers, verified per-provider metering, budget reservation atomic with tenant holds, exception recovery, payment records and reconciled statements. Production provider invoices, actual India pulse, customer consent and carrier classification remain unverified. Do not enable the campaign, auto-settlement or credit-only flags merely because code tests pass.
