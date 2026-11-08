"""Serve the local dashboard and same-origin Prometheus/quality proxies."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener


ROOT = Path(__file__).resolve().parent


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, prometheus_url, agent_api_url="http://127.0.0.1:8090",
                 tempo_url="http://127.0.0.1:3200", **kwargs):
        self.prometheus_url = prometheus_url.rstrip("/")
        self.agent_api_url = agent_api_url.rstrip("/")
        self.tempo_url = tempo_url.rstrip("/")
        # Requests to the local data source should bypass system HTTP proxies.
        self.opener = build_opener(ProxyHandler({}))
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _reply(self, status, body, content_type, *, head_only=False, no_store=False):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if no_store:
            self.send_header("Cache-Control", "no-store")
            self.send_header("Pragma", "no-cache")
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _dispatch(self, *, head_only=False):
        path = urlsplit(self.path).path
        if path == "/healthz":
            self._reply(200, b"ok\n", "text/plain; charset=utf-8", head_only=head_only)
            return
        if path in {"/telemetry/prometheus/ready", "/telemetry/tempo/ready"}:
            upstream = (self.prometheus_url + "/-/ready" if "prometheus" in path
                        else self.tempo_url + "/ready")
            self._proxy_health(upstream, head_only=head_only)
            return
        if path == "/api/evaluations" or path.startswith("/api/evaluations/"):
            self._proxy_quality(head_only=head_only)
            return
        if path.startswith("/api/"):
            body = json.dumps({"detail": "not found"}).encode()
            self._reply(404, body, "application/json; charset=utf-8",
                        head_only=head_only, no_store=True)
            return
        if not path.startswith("/prometheus/"):
            if head_only:
                super().do_HEAD()
            else:
                super().do_GET()
            return

        # Append to a fixed upstream. Never interpret browser input as a host.
        target = self.prometheus_url + "/" + self.path[len("/prometheus/"):]
        request = Request(target, headers={"Accept": "application/json"})
        try:
            with self.opener.open(request, timeout=8) as response:
                self._reply(response.status, response.read(),
                            response.headers.get("Content-Type", "application/json"),
                            head_only=head_only)
        except HTTPError as error:
            self._reply(error.code, error.read(),
                        error.headers.get("Content-Type", "application/json"),
                        head_only=head_only)
        except (URLError, TimeoutError, OSError):
            body = json.dumps({"status": "error", "errorType": "unavailable",
                               "error": "Prometheus unavailable; check the local service on port 9090."}).encode()
            self._reply(502, body, "application/json; charset=utf-8", head_only=head_only)

    def _proxy_quality(self, *, head_only=False):
        # Only a fixed Agent origin and the evaluation prefix are reachable.
        headers = {"Accept": "application/json"}
        cookie = self.headers.get("Cookie")
        if cookie:
            headers["Cookie"] = cookie
        request = Request(self.agent_api_url + self.path, headers=headers,
                          method="HEAD" if head_only else "GET")
        try:
            with self.opener.open(request, timeout=15) as response:
                self._reply(response.status, response.read(),
                            response.headers.get("Content-Type", "application/json"),
                            head_only=head_only, no_store=True)
        except HTTPError as error:
            self._reply(error.code, error.read(),
                        error.headers.get("Content-Type", "application/json"),
                        head_only=head_only, no_store=True)
        except (URLError, TimeoutError, OSError):
            body = json.dumps({"detail": "Evaluation API unavailable"}).encode()
            self._reply(502, body, "application/json; charset=utf-8",
                        head_only=head_only, no_store=True)

    def _proxy_health(self, target, *, head_only=False):
        request = Request(target, headers={"Accept": "text/plain"},
                          method="HEAD" if head_only else "GET")
        try:
            with self.opener.open(request, timeout=3) as response:
                self._reply(response.status, response.read(),
                            response.headers.get("Content-Type", "text/plain"),
                            head_only=head_only, no_store=True)
        except HTTPError as error:
            self._reply(error.code, error.read(),
                        error.headers.get("Content-Type", "text/plain"),
                        head_only=head_only, no_store=True)
        except (URLError, TimeoutError, OSError):
            self._reply(502, b"unavailable\n", "text/plain; charset=utf-8",
                        head_only=head_only, no_store=True)

    def do_GET(self):
        self._dispatch()

    def do_HEAD(self):
        self._dispatch(head_only=True)

    def do_POST(self):
        path = urlsplit(self.path).path
        if path == "/api/evaluations" or path.startswith("/api/evaluations/"):
            body = json.dumps({"detail": "read-only quality proxy"}).encode()
            self._reply(405, body, "application/json; charset=utf-8", no_store=True)
            return
        self.send_error(404)

    def log_request(self, code="-", size="-"):
        if str(code).startswith(("4", "5")):
            super().log_request(code, size)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3002)
    parser.add_argument("--prometheus-url", default="http://127.0.0.1:9090")
    parser.add_argument("--agent-api-url", default="http://127.0.0.1:8090")
    parser.add_argument("--tempo-url", default="http://127.0.0.1:3200")
    args = parser.parse_args()
    handler = partial(DashboardHandler, prometheus_url=args.prometheus_url,
                      agent_api_url=args.agent_api_url, tempo_url=args.tempo_url)
    with ThreadingHTTPServer((args.host, args.port), handler) as server:
        print(f"Dashboard: http://{args.host}:{args.port}; Prometheus: {args.prometheus_url}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
