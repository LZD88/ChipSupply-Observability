import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonRows } from '../workbench.mjs';

test('comparison exposes model prompt skill and code differences and does not invent missing cost', () => {
  const a = { cases: [{ status: 'PASSED' }], manifest: { modelId: 'deepseek-flash', promptVersion: 'v1', skillVariant: 'current', codeRevision: 'before' }, metrics: [] };
  const b = { cases: [{ status: 'FAILED' }], manifest: { modelId: 'deepseek-chat', promptVersion: 'v2', skillVariant: 'without-skills', codeRevision: 'after' }, metrics: [{ name: 'latency_distribution', value: { p95: 1200 }, denominator: 1 }] };
  const rows = comparisonRows(a, b);
  assert.deepEqual(rows.find(r => r[0] === '场景通过率'), ['场景通过率', '100.0%', '0.0%']);
  assert.deepEqual(rows.find(r => r[0] === 'P95 耗时'), ['P95 耗时', '未记录', '1.20 秒']);
  assert.deepEqual(rows.find(r => r[0] === '模型成本估算'), ['模型成本估算', '未记录', '未记录']);
  for (const label of ['调用模型', '提示词版本', '技能配置', '代码指纹']) assert.notEqual(...rows.find(r => r[0] === label).slice(1));
});
