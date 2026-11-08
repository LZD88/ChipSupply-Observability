"""Static Compose contract checks used when Docker CLI is unavailable in CI."""

from pathlib import Path
import re
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]


class ComposeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        cls.compose = yaml.safe_load(cls.raw)

    def test_worker_proxy_schema_and_grant_services_are_wired(self):
        services = self.compose["services"]
        for name in ("agent-schema-init", "decision-db-bootstrap", "evaluation-worker", "observability"):
            self.assertIn(name, services)
        worker = services["evaluation-worker"]
        self.assertEqual(worker["command"], ["python", "-m", "agent.evaluation.worker"])
        environment = worker["environment"]
        self.assertEqual(environment["EVALUATION_DB_USER"], "chipchain_evaluation")
        for forbidden in ("JAVA_API_BASE_URL", "JAVA_API_USERNAME", "JAVA_API_PASSWORD",
                          "ERP_API_TOKEN", "ERP_MCP_URL"):
            self.assertNotIn(forbidden, environment)
        self.assertIn("decision-db-bootstrap", worker["depends_on"])
        self.assertIn("agent-api", services["observability"]["depends_on"])

    def test_secret_variables_have_no_committed_defaults(self):
        example = (ROOT / ".env.example").read_text(encoding="utf-8")
        for key in ("DECISION_DB_PASSWORD", "EVALUATION_DB_PASSWORD", "MCP_INVOCATION_SIGNING_SECRET"):
            self.assertRegex(example, rf"(?m)^{key}=\s*$")
            self.assertNotRegex(self.raw, rf"\$\{{{key}:-[^}}]+\}}")
        self.assertRegex(self.raw, r"\$\{MCP_INVOCATION_SIGNING_SECRET:\?[^}]+\}")

    def test_docs_cover_worker_grants_proxy_and_quality_demo(self):
        docs = (ROOT / "README.md").read_text(encoding="utf-8") + (ROOT / "LOCAL-STACK.md").read_text(encoding="utf-8")
        for required in (
            "evaluation-worker", "decision-db-bootstrap", "evaluation:view",
            "evaluation:maintain", "MCP_INVOCATION_SIGNING_SECRET", "docker compose config",
            "决策质量", "no-store", "Prometheus", "Tempo",
        ):
            self.assertIn(required, docs)


if __name__ == "__main__":
    unittest.main()
