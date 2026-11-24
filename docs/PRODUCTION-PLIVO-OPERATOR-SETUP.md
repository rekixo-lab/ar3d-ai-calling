# AR3D AI Calling — one-time Plivo Production operator checklist

**As of 24 November 2026.** This is for the **single** Production Plivo Voice Application and the isolated `ar3d-ai-calling` Cloudflare Worker. Do **not** change AR3D Engine, AR3D Platform, or Rekixo website resources. **Never paste the Plivo Auth Token, Cloudflare API token, MFA recovery code or real client phone number into GitHub or a chat.**

## What is already confirmed, versus what is not

| Item | Status | Evidence |
| --- | --- | --- |
| AR3D Studio Business KYC | Approved in Plivo Console | Operator's KYC screenshot |
| Number `+918065491333` | Purchased, linked to `AR3D_Production`, KYC Approved | Operator's Purchased Numbers screenshot |
| Caller number in isolated Calling Worker config | Merged into GitHub `main` | PR #143, `wrangler.example.jsonc` |
| Static production Plivo Application Answer URL | Merged into GitHub `main` | PR #142 |
| Hindi internal voice pack `scripted-phone-pilot/hi/` | 12 MP3 names previously visible in private R2 | Screenshot; listen to clips before use |
| Actual Cloudflare Worker deployment | **Not independently verified** | Check GitHub main-push deploy workflow and Worker UI |
| Server-side Plivo Auth ID and Auth Token | **Not independently verified** | Check Cloudflare Worker secret **names only** |
| Phone audio recording auth and pilot recipient | **Not independently verified** | Plivo recording settings and verified owned internal number |
| First real signed Plivo call and CRM result | **Not completed/verified** | Do not claim success from CI or screenshots |
| Provider-approved purpose for other companies / new property leads | **Not verified** | Separate reseller/traffic-category evidence required |
| Spendable tenant wallets and automatic calling | **Not implemented/approved** | Planned credits are not Plivo money |

## Operator — do these once, in this order

### 1. Confirm the deployed Calling Worker is current

