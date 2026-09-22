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

// Pages rebuild their entire DOM on every store update (telemetry alone
// ticks about once a second). Tearing everything down while the user is
// mid-keystroke (or mid-drag on a slider) drops focus onto nothing, so
// whatever they're doing never lands - the page looks like it's fighting
// them. Wrap a render() body with this: while a field inside the container
// is focused, the rebuild is skipped entirely (that field, its value, its
// cursor, and any in-progress drag stay exactly as they are) and deferred
// until the field loses focus, at which point the page catches up.
export function withPreservedFocus(container, rebuild) {
  const active = document.activeElement;
  if (active && container.contains(active) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) {
    if (!active.dataset.deferredRerender) {
      active.dataset.deferredRerender = '1';
      active.addEventListener('blur', () => {
        delete active.dataset.deferredRerender;
        setTimeout(() => withPreservedFocus(container, rebuild), 0);
      }, { once: true });
    }
    return;
  }
  rebuild();
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
  const colors = { info: 'var(--surface-3)', error: 'var(--red-primary)', success: 'var(--green)' };
  const item = el('div', {
    style: `background:${colors[kind] || colors.info};color:#fff;padding:10px 14px;border-radius:6px;font-size:12.5px;max-width:320px;border:1px solid var(--border-strong);box-shadow:0 4px 16px rgba(0,0,0,0.5);`,
  }, msg);
  box.appendChild(item);
  setTimeout(() => item.remove(), 4000);
}

export function clearNode(node) { while (node.firstChild) node.removeChild(node.firstChild); }

// Modern toggle switch. onChange receives the new boolean state; the
// caller decides whether/when to actually call the API (so it can revert
// the switch on failure).
export function toggleSwitch(checked, onChange, disabled = false) {
  const input = el('input', { type: 'checkbox', disabled: disabled ? 'disabled' : null });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked, input));
  return el('label', { class: 'switch' }, [input, el('span', { class: 'switch-track' })]);
}

// A slider paired with a live numeric readout. The number only updates
// visually while dragging (input event); onCommit fires once on release
// (change event) so it doesn't flood the API with a request per pixel.
export function sliderRow(label, value, min, max, step, onCommit, unit = '') {
  const valueLabel = el('span', { class: 'slider-value' }, `${value}${unit}`);
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  input.addEventListener('input', () => { valueLabel.textContent = `${input.value}${unit}`; });
  input.addEventListener('change', () => onCommit(Number(input.value)));
  return el('div', { class: 'slider-row' }, [
    el('div', { class: 'slider-row-head' }, [el('span', {}, label), valueLabel]),
    input,
  ]);
}

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
