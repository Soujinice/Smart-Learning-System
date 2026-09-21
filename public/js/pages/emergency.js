import { api } from '../api.js';
import { state, on as onStoreChange } from '../store.js';
import { el, card, fmtTime, toast, clearNode } from '../ui.js';

let container = null;
let unsub = null;
let doors = null;
let confirmingClear = false;

const STATES = ['IDLE', 'VERIFY', 'ACTIVE', 'RESPONSE', 'CLEARED'];

function render() {
  if (!container) return;
  clearNode(container);
  const t = state.telemetry;
  const emergState = t?.emergency?.state || 'IDLE';

  container.appendChild(el('div', { class: 'page-header' }, [
    el('div', {}, [
      el('h1', {}, 'Emergency System (Module G)'),
      el('p', {}, 'Central override: confirmed fire/smoke, the manual pull station, or a dashboard drill all route here.'),
    ]),
  ]));

  container.appendChild(el('div', { class: 'stepper card' }, STATES.map((s) => {
    const cls = s === emergState ? 'active' : (STATES.indexOf(s) < STATES.indexOf(emergState) ? 'done' : '');
    return el('div', { class: `step ${cls}` }, s);
  })));

  const grid2 = el('div', { class: 'grid grid-2', style: 'margin-top:16px;' });

  grid2.appendChild(card('Controls', [
    el('p', { class: 'sub', style: 'margin-top:0;' }, 'Acknowledge moves ACTIVE -> RESPONSE. Clear requires sensors normal AND this confirmation.'),
    el('div', { class: 'form-inline' }, [
      el('button', { class: 'pill-btn primary', disabled: emergState !== 'ACTIVE' ? 'disabled' : null, onclick: () => act('ack') }, 'Acknowledge'),
      el('button', { class: 'pill-btn', disabled: emergState !== 'RESPONSE' ? 'disabled' : null, onclick: () => { confirmingClear = true; render(); } }, 'Clear Emergency'),
      el('button', { class: 'pill-btn danger', disabled: emergState !== 'IDLE' ? 'disabled' : null, onclick: () => act('test') }, 'Test Emergency Drill'),
    ]),
    confirmingClear ? el('div', { class: 'card', style: 'margin-top:12px;background:var(--amber-bg);border-color:#f2ddad;' }, [
      el('p', { style: 'margin:0 0 8px;font-weight:600;' }, 'Confirm: sensors must read normal for this to actually clear. Proceed?'),
      el('div', { class: 'form-inline' }, [
        el('button', { class: 'pill-btn primary', onclick: () => { confirmingClear = false; act('clear'); } }, 'Yes, clear'),
        el('button', { class: 'pill-btn ghost', onclick: () => { confirmingClear = false; render(); } }, 'Cancel'),
      ]),
    ]) : null,
  ]));

  grid2.appendChild(card('Live State', [
    row('State', emergState),
    row('Override active', t?.emergency?.active ? 'YES - all doors unlocked, RFID bypassed' : 'No'),
    row('Smoke level (module D)', `L${t?.security?.smoke_level ?? 0}`),
    row('Sensors normal?', (t?.security?.smoke_level ?? 0) < 2 ? 'Yes' : 'No - clear will report Continue Emergency Mode'),
  ]));
  container.appendChild(grid2);

  container.appendChild(el('div', { class: 'section-title' }, 'Door Panel'));
  container.appendChild(card(null, [
    doors ? el('div', {}, doors.map((d) => el('div', { class: 'device-chip on', style: `background:${d.locked ? 'var(--gray-50)' : 'var(--red-bg)'};color:${d.locked ? 'inherit' : 'var(--red-primary)'};border-color:${d.locked ? 'var(--border)' : '#f0c3c8'};` }, [
      `${d.name}: ${d.locked ? 'LOCKED' : 'UNLOCKED'} `,
      d.live ? '(LIVE)' : '(SIMULATED)',
    ])) : el('div', { class: 'empty-state' }, 'Loading doors...'),
  ]));

  container.appendChild(el('div', { class: 'section-title' }, 'Notification / Acknowledgement Timeline'));
  const gEvents = state.events.filter((e) => e.kind === 'alert' && e.module === 'G').slice(0, 20);
  container.appendChild(card(null, [
    gEvents.length ? el('div', { class: 'feed' }, gEvents.map((a) => el('div', { class: `feed-item sev-${a.severity}` }, [
      el('span', { class: 'ts' }, fmtTime(a.ts)),
      el('div', {}, [el('strong', {}, a.phase || a.state), a.reason ? ` - ${a.reason}` : '', a.drill ? ' (drill)' : '']),
    ]))) : el('div', { class: 'empty-state' }, 'No emergency events yet.'),
  ]));
}

async function act(action) {
  try { await api.emergency(action); toast(`Emergency ${action} sent`, 'success'); } catch (e) { toast(e.message, 'error'); }
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
    api.doors().then((r) => { doors = r.doors; render(); }).catch(() => render());
    unsub = onStoreChange(() => { if (state.doors) doors = state.doors; render(); });
    render();
  },
  unmount() { if (unsub) unsub(); container = null; },
};
