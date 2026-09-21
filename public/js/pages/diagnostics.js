import { api } from '../api.js';
import { state, on as onStoreChange } from '../store.js';
import { el, card, table, toast, clearNode } from '../ui.js';
import { ASSET_INVENTORY, PIN_MAP } from '../data/inventory.js';

let container = null;
let unsub = null;

const DEMO_GUIDE = [
  ['Tap CARD1', 'Attendance recorded, door unlocks for 3s. CARD3 gives Access Denied, nothing recorded.'],
  ['Start class now (SF-03)', 'Relay ON, room ACTIVE. Raise DHT22 temp above 28C -> alert. End class -> data saved, relay OFF.'],
  ['Raise MQ-2 briefly then lower', '"Possible False Alarm" is logged, no emergency triggered.'],
  ['Raise MQ-2 high & sustained', 'CONFIRMED EMERGENCY: all doors unlock, alarm, notification; acknowledge, drill/clear, doors return to locked.'],
  ['Press the manual pull station', 'Immediate emergency path (bypasses D verification).'],
  ['SCREEN with potentiometer above threshold', 'Metal alert, entry held; Allow/Deny from Security & Fire page. While held, CARD1 will not unlock the door.'],
  ['PIR trigger after building hours', 'Intrusion alert; during class hours it is presence only.'],
  ['HC-SR04 distance below threshold', 'Bin Full alert -> Mark Collected -> resets.'],
  ['Network scenario buttons', 'Firewall blocks and auto-block list grows; student LMS login permitted, server-port attempt denied.'],
  ['Admin edits user/schedule/threshold', 'ESP32 acknowledges and behavior changes immediately.'],
  ['Stop the Wokwi simulation', 'UI shows Offline within ~5s and recovers automatically on restart.'],
];

function render() {
  if (!container) return;
  clearNode(container);

  container.appendChild(el('div', { class: 'page-header' }, [el('h1', {}, 'Diagnostics')]));

  const grid2 = el('div', { class: 'grid grid-2' });
  grid2.appendChild(card('Connection', [
    row('Bridge', state.bridgeMode + (state.demoMode ? ' (DEMO)' : '')),
    row('Connected', state.connected ? 'Yes' : 'No'),
    row('Sim time', state.telemetry?.sim_time || '-'),
    el('div', { class: 'form-inline', style: 'margin-top:8px;' }, [
      el('button', { class: 'pill-btn primary', onclick: async () => { await api.ping(); toast('Ping sent'); } }, 'Send Ping'),
    ]),
  ]));

  grid2.appendChild(card('Pin Values', [
    row('DHT22 temp/humidity', `${(state.telemetry?.environment?.temp_c ?? 0).toFixed(1)}C / ${(state.telemetry?.environment?.humidity_pct ?? 0).toFixed(0)}%`),
    row('PIR (SF-03)', state.telemetry?.environment?.motion ? 'HIGH (motion)' : 'LOW'),
    row('MQ-2 smoke %', `${(state.telemetry?.security?.smoke_pct ?? 0).toFixed(0)}%`),
    row('HC-SR04 waste fill', `${(state.telemetry?.waste?.fill_pct ?? 0).toFixed(0)}%`),
    row('Servo (main door)', state.telemetry?.doors?.main_entrance_unlocked ? '90deg (unlocked)' : '0deg (locked)'),
  ]));
  container.appendChild(grid2);

  container.appendChild(el('div', { class: 'section-title' }, 'Console'));
  const consoleBox = el('div', { class: 'console-box', id: 'console-box' }, state.consoleLines.map((l) => el('div', { class: 'line' }, l)));
  container.appendChild(card(null, [consoleBox]));

  container.appendChild(el('div', { class: 'section-title' }, 'Pin Map'));
  container.appendChild(card(null, [table(
    [{ key: 'pin', label: 'Pin' }, { key: 'device', label: 'Device' }, { key: 'role', label: 'Role' }],
    PIN_MAP,
  )]));

  container.appendChild(el('div', { class: 'section-title' }, 'Asset Inventory'));
  container.appendChild(card(null, [table(
    [{ key: 'component', label: 'Component' }, { key: 'designed', label: 'Qty' }, { key: 'represented', label: 'In this simulation' }],
    ASSET_INVENTORY,
  )]));

  container.appendChild(el('div', { class: 'section-title' }, 'Demo Guide'));
  container.appendChild(card(null, [table(
    [{ key: 'action', label: 'Action' }, { key: 'expected', label: 'Expected Result' }],
    DEMO_GUIDE.map(([action, expected]) => ({ action, expected })),
  )]));
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
    api.console().then((r) => { state.consoleLines = r.lines.map((l) => l.line); render(); }).catch(() => render());
    unsub = onStoreChange(() => {
      const box = document.getElementById('console-box');
      if (box) {
        clearNode(box);
        state.consoleLines.slice(-200).forEach((l) => box.appendChild(el('div', { class: 'line' }, l)));
        box.scrollTop = box.scrollHeight;
      } else {
        render();
      }
    });
    render();
  },
  unmount() { if (unsub) unsub(); container = null; },
};
