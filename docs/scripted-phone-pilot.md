# AR3D fixed-question phone pilot

AR3D owns the questions, branching, answer validation and CRM update. Workers AI transcribes one short answer at a time. Plivo provides the phone call, plays prerecorded prompts and returns short, authenticated recordings. Cloudflare Workers, D1 and R2 handle the rest.

## Browser pilot

In the client workspace, open an internal test lead and its fixed questionnaire. Start the seven-question voice preview. You can choose a local recording for the current prompt or play it using the browser voice. Record each test answer, check the Workers AI text, and continue. The existing reviewed-save action writes the approved qualification to the selected lead. Browser recordings are sent to Workers AI in memory. AR3D does not store the audio.

## Verified phone pilot

Use a staging Worker and isolated test lead first. Apply the Control D1 pilot migration, bind Workers AI as `AI`, and bind the private R2 bucket as `RECORDINGS`. For the language under test, upload MP3 files under `scripted-phone-pilot/hi/` or `scripted-phone-pilot/en/`. Include `opening`, `propertyType`, `location`, `area`, `size-plot`, `size-home`, `budgetInr`, `interest`, `visitDate`, `closing` and `review`, each with an `.mp3` extension. Use the wording in [fixed-property-survey.mjs](../src/fixed-property-survey.mjs) for question prompts. The opening identifies AR3D, explains the internal test and recording, and asks the recipient to press 1 to continue. The closing and review prompts should describe completion or human review without promising a booking. Keep the files under 512 KiB each. Keep tenant and lead details out of these shared test prompts.

Verify that the Plivo India account and caller number are approved for the internal test. Turn on HTTP Basic Auth for Plivo recordings and verify private access before enabling the pilot. Plivo retains its recordings under its account policy, even though AR3D discards the audio after transcription.

Use Worker secrets for `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN` and the internal identifiers and phone numbers below. Supply the staging origin as an HTTPS origin without a trailing slash.

| Setting | Value |
| --- | --- |
| `AR3D_SCRIPTED_PILOT_ORIGIN` | Exact staging Worker HTTPS origin |
| `AR3D_PLIVO_CALLER_NUMBER` | Approved Indian Plivo caller number in E.164 |
| `AR3D_SCRIPTED_PILOT_VERIFIED_NUMBER` | One verified internal Indian mobile in E.164 |
| `AR3D_SCRIPTED_PILOT_TENANT_ID` | Internal pilot tenant UUID |
| `AR3D_SCRIPTED_PILOT_LEAD_ID` | Lead UUID whose mobile matches the verified internal number |
| `AR3D_PLIVO_RECORDING_AUTH` | Set to `confirmed` after verifying Plivo recording authentication |
| `AR3D_SCRIPTED_PILOT_ENABLED` | Set to `enabled` only for the approved pilot |

A current MFA Super Admin can then start one approved call from **Calling Setup → AR3D Fixed-question Phone Pilot**. The pilot limits destination and duration, and never participates in campaign dispatch. A signed callback must match the authorized call before the question flow starts. Confirm in staging that Plivo returns its V3 signatures and recording IDs, that an authenticated recording is accessible when the XML action fires, and that the approved lead has the expected CRM fields and one audit event. A complete, valid response saves the lead's property fields. Incomplete speech, failed audio access, or a concurrently edited lead requires review.

For production, set the exact origin to `https://aicalling.ar3dstudio.in`. Confirm that the final status is completed and that Plivo’s signed hangup is received. Customer campaigns require a separate flag and the completed pilot for the same account, caller and internal test lead. See [customer campaign setup](CUSTOMER-CALLING.md).

[Plivo XML recordings](https://www.plivo.com/docs/voice/xml/record) · [Plivo V3 signatures](https://www.plivo.com/docs/voice/concepts/signature-validation) · [Cloudflare Workers AI transcription](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/)
