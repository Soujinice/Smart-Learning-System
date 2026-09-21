import { api } from '../api.js';
import { state, on as onStoreChange } from '../store.js';
import { el, card, table, liveBadge, toast, clearNode, loadScript } from '../ui.js';

let container = null;
let unsub = null;
let thresholds = null;
let user = null;
let chart = null;
let chartCanvas = null;
const history = { labels: [], temp: [], hum: [] };
let lastSample = 0;

let chartLibPromise = null;
function ensureChartLib() {
  if (window.Chart) return Promise.resolve();
  if (!chartLibPromise) chartLibPromise = loadScript('/vendor/chartjs/chart.umd.js');
  return chartLibPromise;
}

// Every render() rebuilds the DOM (including a fresh <canvas>), so the
// chart is destroyed and recreated each time rather than update()d in
// place - Chart.js refuses to bind two live instances to the same canvas
// lifecycle, and the canvas element itself does not survive a re-render.
function mountChart() {
  if (!window.Chart || !chartCanvas) return;
  if (chart) { chart.destroy(); chart = null; }
  const Chart = window.Chart;
  chart = new Chart(chartCanvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: history.labels,
      datasets: [
        { label: 'Temperature (C)', data: history.temp, borderColor: '#9B1C2E', backgroundColor: 'transparent', tension: 0.25, yAxisID: 'y' },
        { label: 'Humidity (%)', data: history.hum, borderColor: '#1D5A9B', backgroundColor: 'transparent', tension: 0.25, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true,
      animation: false,
      scales: {
        y: { position: 'left', title: { display: true, text: 'C' } },
        y1: { position: 'right', title: { display: true, text: '%' }, grid: { drawOnChartArea: false } },
      },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
    },
  });
}

function sample() {
  const t = state.telemetry;
  if (!t) return;
  const now = Date.now();
  if (now - lastSample < 2500) return;
  lastSample = now;
  history.labels.push(t.sim_time || '');
  history.temp.push(t.environment?.temp_c ?? null);
  history.hum.push(t.environment?.humidity_pct ?? null);
  if (history.labels.length > 40) { history.labels.shift(); history.temp.shift(); history.hum.shift(); }
}

function render() {
  if (!container) return;
  clearNode(container);
  const t = state.telemetry;

  container.appendChild(el('div', { class: 'page-header' }, [
    el('div', {}, [
      el('h1', {}, 'Environment (Module C)'),
      el('p', {}, 'Building-wide environmental monitoring. SF-03 is the one live sensor node; other zones are simulated.'),
    ]),
  ]));

  const kpis = el('div', { class: 'grid grid-3' }, [
    kpi('Temperature (SF-03)', `${(t?.environment?.temp_c ?? 0).toFixed(1)} C`, `Normal range ${thresholds?.env_temp_min ?? 20}-${thresholds?.env_temp_max ?? 28} C`),
    kpi('Humidity (SF-03)', `${(t?.environment?.humidity_pct ?? 0).toFixed(0)} %`, `Normal range ${thresholds?.env_hum_min ?? 40}-${thresholds?.env_hum_max ?? 70} %`),
    kpi('Air Quality Index', `${(t?.environment?.aqi ?? 0).toFixed(0)}`, 'Derived from MQ-2 low-level readings'),
  ]);
  container.appendChild(kpis);

  chartCanvas = el('canvas', { height: '90' });
  container.appendChild(el('div', { class: 'card', style: 'margin-top:16px;' }, [
    el('div', { class: 'card-title' }, ['Temperature & Humidity History (SF-03)', liveBadge(true)]),
    chartCanvas,
  ]));
  if (window.Chart) {
    mountChart();
  } else {
    ensureChartLib().then(() => { if (container) mountChart(); });
  }

  container.appendChild(el('div', { class: 'section-title' }, 'Thresholds'));
  container.appendChild(card(null, [buildThresholdForm()]));

  container.appendChild(el('div', { class: 'section-title' }, 'Zone Table'));
  const zoneRows = [
    { room: 'SF-03', name: 'Smart Classroom 1', temp: t?.environment?.temp_c, hum: t?.environment?.humidity_pct, state: t?.smart_room?.state, live: true },
    ...(state.virtualZones || []).map((z) => ({ room: z.room, name: z.name, temp: z.temp_c, hum: z.humidity_pct, state: z.state, live: false })),
  ];
  container.appendChild(card(null, [table(
    [
      { key: 'room', label: 'Room' },
      { key: 'name', label: 'Name' },
      { key: 'temp', label: 'Temp', render: (r) => `${(r.temp ?? 0).toFixed(1)} C` },
      { key: 'hum', label: 'Humidity', render: (r) => `${(r.hum ?? 0).toFixed(0)} %` },
      { key: 'state', label: 'Room State' },
      { key: 'live', label: 'Source', render: (r) => r.live ? 'LIVE' : 'SIMULATED' },
    ],
    zoneRows,
  )]));
}

function buildThresholdForm() {
  if (!thresholds) return el('div', { class: 'empty-state' }, 'Loading thresholds...');
  if (user?.role !== 'admin') {
    return el('div', {}, [
      row('Temperature range', `${thresholds.env_temp_min} - ${thresholds.env_temp_max} C`),
      row('Humidity range', `${thresholds.env_hum_min} - ${thresholds.env_hum_max} %`),
      el('div', { class: 'sub', style: 'margin-top:8px;' }, 'Sign in as admin to edit thresholds.'),
    ]);
  }
  const tMin = el('input', { type: 'number', value: thresholds.env_temp_min, style: 'width:70px;' });
  const tMax = el('input', { type: 'number', value: thresholds.env_temp_max, style: 'width:70px;' });
  const hMin = el('input', { type: 'number', value: thresholds.env_hum_min, style: 'width:70px;' });
  const hMax = el('input', { type: 'number', value: thresholds.env_hum_max, style: 'width:70px;' });
  return el('div', { class: 'form-inline' }, [
    el('div', { class: 'form-row' }, [el('label', {}, 'Temp min (C)'), tMin]),
    el('div', { class: 'form-row' }, [el('label', {}, 'Temp max (C)'), tMax]),
    el('div', { class: 'form-row' }, [el('label', {}, 'Humidity min (%)'), hMin]),
    el('div', { class: 'form-row' }, [el('label', {}, 'Humidity max (%)'), hMax]),
    el('button', {
      class: 'pill-btn primary', onclick: async () => {
        thresholds = await (await api.saveThresholds({
          env_temp_min: Number(tMin.value), env_temp_max: Number(tMax.value),
          env_hum_min: Number(hMin.value), env_hum_max: Number(hMax.value),
        })).thresholds;
        toast('Thresholds synced to ESP32', 'success');
        render();
      },
    }, 'Save & Sync to ESP32'),
  ]);
}

function kpi(label, value, sub) {
  return el('div', { class: 'card kpi' }, [
    el('span', { class: 'label' }, label),
    el('span', { class: 'value' }, value),
    el('span', { class: 'sub' }, sub),
  ]);
}
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
    api.thresholds().then((r) => { thresholds = r.thresholds; render(); }).catch(() => render());
    unsub = onStoreChange(() => { sample(); render(); });
    render();
  },
  unmount() { if (unsub) unsub(); if (chart) { chart.destroy(); chart = null; } container = null; },
};