1. Open [AR3D Calling production deployment workflow](https://github.com/rekixo-lab/ar3d-ai-calling/actions/workflows/deploy-production.yml). Select the newest **main push** run. Confirm `Run full automated tests`, `Recheck complete safety triggers`, `Inspect isolated Worker secret binding names` and **custom domain smoke** are green. Do not rely on a green PR CI run alone.
2. In Cloudflare, open **Workers & Pages → ar3d-ai-calling → Deployments**. Confirm the latest deployed version corresponds to the current `main` release. The Worker must have **one exact custom domain** `aicalling.ar3dstudio.in`.
3. The production smoke code now sends **one synthetic POST** to `/v1/provider/plivo/inbound-unavailable` and requires immediate Plivo XML Hangup. This never dials or touches CRM. A failure stops the deployment workflow. Do not manually change the Plivo Application Answer URL to a per-call pilot callback.

### 2. Verify Worker binding names and add Plivo credentials privately

Cloudflare **Workers & Pages → ar3d-ai-calling → Settings → Variables and Secrets**. Use **Secret** type for sensitive values. Enter them in Cloudflare directly, **not** in chat/GitHub:

| Binding | Source / required action |
| --- | --- |
| `PLIVO_AUTH_ID` | Your Plivo Console account Auth ID (Worker Secret) |
| `PLIVO_AUTH_TOKEN` | Your masked Plivo Console Auth Token (Worker Secret). Never publish it |
| `AR3D_PLIVO_CALLER_NUMBER` | Already set by guarded Wrangler vars to `+918065491333`. **Do not add a second secret with the same name** |
| `AR3D_SCRIPTED_PILOT_ORIGIN` | `https://aicalling.ar3dstudio.in` (exact origin, no trailing slash) |
| `AR3D_PLIVO_RECORDING_AUTH` | Only enter `confirmed` **after** independently checking that Plivo recording access uses the required authorization and that the internal recipient is informed of recording |
| `LOGIN_RATE_LIMIT_SECRET` / `MFA_ENCRYPTION_KEY` | Confirm the names are present; don't rotate unless part of a reviewed key-rotation procedure |

Check existing Worker bindings `CONTROL_DB`, `CRM_DB`, `AI`, and private R2 `RECORDINGS`; the guarded deployment checks identity. Configure secrets in this **isolated Worker only**. Cloudflare UI will hide Secret values after saving.

In **AR3D Super Admin → Clients → Plivo balance & client credit budgets (operator)** (requires current MFA), use **Check Plivo API & rented numbers**. It must report authenticated Plivo API, an appropriately masked rented caller and the configured caller matching this account. This read-only check is **not** an approved call route or consent verification.

### Fixed Cloudflare Runtime bug: Plivo API was failing before HTTP

In the 24 November 2026 Production incident, the Worker reported `plivo_account_network_error` even though `PLIVO_AUTH_ID` and `PLIVO_AUTH_TOKEN` **Secret names were correctly bound**. The root cause was the **outgoing Plivo fetch configuration**: the Workers Runtime does not support the RequestInit **error redirect mode**, so creating the request threw `TypeError` before reaching Plivo. This is documented by Cloudflare: <https://developers.cloudflare.com/workers/runtime-apis/request/> (Request `redirect` supports only `follow` and `manual`).

The fix uses **manual redirect mode** for all outbound Plivo GET/POST requests in the Calling Worker. Callers explicitly reject non-2xx/redirect responses rather than following 3xx with sensitive Basic Auth headers. The changed areas are account balance/ownership/usage, CDR lookups, Voice API call placement and authorized audio retrieval. The CI source regression test prevents this unsupported redirect mode from being reintroduced.

**Operator after main deploy success:** hard refresh Super Admin → Clients → `Check Plivo API & rented numbers`. You should now see either Plivo API authenticated / configured caller match, or an actionable **real Plivo HTTP status** such as 401, 403, 429, or a genuine network/timeout error. **Do not rotate good Secrets again just because the previous broken Worker showed network error.** No number purchase, callback reassignment, or outbound calling campaign is needed to validate the fix.

### Troubleshooting "Plivo API connection not verified" after Secrets are configured

On the **current deployed** version, go to Super Admin → **Clients → Plivo balance & client credit budgets (operator)** → **Check Plivo API & rented numbers**. The operator-only result now separates runtime Secret presence, syntax, provider HTTP response, network failures and owned-number inventory. The result **never returns raw Auth ID, Token, full number or provider error body**:

| Result | What the operator should do |
| --- | --- |
| `plivo_auth_id_missing` / `plivo_auth_token_missing` | In **Cloudflare → Workers & Pages → ar3d-ai-calling → Settings → Variables and Secrets**, confirm each exact Secret binding name is present **in the deployed Worker**. Save to the correct Worker, check deployment/version, then retry. |
| `plivo_auth_id_format_invalid` / `plivo_auth_token_format_invalid` | Re-enter exact Plivo Home Auth ID or Auth Token in **Secret** type; remove accidental spaces and newlines. Do not disclose their values to chat or GitHub. |
| `plivo_account_unauthorized` / HTTP 401 | The provider rejected that credential pair. Re-check both values were copied from the **same Plivo organization/account**, not an old trial organization or another subaccount. |
| `plivo_account_forbidden` / HTTP 403 | The account exists but Plivo denied this API operation. Review account permissions/support; **KYC status alone does not prove API route access**. |
| `plivo_account_not_found` / HTTP 404 | Confirm the Auth ID and correct Plivo organization. |
| `plivo_account_rate_limited` / HTTP 429 | Stop clicking repeatedly and retry later. |
| `plivo_account_timeout` / `plivo_account_network_error` | Open **Cloudflare Worker → Logs** to check connectivity. The UI does not show credentials or raw provider bodies. |
| `plivo_account_invalid_response` | Plivo returned an unexpected response; check provider status and the deployed endpoint. |
| Account authenticated, but `plivo_number_list_*` | The account works; only the rented-number list failed. The Worker also tries a **read-only GET** for the configured **+918065491333** number without purchasing it. The UI will show whether this individual-number lookup succeeded. |
| `configured caller found` / number `••••1333` | Confirms the connected account owns the selected caller; still not proof of outbound service/transactional authorization or DND/consent. |

If you still see **only** the old generic line `Plivo API connection not verified · number list not available · caller ownership not verified` with none of these detailed reasons, you may still be running **the old Worker version**. Verify the **main-push Cloudflare deploy** and hard-refresh the app before editing credentials again.

### 3. Confirm production Plivo voice application and audio

In **Plivo Console → Applications → AR3D_Production**:
- Type: **Application** (not Plivo AI Agent or SIP Trunk).
- Answer URL: `https://aicalling.ar3dstudio.in/v1/provider/plivo/inbound-unavailable`, method **POST**.
- Hangup URL/Fallback: blank unless explicitly required (if fallback required, use the same no-dial Hangup URL).
- Check **Phone Numbers → Purchased numbers → +918065491333** is linked to `AR3D_Production`.
- Avoid enabling a generic Plivo Default Agent or extra paid AI agent. Outbound AR3D makes separate signed, per-call Answer and Hangup URLs.

In **Cloudflare R2 → ar3d-calling-recordings → scripted-phone-pilot/hi/**, confirm the 11 mandatory MP3s plus optional `repeat.mp3` remain private and listen to opening/closing/one question. The presence/size check alone does not verify clear audio. Each client campaign later needs **its own** approved MP3 pack under `scripted-phone-campaigns/<tenant-id>/hi/`, not the shared internal pilot folder.

### 4. One controlled call from the same Production infrastructure (not a second demo app)

After Plivo confirms the **service/transactional purpose is allowed on this 080 number**, recording permissions are configured and the exact custom domain responds:
- Under the isolated Worker configure `AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER` to a number **you control and have verified** in E.164, with your consent.
- Set `AR3D_SCRIPTED_PILOT_TENANT_ID` to the existing **AR3D Internal** tenant UUID and `AR3D_SCRIPTED_PILOT_LEAD_ID` to the corresponding internal CRM lead UUID whose phone matches that number.
- Only then set `AR3D_SCRIPTED_PILOT_ENABLED=enabled`. **Do not enable** `AR3D_SCRIPTED_CAMPAIGNS_ENABLED`.
- As a current-MFA Super Admin click **Calling Setup → Call the verified internal number once**. Confirm caller ID, Hindi 7 questions, signed Plivo callbacks, recorded answer access, final hangup, CRM result and Plivo Logs/CDR. If anything fails, disable the internal pilot switch and investigate without auto-retry.

This is a **production-stack acceptance check**, not a demo site, extra number or extra AI Agent.

## Do not switch on customer campaigns yet

The rented **080 local number is restricted to authorized service and transactional calls**. A new-lead real-estate marketing campaign is promotional, not made permissible by calling it `property_information` or by selecting the 080 caller. The owner chose not to use a 140 number, so **promotional prospecting through this 080 number is out of scope**. Separate compliance may be required for AR3D acting for other builders (Plivo distinguishes **Direct Brand** from **Reseller**, with separate compliance applications per customer). Never treat KYC/number ownership as consent or DND evidence.

**Keep `AR3D_SCRIPTED_CAMPAIGNS_ENABLED` unset/disabled.** The app intentionally requires a completed signed internal call, provider approval and independently verified customer consent/suppression, appropriate campaign purpose and proper client audio pack before campaign dispatch. Never modify CRM safety triggers to bypass these rules.

The 100/200/300/400/500 AR3D credits are **provisional budget labels**, not actual fundable Plivo minutes. Per-client charged balance, automatic deductions, approved WhatsApp sends and automatic no-answer calls are still separate work requiring carrier/provider/consent and correct currency/funding. Reminders currently prepare drafts only.

## Final acceptance

A production release is accepted only when all of the following hold: GitHub **main deploy** green, Cloudflare Calling Worker up, fixed inbound-safe POST smoke green, protected Plivo account and owned caller check green, private Hindi prompt audio reviewed, one consented internal call shows verified signed provider callbacks and CRM data, and the provider has expressly confirmed the intended permitted service/transactional traffic type. No bulk customer campaign is authorized by this checklist.
