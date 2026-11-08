"""Verify local proxy routing and failure responses without external services."""

from contextlib import contextmanager
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from serve import DashboardHandler


@contextmanager
def running(handler):
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            thread.join()


class FakePrometheus(BaseHTTPRequestHandler):
    last_cookie = None

    def do_GET(self):
        type(self).last_cookie = self.headers.get("Cookie")
        body = json.dumps({"status": "success", "path": self.path}).encode()
        self.send_response(400 if "bad_query" in self.path else 200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


class FakeAgent(BaseHTTPRequestHandler):
    last_cookie = None

    def do_GET(self):
        type(self).last_cookie = self.headers.get("Cookie")
        if type(self).last_cookie != "deepagent_session=opaque":
            body = json.dumps({"detail": "无评测权限"}, ensure_ascii=False).encode()
            self.send_response(403)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        body = json.dumps({"runId": "run-1", "path": self.path}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


class ProxyTests(unittest.TestCase):
    def setUp(self):
        self.opener = build_opener(ProxyHandler({}))

    def test_queries_and_upstream_errors_preserve_path_and_status(self):
        with running(FakePrometheus) as upstream:
            with running(partial(DashboardHandler, prometheus_url=upstream)) as dashboard:
                path = "/api/v1/query?query=sum%28agent_requests_total%29"
                with self.opener.open(dashboard + "/prometheus" + path) as response:
                    self.assertEqual(json.load(response)["path"], path)
                with self.assertRaises(HTTPError) as raised:
                    self.opener.open(dashboard + "/prometheus/api/v1/query?bad_query")
                self.assertEqual(raised.exception.code, 400)
                raised.exception.close()

    def test_health_and_static_page_work_without_prometheus(self):
        with running(partial(DashboardHandler, prometheus_url="http://127.0.0.1:1")) as dashboard:
            with self.opener.open(dashboard + "/healthz") as response:
                self.assertEqual(response.read(), b"ok\n")
            with self.opener.open(dashboard + "/") as response:
                self.assertIn("可观测性中心", response.read().decode())
            with self.assertRaises(HTTPError) as raised:
                self.opener.open(dashboard + "/prometheus/api/v1/query?query=up")
            self.assertEqual(raised.exception.code, 502)
            self.assertEqual(json.load(raised.exception)["errorType"], "unavailable")
            raised.exception.close()

    def test_quality_proxy_forwards_cookie_is_no_store_and_is_read_only(self):
        FakeAgent.last_cookie = None
        with running(FakeAgent) as agent:
            handler = partial(DashboardHandler, prometheus_url="http://127.0.0.1:1",
                              agent_api_url=agent)
            with running(handler) as dashboard:
                request = Request(
                    dashboard + "/api/evaluations/runs?size=10",
                    headers={"Cookie": "deepagent_session=opaque"},
                )
                with self.opener.open(request) as response:
                    self.assertEqual(json.load(response)["runId"], "run-1")
                    self.assertIn("no-store", response.headers.get("Cache-Control"))
                self.assertEqual(FakeAgent.last_cookie, "deepagent_session=opaque")

                with self.assertRaises(HTTPError) as denied:
                    self.opener.open(dashboard + "/api/evaluations/runs/run-secret")
                self.assertEqual(denied.exception.code, 403)
                self.assertEqual(json.load(denied.exception), {"detail": "无评测权限"})
                self.assertIn("no-store", denied.exception.headers.get("Cache-Control"))
                denied.exception.close()

                post = Request(
                    dashboard + "/api/evaluations/runs", data=b"{}", method="POST",
                )
                with self.assertRaises(HTTPError) as raised:
                    self.opener.open(post)
                self.assertEqual(raised.exception.code, 405)
                raised.exception.close()

                with self.assertRaises(HTTPError) as raised:
                    self.opener.open(dashboard + "/api/decisions/DEC-SECRET")
                self.assertEqual(raised.exception.code, 404)
                self.assertIn("no-store", raised.exception.headers.get("Cache-Control"))
                raised.exception.close()

    def test_prometheus_never_receives_browser_cookie_and_nginx_whitelists_quality_only(self):
        FakePrometheus.last_cookie = None
        with running(FakePrometheus) as upstream:
            with running(partial(DashboardHandler, prometheus_url=upstream)) as dashboard:
                request = Request(
                    dashboard + "/prometheus/api/v1/query?query=up",
                    headers={"Cookie": "deepagent_session=must-not-reach-prometheus"},
                )
                with self.opener.open(request):
                    pass
        self.assertIsNone(FakePrometheus.last_cookie)

        root = Path(__file__).resolve().parents[1]
        nginx = (root / "nginx.conf").read_text(encoding="utf-8")
        dockerfile = (root / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("location /api/evaluations/", nginx)
        self.assertIn("limit_except GET", nginx)
        self.assertIn('add_header Cache-Control "no-store" always', nginx)
        self.assertIn("location /api/", nginx)
        prometheus_location = nginx.split("location /prometheus/", 1)[1].split("}", 1)[0]
        self.assertIn('proxy_set_header Cookie ""', prometheus_location)
        self.assertIn("location = /telemetry/prometheus/ready", nginx)
        self.assertIn("location = /telemetry/tempo/ready", nginx)
        self.assertGreaterEqual(nginx.count('proxy_set_header Cookie ""'), 3)
        self.assertNotIn("/api/decisions", nginx)
        self.assertNotIn("COPY reports", dockerfile)
        self.assertNotIn("COPY evidence", dockerfile)

    def test_persisted_quality_remains_available_while_live_telemetry_is_stopped(self):
        with running(FakeAgent) as agent:
            handler = partial(
                DashboardHandler, prometheus_url="http://127.0.0.1:1",
                tempo_url="http://127.0.0.1:2", agent_api_url=agent,
            )
            with running(handler) as dashboard:
                for path in ("/telemetry/prometheus/ready", "/telemetry/tempo/ready"):
                    with self.assertRaises(HTTPError) as raised:
                        self.opener.open(dashboard + path)
                    self.assertEqual(raised.exception.code, 502)
                    self.assertIn("no-store", raised.exception.headers.get("Cache-Control"))
                    raised.exception.close()
                request = Request(
                    dashboard + "/api/evaluations/runs/run-1",
                    headers={"Cookie": "deepagent_session=opaque"},
                )
                with self.opener.open(request) as response:
                    self.assertEqual(json.load(response)["runId"], "run-1")

    def test_prometheus_and_tempo_readiness_are_independent(self):
        FakePrometheus.last_cookie = None
        with running(FakePrometheus) as prometheus:
            handler = partial(
                DashboardHandler, prometheus_url=prometheus,
                tempo_url="http://127.0.0.1:2",
            )
            with running(handler) as dashboard:
                request = Request(
                    dashboard + "/telemetry/prometheus/ready",
                    headers={"Cookie": "must-not-forward"},
                )
                with self.opener.open(request) as response:
                    self.assertEqual(response.status, 200)
                self.assertIsNone(FakePrometheus.last_cookie)
                with self.assertRaises(HTTPError) as raised:
                    self.opener.open(dashboard + "/telemetry/tempo/ready")
                self.assertEqual(raised.exception.code, 502)
                raised.exception.close()


if __name__ == "__main__":
    unittest.main()
