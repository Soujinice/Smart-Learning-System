import { api } from '../api.js';
import { state, on as onStoreChange } from '../store.js';
import { el, card, table, liveBadge, clearNode, loadScript } from '../ui.js';

let container = null;
let unsub = null;
let thresholds = null;
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

  container.appendChild(el('div', { class: 'page-header' }, [el('h1', {}, 'Environment')]));

  const kpis = el('div', { class: 'grid grid-3' }, [
    kpi('Temperature - SF-03', `${(t?.environment?.temp_c ?? 0).toFixed(1)} C`, `Range ${thresholds?.env_temp_min ?? 20}-${thresholds?.env_temp_max ?? 28} C`),
    kpi('Humidity - SF-03', `${(t?.environment?.humidity_pct ?? 0).toFixed(0)} %`, `Range ${thresholds?.env_hum_min ?? 40}-${thresholds?.env_hum_max ?? 70} %`),
    kpi('Air Quality Index', `${(t?.environment?.aqi ?? 0).toFixed(0)}`, ''),
  ]);
  container.appendChild(kpis);

  chartCanvas = el('canvas', { height: '90' });
  container.appendChild(el('div', { class: 'card', style: 'margin-top:16px;' }, [
    el('div', { class: 'card-title' }, ['Temperature & Humidity - SF-03', liveBadge(true)]),
    chartCanvas,
  ]));
  if (window.Chart) {
    mountChart();
  } else {
    ensureChartLib().then(() => { if (container) mountChart(); });
  }

  container.appendChild(el('div', { class: 'section-title' }, 'Zones'));
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

function kpi(label, value, sub) {
  return el('div', { class: 'card kpi' }, [
    el('span', { class: 'label' }, label),
    el('span', { class: 'value' }, value),
    el('span', { class: 'sub' }, sub),
  ]);
}
export default {
  mount(rootEl) {
    container = rootEl;
    api.thresholds().then((r) => { thresholds = r.thresholds; render(); }).catch(() => render());
    unsub = onStoreChange(() => { sample(); render(); });
    render();
  },
  unmount() { if (unsub) unsub(); if (chart) { chart.destroy(); chart = null; } container = null; },
};
