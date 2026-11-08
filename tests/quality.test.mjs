import test from 'node:test';
import assert from 'node:assert/strict';

import {
  metricPresentation,
  qualityState,
  regressionItems,
  statusPresentation,
  telemetryPresentation,
} from '../quality.mjs';


test('completed failed cancelled and partial statuses remain distinct', () => {
  assert.deepEqual(statusPresentation('COMPLETED'), {
    label: '已完成', tone: 'success', incomplete: false,
  });
  assert.equal(statusPresentation('FAILED').tone, 'danger');
  assert.equal(statusPresentation('CANCELLED').tone, 'muted');
  assert.equal(statusPresentation('PARTIAL').tone, 'warning');
  assert.equal(statusPresentation('PARTIAL').incomplete, true);
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
