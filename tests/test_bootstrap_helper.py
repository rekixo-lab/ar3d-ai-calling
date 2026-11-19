import importlib.util
import io
import json
import pathlib
import unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location("bootstrap_main",ROOT/"scripts/bootstrap-main.py")
MODULE=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class BootstrapHelperTests(unittest.TestCase):
    def test_only_isolated_workers_hostname_allowed(self):
        url="https://ar3d-ai-calling.operator-test.workers.dev"
        self.assertEqual(MODULE.validate_host(url+"/"),url)
        for bad in ("http://ar3d-ai-calling.operator-test.workers.dev",
                    "https://other-app.operator-test.workers.dev",
                    "https://ar3d-ai-calling.operator-test.workers.dev.evil.example",
                    "https://ar3d-ai-calling.operator-test.workers.dev/?token=secret",
                    "https://ar3d-ai-calling.operator-test.workers.dev:1234"):
            with self.assertRaises(ValueError):MODULE.validate_host(bad)
    def test_secrets_are_not_part_of_url_or_saved_to_disk(self):
        url="https://ar3d-ai-calling.operator-test.workers.dev"
        r=MODULE.build_request(url,"Owner@Example.com","A"*20,"B"*40)
        self.assertEqual(r.full_url,url+"/v1/human/bootstrap")
        self.assertEqual(r.get_method(),"POST")
        self.assertEqual(r.get_header("User-agent"), "AR3D-AI-Calling-Bootstrap/1.0 (+https://ar3d-ai-calling.ai-8f3.workers.dev)")
        self.assertNotIn("B"*40,r.full_url)
        self.assertNotIn("A"*20,r.full_url)
        self.assertEqual(json.loads(r.data),{"email":"owner@example.com","password":"A"*20})
    def test_descriptive_agent_is_used_for_isolated_worker_only(self):
        url="https://ar3d-ai-calling.operator-test.workers.dev"
        req=MODULE.build_request(url,"admin@example.com","ValidPassWord123!","Q"*43)
        self.assertIn("AR3D-AI-Calling-Bootstrap/1.0",req.get_header("User-agent"))
        self.assertNotIn("Python-urllib",req.get_header("User-agent"))
        self.assertEqual(req.get_method(),"POST")

    def test_invalid_credentials_fail_before_network(self):
        url="https://ar3d-ai-calling.operator-test.workers.dev"
        for token,password in (("short","ValidStrongPass123"),("B"*40,"short")):
            with self.assertRaises(ValueError):
                MODULE.build_request(url,"owner@example.com",password,token)

if __name__=="__main__":
    unittest.main()


