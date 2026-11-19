# Audio files for our local Asterisk 7-question pilot

Record **your own original voice** or use a voice you have rights to.
Each line is a separate original recording. Do NOT embed real customer
names, mobiles, account keys, company passwords, project prices or
confirmed visit slots. This local survey does not automatically
transcribe answers or authorize commercial calls.

Copy the resulting audio (8 kHz mono 16-bit WAV) under the private
Asterisk sound folder as `ar3d/<filename>.wav`.
For example, using ffmpeg locally:
`ffmpeg -i intro.wav -ac 1 -ar 8000 -sample_fmt s16 hi-intro-test-recording-consent.wav`.
Asterisk uses the filename *without* the file extension when playing
it. Do not download unknown audio from the internet.

| WAV basename | Hindi original text | English original text |
|---|---|---|
| `hi-intro-test-recording-consent` / `en-intro-test-recording-consent` | नमस्कार। यह हमारा निजी सॉफ्टवेयर परीक्षण है, कोई व्यावसायिक कॉल नहीं। क्या आप अपनी टेस्ट आवाज रिकॉर्ड करवाना चाहते हैं? हाँ के लिए 1, मना करने के लिए 9 दबाएँ। | Hello. This is a private software test, not a commercial call. Press 1 to allow recording of your test answers, or 9 to decline. |
| `hi-propertyType` / `en-propertyType` | आप प्लॉट, फ्लैट या मकान क्या देख रहे हैं? प्लॉट के लिए 1, फ्लैट के लिए 2, मकान के लिए 3 दबाएँ। | What property are you interested in? Press 1 for plot, 2 for flat, or 3 for house. |
| `hi-location` / `en-location` | किस शहर या लोकेशन में प्रॉपर्टी देख रहे हैं? बीप के बाद बोलें। | Which city or location do you prefer? Speak after the beep. |
| `hi-area` / `en-area` | उस शहर में कौन-सा एरिया पसंद है? बीप के बाद बोलें। | Which neighborhood or area do you prefer? Speak after the beep. |
| `hi-size-plot` / `en-size-plot` | कितने साइज का प्लॉट चाहिए? साइज और यूनिट बोलें, जैसे 1200 वर्ग फुट। | What plot size do you need? Say the size and units, e.g. 1200 square feet. |
| `hi-size-bhk` / `en-size-bhk` | कितने BHK चाहिए, जैसे 2BHK या 3BHK? | How many BHK do you want, such as 2BHK or 3BHK? |
| `hi-budgetInr` / `en-budgetInr` | आपका लगभग बजट कितने रुपये का है? बीप के बाद बोलें। | What is your approximate budget in Indian rupees? Speak after the beep. |
| `hi-interest` / `en-interest` | क्या आप आगे प्रॉपर्टी देखने में इंटरेस्टेड हैं? हाँ के लिए 1, बाद में बात करने के लिए 2, रुचि नहीं है तो 3 दबाएँ। | Are you interested in viewing a property? Press 1 for interested, 2 for later follow-up, or 3 for not interested. |
| `hi-visitDate` / `en-visitDate` | किस तारीख को साइट विजिट करना चाहेंगे? तारीख बोलें। यह अभी बुकिंग कन्फर्म नहीं है। | Which date would you prefer to visit? This is a request, not a confirmed booking. |
| `hi-thank-you-unconfirmed` / `en-thank-you-unconfirmed` | धन्यवाद। आपके टेस्ट जवाब रिकॉर्ड हुए हैं। कोई साइट विजिट बुक नहीं हुई है। | Thank you. Your test answers were recorded. No site visit was booked. |

Important:
- The lab asks **six questions** if uninterested, **seven if interested**.
- Name and Mobile are expected to come from Excel later and are not
  spoken or written by this local-only experiment.
- Property Type and Interest use keypad for reliable lab branching;
  Location, Area, Size, Budget and Visit Date are voice WAV captures.
- This is not yet automatic speech-to-text: it needs a separately
  approved engine and a verified, tenant-scoped CRM integration.
- If a caller rejects recording, AGI creates no files.
