import { api } from '../api.js';
import { el, card, table, toast, clearNode } from '../ui.js';

let container = null;
let user = null;
let registry = [];
let schedule = [];
let announcements = [];
let attendanceRows = [];

function render() {
  if (!container) return;
  clearNode(container);

  container.appendChild(el('div', { class: 'page-header' }, [
    el('div', {}, [
      el('h1', {}, 'Admin / Faculty Portal (Module I)'),
      el('p', {}, `Signed in as ${user.name} - role: ${user.role}.`),
    ]),
  ]));

  if (user.role === 'admin') renderAdmin();
  else if (user.role === 'faculty') renderFaculty();
  else if (user.role === 'registrar') renderRegistrar();
  else renderOther();
}

function renderAdmin() {
  container.appendChild(el('div', { class: 'section-title' }, 'Admin Dashboard'));

  container.appendChild(card('Announcements (Digital Information Display)', [
    announceForm(),
    el('div', { class: 'section-title' }, 'Recent'),
    table([{ key: 'ts', label: 'Time' }, { key: 'text', label: 'Text' }, { key: 'author', label: 'By' }], announcements.slice(-10).reverse()),
  ]));

  container.appendChild(el('div', { class: 'section-title' }, 'User Information (RFID Registry)'));
  container.appendChild(card(null, [userEditor()]));

  container.appendChild(el('div', { class: 'section-title' }, 'Schedule'));
  container.appendChild(card(null, [scheduleTable(true)]));

  container.appendChild(el('div', { class: 'section-title' }, 'System Settings'));
  container.appendChild(card(null, [
    el('p', {}, ['Thresholds and device configuration are edited on their own pages (', el('a', { href: '#/environment' }, 'Environment'), ', ', el('a', { href: '#/security-fire' }, 'Security & Fire'), ') so changes are made where their live readings are visible.']),
  ]));
}

function renderFaculty() {
  container.appendChild(el('div', { class: 'section-title' }, 'Faculty Dashboard'));
  container.appendChild(card('Faculty Inputs Class Information', [scheduleForm()]));
  container.appendChild(el('div', { class: 'section-title' }, 'My Schedule'));
  container.appendChild(card(null, [scheduleTable(false, user.name)]));
  container.appendChild(el('div', { class: 'section-title' }, 'View Attendance / Classroom Data'));
  container.appendChild(card(null, [table(
    [{ key: 'ts', label: 'Time' }, { key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'room', label: 'Room' }],
    attendanceRows.slice(0, 30),
    { emptyText: 'No attendance recorded yet.' },
  )]));
}

function renderRegistrar() {
  container.appendChild(el('div', { class: 'section-title' }, 'Registrar - Attendance Records'));
  container.appendChild(card(null, [table(
    [{ key: 'ts', label: 'Time' }, { key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'room', label: 'Room' }, { key: 'source', label: 'Source' }],
    attendanceRows,
    { emptyText: 'No attendance recorded yet.' },
  )]));
}

function renderOther() {
  const dest = user.role === 'security' ? '#/security-fire' : user.role === 'maintenance' ? '#/waste' : '#/command-center';
  const label = user.role === 'security' ? 'Security & Fire (screening decisions)' : user.role === 'maintenance' ? 'Waste (mark bins collected)' : 'Command Center';
  container.appendChild(card(null, [
    el('p', {}, `Your role (${user.role}) works from its own operational page rather than this portal.`),
    el('a', { href: dest, class: 'pill-btn primary' }, `Go to ${label}`),
  ]));
}

function announceForm() {
  const input = el('input', { type: 'text', placeholder: 'Announcement text for the digital display...', style: 'width:100%;' });
  const btn = el('button', {
    class: 'pill-btn primary', onclick: async () => {
      if (!input.value.trim()) return;
      const r = await api.postAnnouncement(input.value.trim());
      announcements.push(r.announcement);
      input.value = '';
      toast('Announcement sent to ESP32 display', 'success');
      render();
    },
  }, 'Publish');
  return el('div', { class: 'form-inline' }, [input, btn]);
}