class SynchronizedBootstrapTests(unittest.TestCase):
    def test_upload_is_standalone_worker_only_and_password_never_in_args(self):
        token="A"*43
        invocations=[]
        class Result:
            returncode=0
        def runner(command,**kwargs):
            invocations.append((command,kwargs))
            return Result()
        self.assertTrue(MODULE.upload_one_time_token(token,runner=runner))
        self.assertEqual(len(invocations),1)
        cmd,opts=invocations[0]
        self.assertEqual(cmd,["npx","--yes","wrangler@4","secret","put",
                              "ADMIN_BOOTSTRAP_TOKEN","--name","ar3d-ai-calling"])
        self.assertEqual(opts["input"],token+"\n")
        self.assertNotIn(token," ".join(cmd))
        self.assertTrue(opts["check"] is False)
        self.assertIsNotNone(opts["cwd"])
        self.assertNotIn("wrangler.jsonc",opts["cwd"])
        self.assertEqual(opts["stdout"],MODULE.subprocess.PIPE)
        self.assertEqual(opts["stderr"],MODULE.subprocess.PIPE)

    def test_upload_rejects_invalid_token_before_external_command(self):
        with self.assertRaises(ValueError):
            MODULE.upload_one_time_token("wrong",runner=lambda *a,**k:self.fail("should not run"))

    def test_failed_upload_does_not_bootstrap_or_print_secret(self):
        class Result:
            returncode=1
        out=io.StringIO()
        token="Q"*43
        with patch("sys.stdout",out):
            ok=MODULE.upload_one_time_token(token,runner=lambda *a,**k:Result())
        self.assertFalse(ok)
        self.assertNotIn(token,out.getvalue())
        self.assertNotIn("token",out.getvalue().lower().replace("token hidden","")) # no value

    def test_sync_uses_single_ephemeral_token_for_cloudflare_and_bootstrap(self):
        generated="Z"*43
        seen=[]
        with patch.object(MODULE.secrets,"token_urlsafe",return_value=generated), \
             patch.object(MODULE,"upload_one_time_token",side_effect=lambda token: seen.append(("upload",token)) or True), \
             patch.object(MODULE,"bootstrap",side_effect=lambda host,email,pw,token,**kw:seen.append(("bootstrap",token,host,email,pw,kw)) or 0), \
             patch.object(MODULE.time,"sleep",return_value=None), \
             patch("builtins.input",return_value="owner@example.com"), \
             patch.object(MODULE.getpass,"getpass",side_effect=["StrongPassWord!2026","StrongPassWord!2026"]):
            result=MODULE.synchronized_bootstrap(MODULE.PRODUCTION_URL)
        self.assertEqual(result,0)
        self.assertEqual(seen[0],("upload",generated))
        self.assertEqual(seen[1][0:2],("bootstrap",generated))
        self.assertEqual(seen[1][2],MODULE.PRODUCTION_URL)
        self.assertEqual(seen[1][5],{"retry_unauthorized":True})

    def test_retry_reuses_one_request_and_succeeds_after_worker_401(self):
        class Created:
            status = 201
            def __enter__(self): return self
            def __exit__(self, *args): return False

        calls, delays = [], []
        def opener(request, **_):
            calls.append(request)
            if len(calls) <= 2:
                raise MODULE.urllib.error.HTTPError(
                    request.full_url, 401, "Unauthorized",
                    {"Content-Type": "application/json"},
                    io.BytesIO(b'{"error":"unauthorized"}'))
            return Created()

        output = io.StringIO()
        token = "Q" * 43
        with patch("sys.stdout", output):
            result = MODULE.bootstrap(
                MODULE.PRODUCTION_URL, "admin@example.com", "StrongPassword123!",
                token, opener=opener, retry_unauthorized=True,
                sleeper=delays.append)
        self.assertEqual(result, 0)
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(req is calls[0] for req in calls))
        self.assertEqual(delays, [5, 10])
        self.assertNotIn(token, output.getvalue())

    def test_non_worker_401_is_not_retried(self):
        calls, delays = [], []
        def opener(request, **_):
            calls.append(request)
            raise MODULE.urllib.error.HTTPError(
                request.full_url, 401, "Unauthorized",
                {"Content-Type": "text/html"},
                io.BytesIO(b"<html>access denied</html>"))
        with patch("sys.stdout", io.StringIO()) as output:
            result = MODULE.bootstrap(
                MODULE.PRODUCTION_URL, "admin@example.com", "StrongPassword123!",
                "Q" * 43, opener=opener, retry_unauthorized=True,
                sleeper=delays.append)
        self.assertEqual(result, 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(delays, [])
        self.assertIn("not the expected Worker JSON", output.getvalue())

    def test_cloudflare_1010_block_is_reported_without_raw_response(self):
        calls=[]
        def opener(req, **_):
            calls.append(1)
            raise MODULE.urllib.error.HTTPError(
                req.full_url,403,"Forbidden",{"Content-Type":"text/html"},
                io.BytesIO(b"<html>error code: 1010</html>"))
        with patch("sys.stdout", io.StringIO()) as out:
            result=MODULE.bootstrap(
                MODULE.PRODUCTION_URL,"admin@example.com","ValidPassWord123!",
                "Q"*43, opener=opener, retry_unauthorized=True,
                sleeper=lambda _:self.fail("403 must not retry"))
        self.assertEqual(result,1)
        self.assertEqual(len(calls),1)
        self.assertIn("Cloudflare error 1010",out.getvalue())
        self.assertNotIn("<html>",out.getvalue())

    def test_worker_401_retry_exhausts_without_secret_rotation(self):
        delays, count = [], []
        def opener(request, **_):
            count.append(1)
            raise MODULE.urllib.error.HTTPError(
                request.full_url, 401, "Unauthorized",
                {"Content-Type": "application/json"},
                io.BytesIO(b'{"error":"unauthorized"}'))
        with patch("sys.stdout", io.StringIO()) as output:
            result = MODULE.bootstrap(
                MODULE.PRODUCTION_URL, "admin@example.com", "StrongPassword123!",
                "Q" * 43, opener=opener, retry_unauthorized=True,
                sleeper=delays.append)
        self.assertEqual(result, 1)
        self.assertEqual(len(count), 4)
        self.assertEqual(delays, [5, 10, 15])
        self.assertIn("Worker rejected the token", output.getvalue())

    def test_409_is_not_retried(self):
        delays, count = [], []
        def opener(request, **_):
            count.append(1)
            raise MODULE.urllib.error.HTTPError(
                request.full_url, 409, "Conflict",
                {"Content-Type": "application/json"},
                io.BytesIO(b'{"error":"super admin already exists"}'))
        with patch("sys.stdout", io.StringIO()) as output:
            result = MODULE.bootstrap(
                MODULE.PRODUCTION_URL, "admin@example.com", "StrongPassword123!",
                "Q" * 43, opener=opener, retry_unauthorized=True,
                sleeper=delays.append)
        self.assertEqual(result, 1)
        self.assertEqual(len(count), 1)
        self.assertEqual(delays, [])
        self.assertIn("already exists", output.getvalue())

    def test_synchronized_bootstrap_rejects_unverified_domain_without_writes(self):
        with self.assertRaises(ValueError):
            MODULE.synchronized_bootstrap("https://ar3d-ai-calling.wrong.workers.dev")
