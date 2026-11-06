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
from urllib.request import ProxyHandler, build_opener

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
    def do_GET(self):
        body = json.dumps({"status": "success", "path": self.path}).encode()
        self.send_response(400 if "bad_query" in self.path else 200)
        self.send_header("Content-Type", "application/json")
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


if __name__ == "__main__":
    unittest.main()
