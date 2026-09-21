import { state, on as onStoreChange } from '../store.js';
import { el, kpiCard, card, severityBadge, fmtTime, emptyState, offlineState, clearNode } from '../ui.js';

let unsub = null;
let container = null;

const SMOKE_LABELS = ['Normal', 'Watch', 'Warning', 'Danger', 'EMERGENCY'];

function render() {
  if (!container) return;
  clearNode(container);

  const t = state.telemetry;

  container.appendChild(el('div', { class: 'page-header' }, [el('h1', {}, 'Command Center')]));

  if (!t) {
    container.appendChild(offlineState('Waiting for the first telemetry frame from the ESP32...'));
    return;
  }

  const kpis = el('div', { class: 'grid grid-kpi' }, [
    kpiCard({ label: 'Smoke Level', value: SMOKE_LABELS[t.security?.smoke_level ?? 0], sub: `${(t.security?.smoke_pct ?? 0).toFixed(0)}%` }),
    kpiCard({ label: 'SF-03 Temp / Humidity', value: `${(t.environment?.temp_c ?? 0).toFixed(1)}C / ${(t.environment?.humidity_pct ?? 0).toFixed(0)}%`, sub: t.environment?.motion ? 'Motion present' : 'No motion' }),
    kpiCard({ label: 'Attendance Today', value: t.attendance_today ?? 0 }),
    kpiCard({ label: 'Main Door', value: t.doors?.main_entrance_unlocked ? 'UNLOCKED' : 'LOCKED' }),
    kpiCard({ label: 'Waste - Main Lobby', value: `${(t.waste?.fill_pct ?? 0).toFixed(0)}%`, sub: t.waste?.full ? 'BIN FULL' : 'Normal' }),
    kpiCard({ label: 'Firewall Blocks', value: state.netStats?.blocked_hosts?.length ?? 0 }),
    kpiCard({ label: 'Wi-Fi Link', value: t.wifi?.connected ? `${t.wifi.rssi} dBm` : 'Offline', sub: t.wifi?.connected ? t.wifi.ip : '' }),
  ]);
  container.appendChild(kpis);

  const grid2 = el('div', { class: 'grid grid-2', style: 'margin-top:16px;' });

  const alerts = state.events.filter((e) => e.kind === 'alert').slice(0, 15);
  grid2.appendChild(card('Alerts', alerts.length ? alerts.map((a) => el('div', { class: `feed-item sev-${a.severity || 'info'}` }, [
    el('span', { class: 'ts' }, fmtTime(a.ts)),
    el('div', {}, [
      severityBadge(a.severity),
      el('div', {}, a.message || a.reason || a.phase || ''),
    ]),
  ])) : [emptyState('No alerts yet.')], { class: 'feed' }));

  const logs = state.events.filter((e) => e.kind === 'log').slice(0, 15);
  grid2.appendChild(card('Event Log', logs.length ? logs.map((l) => el('div', { class: 'feed-item sev-info' }, [
    el('span', { class: 'ts' }, fmtTime(l.ts)),
    el('div', {}, l.message),
  ])) : [emptyState('No log entries yet.')], { class: 'feed' }));

  container.appendChild(grid2);

  const healthGrid = el('div', { class: 'grid grid-3', style: 'margin-top:16px;' });
  healthGrid.appendChild(card('ESP32', [
    row('Uptime', `${t.uptime_s ?? 0} s`),
    row('Free heap', `${((t.heap_free ?? 0) / 1024).toFixed(0)} KB`),
    row('Sim clock', `x${t.sim_scale ?? 1}`),
    row('Bridge', state.bridgeMode + (state.demoMode ? ' (DEMO)' : '')),
  ]));
  healthGrid.appendChild(card('Smart Room SF-03', [
    row('State', t.smart_room?.state || 'STANDBY'),
    row('Subject', t.smart_room?.subject || '-'),
    row('Relay', t.relay_sf03 ? 'ON' : 'OFF'),
  ]));
  healthGrid.appendChild(card('Metal Detector', [
    row('Threshold', `${t.metal_detector?.threshold_pct ?? 0}%`),
    row('Hold', t.metal_detector?.hold_active ? 'ACTIVE' : 'Idle'),
  ]));
  container.appendChild(healthGrid);
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
    unsub = onStoreChange(render);
    render();
  },
  unmount() {
    if (unsub) unsub();
    container = null;
  },
};
