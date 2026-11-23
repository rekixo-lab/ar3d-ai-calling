# AR3D Own Calling Engine — Asterisk Local-Only Lab

This directory contains an actual **locally executable** Asterisk voice
survey for a private SIP softphone. **It is NOT a carrier,
140-number allocator, 140 SIP Trunk, open SIP dialer, STT engine,
authenticated voice webhook or commercial calling system.** Our
AR3D CRM and Cloudflare Worker remain separate.

## Architecture when a telecom operator approves the SIP trunk

    [AR3D CRM / Excel / 7 fixed questions on Cloudflare]
                             |
                       secure control API
                             |
                 [Our always-on Asterisk PBX]
                    /                  \
       local fixed-question audio   approved SIP Trunk
        and future STT gateway           |
                                        +-- assigned 140 caller number
                                        +-- Indian telecom/mobile network

A local Asterisk lab cannot replace an **authorized Telecom Operator**
or its charges. Jio Business officially offers 140-series telemarketing
outbound trunks: https://www.jio.com/business/services/voice-and-collaboration/sip-trunk/

The Jio public tariff page mentions **minimum 30 channels** for a
published plan. That may be uneconomical for only 100 test calls.
Request a written quote with approved 140 caller number, DLT/PE and
telemarketer onboarding, channel minimum, installation, SIP access,
per-minute charges and taxes. Other operators can quote differently.

TRAI's 2025 TCCCPR amendment requires commercial autodialer/robocall
senders to notify the originating access provider about the intended
activity in advance. Promotional robocalls use the designated 140
series with consent/preference controls:
https://www.trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf

## Actually implemented in this LAB

* Two **LOCAL** Asterisk extensions on loopback SIP only:
  `7000` Hindi, `7001` English.
* `ar3d-local-lab.py` (Asterisk AGI) plays an initial test recording
  notice/choice, requires DTMF 1 to continue (9 to decline), asks
  property type (1 plot, 2 flat, 3 house), records spoken city, area,
  size (plot/BHK), budget, asks interest (1 yes, 2 later, 3 no) and
  records a preferred visit date only when interested.
* Speech answers are **local WAV** files, not transcripts. The JSON
  manifest contains anonymous session ID, chosen type/interest and
  relative audio filenames, never customer name/mobile.
* Declining consent stores **zero** recordings. Incomplete sessions
  are deleted. The test bot cannot dial any outside number.
* No public SIP route, provider registration, PSTN dialplan, 140
  Caller ID, CRM webhook, DND lookup, live transcription, calls
  started or chargeable events.

## Local Linux / Asterisk test (manual operator step)

1. On your own NON-PRODUCTION Linux machine install a current supported
   Asterisk version and a local SIP softphone on **the same host**.
   Keep 5062 accessible only via 127.0.0.1. Never expose a public SIP
   PBX for this lab. Cloudflare Workers do not replace a SIP/RTP PBX.
2. Copy the snippets into the existing Asterisk configuration, after
   local review:
   - `pjsip-local-only.conf.example` in a PJSIP include, replacing the
     placeholder password with a new private random test-only password.
   - `extensions-local-only.conf` in an extensions include.
   - `ar3d-local-lab.py` in the installed executable AGI directory,
     often /var/lib/asterisk/agi-bin; mark executable.
   - Do not add an outgoing `Dial()`, carrier trunk or public listen port.
3. Record original Hindi and English audio prompts per `PROMPTS.md`,
   convert to 8-kHz mono WAV and store under your private Asterisk
   sounds directory `/var/lib/asterisk/sounds/ar3d/`.
4. As the Asterisk service user, create
   `/var/spool/asterisk/ar3d-lab` with mode `0700`.
   Protect and delete test recordings after review.
5. Reload local Asterisk configuration after checking compatibility.
   Register the local softphone to 127.0.0.1:5062 only, then **dial
   local extension 7000 or 7001** (not a mobile number).
6. Press 9: no WAV files. Press 1 to permit recording of only your
   own sample voice, then answer the questions. The resulting WAV
   files and manifest are stored locally only.
7. In the GitHub repo, run `npm run test` to verify safety and
   questionnaire behavior. No live calls are created.

**Privacy:** Voice itself may be personal information. Use your own
or approved test actors' voices, private storage and manual deletion;
this demo has no production retention, encryption or recording policy.

## Still required before a REAL 140 commercial call

1. Operator-approved 140 promotional **outbound SIP trunk** with KYC,
   sender/PE/DLT and permission for automated real-estate calls.
2. Current customer consent/DND check, suppression, lawful hours,
   AI disclosure, cost/volume caps and company/trunk-specific caller ID.
3. Always-on secured Asterisk/SBC with Operator-provided PJSIP, media,
   NAT, firewall and TLS/SRTP requirements.
4. Authenticated dial scheduling; no-call safety triggers must NOT
   be removed to obtain a test result.
5. Approved local/managed STT for Hindi/English, recording notices,
   authenticated per-call events, replay/idempotency and tenant-to-CRM
   secure review before saving.
6. Operator-approved personally controlled live-number pilot and
   fully tested hangup/busy/no-answer/opt-out/reconciliation.

**Status:** This is source code for a working LOCAL seven-question
Asterisk pilot, not an active Plivo production replacement on mobile networks.
Buying a 140 number alone cannot connect calls.
