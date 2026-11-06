const API = '/prometheus/api/v1';
const $ = (id) => document.getElementById(id);
const state = { rangeHours: 6, charts: {}, refreshing: false };

const instantQueries = {
  success: '(sum(rate(agent_requests_total{status="success"}[5m])) or vector(0)) / sum(rate(agent_requests_total[5m]))',
  requestP95: 'histogram_quantile(0.95, sum by (le) (rate(agent_request_duration_seconds_bucket[5m])))',
  firstToken: 'histogram_quantile(0.95, sum by (le) (rate(agent_first_token_seconds_bucket[5m])))',
  active: 'sum(agent_active_requests)',
  erpQps: 'sum(rate(http_server_requests_seconds_count{job="chipsupply-erp"}[5m]))',
  inputTokens: 'sum(rate(agent_llm_input_tokens_total[5m]))',
  outputTokens: 'sum(rate(agent_llm_output_tokens_total[5m]))',
  cost: 'sum(agent_llm_cost_usd_total)',
  queueTotal: 'sum(rabbitmq_queue_messages{queue="chipsupply.platform.events"})',
  queueReady: 'sum(rabbitmq_queue_messages_ready{queue="chipsupply.platform.events"})',
  queueUnacked: 'sum(rabbitmq_queue_messages_unacked{queue="chipsupply.platform.events"})',
  queueConsumers: 'sum(rabbitmq_queue_consumers{queue="chipsupply.platform.events"})',
  queueDlq: 'sum(rabbitmq_queue_messages{queue="chipsupply.platform.events.dlq"})',
  outboxPublished: 'sum(chipsupply_outbox_published_total)',
  outboxFailed: 'sum(chipsupply_outbox_publish_failures_total)',
  consumed: 'sum(chipsupply_events_consumed_total)',
};

const serviceQueries = [
  ['ERP', 'up{job="chipsupply-erp"}'],
  ['Agent API', 'up{job="procurement-agent"}'],
  ['RabbitMQ', 'up{job="rabbitmq"}'],
  ['Prometheus', 'up{job="prometheus"}'],
];

async function prometheus(path, params) {
  const url = `${API}/${path}?${new URLSearchParams(params)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Prometheus HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.status !== 'success') throw new Error(payload.error || 'Prometheus 查询失败');
  return payload.data.result || [];
}

async function query(expression) { return prometheus('query', { query: expression }); }
async function queryRange(expression) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - state.rangeHours * 3600;
  const step = Math.max(30, Math.floor((end - start) / 180));
  return prometheus('query_range', { query: expression, start, end, step });
}

function value(result, fallback = null) {
  const number = Number(result?.[0]?.value?.[1]);
  return Number.isFinite(number) ? number : fallback;
}
function number(value, digits = 0) { return value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: digits }); }
function seconds(value) { if (value == null) return '—'; return value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(value < 10 ? 2 : 1)} s`; }
function setText(id, text) { $(id).textContent = text; }

function renderKpis(data) {
  const success = value(data.success);
  const p95 = value(data.requestP95);
  const first = value(data.firstToken);
  const active = value(data.active);
  const input = value(data.inputTokens);
  const output = value(data.outputTokens);
  setText('success-rate', success == null ? '—' : `${(success * 100).toFixed(1)}%`);
  $('success-track').style.width = `${Math.max(0, Math.min(100, (success || 0) * 100))}%`;
  setText('request-p95', seconds(p95));
  setText('latency-note', p95 == null ? '等待样本' : p95 <= 5 ? '体验稳定' : p95 <= 15 ? '响应偏慢' : '需要关注');
  setText('first-token', seconds(first));
  setText('active-requests', number(active));
  setText('erp-qps', `ERP 吞吐 ${number(value(data.erpQps), 2)} req/s`);
  setText('token-rate', input == null && output == null ? '—' : `${number((input || 0) + (output || 0), 1)}/s`);
  setText('token-split', `输入 ${number(input, 1)} · 输出 ${number(output, 1)}`);
  const cost = value(data.cost);
  setText('model-cost', cost == null ? '—' : `$${cost.toFixed(4)}`);
}

