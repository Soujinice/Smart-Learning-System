import { api } from '../api.js';
import { state, on as onStoreChange } from '../store.js';
import { el, card, table, fmtTime, liveBadge, toast, clearNode } from '../ui.js';

let container = null;
let unsub = null;
let registry = [];
let attendanceRows = [];
let filters = { room: '', role: '', q: '' };

async function loadAttendance() {
  const r = await api.attendance(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)));
  attendanceRows = r.attendance;
  render();
}

function render() {
  if (!container) return;
  clearNode(container);

  container.appendChild(el('div', { class: 'page-header' }, [
    el('div', {}, [
      el('h1', {}, 'Attendance & RFID (Module A)'),
      el('p', {}, 'RFID is simulated: Wokwi has no RC522/PN532 part, so three pushbuttons plus virtual web taps stand in for the reader.'),
    ]),
  ]));

  const readerCard = card('Reader Status', [
    row('Reader', 'Main Entrance - simulated (pushbuttons + web taps)'),
    row('Registered UIDs', String(registry.length)),
    row('Last tap', state.rfidTaps[0] ? `${state.rfidTaps[0].name || state.rfidTaps[0].uid} (${state.rfidTaps[0].result})` : 'None yet'),
  ], { titleRight: liveBadge(true) });

  const tapForm = buildTapPanel();

  const grid2 = el('div', { class: 'grid grid-2' }, [readerCard, tapForm]);
  container.appendChild(grid2);

  const feed = el('div', { class: 'feed' }, state.rfidTaps.slice(0, 25).map((tapEvt) => el('div', { class: `feed-item sev-${tapEvt.result === 'denied' ? 'critical' : tapEvt.result?.startsWith('granted') ? 'info' : 'warning'}` }, [
    el('span', { class: 'ts' }, fmtTime(tapEvt.ts)),
    el('div', {}, [
      el('strong', {}, tapEvt.name || tapEvt.uid),
      ` - ${tapEvt.result}`,
      tapEvt.room ? ` - ${tapEvt.room}` : '',
      el('div', { class: 'sub' }, `Source: ${tapEvt.source}`),
    ]),
  ])));
  container.appendChild(card('Live Tap Feed', [feed.children.length ? feed : el('div', { class: 'empty-state' }, 'No taps yet.')], { class: 'secondary-panel', bodyClass: '' }));

  container.appendChild(el('div', { class: 'section-title' }, 'Registered Users'));
  container.appendChild(card(null, [table(
    [
      { key: 'uid', label: 'UID' },
      { key: 'name', label: 'Name' },
      { key: 'role', label: 'Role' },
      { key: 'room', label: 'Home Room' },
      { key: 'section', label: 'Section' },
    ],
    registry,
  )]));

  container.appendChild(el('div', { class: 'section-title' }, 'Attendance Records'));
  container.appendChild(buildFilterBar());
  container.appendChild(card(null, [table(
    [
      { key: 'ts', label: 'Time', render: (r) => fmtTime(r.ts) },
      { key: 'name', label: 'Name' },
      { key: 'role', label: 'Role' },
      { key: 'room', label: 'Room' },
      { key: 'source', label: 'Source', render: (r) => r.source === 'button' ? 'Pushbutton (LIVE)' : r.source === 'web' ? 'Virtual tap (LIVE cmd)' : r.source },
    ],
    attendanceRows,
    { emptyText: 'No attendance recorded yet.' },
  )]));
}

function buildTapPanel() {
  const select = el('select', {}, [
    el('option', { value: '' }, 'Select a registered user...'),
    ...registry.map((u) => el('option', { value: u.uid }, `${u.name} (${u.uid}) - ${u.role}`)),
  ]);
  const btn = el('button', {
    class: 'pill-btn primary',
    onclick: async () => {
      if (!select.value) { toast('Choose a user to tap first', 'error'); return; }
      try { await api.tap(select.value); toast('Virtual tap sent to ESP32', 'success'); } catch (e) { toast(e.message, 'error'); }
    },
  }, 'Simulate Web Tap');

  return card('Virtual Card-Tap Panel (from website)', [
    el('p', { class: 'sub', style: 'margin-top:0;' }, 'Honest labeling: Wokwi has no native RFID part. Physical taps use CARD1/CARD2/CARD3 pushbuttons; this panel sends the same tap event over the wire as source "web".'),
    el('div', { class: 'form-inline' }, [select, btn]),
  ]);
}

function buildFilterBar() {
  const roomInput = el('input', { type: 'text', placeholder: 'Room (e.g. SF-03)', value: filters.room });
  const roleSelect = el('select', {}, [
    el('option', { value: '' }, 'All roles'),
    el('option', { value: 'student', selected: filters.role === 'student' ? 'selected' : null }, 'Student'),
    el('option', { value: 'faculty', selected: filters.role === 'faculty' ? 'selected' : null }, 'Faculty'),
  ]);
  const qInput = el('input', { type: 'text', placeholder: 'Search name', value: filters.q });
  const applyBtn = el('button', {
    class: 'pill-btn', onclick: () => { filters = { room: roomInput.value.trim(), role: roleSelect.value, q: qInput.value.trim() }; loadAttendance(); },
  }, 'Filter');
  const exportBtn = el('a', { class: 'pill-btn', href: '/api/attendance.csv', download: 'attendance.csv' }, 'Export CSV');

  return el('div', { class: 'card', style: 'margin-bottom:16px;' }, [
    el('div', { class: 'form-inline' }, [
      el('div', { class: 'form-row' }, [el('label', {}, 'Room'), roomInput]),
      el('div', { class: 'form-row' }, [el('label', {}, 'Role'), roleSelect]),
      el('div', { class: 'form-row' }, [el('label', {}, 'Search'), qInput]),
      applyBtn, exportBtn,
    ]),
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
    Promise.all([api.rfid(), api.attendance()]).then(([rfidRes, attRes]) => {
      registry = rfidRes.users;
      attendanceRows = attRes.attendance;
      render();
    }).catch(() => render());
    unsub = onStoreChange(render);
    render();
  },
  unmount() {
    if (unsub) unsub();
    container = null;
  },
};
