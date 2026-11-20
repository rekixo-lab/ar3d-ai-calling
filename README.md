# AR3D AI Calling

Client portal: https://aicalling.ar3dstudio.in/app

Super Admin creates client companies and invitations. Each client signs in to
its own dashboard, uploads a customer Excel sheet with **Name** and **Mobile**,
creates a campaign, and starts/pauses Exotel Voicebot calls. This release adds
the previously missing durable customer campaign dispatcher; it requires
company approval and customer clearances before sending any calls.

## Workflow

1. Super Admin signs in with MFA, creates a shared-storage client, and generates
   its private invitation link. The client sets its own password.
2. Client uploads `.xlsx` (1 MB) or CSV (160 KB), previews it, then imports up to
   200 customers. Duplicate mobile numbers are skipped. Download the CSV
   template and open it in Excel to prepare the two required columns.
3. In **Client Calling Setup**, Super Admin reviews the provider-approved Flow,
   permission evidence and DND checks, chooses daily/duration limits, and
   approves only the covered customers. Approval expires within 30 days.
   Enabling a reviewed trial company's policy activates its software access;
   this does not purchase an Exotel plan or override provider trial restrictions.
4. Client uses **Exotel Customer Calling** to create a campaign from up to 200
   CRM customers (or selects a prepared campaign), then **Start / Resume**.
   Calls run on the server every minute, even after the browser closes.
5. **Refresh call results** shows queued, submitted, completed, failed, blocked
   or unknown states and independently fetched Exotel duration/status.
   Pause prevents future submissions; an already submitted call can finish.

Each company uses its explicitly reviewed Exotel Flow. The managed Exotel
Voicebot handles speech; no separate AI/VPS hosting is required for this path.
The Flow must point to the intended agent and version in Exotel.

## Operational behavior

- India destinations only; calls start 09:00–20:00 Asia/Kolkata.
- One in-flight/uncertain call per company, 1–100 attempts per India day,
  30–600 seconds per attempt, at most 200 customers per campaign snapshot.
- A single atomic D1 reservation checks current policy, lead clearance,
  opt-outs, pauses, number, quotas and in-flight uniqueness before dialing.
- No automatic retries, including busy/no-answer. A timeout, crash after
  reservation, invalid response or provider 5xx can mean a call already
  started: preserve the reservation/unknown state and stop that company's queue.
- Results come from authenticated Exotel Call Details for the registered SID,
  account and caller, rather than trusting browser-supplied status/webhooks.
- Recontact in another campaign requires a clearance reviewed **after** the
  previous reservation. Review Exotel results and record any opt-out first.
- Recordings are not requested. Provider prices, payments and invoicing are not
  implemented. Speech answers remain in Exotel; automatic answer/opt-out import
  is not connected to this dispatcher. Staff must review and record opt-outs
  before authorizing another contact.
- Trial accounts may restrict recipients and caller IDs. Account readiness
  must be checked in Exotel; a code deployment cannot upgrade the account.

## Deployment

`npm test` runs Node + real SQLite isolation tests. Browser checks:

```sh
npm install --no-save --ignore-scripts playwright@1.56.1
npx playwright install chromium
node scripts/browser-e2e.mjs
node scripts/calling-browser-e2e.mjs
```

Main pushes use the existing isolated Cloudflare deployment. CRM migration
`0011_exotel_campaign_dispatch.sql` adds four tables without changing prototype
call/consent/agent guards. The preflight accepts exactly the old complete v10
schema for this additive upgrade, then verifies all four new tables/columns.
Fresh installation also applies the previously omitted Control v9/v10 and CRM
v10 migrations. Mixed/partial schemas are refused.

The Worker template explicitly configures
`EXOTEL_CUSTOMER_CAMPAIGNS_ENABLED=enabled`. This alone creates no campaigns,
policies, clearances or calls. Server-side Exotel SID/key/token/region/caller
bindings, MFA, active tenant, current company policy and per-customer approval
are all required. Set that variable to `disabled` for a global dispatch kill
switch; existing calls may finish at Exotel. Disabling a company policy or
pausing its run stops that company's future submissions.

See [Campaign operations](docs/CUSTOMER-CALLING.md),
[deployment resource isolation](docs/MAIN-DEPLOYMENT.md), and
[historical engineering milestones](docs/ENGINEERING-HISTORY.md).
