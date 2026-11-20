# Call-intent proposal registry — isolated CRM v10, strictly NO DIAL

This milestone creates **durable blocked proposals only**, tying an existing
Client Admin draft campaign to its existing tenant-owned lead. It is not an
Exotel call ledger, not a telecom permission record, and cannot initiate calls.
It is intentionally separated from the existing successful *operator's own*
Exotel self-test; the latter never maps to a customer lead.

## Workflow

1. Client Admin signs in, selects their active tenant and opens
   **Calling Campaign Drafts — not executable**.
2. Create a draft and add a lead. A denied/DND-blocked lead cannot be added.
3. In **Candidates in selected draft**, select that lead and click
   **Record blocked call intent for selected candidate (no call)**.
4. A browser confirmation is required. The Worker only accepts
   \`{tenantId,campaignId,leadId,acknowledgeNoDial:true}\`.
5. The Worker re-checks the correct tenant, a *current existing* draft candidate,
   the lead's current denial/blocked state and recorded opt-out history in the
   **same atomic SQLite INSERT ... SELECT**; any mismatch, duplicate or
   suppression is rejected. It writes a scoped immutable blocked proposal
   and a tenant audit event in one database batch.
6. The list shows each tenant proposal's campaign, truncated lead reference,
   purpose, always-\`blocked\` status, current consent/DND and opt-out flag,
   **not the phone number**.

The proposal is not a provider order, does not place even one call, does not
grant consent, and never stores the customer phone, conversation, account SID,
provider CallSid, recording or transcript. The enum/CHECK in CRM v10 prevents
anything but \`state='blocked'\`; an immutable update trigger forbids status
upgrades or post-hoc tampering. Existing \`trg_no_call_launch\`,
\`trg_block_unverified_consent_*\` and \`trg_agents_block_active_*\` continue to
reject real customer calls and agent activation.

**API:** \`GET /v1/human/call-intent-proposals?tenantId=<UUID>&limit=25&offset=0\`
requires active tenant membership; \`POST /v1/human/call-intent-proposals\`
requires Client Admin plus same-origin session and explicit no-dial
acknowledgement. No PUT, PATCH, DELETE, approve, dispatch or bulk API exists.
No verified consent status can be inferred from the presence of a proposal.

## Production migration / safety

\`migrations/crm/0010_call_intent_proposals.sql\` adds one table, one index
and two new guard triggers in the **isolated Calling shared CRM** only.
Existing leads/campaigns and all older triggers are untouched. The guarded
main preflight permits exactly ONE additive state, previously complete v9
plus this one missing table (no other missing table/trigger/column).
It runs this migration only against the validated Calling CRM D1, then
verifies all required columns and ALL no-dial/consent/agent and proposal
guards *again* before Worker deployment. Partial or mixed schemas refuse
automated deployment. Fresh isolated CRM initialization includes v10.

Dedicated D1 tenants need a separately reviewed per-tenant migration and
binding validation before using this endpoint; the shared CRM procedure
does not mutate any dedicated tenant DB. This is particularly important if
there are any dedicated tenants: do not assume cross-DB deployment.

## What remains before real customer production

- Exotel-approved commercial entitlement, correct Indian numbering/traffic
  classification, compliant KYC and authorized ExoPhone.
- Independently verified recipient consent, current DND and suppression,
  lawful purpose and local time windows (no inference from past enquiry).
- A **separate authorized-call registry** with live consent evidence,
  registered tenant/lead/number, Exotel account/leg/flow/caller ID,
  provider-read-only Call Details confirmation and bounded dispatch.
  A blocked proposal must NEVER be promoted directly.
- Independently authenticated vendor webhook source, replay-resistant
  per-turn transcript storage with encryption and bounded retention,
  mandatory staff review, opt-out/escalation and data deletion.
- Real provider/usage billing reconciliation, financial caps, remote
  D1/R2 backup and isolated restore drill, support/incident response,
  privacy and controlled human pilot approvals.

Run \`npm test\` plus desktop/tablet/mobile Chromium CI. After a green
guarded production deploy, open the Client Admin screen with a fictitious
trial tenant to verify blocked proposals; no real customer number test is
needed. Do not modify AR3D Platform or AR3D Engine.
