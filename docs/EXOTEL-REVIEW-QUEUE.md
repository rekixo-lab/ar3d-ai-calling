# Exotel Voicebot human-review queue (provider-dependent staged integration)

Date: 20 November 2026. Only the standalone AR3D AI Calling project is in scope.
This does NOT turn on actual outbound telephony, callbacks, commercial consent, or DND clearance.

## Purpose

The seven-question Voicebot parser has a provisional structured output. A
future trusted Exotel adapter may stage independently authenticated and
correlated results in the new tenant-safe CRM v9 review table. The Client Admin
can view, apply with a current lead revision, or dismiss these proposals. A
possible opt-out cannot be dismissed until the existing CRM Do Not Call
suppression is set to denied/blocked. The resulting fields never
automatically confirm a site visit or change telecom calling permission.

No provider-produced results can enter this queue yet. The staging helper is
internal and intentionally is not an HTTP endpoint. An inbound webhook
without independently verified vendor identity, call registry and tenant/lead
mapping must stay rejected. Exotel Account SID and API keys alone do not
authorize a callback, dialing or CRM writes.

## Storage and privacy

CRM v9 adds voicebot_qualification_reviews with composite tenant-to-lead FK,
immutable vendor reference/digest and compact provisional survey, unique
per-tenant call reference and irreversible final state. Raw call transcripts,
phone number and Exotel API secrets are not stored in the review table or
returned to the browser. Call and AI-agent activation triggers and
unverified consent/DND denial triggers are unchanged. Staff review uses a
transactional update, checks lead revision and writes an audit record.

### Controlled migration

The standalone production deployment preflight recognizes only one additive
old-CRM state: all existing CRM tables and original protection triggers present,
with just voicebot_qualification_reviews absent. It can run the isolated
migrations/crm/0009_voicebot_review_queue.sql after CI is green, then MUST
recheck the complete schema, both new review triggers, existing no-call
triggers, and exact Cloudflare D1/R2 identities before deploying the Worker.
Any other partial/mixed schema stops. This workflow does not target AR3D
Platform or Engine assets. Back up existing production D1 before operations
that may involve real customer data.

## Required Exotel-specific integration before first real callback

1. Confirm business account/Managed Voicebot entitlement, approved caller
   number and legally applicable traffic registration and consent/DND workflow.
2. Obtain real vendor webhook samples and Exotel-supported source
   authentication policy, retry headers, delivery ID format, and trusted
   server lookup for Call Details. Never invent an undocumented HMAC format.
3. Build authenticated durable incoming event staging with rate/size limits;
   match only previously authorized server-created call intent to the
   correct account, tenant, lead and approved caller ID.
4. Independently reconcile customer preference / opt-out. Reject events with
   unresolved identity, recording consent or DND status. Treat non-final
   transcript turns as untrusted. Prevent replay/conflicting sequences.
5. After a human-reviewed qualification, only the CRM data is updated. A
   site-visit request requires staff scheduling confirmation. Monitor
   provider outcomes, spend and error rates with explicit rollback controls.
6. Require Super Admin MFA, retention, disaster-recovery rehearsals,
   security review and an operator-approved, consented end-to-end pilot.

All live dial paths remain disabled at source and by D1 call-launch
triggers. Tests operate on synthetic data; green CI is not go-live approval.
