import { api } from '../api.js';
import { state, on as onStoreChange } from '../store.js';
import { el, card, table, fmtTime, liveBadge, toast, clearNode } from '../ui.js';

let container = null;
let unsub = null;
let schedule = [];

let boardCanvasEl = null;
let boardCtx = null;
let boardDrawing = false;
let boardLast = null;

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

  container.appendChild(el('div', { class: 'page-header' }, [el('h1', {}, 'Smart Room - SF-03')]));

  const activeId = rm?.state || 'STANDBY';
  const stepper = el('div', { class: 'stepper card' }, STEPS.map((s, idx) => {
    const activeIdx = STEPS.findIndex((x) => x.id === activeId);
    const cls = s.id === activeId ? 'active' : idx < activeIdx ? 'done' : '';
    return el('div', { class: `step ${cls}` }, s.label);
  }));
  container.appendChild(stepper);

  const grid2 = el('div', { class: 'grid grid-2', style: 'margin-top:16px;' });

  grid2.appendChild(card('Room Status', [
    row('State', activeId),
    row('Subject', rm?.subject || '-'),
    row('Faculty', rm?.faculty || '-'),
    row('Attendance', rm?.attendance ?? 0),
    row('Condition', rm?.abnormal ? 'ABNORMAL' : 'Normal'),
  ]));

  grid2.appendChild(card('Devices', [
    el('div', {}, [
      el('span', { class: `device-chip ${t?.relay_sf03 ? 'on' : ''}` }, `Board/Projector relay: ${t?.relay_sf03 ? 'ON' : 'OFF'}`),
      el('span', { class: `device-chip ${activeId !== 'STANDBY' ? 'on' : ''}` }, `Sensors: ${activeId !== 'STANDBY' ? 'ACTIVE' : 'idle'}`),
      el('span', { class: `device-chip ${activeId !== 'STANDBY' ? 'on' : ''}` }, `Attendance window: ${activeId !== 'STANDBY' ? 'OPEN' : 'closed'}`),
    ]),
  ]));

  container.appendChild(grid2);

  container.appendChild(el('div', { class: 'section-title' }, 'Smart Board'));
  container.appendChild(buildSmartBoardCard(t?.relay_sf03));

  const grid3 = el('div', { class: 'grid grid-2', style: 'margin-top:16px;' });
  grid3.appendChild(card('Readings', [
    row('Temperature', `${(t?.environment?.temp_c ?? 0).toFixed(1)} C`),
    row('Humidity', `${(t?.environment?.humidity_pct ?? 0).toFixed(0)} %`),
    row('Motion', t?.environment?.motion ? 'Present' : 'None'),
  ], { titleRight: liveBadge(true) }));

  const alerts = state.events.filter((e) => e.kind === 'alert' && e.module === 'B').slice(0, 10);
  grid3.appendChild(card('Alerts', alerts.length ? alerts.map((a) => el('div', { class: 'feed-item sev-warning' }, [
    el('span', { class: 'ts' }, fmtTime(a.ts)), el('div', {}, a.message),
  ])) : [el('div', { class: 'empty-state' }, 'None logged.')], { class: 'feed' }));
  container.appendChild(grid3);

  container.appendChild(el('div', { class: 'section-title' }, 'Controls'));
  container.appendChild(card(null, [
    el('div', { class: 'form-inline' }, [
      el('button', { class: 'pill-btn primary', onclick: async () => { await api.classOverride('start'); toast('Class start requested', 'success'); } }, 'Start Class Now'),
      el('button', { class: 'pill-btn', onclick: async () => { await api.classOverride('end'); toast('Class end requested', 'success'); } }, 'End Class Now'),
      simClockControls(),
    ]),
  ]));

  container.appendChild(el('div', { class: 'section-title' }, 'Schedule'));
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

function buildSmartBoardCard(relayOn) {
  if (!boardCanvasEl) {
    boardCanvasEl = el('canvas', {
      width: '640',
      height: '260',
      style: 'width:100%;height:220px;border-radius:6px;background:#0e1520;display:block;touch-action:none;cursor:crosshair;',
    });
    boardCtx = boardCanvasEl.getContext('2d');
    boardCtx.strokeStyle = '#F3F4F6';
    boardCtx.lineWidth = 2.5;
    boardCtx.lineCap = 'round';
    boardCtx.lineJoin = 'round';

    const posFromEvent = (e) => {
      const rect = boardCanvasEl.getBoundingClientRect();
      const point = e.touches ? e.touches[0] : e;
      return {
        x: ((point.clientX - rect.left) / rect.width) * boardCanvasEl.width,
        y: ((point.clientY - rect.top) / rect.height) * boardCanvasEl.height,
      };
    };
    const start = (e) => { boardDrawing = true; boardLast = posFromEvent(e); e.preventDefault(); };
    const move = (e) => {
      if (!boardDrawing) return;
      const p = posFromEvent(e);
      boardCtx.beginPath();
      boardCtx.moveTo(boardLast.x, boardLast.y);
      boardCtx.lineTo(p.x, p.y);
      boardCtx.stroke();
      boardLast = p;
      e.preventDefault();
    };
    const end = () => { boardDrawing = false; boardLast = null; };

    boardCanvasEl.addEventListener('mousedown', start);
    boardCanvasEl.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    boardCanvasEl.addEventListener('touchstart', start, { passive: false });
    boardCanvasEl.addEventListener('touchmove', move, { passive: false });
    boardCanvasEl.addEventListener('touchend', end);
  }

  return card('Interactive Board - SF-03 (website demo)', [
    el('div', { class: 'sub', style: 'margin-bottom:8px;' }, 'Draw to represent the board/projector content shown in class. Wokwi has no touchscreen or whiteboard part, so this is simulated here on the dashboard.'),
    boardCanvasEl,
    el('div', { class: 'form-inline', style: 'margin-top:8px;' }, [
      el('button', {
        class: 'pill-btn ghost',
        onclick: () => boardCtx.clearRect(0, 0, boardCanvasEl.width, boardCanvasEl.height),
      }, 'Clear Board'),
    ]),
  ], { titleRight: liveBadge(!!relayOn) });
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
