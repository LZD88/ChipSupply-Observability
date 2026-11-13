export function releaseNumber(value, suffix = '') { return value == null ? '—' : `${Number(value).toFixed(2)}${suffix}`; }
const labels = { stable: '稳定版', canary: '试用版', historical: '历史版本', direct: '直接回复', legacy: '旧会话' };
function node(tag, text, className) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; }
async function api(path) {
  const response = await fetch(`/api/prompt-releases/${path}`, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) { const error = new Error([401, 403].includes(response.status) ? '请先登录采购助手，并开通 prompt:view 权限。' : `发布记录暂时不可用（${response.status}），请稍后刷新。`); error.status = response.status; throw error; }
  return response.json();
}
export function bootReleaseView() {
  const view = document.getElementById('releases-view'); if (!view) return;
  let generation = 0;
  async function load() {
    if (window.location.hash !== '#releases') return;
    const current = ++generation;
    const status = document.getElementById('release-status'); status.replaceChildren(node('p', '正在读取持久化发布记录…'));
    try {
      const [state, observations, history] = await Promise.all([api('state'), api('observations'), api('history')]);
      if (generation !== current) return;
      status.replaceChildren(node('p', state.enabled ? '发布功能已启用 · 数据来自 MySQL，不依赖 Prometheus / Tempo。' : '发布开关关闭 · 当前仅查看已有记录。'));
      const cards = document.getElementById('release-cards'); cards.replaceChildren();
      for (const [title, value, detail] of [['稳定版本', state.stable, '默认使用'], ['试用版本', state.canary || '暂无', `${state.percentage}% 新会话`], ['发布状态', state.status, `修订 ${state.revision}`]]) { const card = node('article', null, 'kpi accent-green'); card.append(node('span', title), node('strong', value), node('small', detail)); cards.append(card); }
      const table = document.getElementById('release-comparison'); table.replaceChildren();
      const header = node('tr'); ['分组', '完整请求', '成功率', 'P50', 'P95', '有用量 / 完整请求', '估算费用 USD', '样本状态'].forEach(t => header.append(node('th', t))); table.append(header);
      for (const [arm, data] of Object.entries(observations.cohorts)) { const row = node('tr'); [labels[arm] || arm, data.completedCount, releaseNumber(data.successRate == null ? null : data.successRate * 100, '%'), releaseNumber(data.p50Seconds, 's'), releaseNumber(data.p95Seconds, 's'), `${data.usageSamples} / ${data.completedCount}`, releaseNumber(data.estimatedCostUsd), data.sufficient ? '样本充足' : '样本不足'].forEach(v => row.append(node('td', String(v)))); table.append(row); }
      const pending = document.getElementById('release-pending'); pending.replaceChildren();
      for (const item of observations.pendingApprovals) pending.append(node('p', `${item.version} · ${item.count} 个会话待审批，恢复时沿用原版本。`));
      const timeline = document.getElementById('release-history'); timeline.replaceChildren();
      for (const gate of history.gates) { const entry = node('details'); entry.append(node('summary', `${gate.candidate_version} · ${gate.passed ? '门禁通过' : '门禁阻止'} · ${gate.created_at}`), node('pre', JSON.stringify(gate.evidence, null, 2))); timeline.append(entry); }
      for (const event of history.events) timeline.append(node('p', `${event.created_at} · ${event.actor} · ${event.action} · 修订 ${event.revision}`));
      if (!history.gates.length && !history.events.length) timeline.append(node('p', '暂无门禁或发布记录。'));
    } catch (error) { if (generation === current) {
      for (const id of ['release-cards', 'release-comparison', 'release-pending', 'release-history']) document.getElementById(id).replaceChildren();
      status.replaceChildren(node('p', error.message, 'release-error'));
    } }
  }
  document.getElementById('show-releases').addEventListener('click', () => { window.location.hash = 'releases'; });
  window.addEventListener('hashchange', load);
  const refresh = node('button', '刷新发布记录', 'release-refresh'); refresh.type = 'button'; refresh.addEventListener('click', load); view.querySelector('.intro').append(refresh);
  load();
}
if (typeof document !== 'undefined') bootReleaseView();
