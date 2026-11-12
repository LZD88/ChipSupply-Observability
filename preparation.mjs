// Separate preparation diagnostics. No identity or request-derived labels.
export const preparationQueries = {
  waitP95: 'histogram_quantile(0.95, sum by (le) (rate(agent_preparation_wait_seconds_bucket{outcome="ready"}[5m])))',
  samples: 'sum(increase(agent_preparation_wait_seconds_count{outcome="ready"}[5m]))',
  failures: 'sum(increase(agent_preparation_wait_seconds_count{outcome="failure"}[5m]))',
  timeouts: 'sum(increase(agent_preparation_wait_seconds_count{outcome="timeout"}[5m]))',
  cancelled: 'sum(increase(agent_preparation_wait_seconds_count{outcome="cancelled"}[5m]))',
  sandbox: 'histogram_quantile(0.95, sum by (le) (rate(agent_preparation_stage_duration_seconds_bucket{stage="sandbox",status="success"}[5m])))',
  graph: 'histogram_quantile(0.95, sum by (le) (rate(agent_preparation_stage_duration_seconds_bucket{stage="graph",status="success"}[5m])))',
  sync: 'histogram_quantile(0.95, sum by (le) (rate(agent_preparation_stage_duration_seconds_bucket{stage="sync",status="success"}[5m])))',
  graphHit: 'sum(rate(agent_runtime_cache_total{cache="graph",result="hit"}[5m])) / sum(rate(agent_runtime_cache_total{cache="graph",result=~"hit|miss"}[5m]))',
  healthHit: 'sum(rate(agent_runtime_cache_total{cache="health",result="hit"}[5m])) / sum(rate(agent_runtime_cache_total{cache="health",result=~"hit|miss"}[5m]))',
  poolReady: 'sum(agent_sandbox_pool_ready)',
  poolTarget: 'sum(agent_sandbox_pool_target)',
  poolCreating: 'sum(agent_sandbox_pool_creating)',
  poolFailures: 'sum(increase(agent_sandbox_pool_replenish_total{status="failure"}[5m]))',
};

function value(result) {
  const raw = result?.[0]?.value?.[1];
  if (raw == null || raw === '') return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}
const count = (v) => v == null ? '—' : `约 ${v.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}`;
const seconds = (v) => v == null ? '—' : `${v.toFixed(v < 1 ? 3 : 2)} s`;
const percent = (v) => v == null ? '等待样本' : `${(v * 100).toFixed(1)}%`;

export function preparationPresentation(data, available = true) {
  const samples = value(data.samples), p95 = value(data.waitP95);
  let note = '等待样本（旧版 Agent 可能未提供指标）';
  if (!available) note = '准备指标不可用，请检查 Prometheus';
  else if (samples > 0) note = samples < 20 ? '样本较少，直方图估算' : '直方图估算';
  return {
    p95: available && samples > 0 ? seconds(p95) : '—',
    note,
    samples: `最近 5 分钟 · ${count(samples)} 个成功等待样本`,
    outcomes: `失败 ${count(value(data.failures))} · 超时 ${count(value(data.timeouts))} · 取消 ${count(value(data.cancelled))}`,
    stages: `沙箱 ${seconds(value(data.sandbox))} · graph ${seconds(value(data.graph))} · 同步 ${seconds(value(data.sync))}`,
    cache: `graph ${percent(value(data.graphHit))} · 健康 ${percent(value(data.healthHit))}`,
    pool: `${value(data.poolReady) ?? '—'} / ${value(data.poolTarget) ?? '—'} 就绪 · 创建中 ${value(data.poolCreating) ?? '—'}`,
    poolFailures: `最近 5 分钟补充失败 ${count(value(data.poolFailures))}`,
  };
}

export function renderPreparation(document, data, available = true) {
  const view = preparationPresentation(data, available);
  for (const [key, text] of Object.entries(view)) {
    const node = document.getElementById(`preparation-${key}`);
    if (node) node.textContent = text;
  }
}

export async function refreshPreparation(query, document) {
  const results = await Promise.allSettled(Object.entries(preparationQueries).map(
    async ([key, expression]) => [key, await query(expression)],
  ));
  const data = Object.fromEntries(results.filter((r) => r.status === 'fulfilled').map((r) => r.value));
  renderPreparation(document, data, results.every((r) => r.status === 'fulfilled'));
}
