# Questions, answers and conversation rules

AR3D stores the client's editable opening, questions, approved FAQ answers,
language, follow-up rules and closing as immutable versions. Super Admin and the
company's client admins can save and restore versions. Viewers can only read.
Concurrent editors must refresh rather than overwrite another version.

## Provider connection

Configure these **Worker secrets**, never client-side configuration or Git:

- `EXOTEL_VOICEBOT_ACCOUNT_ID`
- `EXOTEL_VOICEBOT_API_KEY`
- `EXOTEL_VOICEBOT_API_TOKEN`

These are dedicated Voicebot management credentials. When none are configured,
the server can test its existing account API credentials against the same Exotel
management service. Partial dedicated credentials never mix with account keys.
A dashboard session or ordinary CPaaS call credentials are not proof of management
access: use the read-only API test, which never changes the bot. Exotel documents its
management API as chargeable and not enabled for every account by default:
https://developer.exotel.com/docs/voicebot-tools/voicebot-api

In Super Admin → Questions & Conversation Logic → Exotel connection, assign a
dedicated assistant UUID, bot reference UUID and exact assistant source version.
An assistant/bot cannot be assigned to two companies, even with dedicated CRM
databases. Use a single-agent assistant; multi-agent configurations need an
explicit agent-selection integration before they can be modified safely.

“Sync to Exotel” creates a **non-stable assistant version** from the selected
source. It preserves the agent's tools, model configuration and other fields,
updates its instruction, then reads the precise new version back and compares
the instruction. The implementation follows Exotel's official ExotelMCP source:
https://github.com/exotel/ExotelMCP/blob/main/src/main/java/com/example/mcp_api/service/VoiceBotAdminTools.java

## Rollout and truthful status

A sync success means the new assistant version was saved and read back. It
does **not** mean the live bot uses it. The public API does not document a
complete traffic-rollout contract. Select the saved assistant version in the
intended bot, review its other settings, and roll it out in Exotel. Confirm the
live traffic version and make an authorized operator test before claiming live
behavior. Existing live versions are not overwritten by this integration.

An interrupted/ambiguous write enters `unknown` (a crashed request may remain
`sending`) and blocks further provider writes for the company. Inspect Exotel
before an operator reconciles the exact saved version; never automatically retry
an uncertain POST or clear the state solely because a timeout elapsed.

The editable logic is model instructions, not a deterministic state machine.
Opt-out instructions and refusing invented facts are always included. These
prompts do not grant telecom consent, modify CRM consent or confirm bookings.
