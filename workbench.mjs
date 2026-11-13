import { metricPresentation, statusPresentation } from './quality.mjs';

const $ = id => document.getElementById(id);
const names = { 'light-chat': '日常问答', 'light-read': '库存查询', 'light-boundary': '危险请求拦截', 'main-delegate': '主助手委派分析', 'analyst-compare': '采购比价', 'order-reject': '拒绝下单审批', 'order-approve': '批准下单审批', 'order-missing': '缺少下单信息', 'orchestrator-order': '完整采购协同', 'analyst-budget': '预算不足', 'order-tampering': '篡改价格拦截', 'order-duplicate': '重复下单拦截', 'analyst-downstream': '下游服务故障' };
const modes = { experiment: '真实 Agent 调用', 'rule-contract': '采购规则检查', 'workflow-safety': '审批边界模拟' };
names['analyst-skills'] = '采购技能读取与分析';
let catalog, report, failurePage = 1, busy = false, comparisonSequence = 0;
let onlineFailures = [];
function node(tag, text, className) { const n = document.createElement(tag); n.textContent = text; if (className) n.className = className; return n; }
function option(value, text) { const n = node('option', text); n.value = value; return n; }
function message(text, error = false) { $('wb-message').textContent = text; $('wb-message').classList.toggle('wb-error', error); }
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api/evaluations${path}`, { method, credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Requested-With': 'DeepAgent' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `操作失败（${response.status}），请检查输入或登录状态`);
  return data;
}
function access() {
  document.querySelectorAll('[data-maintain]').forEach(n => { n.disabled = busy || !catalog?.canMaintain || n.dataset.replaying === 'true'; });
  if (report) updateRun(report);
}
async function act(fn) {
  if (busy) return;
  busy = true; access();
  try { await fn(); } catch (error) { message(error.message, true); }
  finally { busy = false; access(); }
}
function variantFields(host, prefix) {
  host.replaceChildren();
  for (const [key, label, items] of [
    ['promptVersion', '提示词版本', (catalog.prompts || []).map(p => [p.version, p.change_note || p.version])],
    ['modelId', '调用模型', (catalog.models || []).map(m => [m, m])],
    ['skillVariant', '技能配置', (catalog.skills || []).map(s => [s.id, s.title])],
  ]) {
    const field = node('label', label), select = document.createElement('select'); select.id = `${prefix}-${key}`;
    if (key === 'promptVersion') select.append(option('', '当前正式版'));
    for (const [value, title] of items) select.append(option(value, title));
    if (key === 'modelId') select.value = catalog.defaultModel || 'deepseek-flash';
    field.append(select); host.append(field);
  }
}
function variant(prefix) {
  return { promptVersion: $(`${prefix}-promptVersion`).value || null, modelId: $(`${prefix}-modelId`).value || null, skillVariant: $(`${prefix}-skillVariant`).value };
}
function task() {
  const suite = catalog.suites[Number($('wb-suite').value)];
  const scenarioIds = [...$('wb-scenarios').querySelectorAll('input:checked')].map(n => n.value);
  if (!scenarioIds.length) throw new Error('请至少选择一个场景');
  return { suiteId: suite.suiteId, suiteVersion: suite.version, executionMode: $('wb-mode').value,
    repetitions: Number($('wb-repetitions').value), scenarioIds, ...variant('wb-task') };
}
function renderScenarios() {
  const suite = catalog.suites[Number($('wb-suite').value)], mode = $('wb-mode').value;
  $('wb-scenarios').replaceChildren();
  for (const scenario of suite.scenarios.filter(s => s.executionMode === mode || mode === 'experiment' && s.executionMode === 'prompt-candidate')) {
    const label = node('label', ''), input = document.createElement('input'); input.type = 'checkbox'; input.value = scenario.id;
    input.checked = true; label.title = scenario.fixture.question || scenario.title;
    label.append(input, node('span', names[scenario.id] || scenario.title)); $('wb-scenarios').append(label);
  }
  $('wb-task-variant').hidden = mode !== 'experiment';
  $('wb-repetitions').disabled = mode === 'rule-contract';
  if (mode === 'rule-contract') $('wb-repetitions').value = '1';
  $('wb-task-hint').textContent = mode === 'experiment' ? '会产生模型调用费用；订单和工具使用隔离测试数据。完整套件可能需要几分钟。' : '使用固定测试数据；审批边界模拟不调用真实模型。';
}
function renderModes() {
  const suite = catalog.suites[Number($('wb-suite').value)];
  $('wb-mode').replaceChildren(...suite.modes.map(m => option(m, modes[m] || m)));
  renderScenarios();
}
function openRun(runId) { window.dispatchEvent(new CustomEvent('evaluation-open-run', { detail: { runId } })); }
function selectTab(tab) {
  document.querySelectorAll('[data-wb-tab]').forEach(n => { n.setAttribute('aria-selected', String(n.dataset.wbTab === tab)); });
  for (const key of ['task', 'experiment', 'failures']) $(`wb-${key}`).hidden = key !== tab;
}
export function comparisonRows(a, b) {
  const find = (r, name) => (r.metrics || []).find(m => m.name === name);
  const quality = r => { const cases = r.cases || []; return r.quality ?? (cases.length ? cases.filter(c => c.status === 'PASSED').length / cases.length : null); };
  const value = (r, name) => find(r, name)?.value;
  const pass = r => quality(r) == null ? '尚无结果' : `${(quality(r) * 100).toFixed(1)}%`;
  const metric = (r, name) => find(r, name) ? metricPresentation(find(r, name)).value : '未记录';
  return [
    ['场景通过率', pass(a), pass(b)],
    ['P95 耗时', value(a, 'latency_distribution')?.p95 == null ? '未记录' : `${(value(a, 'latency_distribution').p95 / 1000).toFixed(2)} 秒`, value(b, 'latency_distribution')?.p95 == null ? '未记录' : `${(value(b, 'latency_distribution').p95 / 1000).toFixed(2)} 秒`],
    ['Token 用量', metric(a, 'token_usage'), metric(b, 'token_usage')],
    ['模型成本估算', metric(a, 'estimated_model_cost'), metric(b, 'estimated_model_cost')],
    ...[['modelId', '调用模型'], ['promptVersion', '提示词版本'], ['skillVariant', '技能配置'], ['codeRevision', '代码指纹']].map(([k, label]) => [label, a.manifest?.[k] || '未记录', b.manifest?.[k] || '未记录']),
  ];
}
function renderComparison(a, b, comparison) {
  const host = $('wb-comparison'); host.replaceChildren();
  const table = document.createElement('table'); table.className = 'quality-table';
  const head = document.createElement('thead'), header = document.createElement('tr');
  for (const text of ['对比项目', `方案 A · ${statusPresentation(a.status).label}`, `方案 B · ${statusPresentation(b.status).label}`]) header.append(node('th', text));
  head.append(header); table.append(head); const body = document.createElement('tbody');
  for (const [label, before, after] of comparisonRows(a, b)) {
    const row = document.createElement('tr');
    for (const value of [label, before, after]) { const cell = node('td', label === '代码指纹' ? String(value).slice(0, 12) : value); cell.title = value; row.append(cell); }
    if (before !== after) row.className = 'wb-changed'; body.append(row);
  }
  table.append(body); host.append(table);
  const links = node('div', '', 'wb-footer');
  for (const [label, r] of [['查看 A 报告', a], ['查看 B 报告', b]]) {
    const button = node('button', label, 'wb-secondary'); button.type = 'button'; button.onclick = () => openRun(r.runId); links.append(button);
  }
  host.append(links);
  if (!comparison) host.append(node('p', '实验尚未全部完成。已有数据仅供查看，完成后才能判断是否回归。'));
  else {
    const regressions = (comparison.scenarioDiffs || []).filter(s => s.assertionRegression);
    host.append(node('p', regressions.length ? `有 ${regressions.length} 个样本由通过变为未通过，请展开报告检查。` : '本次未发现从通过变为失败的样本。', regressions.length ? 'wb-error' : 'wb-success'));
    for (const item of regressions) host.append(node('p', `${names[item.scenarioId] || item.scenarioId} · 第 ${item.repetition} 次`));
  }
  host.append(node('p', '成本未配置单价时显示未采集；小样本结果仅供本次比较，不作为发布通过依据。', 'wb-muted'));
}
async function loadComparison() {
  const id = $('wb-experiment-select').value; if (!id) return;
  const sequence = ++comparisonSequence;
  const payload = await api(`/experiments/${encodeURIComponent(id)}`);
  if (sequence === comparisonSequence) renderComparison(payload.arms.baseline, payload.arms.candidate, payload.comparison);
}
async function loadExperiments() {
  const [experiments, runs] = await Promise.all([api('/experiments'), api('/runs?size=100')]);
  const select = $('wb-experiment-select'), selected = select.value;
  select.replaceChildren(option('', '选择已有实验'), ...experiments.items.map(e => option(e.experiment_id, `${String(e.created_at).replace('T', ' ').slice(0, 19)} · ${e.experiment_id.slice(0, 8)}`)));
  if ([...select.options].some(o => o.value === selected)) select.value = selected;
  for (const suffix of ['a', 'b']) {
    const field = $(`wb-compare-${suffix}`), previous = field.value;
    field.replaceChildren(...runs.items.map(r => option(r.runId, `${r.runId.slice(0, 8)} · ${statusPresentation(r.status).label} · ${r.variant?.modelId || r.executionMode} · ${r.variant?.promptVersion || '默认'}`)));
    if ([...field.options].some(o => o.value === previous)) field.value = previous;
    else if (suffix === 'b' && field.options.length > 1) field.selectedIndex = 1;
  }
  if (select.value) await loadComparison();
}
async function loadFailures() {
  const online = await api('/online-failures'); onlineFailures = online.items;
  const previous = $('wb-online-source').value;
  $('wb-online-source').replaceChildren(option('', '选择当前账号的失败请求'), ...onlineFailures.map(row => option(row.request_id, `${row.snapshot.question.slice(0, 35)} · ${row.request_id.slice(0, 8)}${row.source_run_id ? ' · 已保存' : ''}`)));
  if (onlineFailures.some(r => r.request_id === previous)) $('wb-online-source').value = previous;
  const data = await api(`/failures?page=${failurePage}&size=10`), host = $('wb-failure-list'); host.replaceChildren();
  for (const item of data.items) {
    const card = node('article', '', 'wb-failure'), title = node('div', '', 'wb-section-title');
    title.append(node('h3', item.title), node('span', ({ OPEN: '待验证', REPLAYING: '重跑中', RESOLVED: '已验证修复' })[item.state], `wb-tag ${item.state === 'RESOLVED' ? 'wb-success' : ''}`)); card.append(title);
    card.append(node('p', `${names[item.scenario_id] || item.scenario_id} · 原始报告 ${item.source_run_id.slice(0, 8)} · 第 ${item.repetition} 次`, 'wb-muted'));
    const actions = node('div', '', 'wb-footer');
    for (const [label, handler] of [
      ['原始报告', () => openRun(item.source_run_id)],
      ['查看快照与重跑记录', () => act(async () => { const data = await api(`/failures/${item.failure_id}`); const old = card.querySelector('details'); if (old) old.remove(); const details = document.createElement('details'); details.open = true; details.append(node('summary', '冻结的输入、预期与原结果'), node('pre', JSON.stringify(data, null, 2))); card.append(details); })],
      ...(item.latestRunId ? [['重跑报告', () => openRun(item.latestRunId)]] : []),
    ]) { const button = node('button', label, 'wb-secondary'); button.type = 'button'; button.onclick = handler; actions.append(button); }
    const replay = node('button', '修复后重跑', 'wb-primary'); replay.type = 'button'; replay.dataset.maintain = ''; replay.disabled = item.state === 'REPLAYING' || !catalog.canMaintain;
    replay.dataset.replaying = String(item.state === 'REPLAYING');
    replay.onclick = () => act(async () => { const result = await api(`/failures/${item.failure_id}/replay`, 'POST', variant('wb-replay')); message('已开始重跑，只有全部样本通过才会标记为已验证修复。'); openRun(result.runId); await loadFailures(); }); actions.append(replay); card.append(actions); host.append(card);
  }
  if (!data.items.length) host.append(node('p', '还没有保存失败案例。展开下方失败场景，点击“保存为回归案例”。', 'wb-muted'));
  $('wb-failure-page').textContent = `第 ${failurePage} 页`; $('wb-failure-prev').disabled = failurePage === 1; $('wb-failure-next').disabled = data.items.length < 10;
}
function updateRun(value) {
  report = value;
  const active = ['QUEUED', 'RUNNING'].includes(report.status), progress = report.progress || {};
  $('wb-progress').textContent = `${statusPresentation(report.status).label} · 已完成 ${progress.completed ?? report.cases.length} / ${progress.total ?? '—'} 个样本${report.cancelRequestedAt ? ' · 正在取消' : active ? ' · 自动更新中' : ''}`;
  $('wb-cancel').disabled = !catalog?.canMaintain || !active || !!report.cancelRequestedAt || busy;
  $('wb-baseline').disabled = !catalog?.canMaintain || report.status !== 'COMPLETED' || report.executionMode === 'prompt-candidate' || busy;
  $('wb-export').disabled = false;
}
async function initialize() {
  catalog = await api('/catalog');
  window.dispatchEvent(new CustomEvent('evaluation-capabilities', { detail: { canMaintain: catalog.canMaintain } }));
  $('wb-suite').replaceChildren(...catalog.suites.map((s, i) => option(String(i), `${s.title} · v${s.version}`)));
  for (const [id, prefix] of [['wb-task-variant', 'wb-task'], ['wb-arm-a', 'wb-a'], ['wb-arm-b', 'wb-b'], ['wb-replay-variant', 'wb-replay']]) variantFields($(id), prefix);
  $('wb-online-template').replaceChildren(...catalog.suites[0].scenarios.map(s => option(s.id, names[s.id] || s.title)));
  $('wb-b-skillVariant').value = 'without-skills';
  renderModes(); access(); $('wb-access').textContent = catalog.canMaintain ? '可创建和管理' : '仅可查看';
  message(catalog.canMaintain ? '先选场景，再开始评测。每份报告都会保留本次使用的版本。' : '当前账号仅可查看报告，管理操作需要评测维护权限。');
  await Promise.all([loadExperiments(), loadFailures()]);
}
if (typeof document !== 'undefined' && $('evaluation-workbench')) {
  document.querySelectorAll('[data-wb-tab]').forEach(button => button.onclick = () => selectTab(button.dataset.wbTab));
  $('wb-suite').onchange = renderModes; $('wb-mode').onchange = renderScenarios;
  $('wb-select-all').onclick = () => { const inputs = [...$('wb-scenarios').querySelectorAll('input')], all = inputs.every(n => n.checked); inputs.forEach(n => { n.checked = !all; }); };
  $('wb-task-form').onsubmit = event => { event.preventDefault(); act(async () => { const result = await api('/tasks', 'POST', task()); message('评测已排队，下方会自动显示进度和结果。'); openRun(result.runId); await loadExperiments(); }); };
  $('wb-experiment-form').onsubmit = event => { event.preventDefault(); act(async () => { const result = await api('/experiments', 'POST', { task: task(), baseline: variant('wb-a'), candidate: variant('wb-b') }); message('两组实验已排队，将使用相同场景分别验证。'); await loadExperiments(); $('wb-experiment-select').value = result.experimentId; await loadComparison(); openRun(result.baselineRunId); }); };
  $('wb-refresh-experiments').onclick = () => act(loadExperiments); $('wb-experiment-select').onchange = () => act(loadComparison);
  $('wb-compare').onclick = () => act(async () => { const a = $('wb-compare-a').value, b = $('wb-compare-b').value; if (!a || !b || a === b) throw new Error('请选择两份不同的报告'); const [before, after, result] = await Promise.all([api(`/runs/${a}`), api(`/runs/${b}`), api(`/comparisons?baselineRunId=${a}&candidateRunId=${b}`)]); ++comparisonSequence; renderComparison(before, after, result.comparison); });
  $('wb-refresh-failures').onclick = () => act(loadFailures);
  $('wb-online-source').onchange = () => { $('wb-online-question').textContent = onlineFailures.find(r => r.request_id === $('wb-online-source').value)?.snapshot.question || ''; };
  $('wb-online-form').onsubmit = event => { event.preventDefault(); act(async () => { const requestId = $('wb-online-source').value; if (!requestId) throw new Error('请选择一条线上失败请求'); const scenarioId = $('wb-online-template').value; await api('/online-failures/capture', 'POST', { requestId, scenarioId, title: `线上失败回归 · ${names[scenarioId] || scenarioId}` }); message('原问题已保存，可选择修复后的版本重跑。回放使用固定测试数据。'); await loadFailures(); }); };
  $('wb-failure-prev').onclick = () => act(async () => { failurePage = Math.max(1, failurePage - 1); await loadFailures(); });
  $('wb-failure-next').onclick = () => act(async () => { ++failurePage; await loadFailures(); });
  $('wb-cancel').onclick = () => act(async () => { await api(`/runs/${report.runId}/cancel`, 'POST', {}); message('已请求取消。已产生的结果会保留，取消后的报告不能设置基线。'); openRun(report.runId); });
  $('wb-baseline').onclick = () => act(async () => { await api('/baselines', 'PUT', { runId: report.runId, suiteId: report.suiteId, executionMode: report.executionMode }); message('已设为比较基线，后续相同场景的报告会自动对照。'); openRun(report.runId); });
  $('wb-export').onclick = () => { const link = document.createElement('a'); link.href = `/api/evaluations/runs/${report.runId}/export`; link.download = `evaluation-${report.runId}.json`; link.click(); };
  window.addEventListener('evaluation-report', event => updateRun(event.detail));
  window.addEventListener('evaluation-capture', event => act(async () => { const { runId, scenarioId, repetition } = event.detail; await api('/failures', 'POST', { runId, scenarioId, repetition, title: `${names[scenarioId] || scenarioId} · 回归检查` }); message('已保存失败案例，可在“失败案例”中修复后重跑。'); await loadFailures(); selectTab('failures'); }));
  window.addEventListener('hashchange', () => { if (window.location.hash === '#evaluations' && !catalog) act(initialize); });
  $('quality-refresh').addEventListener('click', () => { if (!catalog) act(initialize); });
  if (window.location.hash === '#evaluations') act(initialize);
  setInterval(() => { if (window.location.hash === '#evaluations' && catalog && !busy && !document.hidden) { const pane = $('wb-experiment').hidden ? $('wb-failures').hidden ? null : loadFailures : loadComparison; if (pane) pane().catch(error => message(error.message, true)); } }, 5000);
}
