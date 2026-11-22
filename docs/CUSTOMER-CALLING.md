# Customer campaigns

Complete the [verified-number pilot](scripted-phone-pilot.md) before enabling customer traffic. In production, use the exact custom hostname for the signed callbacks. Set `AR3D_SCRIPTED_CAMPAIGNS_ENABLED=enabled` only after the operator approves the carrier account, caller, permitted purpose and recording configuration.

## Company setup

1. Upload the reviewed Hindi or English MP3 prompts to `scripted-phone-campaigns/<tenant-uuid>/<hi-or-en>/` in private R2. Use the [pilot filenames](scripted-phone-pilot.md) and identify the calling company and purpose in its opening. The opening explains recording and asks recipients to press 1 to continue or 2 to stop further calls. Keep every prompt under 512 KiB.
2. Under **Calling Setup → Customer Calling Approval**, a current MFA Super Admin saves the provider approval reference, expiry, daily cap and 180–300 second call limit. Use **Review customers for calling** for the permitted purpose with evidence of consent and current DND clearance. Renew these customer clearances after changing the company approval and before recontacting a number.
3. From **Customers / Excel**, the client imports the matched Name and Mobile columns. In **Calling**, the client creates a campaign, selects the language with uploaded prompts, and uses **Start / Resume calling**. Existing bilingual drafts require a new Hindi or English campaign. New campaign runs never inherit a legacy provider run.

## Queue and results

The Worker dispatches on a one-minute schedule within 09:00–20:00 India time. It reserves one call at a time per company and enforces the daily cap including failed attempts. Pause or disable company calling to suspend further reservations. A call already being submitted can finish. An uncertain request locks that company's queue until operations confirms its outcome from Plivo and the application audit. Operations must never resubmit an uncertain call based on a timeout alone.

A signed Plivo callback establishes call identity. A successful questionnaire writes tenant-scoped property details and logs one CRM audit event. Partial responses, failed transcription or a concurrently edited lead are flagged for staff follow-up. A proposed visit date is a preference. Recording begins only after pressing 1. Pressing 2 or requesting to stop a campaign call creates a permanent opt-out in the CRM. Review customer consent separately before any further contact.

For an emergency global stop, disable `AR3D_SCRIPTED_CAMPAIGNS_ENABLED`. Existing authenticated callbacks can finish recording the result of a call already in progress.
