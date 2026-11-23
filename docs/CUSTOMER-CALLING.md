# Customer campaigns

Complete the [verified-number pilot](scripted-phone-pilot.md) before enabling customer traffic. In production, use the exact custom hostname for the signed callbacks. Set `AR3D_SCRIPTED_CAMPAIGNS_ENABLED=enabled` only after the operator approves the carrier account, caller, permitted purpose and recording configuration.

## Company setup

1. Upload the reviewed Hindi or English MP3 prompts to `scripted-phone-campaigns/<tenant-uuid>/<hi-or-en>/` in private R2. Use the [pilot filenames](scripted-phone-pilot.md) and identify the calling company and purpose in its opening. The opening explains recording and asks recipients to press 1 to continue or 2 to stop further calls. Keep every prompt under 512 KiB.
2. Under **Calling Setup → Client calling approval**, a current MFA Super Admin saves the provider approval reference, expiry, daily cap and 180–300 second call limit. Use **Customer clearance** for the permitted purpose with evidence of consent and current DND clearance. Renew these customer clearances after changing the company approval and before recontacting a number.
3. From **Customers / Excel**, the client uploads a CSV or XLSX containing **1–100 unique customer numbers per file** (header excluded), previews it, enters a campaign name and selects its language. Files with 101+ customer rows are rejected by the backend for both preview and commit; Excel uses the same validation. This is an **upload/campaign candidate limit, not free calls, an account-wide monthly allowance or a substitute for approved recipient eligibility**. Calling still uses the independent company daily cap and carrier per-minute billing. **Import & prepare campaign** creates a draft for that file only and opens **Calling**. Use **Start / Resume calling** when ready. A separate **Import to CRM** action saves leads without preparing a campaign.
4. In **Results / CRM**, select the campaign and refresh. Each call's normalized answers appear beside its outcome. **Saved to lead** confirms the CRM update. **Answers captured · lead needs review** preserves valid answers for follow-up when a staff edit or lead restriction prevented an automatic CRM update.

## Fast CRM follow-up actions

- Client Admin → **Customers / Excel → Customer list → Interested leads** now selects the existing Interest status filter immediately (read-only shortcut). Existing user-specific CRM access remains unchanged.
- Client Admin → **Customers / Excel → Site visits** can now reschedule a visit that is `requested` or `confirmed`. The chosen future date/time is saved to the client's own CRM, leaving the visit status unchanged, with an audit entry and stale-update conflict protection. Completed/cancelled visits cannot be rescheduled.
- **No automatic notifications are sent.** Rescheduling does not make Plivo calls or SMS/WhatsApp messages; the staff must inform the customer manually until a separately approved provider integration and opt-in reminder workflow exist.

## Next Actions and easy reports (pre-KYC)

- Client **Company overview → View follow-ups and next actions** opens the **Results** page, showing due follow-ups and upcoming site visits from the client's own CRM.
- **Next Actions** is a read-only task reminder in the dashboard. It highlights staff follow-up dates, visit requests/confirmations, and Do Not Call entries without sending any WhatsApp/SMS or retrying a telephone call.
- **Operations report** now shows interested leads, follow-up leads and already-due follow-ups, alongside campaign/visit counters. These are CRM statuses, not Plivo-verified answers, billed minutes or revenue.
- Future automatic callback and carrier-integrated reminders must require provider-approved routing and independently verified recipient preference and DND status.

## Queue and results

The Worker dispatches on a one-minute schedule within 09:00–20:00 India time. Customers without current clearance stay queued while approved customers proceed. Explicit suppression blocks a customer. It reserves one call at a time per company and enforces the daily cap including failed attempts. Pause or disable company calling to suspend further reservations. A call already being submitted can finish. An uncertain request locks that company's queue until operations confirms its outcome from Plivo and the application audit. The client pauses the campaign, then a current MFA Super Admin verifies the ended attempt in Plivo. After 30 minutes from submission, enter the provider evidence reference and use **Close verified attempt**. The client can then resume the remaining jobs. The closed attempt cannot be dialed again by resuming the same run.

A signed Plivo callback establishes call identity. A successful questionnaire writes tenant-scoped property details and logs one CRM audit event. Partial responses, failed transcription or a concurrently edited lead are flagged for staff follow-up. A proposed visit date is a preference. Recording begins only after pressing 1. Pressing 2 or requesting to stop a campaign call creates a permanent opt-out in the CRM. Review customer consent separately before any further contact.

For an emergency global stop, disable `AR3D_SCRIPTED_CAMPAIGNS_ENABLED`. Existing authenticated callbacks can finish recording the result of a call already in progress.