function renderQueue(data, rabbitUp) {
  const total = value(data.queueTotal), ready = value(data.queueReady), unacked = value(data.queueUnacked);
  const consumers = value(data.queueConsumers), dlq = value(data.queueDlq);
  setText('queue-total', number(total)); setText('queue-ready', number(ready)); setText('queue-unacked', number(unacked));
  setText('queue-consumers', number(consumers)); setText('queue-dlq', number(dlq));
  setText('outbox-published', number(value(data.outboxPublished))); setText('outbox-failed', number(value(data.outboxFailed)));
  const grade = total == null ? '—' : total === 0 ? '畅通' : total < 20 ? '正常' : total < 100 ? '关注' : '拥堵';
  setText('queue-grade', grade);
  const progress = total == null ? 0 : Math.min(100, total);
  $('queue-ring').style.strokeDashoffset = String(100 - progress);
  $('queue-ring').style.stroke = total > 100 ? 'var(--rose)' : total > 20 ? 'var(--amber)' : 'var(--green)';
  const badge = $('rabbit-health'); badge.className = `status-badge ${rabbitUp ? 'up' : 'down'}`; badge.textContent = rabbitUp ? '运行中' : '不可用';
  setText('flow-mq', rabbitUp ? '已连接' : '不可用');
  setText('flow-consumer', value(data.consumed) == null ? '等待指标' : `已消费 ${number(value(data.consumed))}`);
  setText('flow-dlq', dlq == null ? '等待指标' : dlq > 0 ? `${number(dlq)} 条待处理` : '无积压');
}

function renderServices(results) {
  const host = $('service-health'); host.replaceChildren();
  let online = 0;
  results.forEach(([name, result]) => {
    const up = value(result) === 1; if (up) online += 1;
    const pill = document.createElement('span'); pill.className = `service-pill ${up ? 'up' : 'down'}`;
    const dot = document.createElement('i'); const label = document.createElement('span'); label.textContent = `${name} ${up ? '在线' : '离线'}`;
    pill.append(dot, label); host.append(pill);
  });
  const live = $('live-state'); live.className = `live-state ${online === results.length ? 'online' : online ? 'online' : 'error'}`;
  live.querySelector('span').textContent = online === results.length ? '全部服务在线' : `${online}/${results.length} 服务在线`;
  return Object.fromEntries(results.map(([name, result]) => [name, value(result) === 1]));
}

function normalizeSeries(result, label) {
  return result.map((series, index) => ({ label: label(series, index), values: series.values.map(([time, item]) => [Number(time), Number(item)]).filter(([, item]) => Number.isFinite(item)) }));
}

function drawChart(canvas, series, colors, formatY) {
  const parent = canvas.parentElement; const rect = parent.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, rect.width * dpr); canvas.height = Math.max(1, rect.height * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); const w = rect.width, h = rect.height;
  const pad = { l: 42, r: 14, t: 12, b: 25 }; const all = series.flatMap((item) => item.values);
  if (!all.length) return false;
  const minX = Math.min(...all.map(([x]) => x)), maxX = Math.max(...all.map(([x]) => x));
  let maxY = Math.max(...all.map(([, y]) => y), 0.0001); let minY = Math.min(0, ...all.map(([, y]) => y));
  const x = (item) => pad.l + ((item - minX) / Math.max(1, maxX - minX)) * (w - pad.l - pad.r);
  const y = (item) => h - pad.b - ((item - minY) / Math.max(.000001, maxY - minY)) * (h - pad.t - pad.b);
  ctx.font = '9px system-ui'; ctx.fillStyle = '#65726c'; ctx.strokeStyle = 'rgba(225,236,230,.07)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) { const yy = pad.t + (h - pad.t - pad.b) * i / 4; ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke(); const value = maxY - (maxY - minY) * i / 4; ctx.fillText(formatY(value), 2, yy + 3); }
  for (let i = 0; i <= 4; i += 1) { const stamp = minX + (maxX - minX) * i / 4; const label = new Date(stamp * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); ctx.fillText(label, x(stamp) - 14, h - 5); }
  series.forEach((item, index) => { if (!item.values.length) return; const gradient = ctx.createLinearGradient(0, pad.t, 0, h - pad.b); gradient.addColorStop(0, `${colors[index % colors.length]}33`); gradient.addColorStop(1, `${colors[index % colors.length]}00`); ctx.beginPath(); item.values.forEach(([xx, yy], point) => point ? ctx.lineTo(x(xx), y(yy)) : ctx.moveTo(x(xx), y(yy))); ctx.lineTo(x(item.values.at(-1)[0]), h - pad.b); ctx.lineTo(x(item.values[0][0]), h - pad.b); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill(); ctx.beginPath(); item.values.forEach(([xx, yy], point) => point ? ctx.lineTo(x(xx), y(yy)) : ctx.moveTo(x(xx), y(yy))); ctx.strokeStyle = colors[index % colors.length]; ctx.lineWidth = 1.8; ctx.stroke(); });
  return true;
}

