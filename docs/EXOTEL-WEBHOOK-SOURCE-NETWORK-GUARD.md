# Exotel Voicebot callback source IP network guard

Updated 20 November 2026. AR3D AI Calling's deployed Exotel Voicebot
`transcript-events` and `session-end` endpoints already require the
private Bearer token, validate the official event schema and store
metadata-only quarantined HMAC receipts; there are no CRM writes, PII
or transcript persistence.

## Optional production CIDR gate, fail-closed when configured

Exotel's [official authentication documentation](https://developer.exotel.com/docs/references/authentication)
advises accepting webhook traffic only from current Exotel source IP
ranges and says to **obtain the current range list from Exotel Support**.
Do not guess public ranges, use DNS lookups as proof, or copy ranges from
unrelated Exotel products/regions or customer screenshots.

After Exotel confirms **this account's actual Voicebot webhook
egress public IPv4 CIDRs for the Singapore region** and the business
approves change control, store a dedicated Cloudflare Worker secret
named:

`EXOTEL_VOICEBOT_ALLOWED_SOURCE_IPV4_CIDRS`

The value is a comma-separated list of canonical **public IPv4 networks**
with prefix /16 through /32, at most 32 entries, e.g. syntactically
`<provider-approved-ip>/32,<provider-approved-network>/24`
(NOT real IP values). Single public IPv4s may omit /32. Private,
reserved/test networks, broad prefixes, duplicate entries and malformed
values are rejected. **Do not put a real allowlist in GitHub, API query,
browser form, support ticket or ChatGPT.**

When secret is entirely absent the Worker maintains the previous
Bearer-authenticated **quarantine-only** behavior. This is **NOT
independently vendor-authenticated**. Once the secret exists in any form,
the Worker requires **both** Bearer and Cloudflare's edge-populated
`CF-Connecting-IP` to match that exact valid allowlist.
Incorrect CIDRs fail closed with a 503; nonmatching or missing IP fails
with a 403. It never reads `X-Forwarded-For` or user-provided
body/network identity. If Exotel sends over IPv6, you must obtain and
implement a separately reviewed IPv6 CIDR policy before enforcing this
IPv4-only guard, otherwise **do not enable** this policy. Never switch
to allow-all to clear a failed probe.

**Protect secrets** by using your private Cloudflare environment and
`wrangler secret put` *only for this Worker* through an authorized
release process after approval. Keep a rollback record and confirm exact
Cloudflare worker/bindings. Never alter the AR3D Platform or Engine.

## Verify without sending calls

1. Confirm vendor-approved ranges and test source format (IPv4 versus
   IPv6) with Exotel Support.
2. Use the Super Admin with a current MFA session:
   **Exotel Webhook Receipt Health** → **Check saved Exotel webhooks**.
   The health response reports only `sourceNetworkPolicy`:
   `bearer_only_quarantine`,
   `cloudflare_ipv4_allowlist_enforced` or
   `invalid_allowlist_fail_closed`.
   CIDRs and IPs are never returned to the dashboard.
3. Run a provider-approved **Test URL** from Exotel, then a personally
   consented operator self-test if needed, and review the real webhook
   receipt counts, source-IP guard status and Exotel Interactions.
   Test URL probes are ACKed but not saved as customer events.
4. A matching IP + Bearer shows *network authorization* only:
   `sourceVerified` remains `false`.
   A service proxy, NAT, compromised token or nonexclusive egress can
   still send data; verify call identity independently via Exotel Call
   Details. Do not import transcripts into a customer CRM based on IP.
5. If the vendor changes egress IPs, an invalid/missing IP produces an
   error. Update only after independently confirming the new approved
   ranges. No drop of the CRM's existing no-call/no-consent triggers.

## Acceptance and non-goals

Run `npm test` and Chrome desktop/tablet/mobile E2E.
Tests verify exact CIDR canonicalization, nonpublic IPv4 rejection,
forged X-Forwarded-For, missing edge header, Bearer enforcement,
invalid config, duplicate quarantined deliveries and no PII/CRM writes.

This guard does **not** implement Exotel vendor-signed HMAC, caller
consent/DND, 140/1601 legal traffic approval, approved provider
CallSid-to-tenant/lead binding, production transcript processing,
customer campaign dispatch or billing. All customer calls remain
blocked; only the existing separately approved operator self-test
can initiate a real call.
