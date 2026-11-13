from functools import partial
import json
import unittest
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError
from test_serve import running, FakeAgent
from serve import DashboardHandler, release_read_path


class ReleaseProxyTests(unittest.TestCase):
    def test_exact_whitelist_and_read_only_methods(self):
        opener = build_opener(ProxyHandler({}))
        for path in ('/api/prompt-releases/state', '/api/prompt-releases/versions/builtin-v1', '/api/prompt-releases/observations'):
            self.assertTrue(release_read_path(path))
        for path in ('/api/prompt-releases/canary', '/api/prompt-releases/versions/../canary', '/api/prompt-releases/state/extra', '/api/chat', '/api/prompt-releases/versions/%2f..'):
            self.assertFalse(release_read_path(path))
        with running(FakeAgent) as agent, running(partial(DashboardHandler, prometheus_url='http://127.0.0.1:1', agent_api_url=agent)) as dashboard:
            with opener.open(Request(dashboard+'/api/prompt-releases/state', headers={'Cookie':'deepagent_session=opaque'})) as response:
                self.assertIn('no-store', response.headers['Cache-Control'])
                self.assertEqual(json.load(response)['path'], '/api/prompt-releases/state')
            for method in ('POST','PUT','PATCH','DELETE'):
                with self.assertRaises(HTTPError) as raised:
                    opener.open(Request(dashboard+'/api/prompt-releases/canary',method=method,data=b'{}'))
                self.assertEqual(raised.exception.code,405)
                raised.exception.close()
            with self.assertRaises(HTTPError) as raised:
                opener.open(dashboard+'/api/prompt-releases/canary')
            self.assertEqual(raised.exception.code,404)
            raised.exception.close()