function userEditor() {
  const rows = registry.map((u) => el('tr', {}, [
    tdInput(u, 'uid'), tdInput(u, 'name'), tdSelect(u, 'role', ['student', 'faculty', 'admin', 'registrar', 'security', 'maintenance']),
    tdInput(u, 'room'), tdInput(u, 'section'),
  ]));
  const addBtn = el('button', {
    class: 'pill-btn', onclick: () => { registry.push({ uid: '', name: '', role: 'student', room: '', section: '' }); render(); },
  }, 'Add User');
  const saveBtn = el('button', {
    class: 'pill-btn primary', onclick: async () => {
      await api.saveRfid(registry.filter((u) => u.uid));
      toast('Registry synced to ESP32', 'success');
    },
  }, 'Save & Sync to ESP32');

  return el('div', {}, [
    el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, ['UID', 'Name', 'Role', 'Room', 'Section'].map((h) => el('th', {}, h)))]),
      el('tbody', {}, rows),
    ]),
    el('div', { class: 'form-inline', style: 'margin-top:10px;' }, [addBtn, saveBtn]),
  ]);
}

function tdInput(obj, key) {
  const input = el('input', { value: obj[key] || '', oninput: (e) => { obj[key] = e.target.value; } });
  return el('td', {}, [input]);
}
function tdSelect(obj, key, options) {
  const select = el('select', { onchange: (e) => { obj[key] = e.target.value; } }, options.map((o) => el('option', { value: o, selected: obj[key] === o ? 'selected' : null }, o)));
  return el('td', {}, [select]);
}

function scheduleForm() {
  const room = el('select', {}, ['SF-03', 'SF-04', 'SF-05', 'SF-06', 'SF-07', 'SF-08'].map((r) => el('option', { value: r }, r)));
  const start = el('input', { type: 'time', value: '07:30' });
  const end = el('input', { type: 'time', value: '09:00' });
  const subject = el('input', { type: 'text', placeholder: 'Subject' });
  const section = el('input', { type: 'text', placeholder: 'Section' });
  const btn = el('button', {
    class: 'pill-btn primary', onclick: async () => {
      const [sh, sm] = start.value.split(':').map(Number);
      const [eh, em] = end.value.split(':').map(Number);
      const entry = { id: `SCH-${Date.now()}`, room: room.value, start: sh * 60 + sm, end: eh * 60 + em, subject: subject.value, section: section.value, faculty: user.name };
      schedule.push(entry);
      await api.saveSchedule(schedule);
      toast('Schedule updated and synced to ESP32', 'success');
      render();
    },
  }, 'Add to Schedule');
  return el('div', { class: 'form-inline' }, [
    el('div', { class: 'form-row' }, [el('label', {}, 'Room'), room]),
    el('div', { class: 'form-row' }, [el('label', {}, 'Start'), start]),
    el('div', { class: 'form-row' }, [el('label', {}, 'End'), end]),
    el('div', { class: 'form-row' }, [el('label', {}, 'Subject'), subject]),
    el('div', { class: 'form-row' }, [el('label', {}, 'Section'), section]),
    btn,
  ]);
}

function scheduleTable(showAll, facultyFilter) {
  const rows = showAll ? schedule : schedule.filter((s) => s.faculty === facultyFilter);
  return table(
    [
      { key: 'room', label: 'Room' },
      { key: 'start', label: 'Start', render: (r) => minToHHMM(r.start) },
      { key: 'end', label: 'End', render: (r) => minToHHMM(r.end) },
      { key: 'subject', label: 'Subject' },
      { key: 'section', label: 'Section' },
      { key: 'faculty', label: 'Faculty' },
    ],
    rows,
  );
}
function minToHHMM(min) { const h = Math.floor(min / 60); const m = min % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

export default {
  mount(rootEl, ctx) {
    container = rootEl;
    user = ctx.user;
    Promise.all([api.rfid(), api.schedule(), api.announcements(), api.attendance()]).then(([r1, r2, r3, r4]) => {
      registry = r1.users; schedule = r2.schedule; announcements = r3.announcements; attendanceRows = r4.attendance;
      render();
    }).catch(() => render());
    render();
  },
  unmount() { container = null; },
};
