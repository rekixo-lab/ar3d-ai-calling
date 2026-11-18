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
