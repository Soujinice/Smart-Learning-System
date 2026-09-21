import { api } from '../api.js';
import { state, on as onStoreChange } from '../store.js';
import { el, kpiCard, card, severityBadge, fmtTime, emptyState, offlineState, clearNode } from '../ui.js';

let unsub = null;
let container = null;
let doors = null;

const SMOKE_LABELS = ['L0 Normal', 'L1 Watch', 'L2 Warning', 'L3 Danger', 'L4 EMERGENCY'];

function render() {
  if (!container) return;
  clearNode(container);

  const t = state.telemetry;

  container.appendChild(el('div', { class: 'page-header' }, [
    el('div', {}, [
      el('h1', {}, 'Command Center'),
      el('p', {}, 'Live overview of the Smart Learning Center - one ESP32 running every subsystem concurrently.'),
    ]),
  ]));

  if (!t) {
    container.appendChild(offlineState('Waiting for the first telemetry frame from the ESP32...'));
    return;
  }

  const doorsUnlocked = t.doors?.override_active
    ? (doors ? doors.length : 1)
    : (doors ? doors.filter((d) => !d.locked).length : (t.doors?.main_entrance_unlocked ? 1 : 0));
  const doorsTotal = doors ? doors.length : 1;

  const kpis = el('div', { class: 'grid grid-kpi' }, [
    kpiCard({
      label: 'Emergency State', value: t.emergency?.state || 'IDLE',
      valueClass: t.emergency?.active ? 'small' : 'small',
      sub: t.emergency?.active ? 'OVERRIDE ACTIVE' : 'Normal operation',
    }),
    kpiCard({ label: 'Smoke Level', value: SMOKE_LABELS[t.security?.smoke_level ?? 0], sub: `${(t.security?.smoke_pct ?? 0).toFixed(0)}% of range - flame ${t.security?.flame ? 'DETECTED' : 'clear'}` }),
    kpiCard({ label: 'SF-03 Temp / Humidity', value: `${(t.environment?.temp_c ?? 0).toFixed(1)}C / ${(t.environment?.humidity_pct ?? 0).toFixed(0)}%`, sub: t.environment?.motion ? 'Motion present' : 'No motion' }),
    kpiCard({ label: 'Attendance Today', value: t.attendance_today ?? 0, sub: 'Granted RFID taps (building-wide)' }),
    kpiCard({ label: 'Doors Unlocked', value: `${doorsUnlocked} / ${doorsTotal}`, sub: t.doors?.override_active ? 'Emergency override active' : 'Normal access mode' }),
    kpiCard({ label: 'Waste - Main Lobby', value: `${(t.waste?.fill_pct ?? 0).toFixed(0)}%`, sub: t.waste?.full ? 'BIN FULL' : 'Normal' }),
    kpiCard({ label: 'Network / Firewall', value: state.netStats ? `${state.netStats.blocked_hosts?.length ?? 0} blocked` : '-', sub: state.netStats?.scenario ? `Last scenario: ${state.netStats.scenario}` : 'Awaiting stats' }),
    kpiCard({ label: 'Wi-Fi Link (Wokwi-GUEST)', value: t.wifi?.connected ? `${t.wifi.rssi} dBm` : 'Offline', sub: t.wifi?.connected ? t.wifi.ip : 'Building runs normally without it' }),
  ]);
  container.appendChild(kpis);

  const grid2 = el('div', { class: 'grid grid-2', style: 'margin-top:16px;' });

  const alerts = state.events.filter((e) => e.kind === 'alert').slice(0, 20);
  grid2.appendChild(card('Live Alert Feed', alerts.length ? alerts.map((a) => el('div', { class: `feed-item sev-${a.severity || 'info'}` }, [
    el('span', { class: 'ts' }, fmtTime(a.ts)),
    el('div', {}, [
      el('div', {}, [severityBadge(a.severity), ' ', el('strong', {}, a.module ? `Module ${a.module}` : 'Alert')]),
      el('div', {}, a.message || a.reason || a.phase || ''),
    ]),
  ])) : [emptyState('No alerts yet.')], { class: 'feed' }));

  const logs = state.events.filter((e) => e.kind === 'log').slice(0, 20);
  grid2.appendChild(card('Live Event Log', logs.length ? logs.map((l) => el('div', { class: 'feed-item sev-info' }, [
    el('span', { class: 'ts' }, fmtTime(l.ts)),
    el('div', {}, l.message),
  ])) : [emptyState('No log entries yet.')], { class: 'feed' }));

  container.appendChild(grid2);

  const healthGrid = el('div', { class: 'grid grid-3', style: 'margin-top:16px;' });
  healthGrid.appendChild(card('ESP32 Health', [
    row('Uptime', `${t.uptime_s ?? 0} s`),
    row('Free heap', `${((t.heap_free ?? 0) / 1024).toFixed(0)} KB`),
    row('Sim clock scale', `${t.sim_scale ?? 1} min / real second`),
    row('Bridge mode', state.bridgeMode + (state.demoMode ? ' (DEMO MODE)' : '')),
  ]));
  healthGrid.appendChild(card('Smart Room SF-03', [
    row('State', t.smart_room?.state || 'STANDBY'),
    row('Subject', t.smart_room?.subject || '-'),
    row('Faculty', t.smart_room?.faculty || '-'),
    row('Relay (board/projector)', t.relay_sf03 ? 'ON' : 'OFF'),
  ]));
  healthGrid.appendChild(card('Metal Detector', [
    row('Threshold', `${t.metal_detector?.threshold_pct ?? 0}%`),
    row('Screening hold', t.metal_detector?.hold_active ? 'ACTIVE - entry held' : 'Idle'),
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
    api.doors().then((r) => { doors = r.doors; render(); }).catch(() => {});
    unsub = onStoreChange(render);
    render();
  },
  unmount() {
    if (unsub) unsub();
    container = null;
  },
};
