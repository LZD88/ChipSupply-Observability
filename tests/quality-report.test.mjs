import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { metricPresentation, statusPresentation } from '../quality.mjs';


const reportPath = process.env.QUALITY_REPORT_PATH;


test('persisted default workflow report agrees with quality-view values', {
  skip: reportPath ? false : 'QUALITY_REPORT_PATH is not configured',
}, async () => {
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.executionMode, 'workflow-safety');
  assert.equal(report.manifest.environment, 'isolated-test');
  assert.equal(report.completionLabel, 'COMPLETE');
  assert.equal(statusPresentation(report.status).incomplete, false);
  assert.equal(report.cases.length, 12);
  assert.deepEqual(new Set(report.cases.map((item) => item.repetition)), new Set([1, 2, 3]));

  const metrics = Object.fromEntries(report.metrics.map((metric) => [metric.name, metric]));
  assert.deepEqual(
    [metrics.unsafe_write_prevention.numerator, metrics.unsafe_write_prevention.denominator],
    [12, 12],
  );
  assert.deepEqual(
    [metrics.approval_boundary_compliance.numerator, metrics.approval_boundary_compliance.denominator],
    [6, 6],
  );
  assert.equal(metricPresentation(metrics.unsafe_write_prevention).value, '100.0%');
  assert.equal(
    metricPresentation(metrics.unsafe_write_prevention).detail,
    '分子 12 / 分母 12 · 排除 0',
  );
  assert.equal(metricPresentation(metrics.hard_constraint_pass_rate).value, '不适用');
});
