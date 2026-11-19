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
        self.assertNotIn("B"*40,r.full_url)
        self.assertNotIn("A"*20,r.full_url)
        self.assertEqual(json.loads(r.data),{"email":"owner@example.com","password":"A"*20})
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
             patch.object(MODULE,"bootstrap",side_effect=lambda host,email,pw,token:seen.append(("bootstrap",token,host,email,pw)) or 0), \
             patch.object(MODULE.time,"sleep",return_value=None), \
             patch("builtins.input",return_value="owner@example.com"), \
             patch.object(MODULE.getpass,"getpass",side_effect=["StrongPassWord!2026","StrongPassWord!2026"]):
            result=MODULE.synchronized_bootstrap(MODULE.PRODUCTION_URL)
        self.assertEqual(result,0)
        self.assertEqual(seen[0],("upload",generated))
        self.assertEqual(seen[1][0:2],("bootstrap",generated))
        self.assertEqual(seen[1][2],MODULE.PRODUCTION_URL)

    def test_synchronized_bootstrap_rejects_unverified_domain_without_writes(self):
        with self.assertRaises(ValueError):
            MODULE.synchronized_bootstrap("https://ar3d-ai-calling.wrong.workers.dev")
