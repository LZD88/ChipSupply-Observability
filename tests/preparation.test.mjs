import test from 'node:test';
import assert from 'node:assert/strict';
import { preparationQueries, preparationPresentation, renderPreparation, refreshPreparation } from '../preparation.mjs';
const metric = (n) => [{ value: [0, String(n)] }];

test('queries isolate ready waits and fixed phases in a five minute window', () => {
  assert.match(preparationQueries.waitP95, /histogram_quantile\(0.95/);
  assert.match(preparationQueries.waitP95, /outcome="ready".*\[5m\]/);
  assert.match(preparationQueries.samples, /increase\(agent_preparation_wait_seconds_count/);
  assert.match(preparationQueries.failures, /outcome="failure"/);
  for (const phase of ['sandbox', 'graph', 'sync']) assert.ok(preparationQueries[phase].includes(`stage="${phase}"`));
  assert.ok(!Object.values(preparationQueries).some((q) => /user_id|thread_id|sandbox_id/.test(q)));
});

test('rendering keeps seconds samples low sample warning and independent outcomes', () => {
  const data = { waitP95: metric(.15), samples: metric(1.1), failures: metric(2), timeouts: metric(3),
    cancelled: metric(4), graphHit: metric(.5), healthHit: metric(.9), sandbox: metric(.2),
    graph: metric(.1), sync: metric(.05), poolReady: metric(2), poolTarget: metric(2), poolCreating: metric(0) };
  const view = preparationPresentation(data);
  assert.equal(view.p95, '0.150 s');
  assert.match(view.note, /样本较少，直方图估算/);
  assert.match(view.samples, /5 分钟.*约 1.1/);
  assert.match(view.outcomes, /失败 约 2.*超时 约 3.*取消 约 4/);
  assert.match(view.cache, /50.0%.*90.0%/);
  assert.match(view.pool, /2 \/ 2.*创建中 0/);
  const nodes = new Map();
  renderPreparation({ getElementById(id) { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); } }, data);
  assert.equal(nodes.get('preparation-p95').textContent, '0.150 s');
  assert.equal(preparationPresentation({ ...data, samples: metric(30) }).note, '直方图估算');
});

test('old agent zero denominators no observations and partial outage remain explicit', async () => {
  assert.match(preparationPresentation({}).note, /等待样本.*旧版/);
  assert.equal(preparationPresentation({ samples: metric(0), waitP95: metric(NaN) }).p95, '—');
  assert.match(preparationPresentation({ graphHit: metric(NaN) }).cache, /等待样本/);
  const nodes = new Map();
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); } };
  await refreshPreparation(async () => { throw new Error('offline'); }, document);
  assert.match(nodes.get('preparation-note').textContent, /不可用/);
  assert.equal(nodes.get('preparation-p95').textContent, '—');
});
