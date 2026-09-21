import { api } from '../api.js';
import { state, on as onStoreChange } from '../store.js';
import { el, card, table, fmtTime, liveBadge, gauge, toast, clearNode } from '../ui.js';

let container = null;
let unsub = null;
let bins = null;

function render() {
  if (!container) return;
  clearNode(container);
  const t = state.telemetry;
  const displayBins = state.bins || bins || [];

  container.appendChild(el('div', { class: 'page-header' }, [
    el('div', {}, [
      el('h1', {}, 'Waste Management (Module H)'),
      el('p', {}, 'HC-SR04 ultrasonic level sensor on the Main Lobby bin (live). Other bins are simulated so the map looks alive.'),
    ]),
  ]));

  const grid2 = el('div', { class: 'grid grid-2' });
  grid2.appendChild(card('Main Lobby Bin (live)', [
    gauge(t?.waste?.fill_pct ?? 0, t?.waste?.full ? 'BIN FULL' : 'Normal', (pct) => pct >= 80 ? 'var(--red-primary)' : pct >= 60 ? 'var(--amber)' : 'var(--green)'),
    row('Threshold bands', 'Normal < 60% - Filling 60-80% - FULL >= 80%'),
    el('div', { class: 'form-inline', style: 'margin-top:8px;' }, [
      el('button', { class: 'pill-btn primary', onclick: () => collect('lobby-main', false) }, 'Mark Collected'),
      el('button', { class: 'pill-btn danger', onclick: () => collect('lobby-main', true) }, 'Admin Override Reset'),
    ]),
  ], { titleRight: liveBadge(true) }));

  const alerts = state.events.filter((e) => e.kind === 'alert' && e.module === 'H').slice(0, 10);
  grid2.appendChild(card('Alert History', alerts.length ? alerts.map((a) => el('div', { class: 'feed-item sev-warning' }, [
    el('span', { class: 'ts' }, fmtTime(a.ts)), el('div', {}, a.message),
  ])) : [el('div', { class: 'empty-state' }, 'No waste alerts yet.')], { class: 'feed' }));
  container.appendChild(grid2);

  container.appendChild(el('div', { class: 'section-title' }, 'Bin List'));
  container.appendChild(card(null, [table(
    [
      { key: 'name', label: 'Bin' },
      { key: 'room', label: 'Room' },
      { key: 'fill_pct', label: 'Fill', render: (r) => `${(r.fill_pct ?? 0).toFixed(0)}%` },
      { key: 'live', label: 'Source', render: (r) => r.live ? 'LIVE' : 'SIMULATED' },
      { key: 'actions', label: '', render: (r) => actionCell(r) },
    ],
    displayBins,
  )]));
}

function actionCell(bin) {
  const btn = el('button', { class: 'pill-btn', onclick: () => collect(bin.id, false) }, 'Mark Collected');
  return btn;
}

async function collect(id, adminOverride) {
  try { await api.collectBin(id, adminOverride); toast('Bin marked collected', 'success'); } catch (e) { toast(e.message, 'error'); }
}

function row(label, value) {
  return el('div', { style: 'display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12.5px;' }, [
    el('span', { style: 'color:var(--text-muted);' }, label),
    el('span', { style: 'font-weight:600;' }, String(value)),
  ]);
}

export default {
  mount(rootEl) {
    container = rootEl;
    api.bins().then((r) => { bins = r.bins; render(); }).catch(() => render());
    unsub = onStoreChange(render);
    render();
  },
  unmount() { if (unsub) unsub(); container = null; },
};
