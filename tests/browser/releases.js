/* Evaluate in the /#releases browser tab. All injected data stays in this tab. */
(async () => {
  const original = window.fetch;
  const results = [];
  const assert = (ok, message) => { if (!ok) throw new Error(message); results.push(message); };
  const wait = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('view wait timed out'); };
  let status = 200, calls = 0;
  const empty = { completedCount: 0, sufficient: false, successRate: null, p50Seconds: null, p95Seconds: null, usageSamples: 0, estimatedCostUsd: null };
  window.fetch = async (url, options) => {
    if (!String(url).includes('/api/prompt-releases/')) return original(url, options);
    calls++;
    if (status !== 200) return new Response('{}', { status });
    const key = String(url).split('/').pop();
    const body = key === 'state' ? { enabled: true, stable: 'test-stable', canary: null, percentage: 0, status: 'STABLE', revision: 1 }
      : key === 'observations' ? { cohorts: { stable: empty, canary: empty }, pendingApprovals: [{ version: '<unsafe-v1>', count: 2 }] }
      : { gates: [{ candidate_version: '<img src=x onerror=alert(1)>', passed: false, evidence: { reasons: ['blocked'] } }], events: [] };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  };
  const refresh = async () => {
    const start = calls;
    [...document.querySelectorAll('button')].find(b => b.textContent === '刷新发布记录').click();
    await wait(() => calls >= start + 3);
    await new Promise(r => setTimeout(r, 30));
  };
  try {
    await refresh();
    assert(document.getElementById('release-comparison').textContent.includes('样本不足'), 'insufficient sample warning');
    assert(document.getElementById('release-comparison').textContent.includes('—'), 'missing usage and latency stay unknown');
    assert(document.getElementById('release-pending').textContent.includes('<unsafe-v1>'), 'pending original approval version');
    assert(!document.getElementById('release-history').querySelector('img'), 'gate values rendered as text');
    for (const code of [401, 403, 503]) {
      status = code; await refresh();
      assert(document.getElementById('release-status').textContent.includes(code === 503 ? '暂时不可用' : '权限'), `${code} error state`);
      assert(!document.getElementById('release-history').textContent && !document.getElementById('release-cards').textContent, `${code} removes stale data`);
    }
    status = 200;
    location.hash = 'quality'; await new Promise(r => setTimeout(r, 30));
    location.hash = 'releases'; await new Promise(r => setTimeout(r, 50));
    assert(document.getElementById('release-status').textContent.includes('MySQL'), 'hash navigation restores persistent view');
    return { passed: results.length, results };
  } finally { window.fetch = original; [...document.querySelectorAll('button')].find(b => b.textContent === '刷新发布记录').click(); }
})()
