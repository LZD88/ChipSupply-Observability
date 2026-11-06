"""Serve the local dashboard and its same-origin Prometheus proxy."""

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
    def __init__(self, *args, prometheus_url, **kwargs):
        self.prometheus_url = prometheus_url.rstrip("/")
        # Requests to the local data source should bypass system HTTP proxies.
        self.opener = build_opener(ProxyHandler({}))
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _reply(self, status, body, content_type, *, head_only=False):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _dispatch(self, *, head_only=False):
        path = urlsplit(self.path).path
        if path == "/healthz":
            self._reply(200, b"ok\n", "text/plain; charset=utf-8", head_only=head_only)
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

    def do_GET(self):
        self._dispatch()

    def do_HEAD(self):
        self._dispatch(head_only=True)

    def log_request(self, code="-", size="-"):
        if str(code).startswith(("4", "5")):
            super().log_request(code, size)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3002)
    parser.add_argument("--prometheus-url", default="http://127.0.0.1:9090")
    args = parser.parse_args()
    handler = partial(DashboardHandler, prometheus_url=args.prometheus_url)
    with ThreadingHTTPServer((args.host, args.port), handler) as server:
        print(f"Dashboard: http://{args.host}:{args.port}; Prometheus: {args.prometheus_url}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
