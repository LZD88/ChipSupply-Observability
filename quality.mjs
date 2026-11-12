const QUALITY_API = '/api/evaluations';
const telemetryState = { prometheus: null, tempo: null };

export function metricPresentation(metric) {
  const denominator = Number(metric?.denominator || 0);
  const value = metric?.value;
  if (denominator === 0 || value == null) {
    return { value: '不适用', detail: `分母 0 · 排除 ${metric?.excluded || 0}`, state: 'not-applicable' };
  }
  const rendered = typeof value === 'number'
    ? (metric.unit === 'ratio' ? `${(value * 100).toFixed(1)}%` : value.toLocaleString('zh-CN'))
    : JSON.stringify(value);
  return {
    value: rendered,
    detail: `分子 ${metric.numerator ?? '—'} / 分母 ${denominator} · 排除 ${metric.excluded || 0}`,
    state: 'measured',
  };
}

export function qualityState({ status, runCount = 0 } = {}) {
  if (status === 401 || status === 403) return 'unauthorized';
  if (runCount === 0) return 'empty';
  return 'ready';
}

export function statusPresentation(status) {
  const normalized = String(status || 'UNKNOWN').toUpperCase();
  const labels = {
    COMPLETED: '已完成', FAILED: '失败', CANCELLED: '已取消', PARTIAL: '部分完成',
    TIMED_OUT: '超时', RUNNING: '运行中', QUEUED: '排队中',
  };
  const tone = normalized === 'COMPLETED' ? 'success'
    : ['FAILED', 'TIMED_OUT'].includes(normalized) ? 'danger'
      : normalized === 'CANCELLED' ? 'muted'
        : normalized === 'PARTIAL' ? 'warning' : 'active';
  return { label: labels[normalized] || normalized, tone, incomplete: normalized !== 'COMPLETED' };
}

export function regressionItems(comparisonPayload) {
  const comparison = comparisonPayload?.comparison || {};
  const caseLabel = (item) => `${item.scenarioId}${item.repetition == null ? '' : ` · 第 ${item.repetition} 次`}`;
  const scenario = (comparison.scenarioDiffs || []).filter(
    (item) => item.assertionRegression || item.recommendation?.changed,
  ).map((item) => ({
    kind: item.assertionRegression ? 'assertion' : 'recommendation',
    label: item.assertionRegression
      ? `${caseLabel(item)}：断言从通过变为未通过`
      : `${caseLabel(item)}：推荐 ${item.recommendation.before ?? '无'} → ${item.recommendation.after ?? '无'}`,
  }));
  const gates = (comparisonPayload?.gates?.failures || []).map((item) => ({
    kind: item.priority === 'SAFETY' ? 'safety' : 'gate',
    label: item.metric
      ? `${item.metric}：${item.actual} < ${item.threshold}`
      : `${caseLabel(item)}：断言回归`,
  }));
  const summaryLabel = (summary) => {
    if (!summary?.sampleCount) return '无样本';
    const rate = `${(summary.passRate * 100).toFixed(1)}%（${summary.passedCount}/${summary.sampleCount}）`;
    const variation = summary.hasVariation == null ? '样本不足以判断波动'
      : summary.hasVariation ? '重复结果有差异' : '已观察结果一致';
    return `${rate} · ${variation}`;
  };
  const summaries = (comparison.scenarioSummaries || []).map((item) => ({
    kind: 'summary',
    label: `${item.scenarioId}：基线 ${summaryLabel(item.before)} → 当前 ${summaryLabel(item.after)}`,
  }));
  return [...gates, ...scenario, ...summaries];
}

export function telemetryPresentation(available, label) {
  if (available === true) return { label, state: 'available', disabled: false };
  if (available === false) return { label: `${label}（不可用）`, state: 'unavailable', disabled: true };
  return { label: `${label}（状态未验证）`, state: 'unknown', disabled: false };
}

