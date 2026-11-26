# Client properties and WhatsApp follow-ups

## What this release adds

Clients can maintain their own property catalogue, attach a brochure and photos,
select up to three properties for a campaign, and manage a separate WhatsApp
follow-up workspace. The existing voice questions and consent introduction are
unchanged. A call result, a CSV upload and a voice consent record do not create a
WhatsApp permission record.

The release provides a direct Meta Cloud API adapter and a durable CRM outbox.
It does not create a Meta business account, register a number, attach a payment
method, purchase a messaging plan or fabricate approved templates. A new client
starts with no WhatsApp connection and with automatic rules disabled. The panel
shows that setup is incomplete until an actual account is connected.

## Client workflow

1. Open **My Properties** and add the property name/type, city/locality, address,
   map link, actual price or range with its basis, size/unit, availability and
   salesperson contact. City/locality aliases are optional explicit names, such
   as `Raipur` and `रायपुर`; the matcher does not guess translations.
2. Upload a PDF brochure (up to 10 MB) and up to five JPEG/PNG/WebP photos (up to
   3 MB each). A replacement brochure retires the prior version. Outdated media
   can be removed from use without deleting the historical private object.
3. Select the appropriate available properties for the campaign. Only this
   client's selected inventory can supply a property follow-up.
4. In **WhatsApp**, record existing customer permission using its actual source,
   reference and capture time. This can refer to a website/ad form or a prior
   CRM/customer-message record. Unknown permission stays unknown.
5. Choose compatible approved templates and save rules. Draft rules can be saved
   before connection; enabling automatic sends requires a verified connection.
6. Review scheduled messages and replies in the same workspace. A reply pauses
   prospect follow-ups for salesperson handling. Staff can pause a customer,
   cancel an unsent message and respond during the open customer-service window.

Properties are versioned and all client writes are scoped to their own tenant.
Prices quoted as a unit rate are never silently treated as a total customer
budget. Missing facts or a non-matching property create a review item rather
than an invented offer.

## First Meta connection

This version uses a one-time **Super Admin** technical connection. Client users
can manage their data and follow-ups but cannot view or enter platform secrets.
Self-service Meta Embedded Signup is not implemented in this release; it is a
separate onboarding UI after the platform's Meta app is configured and reviewed.

Use the client's Meta-owned business identity and a registered Cloud API number.
An existing Plivo voice number is not automatically WhatsApp-ready. Keep the
existing voice integration intact while verifying the chosen WhatsApp number.

Complete the appropriate business/number setup and billing in Meta, then provide
the **Messaging account ID**, **Phone number ID**, a production access token
with the required WhatsApp permissions, and the associated **Meta app secret**
in the authenticated Super Admin WhatsApp setup form. Do not put credentials in
chat, source control, CSV files or client-visible configuration. The token and
app secret are encrypted at rest using a tenant-specific key derived from the
existing `MFA_ENCRYPTION_KEY` with a WhatsApp-only cryptographic context.

The connection action checks the account-to-number relationship with Meta and
loads available templates. It does not send a customer message. It returns the
callback URL and verification token for configuring Meta's webhook. Use the
callback **`https://aicalling.ar3dstudio.in/v1/provider/whatsapp`** and subscribe
the app to the client's account's `messages` events. A valid signed incoming
event must be observed before the connection is considered ready for automated
follow-ups. A test inbound message from the operator's own phone can provide
that event. A GET challenge alone does not prove signed event delivery.

The existing encryption key must remain stable across deployments. If it is
rotated, reconnect the WhatsApp credentials through the authenticated setup.

Official setup references:

- https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/
- https://business.whatsapp.com/policy
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/

## Template contract

Prepare templates in Meta WhatsApp Manager and use **Sync templates** after they
are approved. The first version supports six numbered body parameters, with an
optional document header for the uploaded brochure. A plain static text header,
static URL/phone buttons and quick-reply buttons are supported; dynamic headers
and dynamic URL buttons are not.

| Parameter | Property details / follow-up | Confirmed visit reminder |
| --- | --- | --- |
| `{{1}}` | Customer name | Customer name |
| `{{2}}` | Client business name | Client business name |
| `{{3}}` | Selected property name | Explicitly selected visit property |
| `{{4}}` | Current actual price and basis | Confirmed visit date/time in India |
| `{{5}}` | Current property address/location | Visit property address/location |
| `{{6}}` | Property/map/brochure links or salesperson contact | Property/map links or salesperson contact |

Meta determines template approval and category. Promotional property information
must use its permitted category; visit reminders require a compatible approved
Utility template. Merely naming a template "utility" does not qualify it.

## Scheduling and delivery behavior

The default first delay is 10 minutes after a new accepted Interested call
result. The optional second step is 48 hours after the first due time, and it
requires evidence that the first message was delivered and that the customer
has not replied. Existing historical results are not swept when rules are
first enabled or re-enabled. A client can explicitly schedule an individual
message for an existing eligible customer instead.

A visit reminder requires a real confirmed appointment and an explicit
property/campaign association for that visit; a spoken date preference is not
a confirmed appointment. The final send rechecks visit time/status. A cancelled
or rescheduled appointment cannot use the old reminder. A customer reply stops
the generic nurture sequence; expected confirmed-visit communication is handled
separately from that sequence.

The outbox is polled every two minutes in its own Worker invocation, separate
from the existing voice scheduler. The initial batch is deliberately bounded
to one tenant and one send per tick, with clients rotated fairly. This is a
maximum of 30 submissions per hour across the deployment, not a bulk-volume
service promise. The configured delay is the earliest due time; a backlog can
delay delivery. Increase capacity only with a measured D1 query budget or a
separate queue deployment. Daily limits are limits, not guaranteed throughput.

Immediately before an API send, the application checks current tenant/number,
permission, opt-outs, lead state, property availability/revision, template and
applicable rule/visit conditions. Replayed call callbacks have a unique source
key and cannot enqueue the same sequence step twice. Replayed status webhooks
are deduplicated; out-of-order receipts cannot regress a delivered/read state.

An API acknowledgement displays **Submitted**, not **Delivered**. Delivery/read
states depend on signed Meta events. If a network timeout or server error leaves
acceptance unknown, the application displays **Unknown** and does not blindly
retry a potentially delivered message.

WhatsApp billing is separate from Plivo/Sarvam credit snapshots and voice minute
holds. Current message costs and invoices belong to the chosen Meta billing
account. Deploying this feature seeds no credentials, permissions or messages.

## Deployment and verification

The production workflow verifies existing Calling database identities, columns
and voice safeguards before applying additive Control migration 0032 and CRM
migrations 0023/0024. It accepts only the complete reviewed migration groups;
unknown partial schemas still stop deployment. All three additions are
idempotent and do not alter existing leads, voice permissions or balances.

Automated verification uses synthetic data and stubbed provider responses. It
does not send a paid message or call a real customer. A live Meta connection and
an explicitly chosen operator test recipient are required for a later end-to-end
provider delivery test.
