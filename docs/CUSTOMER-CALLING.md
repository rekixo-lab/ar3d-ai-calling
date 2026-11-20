# Customer calling operations

## Concrete release scope

The customer dispatcher uses Exotel's [Connect with Flow API](https://developer.exotel.com/docs/agentstream/connect-voice-ai-flow),
Basic authentication, server-owned destination/caller/Flow, recording off, and a
persisted pre-submission reservation. It uses [Call Details](https://developer.exotel.com/docs/voice-v1/api-reference/call-details)
for result reconciliation. It neither assumes a browser API request is a call
completion nor automatically retries an ambiguous provider response.

The earlier GO/NO-GO engineering panel and historical docs describe the
prototype path and commercial readiness, not this new operator-reviewed
campaign path. Existing `calls`, `agents`, consent and webhook-quarantine
protections remain intact. Actual campaign records live in `calling_runs` and
`calling_jobs`. Overview counts include reserved campaign attempts.

## Setup and launch

- Preserve existing Exotel secrets; do not copy keys into client UI or GitHub.
- In a current MFA Super Admin session, create a client and issue an invitation.
- Review the actual caller, provider account restrictions and intended Voicebot
  Flow before enabling that client's policy. The Flow and its prompt/version
  are selected in Exotel, not by the client browser.
- Select only leads covered by a specific consent reference and current DND
  check. Choose the campaign purpose, expiry, daily attempts and max seconds.
- The client imports its own sheet, makes a campaign and confirms Start.
  Existing campaign planning APIs can select individual customers instead.
- Each campaign's first Start snapshots its candidates once. Start retries
  reuse the same run; Resume never adds new candidates. A completed campaign
  stays completed. Create a new campaign for an explicitly reviewed recontact.
- Recontact requires a newer clearance than the last reservation. Review the
  previous Exotel interaction and record Do Not Call in the existing CRM action
  before approving further contact. This release does not ingest speech answers
  or automatically detect spoken opt-outs in the dispatcher.

## Incident actions

Pause the run or disable company calling to stop future calls. To stop all new
submissions set `EXOTEL_CUSTOMER_CAMPAIGNS_ENABLED=disabled` on this Worker.
These actions do not hang up a call already accepted by Exotel.

`reserved` after a Worker crash or `unknown` after a timeout means dispatch
might have happened. Never clear the state or retry just because the UI lacks
a result. Check the corresponding time/destination in Exotel and retain its
provider record. The queue deliberately stays locked until an operator resolves
the incident with provider evidence. There is no UI force-reset button.
A submitted call whose status cannot be verified also blocks the next call.

Limits count reservations, including failed/unknown attempts, to bound spend.
Usage shown is attempt count/duration, not an invoice. No payment gateway is
required for an operator-run pilot.

## Rollout evidence, 20 November 2026

Read-only Exotel UI review found a free-trial account, an existing Voicebot Flow
and live agent version v4 with one 3m21s historical interaction. Configure can
show an older stable assistant even while another version receives 100% of
traffic. A new seven-question property survey version was saved as paused v5,
0% traffic; the existing v4 allocation was preserved. Review/test the chosen
version before changing live allocation. No customer calls were started during
this implementation.

## Verification

`tests/calling-campaigns.test.mjs` uses actual Control+CRM migrations and SQLite,
with a fake Exotel transport. It checks admin/client/viewer isolation, current
MFA, duplicate reservations, verified results, pause/expiry/window/kill switch,
opt-out/missing clearance and uncertain response lockout. Browser acceptance
runs the real Worker routes backed by migrated SQLite on localhost, uploads a
synthetic CSV, creates a campaign, starts/pauses/resumes it and refreshes results.
No test uses a real provider destination or private account credentials.

Live acceptance still requires an explicitly selected verified recipient,
provider-permitted trial/production caller, chosen agent version and a real
conversation check. Passing automated tests is not evidence that those
account-side steps happened.
