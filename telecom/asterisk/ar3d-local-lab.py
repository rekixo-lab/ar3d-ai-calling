#!/usr/bin/env python3
"""Asterisk AGI: seven-question LOCAL SIP pilot with recording by permission.

Important: NO network, SIP registration, PSTN dial, STT, customer/CRM access,
or phone number discovery. Requires private lab extension 7000/7001 and
user-supplied original WAV prompts; this is not a real outbound caller.
"""
from __future__ import annotations

import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Caller-provided AGI environment is never trusted as an identity or filename.
DEFAULT_ROOT = Path("/var/spool/asterisk/ar3d-lab")
LABELS = ("propertyType", "location", "area", "size", "budgetInr", "interest", "visitDate")
CHOICES = {
    "propertyType": {"1": "plot", "2": "flat", "3": "house"},
    "interest": {"1": "interested", "2": "later", "3": "not_interested"},
}
MAX_QUESTION_ATTEMPTS = 3
RESPONSE_PATTERN = re.compile(r"^200 result=(-?[0-9]+)(?:\s.*)?$")
# In a laboratory, named files do not contain names or phone numbers.


class HungUp(Exception):
    pass


class LabAGI:
    def __init__(self, stream_in, stream_out):
        self.input = stream_in
        self.output = stream_out

    def read_environment(self):
        # Mandatory AGI header terminates at first blank line.
        for _ in range(96):
            line = self.input.readline()
            if line == "":
                raise HungUp("No AGI header")
            if line.strip() == "":
                return
        raise ValueError("AGI header too long")

    def command(self, value):
        if "\n" in value or "\r" in value or len(value) > 450:
            raise ValueError("Invalid local AGI command")
        self.output.write(value + "\n")
        self.output.flush()
        line = self.input.readline()
        if not line:
            raise HungUp("Channel closed")
        match = RESPONSE_PATTERN.fullmatch(line.strip())
        if not match:
            raise HungUp("Unexpected AGI response")
        result = int(match.group(1))
        if result == -1:
            raise HungUp("Caller hung up")
        return str(result)

    def digit(self, prompt, allowed):
        for _ in range(MAX_QUESTION_ATTEMPTS):
            result = self.command("GET DATA " + prompt + " 12000 1")
            if result in allowed:
                return result
        return None

    def announce(self, prompt):
        self.command('STREAM FILE ' + prompt + ' ""')

    def speech_answer(self, prompt, dest):
        self.announce(prompt)
        # Asterisk writes a local WAV. Not a cloud recording or STT.
        stem = str(dest.with_suffix(""))
        self.command("RECORD FILE " + stem + ' wav "#" 18000 0 BEEP s=2')
        path = dest.with_suffix(".wav")
        if path.exists():
            os.chmod(path, 0o600)
        return path.name


def run_survey(agi, language, root=DEFAULT_ROOT, clock=None):
    if language not in ("hi", "en"):
        raise ValueError("Invalid lab language")
    agi.read_environment()
    if agi.digit(f"ar3d/{language}-intro-test-recording-consent", {"1", "9"}) != "1":
        return {"status": "declined", "files": (), "crmSaves": 0, "phoneCallsStarted": 0}
    session_id = uuid.uuid4().hex
    folder = Path(root) / session_id
    folder.mkdir(parents=True, mode=0o700, exist_ok=False)
    os.chmod(folder, 0o700)
    answers = {}
    try:
        kind = agi.digit(f"ar3d/{language}-propertyType", {"1", "2", "3", "9"})
        if kind in (None, "9"):
            return {"status": "human_review", "crmSaves": 0, "phoneCallsStarted": 0}
        answers["propertyType"] = CHOICES["propertyType"][kind]
        for field in ("location", "area", "size", "budgetInr"):
            prompt = f"ar3d/{language}-{field}"
            if field == "size":
                prompt = f"ar3d/{language}-size-{'plot' if kind == '1' else 'bhk'}"
            answers[field] = agi.speech_answer(prompt, folder / (field + ".wav"))
        interest = agi.digit(f"ar3d/{language}-interest", {"1", "2", "3", "9"})
        if interest in (None, "9"):
            return {"status": "human_review", "crmSaves": 0, "phoneCallsStarted": 0}
        answers["interest"] = CHOICES["interest"][interest]
        answers["visitDate"] = None
        if answers["interest"] == "interested":
            answers["visitDate"] = agi.speech_answer(
                f"ar3d/{language}-visitDate", folder / "visitDate.wav"
            )
        timestamp = (clock or (lambda: datetime.now(timezone.utc)))().isoformat()
        manifest = {
            "mode": "private_local_asterisk_test",
            "sessionId": session_id,
            "recordedAt": timestamp,
            "language": language,
            "answers": answers,
            "transcriptsVerified": False,
            "customerNumberKnown": False,
            "callerIdentityVerified": False,
            "consentForCommercialCalls": False,
            "realCallsStartedByThisScript": 0,
            "crmSaves": 0,
            "warning": "Local WAV filenames only; voice has NOT been transcribed/verified.",
        }
        result_file = folder / "answers.json"
        # File creation exclusive, no arbitrary paths from caller or channel.
        with result_file.open("x", encoding="utf-8") as handle:
            json.dump(manifest, handle, ensure_ascii=False, indent=2)
        os.chmod(result_file, 0o600)
        agi.announce(f"ar3d/{language}-thank-you-unconfirmed")
        return {"status": "recorded_local_only", "crmSaves": 0, "phoneCallsStarted": 0,
                "sessionId": session_id}
    except HungUp:
        return {"status": "hung_up", "crmSaves": 0, "phoneCallsStarted": 0}


def main():
    # Use no caller phone number, password, auth material or external API.
    # stdout belongs to AGI protocol, so do not print ordinary output here.
    language = sys.argv[1] if len(sys.argv) > 1 else "hi"
    agi = LabAGI(sys.stdin, sys.stdout)
    try:
        run_survey(agi, language)
    except (HungUp, OSError, ValueError) as exc:
        # Error string must not contain recordings or caller identity.
        sys.stderr.write("AR3D local AGI lab stopped: " + type(exc).__name__ + "\n")


if __name__ == "__main__":
    main()
