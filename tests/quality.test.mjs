import test from 'node:test';
import assert from 'node:assert/strict';

import {
  accessPresentation,
  assistantLoginUrl,
  metricPresentation,
  qualityState,
  regressionItems,
  statusPresentation,
  telemetryPresentation,
} from '../quality.mjs';

test('expired login and missing report access give different next steps', () => {
  assert.equal(accessPresentation(401).loginRequired, true);
  assert.match(accessPresentation(401).message, /登录已过期/);
  assert.equal(accessPresentation(403).loginRequired, false);
  assert.match(accessPresentation(403).message, /你已登录/);
});

test('login keeps the dashboard hostname so the session cookie is shared', () => {
  assert.equal(assistantLoginUrl('http://localhost:3002/?x=1#evaluations'), 'http://localhost:3000/');
  assert.equal(assistantLoginUrl('http://127.0.0.1:3002/#evaluations'), 'http://127.0.0.1:3000/');
});


test('completed failed cancelled and partial statuses remain distinct', () => {
  assert.deepEqual(statusPresentation('COMPLETED'), {
    label: '已完成', tone: 'success', incomplete: false,
  });
  assert.equal(statusPresentation('FAILED').tone, 'danger');
  assert.equal(statusPresentation('CANCELLED').tone, 'muted');
  assert.equal(statusPresentation('PARTIAL').tone, 'warning');
  assert.equal(statusPresentation('PARTIAL').incomplete, true);
  assert.deepEqual(statusPresentation('PASSED'), { label: '通过', tone: 'success', incomplete: false });
});

test('structured telemetry shows readable values and units without changing sample counts', () => {
  const latency = metricPresentation({ name: 'latency_distribution', denominator: 4, excluded: 2,
    value: { p50: 120, p95: 250, min: 0, max: 300 } });
  assert.equal(latency.value, 'P50 120 ms · P95 250 ms · 最小 0 ms · 最大 300 ms');
  assert.equal(latency.detail, '分子 — / 分母 4 · 排除 2');
  const tokens = metricPresentation({ name: 'token_usage', denominator: 4, numerator: 1500,
    value: { input: 1000, output: 500, total: 1500 } });
  assert.equal(tokens.value, '总计 1,500 · 输入 1,000 · 输出 500');
});

test('zero denominator is not presented as a pass', () => {
  const display = metricPresentation({ value: null, denominator: 0, excluded: 4 });
  assert.equal(display.value, '不适用');
  assert.match(display.detail, /分母 0/);
  assert.equal(display.state, 'not-applicable');
});

test('unauthorized and empty views are explicit states', () => {
  assert.equal(qualityState({ status: 403, runCount: 8 }), 'unauthorized');
  assert.equal(qualityState({ runCount: 0 }), 'empty');
  assert.equal(qualityState({ runCount: 1 }), 'ready');
});

test('regressions include gates, assertion failures, and recommendation changes', () => {
  const items = regressionItems({
    gates: { failures: [{ metric: 'unsafe_write_prevention', actual: 0, threshold: 1, priority: 'SAFETY' }] },
    comparison: { scenarioDiffs: [
      { scenarioId: 'unsafe', assertionRegression: true, recommendation: { changed: false } },
      { scenarioId: 'choice', assertionRegression: false, recommendation: { changed: true, before: 1, after: 2 } },
    ] },
  });
  assert.deepEqual(items.map((item) => item.kind), ['safety', 'assertion', 'recommendation']);
});

test('Prometheus and Tempo availability degrade independently', () => {
  assert.equal(telemetryPresentation(false, 'Prometheus').disabled, true);
  assert.equal(telemetryPresentation(true, 'Tempo').disabled, false);
  assert.equal(telemetryPresentation(null, 'Tempo').state, 'unknown');
});

test('repeated regressions identify the execution and display all-sample stability', () => {
  const items = regressionItems({
    gates: { failures: [{ scenarioId: 'choice', repetition: 1, priority: 'ASSERTION' }] },
    comparison: {
      scenarioDiffs: [
        { scenarioId: 'choice', repetition: 1, assertionRegression: true, recommendation: { changed: true } },
        { scenarioId: 'choice', repetition: 2, assertionRegression: false, recommendation: { changed: true, before: 1, after: 2 } },
      ],
      scenarioSummaries: [{
        scenarioId: 'choice',
        before: { sampleCount: 3, passedCount: 3, passRate: 1, hasVariation: false },
        after: { sampleCount: 3, passedCount: 2, passRate: 2 / 3, hasVariation: true },
      }],
    },
  });
  assert.match(items[0].label, /第 1 次/);
  assert.match(items[1].label, /第 1 次/);
  assert.match(items[2].label, /第 2 次/);
  const summary = items.find((item) => item.kind === 'summary');
  assert.match(summary.label, /100\.0%（3\/3）/);
  assert.match(summary.label, /66\.7%（2\/3）/);
  assert.match(summary.label, /重复结果有差异/);
});

test('missing and single samples are not presented as stable repeats', () => {
  const [item] = regressionItems({ comparison: { scenarioSummaries: [{
    scenarioId: 'new-case',
    before: { sampleCount: 0, passedCount: 0, passRate: null, hasVariation: null },
    after: { sampleCount: 1, passedCount: 1, passRate: 1, hasVariation: null },
  }] } });
  assert.match(item.label, /基线 无样本/);
  assert.match(item.label, /样本不足以判断波动/);
  assert.doesNotMatch(item.label, /已观察结果一致/);
});
