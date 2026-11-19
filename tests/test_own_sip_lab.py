"""Isolated tests of our private Asterisk lab: NEVER dial telecom numbers."""
import importlib.util
import io
import json
import os
import pathlib
import stat
import tempfile
import unittest

BASE = pathlib.Path(__file__).resolve().parents[1]
PY = BASE / "telecom" / "asterisk" / "ar3d-local-lab.py"
SPEC = importlib.util.spec_from_file_location("own_sip_agilab", PY)
lab = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lab)


class FakeWriter(io.StringIO):
    def write(self, message):
        if message.startswith("RECORD FILE "):
            # Simulate a successful local Asterisk WAV file write, not speech.
            stem = message.split()[2]
            pathlib.Path(stem + ".wav").write_bytes(b"RIFF" + b"\0" * 128)
        return super().write(message)


def agi(replies):
    stream = io.StringIO("agi_request: synthetic-lab\nagi_extension: 7000\n\n"
                         + "".join(f"200 result={n}\n" for n in replies))
    output = FakeWriter()
    return lab.LabAGI(stream, output), output


class OwnSIPLabTest(unittest.TestCase):
    def test_internal_extensions_no_external_dial_or_provider_config(self):
        extensions = (BASE / "telecom/asterisk/extensions-local-only.conf").read_text()
        sip = (BASE / "telecom/asterisk/pjsip-local-only.conf.example").read_text()
        self.assertIn("exten => 7000,1", extensions)
        self.assertIn("exten => 7001,1", extensions)
        self.assertIn("AGI(ar3d-local-lab.py,hi)", extensions)
        self.assertIn("bind=127.0.0.1:5062", sip)
        self.assertIn("context=ar3d-local-only", sip)
        self.assertNotIn("same => n,Dial(", extensions)
        self.assertNotIn("exten => _X.", extensions)
        self.assertNotIn("type=registration", sip)
        self.assertNotIn("outbound_auth=", sip)
        self.assertNotIn("sip:jio", sip.lower())
        self.assertNotIn("sip:exotel", sip.lower())
        self.assertNotIn("0.0.0.0", sip)

    def test_declines_without_consent_and_does_not_create_audio(self):
        for reply in ("9", "0", "1"):
            # '1' is not a decline, tested separately.
            if reply == "1":
                continue
            a, output = agi([reply] * 3)
            with tempfile.TemporaryDirectory() as temp:
                result = lab.run_survey(a, "hi", root=pathlib.Path(temp))
                self.assertEqual(result["status"], "declined")
                self.assertEqual(list(pathlib.Path(temp).iterdir()), [])
                self.assertNotIn("RECORD FILE", output.getvalue())
                self.assertNotIn("Dial(", output.getvalue())

    def test_record_seven_question_plan_and_require_human_review(self):
        # Consent 1, flat 2, four location/area/size/budget recording pairs,
        # interest 1, visitDate recording pair, thank-you announcement.
        replies = [1, 2] + [0, 0] * 4 + [1] + [0, 0] + [0]
        a, output = agi(replies)
        with tempfile.TemporaryDirectory() as temp:
            result = lab.run_survey(a, "hi", root=pathlib.Path(temp))
            self.assertEqual(result["status"], "recorded_local_only")
            self.assertEqual(result["crmSaves"], 0)
            self.assertEqual(result["phoneCallsStarted"], 0)
            manifest_file = pathlib.Path(temp, result["sessionId"], "answers.json")
            self.assertTrue(manifest_file.is_file())
            manifest = json.loads(manifest_file.read_text())
            self.assertEqual(manifest["answers"]["propertyType"], "flat")
            self.assertEqual(manifest["answers"]["interest"], "interested")
            self.assertEqual(manifest["answers"]["size"], "size.wav")
            self.assertEqual(manifest["answers"]["visitDate"], "visitDate.wav")
            self.assertEqual(manifest["crmSaves"], 0)
            self.assertFalse(manifest["transcriptsVerified"])
            self.assertFalse(manifest["consentForCommercialCalls"])
            self.assertFalse(manifest["callerIdentityVerified"])
            self.assertNotIn("mobile", json.dumps(manifest))
            self.assertNotIn("callerid", json.dumps(manifest))
            self.assertEqual(stat.S_IMODE(os.stat(manifest_file).st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(os.stat(manifest_file.parent).st_mode), 0o700)
            for key in ["location", "area", "size", "budgetInr", "visitDate"]:
                self.assertEqual(stat.S_IMODE(os.stat(manifest_file.parent / (key + ".wav")).st_mode), 0o600)
            self.assertEqual(output.getvalue().count("RECORD FILE"), 5)
            self.assertIn("ar3d/hi-size-bhk", output.getvalue())
            self.assertNotIn("ar3d/hi-size-plot", output.getvalue())
            self.assertNotIn("Dial(", output.getvalue())

    def test_plot_and_not_interested_skip_visit(self):
        # 1 consent, 1 plot, 4 recordings, 3 not interested, thank-you.
        replies = [1, 1] + [0, 0] * 4 + [3, 0]
        a, output = agi(replies)
        with tempfile.TemporaryDirectory() as temp:
            result = lab.run_survey(a, "en", root=pathlib.Path(temp))
            self.assertEqual(result["status"], "recorded_local_only")
            answer = json.loads((pathlib.Path(temp, result["sessionId"], "answers.json")).read_text())
            self.assertEqual(answer["answers"]["propertyType"], "plot")
            self.assertEqual(answer["answers"]["interest"], "not_interested")
            self.assertIsNone(answer["answers"]["visitDate"])
            self.assertIn("ar3d/en-size-plot", output.getvalue())
            self.assertNotIn("ar3d/en-visitDate", output.getvalue())

    def test_hangup_or_missing_audio_purges_unfinished_local_session(self):
        # Consent 1, select house 3, then stream attempts hangup.
        a, _ = agi([1, 3, -1])
        with tempfile.TemporaryDirectory() as temp:
            result = lab.run_survey(a, "en", root=pathlib.Path(temp))
            self.assertEqual(result["status"], "hung_up")
            self.assertEqual(list(pathlib.Path(temp).iterdir()), [])
        a = lab.LabAGI(io.StringIO("agi_request: mock\n\n" +
                                  "".join(f"200 result={n}\n" for n in [1, 3, 0, 0])),
                       io.StringIO())
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(OSError):
                lab.run_survey(a, "en", root=pathlib.Path(temp))
            self.assertEqual(list(pathlib.Path(temp).iterdir()), [])

    def test_invalid_language_never_accesses_agi_or_files(self):
        a, _ = agi([1])
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):
                lab.run_survey(a, "../attack", root=pathlib.Path(temp))
            self.assertEqual(list(pathlib.Path(temp).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