function element(id) { return document.getElementById(id); }
function clear(node) { node.replaceChildren(); }
function textNode(tag, value, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

async function api(path) {
  const response = await fetch(`${QUALITY_API}${path}`, {
    credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const error = new Error(`评测 API HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function showState(name, message = '') {
  const host = element('quality-state');
  host.dataset.state = name;
  host.textContent = message;
  host.hidden = name === 'ready';
  element('quality-content').hidden = name !== 'ready';
}

function renderRunHeader(report, baseline) {
  const status = statusPresentation(report.status);
  const badge = element('quality-run-status');
  badge.textContent = status.label;
  badge.className = `quality-status ${status.tone}`;
  element('quality-suite').textContent = `${report.suiteId}@${report.suiteVersion}`;
  element('quality-environment').textContent = report.manifest?.environment || '未记录';
  element('quality-mode').textContent = report.executionMode || report.manifest?.executionMode || '未记录';
  element('quality-baseline').textContent = baseline?.runId || '未设置';
  element('quality-evidence-label').textContent = '离线 / 测试证据';
  element('quality-incomplete').hidden = !status.incomplete;
}

function renderMetrics(metrics) {
  const host = element('quality-metrics'); clear(host);
  (metrics || []).forEach((metric) => {
    const display = metricPresentation(metric);
    const row = document.createElement('tr'); row.dataset.state = display.state;
    row.append(
      textNode('td', metric.name || '未命名指标'),
      textNode('td', display.value, 'metric-value'),
      textNode('td', display.detail),
      textNode('td', metric.executionMode || '—'),
    );
    host.append(row);
  });
  if (!host.children.length) {
    const row = document.createElement('tr');
    const cell = textNode('td', '该运行尚未产生指标', 'quality-empty-row'); cell.colSpan = 4;
    row.append(cell); host.append(row);
  }
}

function traceUrl(traceId) {
  const left = encodeURIComponent(JSON.stringify({
    datasource: 'tempo', queries: [{ refId: 'A', query: traceId, queryType: 'traceql' }],
    range: { from: 'now-1h', to: 'now' },
  }));
  return `http://localhost:3001/explore?left=${left}`;
}

function renderScenarios(cases) {
  const host = element('quality-scenarios'); clear(host);
  (cases || []).forEach((item) => {
    const details = document.createElement('details'); details.className = 'quality-scenario';
    const summary = document.createElement('summary');
    summary.append(
      textNode('span', item.scenarioId || '未命名场景'),
      textNode('span', `#${item.repetition || 1}`),
      textNode('b', statusPresentation(item.status).label, `scenario-status ${statusPresentation(item.status).tone}`),
    );
    details.append(summary);
    const assertions = textNode('p', `断言：${(item.assertions || []).filter((a) => a.status === 'PASSED').length}/${(item.assertions || []).length} 通过`);
    details.append(assertions);
    const links = document.createElement('div'); links.className = 'scenario-links';
    const decisionId = item.result?.decisionId || item.result?.decision_id;
    const traceId = item.result?.traceId || item.result?.trace_id;
    if (decisionId) {
      const link = textNode('a', `决策证据 ${decisionId}`); link.href = `http://localhost:3000/?decisionId=${encodeURIComponent(decisionId)}`;
      link.target = '_blank'; link.rel = 'noopener'; links.append(link);
    }
    if (traceId) {
      const link = textNode('a', `Trace ${traceId}`); link.href = traceUrl(traceId);
      link.dataset.label = `Trace ${traceId}`; link.dataset.href = link.href;
      link.target = '_blank'; link.rel = 'noopener'; link.dataset.telemetry = 'tempo'; links.append(link);
    }
    if (!links.children.length) links.append(textNode('span', '无可用的决策或 Trace 关联'));
    details.append(links); host.append(details);
  });
  if (!host.children.length) host.append(textNode('p', '该运行尚未产生场景结果', 'quality-empty-row'));
}

function renderRegressions(payload) {
  const host = element('quality-regressions'); clear(host);
  const items = regressionItems(payload);
  if (!items.length) {
    host.append(textNode('li', payload ? '未发现相对基线的回归' : '无可比较基线'));
    return;
  }
  items.forEach((item) => host.append(textNode('li', item.label, `regression-${item.kind}`)));
}

function updateTelemetry(detail = {}) {
  for (const name of ['prometheus', 'tempo']) {
    if (Object.prototype.hasOwnProperty.call(detail, name)) telemetryState[name] = detail[name];
  }
  for (const name of ['prometheus', 'tempo']) {
    const node = element(`quality-${name}-link`);
    if (!node) continue;
    const display = telemetryPresentation(telemetryState[name], node.dataset.label);
    node.textContent = display.label; node.dataset.state = display.state;
    node.setAttribute('aria-disabled', String(display.disabled));
    if (display.disabled) node.removeAttribute('href'); else node.href = node.dataset.href;
  }
  document.querySelectorAll('[data-telemetry="tempo"]').forEach((node) => {
    const display = telemetryPresentation(telemetryState.tempo, node.dataset.label);
    node.textContent = display.label; node.dataset.state = display.state;
    node.setAttribute('aria-disabled', String(display.disabled));
    if (display.disabled) node.removeAttribute('href'); else node.href = node.dataset.href;
  });
}

async function probeTelemetry() {
  const probe = async (path) => {
    try {
      const response = await fetch(path, {
        credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(3500),
      });
      return response.ok;
    } catch (_error) { return false; }
  };
  const [prometheus, tempo] = await Promise.all([
    probe('/telemetry/prometheus/ready'), probe('/telemetry/tempo/ready'),
  ]);
  updateTelemetry({ prometheus, tempo });
}

async function loadReport(runId) {
  showState('loading', '正在读取持久化评测报告…');
  try {
    const report = await api(`/runs/${encodeURIComponent(runId)}`);
    let baseline = null; let comparison = null;
    try {
      baseline = await api(`/baselines/${encodeURIComponent(report.suiteId)}/${encodeURIComponent(report.executionMode)}`);
      if (report.status === 'COMPLETED' && baseline.runId !== report.runId) {
        comparison = await api(`/comparisons?candidateRunId=${encodeURIComponent(report.runId)}&baselineRunId=${encodeURIComponent(baseline.runId)}`);
      }
    } catch (error) {
      if (![404, 409, 422].includes(error.status)) throw error;
    }
    renderRunHeader(report, baseline); renderMetrics(report.metrics); renderRegressions(comparison);
    renderScenarios(report.cases); showState('ready');
  } catch (error) {
    if ([401, 403].includes(error.status)) showState('unauthorized', '没有查看决策质量的权限，请在 Agent 登录并申请 evaluation:view。');
    else showState('error', `持久化评测报告暂时不可用：${error.message}`);
  }
}

async function loadRuns() {
  showState('loading', '正在读取评测运行…');
  try {
    const payload = await api('/runs?size=50');
    const viewState = qualityState({ runCount: payload.items?.length || 0 });
    if (viewState === 'empty') { showState('empty', '还没有评测运行。请先执行默认套件并发布基线。'); return; }
    const select = element('quality-run-select'); clear(select);
    payload.items.forEach((run) => {
      const option = document.createElement('option'); option.value = run.runId;
      option.textContent = `${run.suiteId}@${run.suiteVersion} · ${statusPresentation(run.status).label} · ${run.runId.slice(0, 8)}`;
      select.append(option);
    });
    await loadReport(select.value);
  } catch (error) {
    if ([401, 403].includes(error.status)) showState('unauthorized', '没有查看决策质量的权限，请在 Agent 登录并申请 evaluation:view。');
    else showState('error', `持久化评测报告暂时不可用：${error.message}`);
  }
}

export function bootQualityView() {
  const qualityView = element('quality-view');
  if (!qualityView) return;
  element('show-live').addEventListener('click', () => {
    element('live-view').hidden = false; qualityView.hidden = true;
    element('show-live').classList.add('active'); element('show-quality').classList.remove('active');
  });
  element('show-quality').addEventListener('click', () => {
    element('live-view').hidden = true; qualityView.hidden = false;
    element('show-live').classList.remove('active'); element('show-quality').classList.add('active');
    loadRuns(); probeTelemetry();
  });
  element('quality-refresh').addEventListener('click', () => { loadRuns(); probeTelemetry(); });
  element('quality-run-select').addEventListener('change', (event) => loadReport(event.target.value));
  window.addEventListener('live-telemetry-status', (event) => updateTelemetry(event.detail));
  updateTelemetry({ prometheus: null, tempo: null });
  probeTelemetry();
}

if (typeof document !== 'undefined') bootQualityView();
