# Shared client calling connection

Normal client onboarding belongs entirely in AR3D. A client saves company details
and questions, publishes its assistant, uploads contacts and starts an approved
campaign. It does not create an Exotel account, bot, phone number or call flow.

The platform has one shared bot/flow with the tested Hindi/English speech pipeline.
Its default assistant is a generic routing guard with no client business facts.
The one-time gateway configuration and rollout remain Super Admin engineering
settings; a successful authenticated verified-phone routing test marks it ready.

Each publication creates a distinct immutable provider assistant containing only
that tenant's company/profile and conversation revision. Model configuration comes
from a trusted single-agent template; templates with tools/sub-agents are rejected.
Unknown provider writes lock additional publications until reviewed. No API key or
webhook credential is returned to the browser.

An accepted outgoing call registers an HMAC fingerprint of its provider CallSID
against its tenant, campaign job and publication. The Session Start callback must
present the existing Bearer credential, match the shared bot and registered call,
and independently pass authenticated Exotel Call Details checks for account,
caller, destination and outbound in-progress status. Its lookup never trusts a
callback-supplied tenant or lead ID. The response chooses that publication's
assistant and greeting. Checks share a 2.5-second startup budget.

Customer dispatch requires the latest published company/script, the reviewed
shared flow, an authenticated live provider configuration, existing calling
approvals and lead clearances. Uncertain dispatch/routing never automatically
redials. Gateway tests use only the privately configured verified operator number.

Conversation-result persistence and the simplified account/reporting interface
are separate application workflow changes; this connection alone does not claim
that customer transcripts or structured answers have been stored in CRM.
