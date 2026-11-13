import json
from functools import partial
from http.server import BaseHTTPRequestHandler
from urllib.error import HTTPError
from urllib.request import Request, ProxyHandler, build_opener
import unittest

from test_serve import running
from serve import DashboardHandler


class WritableAgent(BaseHTTPRequestHandler):
    received = None
    def do_POST(self):
        type(self).received = (self.path, self.headers.get('Cookie'), self.headers.get('X-Requested-With'), self.rfile.read(int(self.headers.get('Content-Length', 0))))
        self.send_response(202)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"runId":"queued"}')
    do_PUT = do_POST
    def log_message(self, *_args):
        pass


class WorkbenchProxyTests(unittest.TestCase):
    def test_mutation_allowlist_preserves_auth_and_body_and_blocks_other_routes(self):
        opener = build_opener(ProxyHandler({}))
        with running(WritableAgent) as upstream:
            with running(partial(DashboardHandler, prometheus_url='http://127.0.0.1:1', agent_api_url=upstream)) as dashboard:
                for method, path in [('POST', '/tasks'), ('POST', '/experiments'), ('POST', '/failures'), ('POST', '/online-failures/capture'), ('POST', '/failures/id/replay'), ('POST', '/runs/id/cancel'), ('PUT', '/baselines')]:
                    request = Request(dashboard + '/api/evaluations' + path, data=b'{"test":1}', method=method,
                        headers={'Cookie': 'deepagent_session=opaque', 'X-Requested-With': 'DeepAgent'})
                    with opener.open(request) as response:
                        self.assertEqual(response.status, 202)
                        self.assertIn('no-store', response.headers['Cache-Control'])
                    self.assertEqual(WritableAgent.received[1:], ('deepagent_session=opaque', 'DeepAgent', b'{"test":1}'))
                for path, code, headers in [('/tasks', 403, {}), ('/tasks', 413, {'X-Requested-With': 'DeepAgent', 'Content-Length': '999999'}), ('/runs', 405, {'X-Requested-With': 'DeepAgent'}), ('/../auth/login', 405, {})]:
                    request = Request(dashboard + '/api/evaluations' + path, data=b'{}', headers=headers)
                    with self.assertRaises(HTTPError) as raised:
                        opener.open(request)
                    self.assertEqual(raised.exception.code, code)
                    raised.exception.close()
