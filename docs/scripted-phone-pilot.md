# AR3D fixed-question phone pilot

AR3D owns the questions, branching, answer validation and CRM update. Workers AI transcribes one short answer at a time. Plivo provides the phone call, plays prerecorded prompts and returns short, authenticated recordings. Cloudflare Workers, D1 and R2 handle the rest.

## Browser pilot

In the client workspace, open an internal test lead and its fixed questionnaire. Start the seven-question voice preview. You can choose a local recording for the current prompt or play it using the browser voice. Record each test answer, check the Workers AI text, and continue. The existing reviewed-save action writes the approved qualification to the selected lead. Browser recordings are sent to Workers AI in memory. AR3D does not store the audio.

## Verified phone pilot

Use a staging Worker and isolated test lead first. Apply the Control D1 pilot migration, bind Workers AI as `AI`, and bind the private R2 bucket as `RECORDINGS`. For the language under test, upload MP3 files under `scripted-phone-pilot/hi/` or `scripted-phone-pilot/en/`. Include `opening`, `propertyType`, `location`, `area`, `size-plot`, `size-home`, `budgetInr`, `interest`, `visitDate`, `closing` and `review`, each with an `.mp3` extension. Use the wording in [fixed-property-survey.mjs](../src/fixed-property-survey.mjs) for question prompts.

**Optional natural retry cue:** record an extra `repeat.mp3` in the same language folder, saying in Hindi `माफ कीजिए, आपकी बात स्पष्ट नहीं हुई। कृपया दोबारा बताइए।` (English: `Sorry, I didn't catch that. Could you please say it again?`). On an unclear spoken answer, the verified signed callback plays **repeat.mp3 and then the original question**. This extra clip is optional: if it is missing, too large or its R2 metadata is temporarily inaccessible, the original question is played again without it. The ordinary pilot/campaign prompt readiness check does not require this extra audio. This is not realtime interruption or an LLM; the fixed recorded question flow remains. Use `scripted-phone-pilot/hi/repeat.mp3` or `scripted-phone-pilot/en/repeat.mp3` for the internal pilot, and `scripted-phone-campaigns/<tenant-uuid>/hi/repeat.mp3` or `.../en/repeat.mp3` for an approved customer campaign. Use a reviewed, properly licensed human recording and keep each MP3 below 512 KiB. Do not include tenant IDs, phone numbers or other customer information in the spoken audio. The opening identifies AR3D, explains the internal test and recording, and asks the recipient to press 1 to continue. The closing and review prompts should describe completion or human review without promising a booking. Keep the files under 512 KiB each. Keep tenant and lead details out of these shared test prompts.

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

A current MFA Super Admin can then start one approved call from **Calling Setup → Internal phone test**. The pilot limits destination and duration, and never participates in campaign dispatch. A new internal call requires the prior signed hangup (or a definitive provider rejection) and a full 60-second cooldown. An expired or uncertain call never automatically unlocks dialing; investigate the provider before further tests. A signed callback must match the authorized call before the question flow starts. Confirm in staging that Plivo returns its V3 signatures and recording IDs, that an authenticated recording is accessible when the XML action fires, and that the approved lead has the expected CRM fields and one audit event. A complete, valid response saves the lead's property fields. Incomplete speech, failed audio access, or a concurrently edited lead requires review.

For production, set the exact origin to `https://aicalling.ar3dstudio.in`. Confirm that the final status is completed and that Plivo’s signed hangup is received. Customer campaigns require a separate flag and the completed pilot for the same account, caller and internal test lead. See [customer campaign setup](CUSTOMER-CALLING.md).

[Plivo XML recordings](https://www.plivo.com/docs/voice/xml/record) · [Plivo V3 signatures](https://www.plivo.com/docs/voice/concepts/signature-validation) · [Cloudflare Workers AI transcription](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/)

The current-MFA Super Admin can enroll up to four additional authorized, consenting Indian internal devices (five including the primary configured lead) from Calling Setup. Enrollment creates a separate test lead and audited lead/mobile binding, never dials, and does not grant external telecom or campaign permissions. Select a device for each explicitly confirmed call; the global signed-hangup gate and 60-second cooldown apply across all devices. Customer campaign acceptance remains bound to the original configured primary lead.
