// Small DOM/formatting helpers shared by every page module.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function liveBadge(isLive) {
  return el('span', { class: `badge ${isLive ? 'badge-live' : 'badge-sim'}` }, isLive ? 'LIVE' : 'SIMULATED');
}

export function severityBadge(sev) {
  const cls = sev === 'critical' ? 'badge-critical' : sev === 'warning' ? 'badge-warning' : 'badge-normal';
  return el('span', { class: `badge ${cls}` }, sev || 'info');
}

export function kpiCard({ label, value, sub, valueClass = '' }) {
  return el('div', { class: 'card kpi' }, [
    el('span', { class: 'label' }, label),
    el('span', { class: `value ${valueClass}` }, String(value)),
    sub ? el('span', { class: 'sub' }, sub) : null,
  ]);
}

export function card(title, children, opts = {}) {
  const body = el('div', { class: opts.bodyClass || '' }, children);
  return el('div', { class: `card ${opts.class || ''}` }, [
    title ? el('div', { class: 'card-title' }, [el('span', {}, title), opts.titleRight || null]) : null,
    body,
  ]);
}

export function emptyState(text) { return el('div', { class: 'empty-state' }, text); }
export function offlineState(text) { return el('div', { class: 'offline-state' }, text || 'No data - ESP32 not connected.'); }

export function table(columns, rows, opts = {}) {
  const thead = el('thead', {}, [el('tr', {}, columns.map((c) => el('th', {}, c.label)))]);
  const tbody = el('tbody', {}, rows.length
    ? rows.map((row) => el('tr', {}, columns.map((c) => el('td', {}, c.render ? c.render(row) : String(row[c.key] ?? '')))))
    : [el('tr', {}, [el('td', { colspan: String(columns.length) }, opts.emptyText || 'No records yet.')])]);
  return el('table', { class: 'data-table' }, [thead, tbody]);
}

export function fmtTime(ts) {
  if (!ts) return '-';
  if (/^\d{2}:\d{2}$/.test(ts)) return ts;
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleTimeString('en-PH', { hour12: false });
  } catch { return String(ts); }
}

export function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

export function gauge(valuePct, label, colorFor) {
  const pct = clamp(valuePct, 0, 100);
  const color = colorFor ? colorFor(pct) : (pct < 60 ? 'var(--green)' : pct < 80 ? 'var(--amber)' : 'var(--red-primary)');
  return el('div', { class: 'gauge-wrap' }, [
    el('div', { class: 'gauge-value' }, `${pct.toFixed(0)}%`),
    el('div', { class: 'gauge-track' }, [el('div', { class: 'gauge-fill', style: `width:${pct}%;background:${color}` })]),
    label ? el('div', { class: 'sub' }, label) : null,
  ]);
}

export function toast(msg, kind = 'info') {
  let box = document.getElementById('toast-box');
  if (!box) {
    box = el('div', { id: 'toast-box', style: 'position:fixed;bottom:16px;right:16px;z-index:50;display:flex;flex-direction:column;gap:8px;' });
    document.body.appendChild(box);
  }
  const colors = { info: 'var(--gray-900)', error: 'var(--red-primary)', success: 'var(--green)' };
  const item = el('div', {
    style: `background:${colors[kind] || colors.info};color:#fff;padding:10px 14px;border-radius:6px;font-size:12.5px;max-width:320px;box-shadow:0 4px 16px rgba(0,0,0,0.2);`,
  }, msg);
  box.appendChild(item);
  setTimeout(() => item.remove(), 4000);
}

export function clearNode(node) { while (node.firstChild) node.removeChild(node.firstChild); }

const loadedScripts = new Map();
export function loadScript(src) {
  if (loadedScripts.has(src)) return loadedScripts.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
  loadedScripts.set(src, p);
  return p;
}
