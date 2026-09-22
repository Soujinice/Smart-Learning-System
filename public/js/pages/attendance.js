import { api } from '../api.js';
import { state, on as onStoreChange } from '../store.js';
import { el, card, table, fmtTime, liveBadge, toast, clearNode, withPreservedFocus } from '../ui.js';

let container = null;
let unsub = null;
let registry = [];
let attendanceRows = [];
let filters = { room: '', role: '', q: '' };

let regUid = '';
let regName = '';
let regRole = 'student';
let regRoom = '';
let lastAutoFilledUid = null;

async function loadAttendance() {
  const r = await api.attendance(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)));
  attendanceRows = r.attendance;
  render();
}

function render() {
  if (!container) return;
  withPreservedFocus(container, renderBody);
}

function renderBody() {
  clearNode(container);

  container.appendChild(el('div', { class: 'page-header' }, [el('h1', {}, 'Attendance & RFID')]));

  const readerCard = card('Reader Status', [
    row('Registered UIDs', String(registry.length)),
    row('Last tap', state.rfidTaps[0] ? `${state.rfidTaps[0].name || state.rfidTaps[0].uid} (${state.rfidTaps[0].result})` : 'None yet'),
  ], { titleRight: liveBadge(true) });

  const tapForm = buildTapPanel();

  const grid2 = el('div', { class: 'grid grid-2' }, [readerCard, tapForm]);
  container.appendChild(grid2);

  container.appendChild(buildRegisterPanel());

  const feed = el('div', { class: 'feed' }, state.rfidTaps.slice(0, 25).map((tapEvt) => el('div', { class: `feed-item sev-${tapEvt.result === 'denied' ? 'critical' : tapEvt.result?.startsWith('granted') ? 'info' : 'warning'}` }, [
    el('span', { class: 'ts' }, fmtTime(tapEvt.ts)),
    el('div', {}, [
      el('strong', {}, tapEvt.name || tapEvt.uid),
      ` - ${tapEvt.result}`,
      tapEvt.room ? ` - ${tapEvt.room}` : '',
      el('div', { class: 'sub' }, `Source: ${tapEvt.source}`),
    ]),
  ])));
  container.appendChild(card('Tap Feed', [feed.children.length ? feed : el('div', { class: 'empty-state' }, 'No taps yet.')]));

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
      { key: 'source', label: 'Source', render: (r) => r.source === 'button' ? 'Pushbutton' : r.source === 'web' ? 'Virtual tap' : r.source },
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

  return card('Virtual Tap', [
    el('div', { class: 'form-inline' }, [select, btn]),
  ]);
}

function buildRegisterPanel() {
  // Auto-fill the UID from the most recent denied tap (once per new UID, so
  // it doesn't keep stomping on something the admin is editing) - tapping
  // an unrecognized card on the Wokwi reader surfaces it here without
  // needing to copy/paste the UID by hand.
  const lastTap = state.rfidTaps[0];
  if (lastTap && lastTap.result === 'denied' && lastTap.uid !== lastAutoFilledUid) {
    regUid = lastTap.uid;
    lastAutoFilledUid = lastTap.uid;
  }

  const uidInput = el('input', { type: 'text', placeholder: 'UID', value: regUid, oninput: (e) => { regUid = e.target.value; } });
  const nameInput = el('input', { type: 'text', placeholder: 'Name (optional)', value: regName, oninput: (e) => { regName = e.target.value; } });
  const roleSelect = el('select', { onchange: (e) => { regRole = e.target.value; } }, [
    el('option', { value: 'student', selected: regRole === 'student' ? 'selected' : null }, 'Student'),
    el('option', { value: 'faculty', selected: regRole === 'faculty' ? 'selected' : null }, 'Faculty'),
  ]);
  const roomInput = el('input', { type: 'text', placeholder: 'Room (optional)', value: regRoom, oninput: (e) => { regRoom = e.target.value; } });

  const registerBtn = el('button', {
    class: 'pill-btn primary',
    onclick: async () => {
      const uid = regUid.trim();
      if (!uid) { toast('Tap a card on the reader (or the Virtual Tap panel) to get a UID first', 'error'); return; }
      const name = regName.trim() || `New Card ${uid.slice(-4)}`;
      const newUser = { uid, name, role: regRole, room: regRoom.trim(), section: '' };
      const updated = [...registry.filter((u) => u.uid !== uid), newUser];
      try {
        await api.saveRfid(updated);
        registry = updated;
        await api.tap(uid); // re-tap immediately so it shows granted right away
        toast(`${name} registered`, 'success');
        regUid = ''; regName = ''; regRoom = ''; lastAutoFilledUid = null;
        render();
        // Confirm the re-tap actually landed as granted (not swallowed as a
        // duplicate of the original denied tap) once the resulting event
        // has had time to come back over the wire.
        setTimeout(() => {
          const result = state.rfidTaps.find((t) => t.uid === uid)?.result;
          if (result && result.startsWith('granted')) {
            toast(`${name} - tap granted, RFID is working`, 'success');
          } else if (result === 'duplicate') {
            toast(`${name} is registered - tap the card again to confirm it grants`, 'success');
          }
        }, 1200);
      } catch (e) { toast(e.message, 'error'); }
    },
  }, 'Register & Grant');

  return el('div', { style: 'margin-bottom:16px;' }, [card('Register New Card', [
    el('div', { style: 'color:var(--text-muted);font-size:12.5px;' }, 'Tap an unrecognized card on the Wokwi reader, then register it here so it (and every tap after) is granted.'),
    el('div', { class: 'form-inline', style: 'margin-top:8px;' }, [
      el('div', { class: 'form-row' }, [el('label', {}, 'UID'), uidInput]),
      el('div', { class: 'form-row' }, [el('label', {}, 'Name'), nameInput]),
      el('div', { class: 'form-row' }, [el('label', {}, 'Role'), roleSelect]),
      el('div', { class: 'form-row' }, [el('label', {}, 'Room'), roomInput]),
      registerBtn,
    ]),
  ])]);
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
