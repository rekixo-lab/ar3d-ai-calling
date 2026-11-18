import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class MainOnlyDeploymentLayoutTests(unittest.TestCase):
    def test_only_main_cloudflare_workflow_exists(self):
        workflows = list((ROOT / ".github/workflows").glob("deploy-*.yml"))
        self.assertEqual([p.name for p in workflows], ["deploy-production.yml"])
        source = workflows[0].read_text()
        self.assertIn("workflow_dispatch:", source)
        self.assertIn("environment: production", source)
        self.assertIn("AR3D_MAIN_CONTROL_DB_ID", source)
        self.assertIn("AR3D_MAIN_CRM_DB_ID", source)
        for operation in ("preflight", "initialize", "deploy"):
            self.assertIn(" - " + operation, source)

    def test_main_scripts_and_docs_only(self):
        scripts = json.loads((ROOT / "package.json").read_text())["scripts"]
        self.assertIn("smoke:main", scripts)
        self.assertIn("test", scripts)
        self.assertTrue((ROOT / "scripts/smoke-main.mjs").is_file())
        self.assertTrue((ROOT / "docs/MAIN-DEPLOYMENT.md").is_file())
        self.assertTrue((ROOT / "wrangler.example.jsonc").is_file())
        for path in [
            ".github/workflows/deploy-staging.yml",
            "docs/STAGING.md",
            "scripts/check-staging.mjs",
            "scripts/smoke-staging.mjs",
            "wrangler.staging.example.jsonc",
        ]:
            self.assertFalse((ROOT / path).exists(), path)

    def test_main_config_is_isolated(self):
        config = json.loads((ROOT / "wrangler.example.jsonc").read_text())
        self.assertEqual(config["name"], "ar3d-ai-calling")
        self.assertEqual(
            {item["database_name"] for item in config["d1_databases"]},
            {"ar3d-calling-control", "ar3d-calling-shared-crm"},
        )
        self.assertEqual(config["r2_buckets"][0]["bucket_name"], "ar3d-calling-recordings")


if __name__ == "__main__":
    unittest.main()
