import { api } from '../api.js';
import { state, on as onStoreChange } from '../store.js';
import { el, card, table, fmtTime, liveBadge, toast, clearNode } from '../ui.js';

let container = null;
let unsub = null;
let schedule = [];

const STEPS = [
  { id: 'STANDBY', label: 'Standby' },
  { id: 'ACTIVE_BEFORE', label: 'Before Class' },
  { id: 'IN_SESSION', label: 'During Class' },
  { id: 'AFTER_CLASS', label: 'After Class' },
];

function minToHHMM(min) { const h = Math.floor(min / 60); const m = min % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

function render() {
  if (!container) return;
  clearNode(container);
  const t = state.telemetry;
  const rm = t?.smart_room;

  container.appendChild(el('div', { class: 'page-header' }, [
    el('div', {}, [
      el('h1', {}, 'Smart Room (Module B) - Smart Classroom 1, SF-03'),
      el('p', {}, 'The only physically-wired classroom. Other smart rooms are virtual and simulated by the server.'),
    ]),
  ]));

  const activeId = rm?.state || 'STANDBY';
  const stepper = el('div', { class: 'stepper card' }, STEPS.map((s, idx) => {
    const activeIdx = STEPS.findIndex((x) => x.id === activeId);
    const cls = s.id === activeId ? 'active' : idx < activeIdx ? 'done' : '';
    return el('div', { class: `step ${cls}` }, s.label);
  }));
  container.appendChild(stepper);

  const grid2 = el('div', { class: 'grid grid-2', style: 'margin-top:16px;' });

  grid2.appendChild(card('Room Status', [
    row('Room', 'SF-03 - Smart Classroom 1', true),
    row('State', activeId),
    row('Subject', rm?.subject || '-'),
    row('Section', rm?.section || '-'),
    row('Faculty', rm?.faculty || '-'),
    row('Attendance this session', rm?.attendance ?? 0),
    row('Condition', rm?.abnormal ? 'ABNORMAL' : 'Normal'),
  ]));

  grid2.appendChild(card('Device Power States', [
    el('div', {}, [
      el('span', { class: `device-chip ${t?.relay_sf03 ? 'on' : ''}` }, `Smart Board / Projector relay: ${t?.relay_sf03 ? 'ON' : 'OFF'}`),
      el('span', { class: `device-chip ${activeId !== 'STANDBY' ? 'on' : ''}` }, `Sensors (DHT22 + PIR): ${activeId !== 'STANDBY' ? 'ACTIVE' : 'idle'}`),
      el('span', { class: `device-chip ${activeId !== 'STANDBY' ? 'on' : ''}` }, `RFID attendance window: ${activeId !== 'STANDBY' ? 'OPEN' : 'closed'}`),
      el('span', { class: 'device-chip on' }, 'Network: connected'),
    ]),
  ]));

  container.appendChild(grid2);

  const grid3 = el('div', { class: 'grid grid-2', style: 'margin-top:16px;' });
  grid3.appendChild(card('Room Readings', [
    row('Temperature', `${(t?.environment?.temp_c ?? 0).toFixed(1)} C (normal 20-28C)`),
    row('Humidity', `${(t?.environment?.humidity_pct ?? 0).toFixed(0)} % (normal 40-70%)`),
    row('Motion / presence', t?.environment?.motion ? 'Present' : 'None'),
  ], { titleRight: liveBadge(true) }));

  const alerts = state.events.filter((e) => e.kind === 'alert' && e.module === 'B').slice(0, 10);
  grid3.appendChild(card('Room Alerts', alerts.length ? alerts.map((a) => el('div', { class: 'feed-item sev-warning' }, [
    el('span', { class: 'ts' }, fmtTime(a.ts)), el('div', {}, a.message),
  ])) : [el('div', { class: 'empty-state' }, 'No abnormal conditions logged.')], { class: 'feed' }));
  container.appendChild(grid3);

  container.appendChild(el('div', { class: 'section-title' }, 'Demo Controls'));
  container.appendChild(card(null, [
    el('div', { class: 'form-inline' }, [
      el('button', { class: 'pill-btn primary', onclick: async () => { await api.classOverride('start'); toast('Class start requested', 'success'); } }, 'Start Class Now'),
      el('button', { class: 'pill-btn', onclick: async () => { await api.classOverride('end'); toast('Class end requested', 'success'); } }, 'End Class Now'),
      simClockControls(),
    ]),
  ]));

  container.appendChild(el('div', { class: 'section-title' }, 'Schedule (SF-03)'));
  container.appendChild(card(null, [table(
    [
      { key: 'start', label: 'Start', render: (r) => minToHHMM(r.start) },
      { key: 'end', label: 'End', render: (r) => minToHHMM(r.end) },
      { key: 'subject', label: 'Subject' },
      { key: 'section', label: 'Section' },
      { key: 'faculty', label: 'Faculty' },
    ],
    schedule.filter((s) => s.room === 'SF-03'),
  )]));
}

function simClockControls() {
  const scaleInput = el('input', { type: 'number', min: '1', max: '60', value: String(state.telemetry?.sim_scale ?? 1), style: 'width:70px;' });
  const jumpInput = el('input', { type: 'time', value: state.telemetry?.sim_time || '07:30' });
  return el('span', { style: 'display:flex;gap:8px;align-items:flex-end;' }, [
    el('div', { class: 'form-row' }, [el('label', {}, 'Sim minutes / real second'), scaleInput]),
    el('button', { class: 'pill-btn', onclick: async () => { await api.simClockScale(Number(scaleInput.value)); toast('Clock scale updated'); } }, 'Set Scale'),
    el('div', { class: 'form-row' }, [el('label', {}, 'Jump to time'), jumpInput]),
    el('button', {
      class: 'pill-btn', onclick: async () => {
        const [h, m] = jumpInput.value.split(':').map(Number);
        await api.simClockJump(h * 60 + m);
        toast('Sim clock jumped');
      },
    }, 'Jump'),
  ]);
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
    api.schedule().then((r) => { schedule = r.schedule; render(); }).catch(() => render());
    unsub = onStoreChange(render);
    render();
  },
  unmount() { if (unsub) unsub(); container = null; },
};