async function refreshCharts() {
  const successExpression = `${instantQueries.success} * 100`;
  const latencyExpression = 'histogram_quantile(0.95, sum by (le) (rate(agent_request_duration_seconds_bucket[5m])))';
  const [success, latency, input, output] = await Promise.all([queryRange(successExpression), queryRange(latencyExpression), queryRange('sum(rate(agent_llm_input_tokens_total[5m]))'), queryRange('sum(rate(agent_llm_output_tokens_total[5m]))')]);
  const experience = [...normalizeSeries(success, () => '成功率'), ...normalizeSeries(latency, () => 'P95 耗时')];
  const token = [...normalizeSeries(input, () => '输入'), ...normalizeSeries(output, () => '输出')];
  state.charts = { experience, token };
  $('experience-empty').hidden = drawChart($('experience-chart'), experience, ['#78d9a7', '#f1bb71'], (v) => v >= 10 ? v.toFixed(0) : v.toFixed(1));
  $('token-empty').hidden = drawChart($('token-chart'), token, ['#69cbd1', '#b39be5'], (v) => v.toFixed(v < 10 ? 1 : 0));
}

function redrawCharts() {
  if (!state.charts.experience) return;
  $('experience-empty').hidden = drawChart($('experience-chart'), state.charts.experience, ['#78d9a7', '#f1bb71'], (v) => v >= 10 ? v.toFixed(0) : v.toFixed(1));
  $('token-empty').hidden = drawChart($('token-chart'), state.charts.token, ['#69cbd1', '#b39be5'], (v) => v.toFixed(v < 10 ? 1 : 0));
}

function toast(message) { const node = $('toast'); node.textContent = message; node.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, 3500); }

async function refresh() {
  if (state.refreshing) return; state.refreshing = true; $('refresh').disabled = true; $('refresh').textContent = '刷新中…';
  try {
    const entries = Object.entries(instantQueries);
    const [metrics, services] = await Promise.all([
      Promise.all(entries.map(async ([key, expression]) => [key, await query(expression)])),
      Promise.all(serviceQueries.map(async ([name, expression]) => [name, await query(expression)])),
      refreshCharts(),
    ]);
    const data = Object.fromEntries(metrics); const health = renderServices(services);
    renderKpis(data); renderQueue(data, health.RabbitMQ);
    setText('updated', `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
  } catch (error) {
    const live = $('live-state'); live.className = 'live-state error'; live.querySelector('span').textContent = '数据源连接失败'; toast(error.message || '刷新失败');
  } finally { state.refreshing = false; $('refresh').disabled = false; $('refresh').textContent = '刷新数据'; }
}

$('refresh').addEventListener('click', refresh);
$('range').addEventListener('change', (event) => { state.rangeHours = Number(event.target.value); refresh(); });
$('open-trace').addEventListener('click', () => { const traceId = $('trace-id').value.trim(); if (!traceId) return toast('请先输入 Trace ID'); const left = encodeURIComponent(JSON.stringify({ datasource: 'tempo', queries: [{ refId: 'A', query: traceId, queryType: 'traceql' }], range: { from: 'now-1h', to: 'now' } })); window.open(`http://localhost:3001/explore?left=${left}`, '_blank', 'noopener'); });
window.addEventListener('resize', (() => { let timer; return () => { clearTimeout(timer); timer = setTimeout(redrawCharts, 120); }; })());
refresh(); setInterval(refresh, 10000);
