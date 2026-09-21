import { api } from '../api.js';
import { state, on as onStoreChange } from '../store.js';
import { el, card, table, fmtTime, liveBadge, gauge, toast, clearNode } from '../ui.js';

let container = null;
let unsub = null;
let thresholds = null;
let user = null;

const LEVEL_LABELS = ['Normal', 'Watch', 'Warning', 'Danger', 'CONFIRMED EMERGENCY'];
const LEVEL_COLORS = ['var(--green)', 'var(--green)', 'var(--amber)', 'var(--amber)', 'var(--red-primary)'];

function render() {
  if (!container) return;
  clearNode(container);
  const t = state.telemetry;
  const level = t?.security?.smoke_level ?? 0;

  container.appendChild(el('div', { class: 'page-header' }, [el('h1', {}, 'Security & Fire')]));

  const grid2 = el('div', { class: 'grid grid-2' });
  grid2.appendChild(card('Smoke / Fire - GF-06', [
    gauge(t?.security?.smoke_pct ?? 0, LEVEL_LABELS[level], () => LEVEL_COLORS[level]),
    row('Flame', t?.security?.flame ? 'DETECTED' : 'Clear'),
    row('Intrusion check', t?.security?.intrusion ? 'SUSPECTED' : 'Normal'),
    row('False alarms', t?.security?.false_alarms ?? 0),
  ], { titleRight: liveBadge(true) }));

  grid2.appendChild(card('CCTV - SF-03', [
    row('Camera', 'CAM-SF03-01'),
    row('Motion', t?.environment?.motion ? 'PRESENT' : 'none'),
    row('Last motion', t?.sim_time || '-'),
  ]));
  container.appendChild(grid2);

  container.appendChild(el('div', { class: 'section-title' }, 'Metal Detector'));
  const metalGrid = el('div', { class: 'grid grid-2' });
  metalGrid.appendChild(card('Status', [
    gauge(state.screenings[0]?.signal_pct ?? 0, `Threshold ${t?.metal_detector?.threshold_pct ?? 55}%`),
    row('Hold', t?.metal_detector?.hold_active ? 'ACTIVE' : 'Idle'),
    row('Total scans', state.screenings.length),
  ], { titleRight: liveBadge(true) }));

  metalGrid.appendChild(card('Screening Decision', t?.metal_detector?.hold_active ? [
    el('div', { class: 'form-inline' }, [
      el('button', { class: 'pill-btn primary', onclick: () => decide(true) }, 'Allow Entry'),
      el('button', { class: 'pill-btn danger', onclick: () => decide(false) }, 'Deny Entry'),
    ]),
  ] : [el('div', { class: 'empty-state' }, 'No hold active.')]));
  container.appendChild(metalGrid);

  container.appendChild(el('div', { class: 'section-title' }, 'Thresholds'));
  container.appendChild(card(null, [buildThresholdForm()]));

  const grid3 = el('div', { class: 'grid grid-2', style: 'margin-top:16px;' });
  grid3.appendChild(card('False Alarms', state.falseAlarms.length ? [table(
    [
      { key: 'ts', label: 'Time', render: (r) => fmtTime(r.ts) },
      { key: 'smoke_pct', label: 'Smoke %', render: (r) => `${(r.smoke_pct ?? 0).toFixed(0)}%` },
      { key: 'flame', label: 'Flame', render: (r) => r.flame ? 'yes' : 'no' },
      { key: 'reason', label: 'Reason' },
    ],
    state.falseAlarms.slice(0, 15),
  )] : [el('div', { class: 'empty-state' }, 'None logged.')]));

  const screeningStats = state.screenings.length ? {
    scans: state.screenings[0]?.scans ?? state.screenings.length,
    allowed: state.screenings[0]?.allowed ?? 0,
    denied: state.screenings[0]?.denied ?? 0,
  } : { scans: 0, allowed: 0, denied: 0 };
  grid3.appendChild(card('Screening Stats', [
    row('Scans', screeningStats.scans),
    row('Allowed', screeningStats.allowed),
    row('Denied', screeningStats.denied),
    el('div', { class: 'section-title', style: 'margin-top:12px;' }, 'Recent'),
    table(
      [
        { key: 'ts', label: 'Time', render: (r) => fmtTime(r.ts) },
        { key: 'result', label: 'Result' },
        { key: 'signal_pct', label: 'Signal', render: (r) => `${(r.signal_pct ?? 0).toFixed(0)}%` },
      ],
      state.screenings.slice(0, 8),
    ),
  ]));
  container.appendChild(grid3);
}

async function decide(allow) {
  try { await api.screeningDecision(allow); toast(allow ? 'Entry allowed' : 'Entry denied', 'success'); } catch (e) { toast(e.message, 'error'); }
}

function buildThresholdForm() {
  if (!thresholds) return el('div', { class: 'empty-state' }, 'Loading thresholds...');
  if (user?.role !== 'admin') {
    return el('div', {}, [
      row('Smoke L1-L4', `${thresholds.smoke_l1} / ${thresholds.smoke_l2} / ${thresholds.smoke_l3} / ${thresholds.smoke_l4} %`),
      row('Metal detector', `${thresholds.metal_threshold_pct}%`),
    ]);
  }
  const l1 = numInput(thresholds.smoke_l1), l2 = numInput(thresholds.smoke_l2), l3 = numInput(thresholds.smoke_l3), l4 = numInput(thresholds.smoke_l4);
  const metal = numInput(thresholds.metal_threshold_pct);
  return el('div', { class: 'form-inline' }, [
    labeled('Smoke L1', l1), labeled('L2', l2), labeled('L3', l3), labeled('L4', l4),
    labeled('Metal detector', metal),
    el('button', {
      class: 'pill-btn primary', onclick: async () => {
        const r = await api.saveThresholds({
          smoke_l1: Number(l1.value), smoke_l2: Number(l2.value), smoke_l3: Number(l3.value), smoke_l4: Number(l4.value),
          metal_threshold_pct: Number(metal.value),
        });
        thresholds = r.thresholds;
        toast('Saved', 'success');
        render();
      },
    }, 'Save'),
  ]);
}

function numInput(v) { return el('input', { type: 'number', value: v, style: 'width:70px;' }); }
function labeled(label, input) { return el('div', { class: 'form-row' }, [el('label', {}, label), input]); }
function row(label, value) {
  return el('div', { style: 'display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12.5px;' }, [
    el('span', { style: 'color:var(--text-muted);' }, label),
    el('span', { style: 'font-weight:600;' }, String(value)),
  ]);
}

export default {
  mount(rootEl, ctx) {
    container = rootEl;
    user = ctx.user;
    Promise.all([api.thresholds(), api.screenings(), api.falseAlarms()]).then(([th, sc, fa]) => {
      thresholds = th.thresholds;
      state.screenings = sc.screenings;
      state.falseAlarms = fa.false_alarms;
      render();
    }).catch(() => render());
    unsub = onStoreChange(render);
    render();
  },
  unmount() { if (unsub) unsub(); container = null; },
};
