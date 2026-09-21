import { api } from './api.js';
import { state, on as onStoreChange } from './store.js';
import { el, clearNode } from './ui.js';
import { icon } from './icons.js';

const PAGES = [
  { id: 'command-center', label: 'Command Center', icon: 'dashboard', path: './pages/command-center.js' },
  { id: 'attendance', label: 'Attendance & RFID', icon: 'rfid', path: './pages/attendance.js' },
  { id: 'smart-room', label: 'Smart Room', icon: 'room', path: './pages/smart-room.js' },
  { id: 'environment', label: 'Environment', icon: 'leaf', path: './pages/environment.js' },
  { id: 'security-fire', label: 'Security & Fire', icon: 'flame', path: './pages/security-fire.js' },
  { id: 'network', label: 'Network', icon: 'network', path: './pages/network.js' },
  { id: 'waste', label: 'Waste', icon: 'waste', path: './pages/waste.js' },
  { id: 'admin-portal', label: 'Admin / Faculty', icon: 'admin', path: './pages/admin-portal.js' },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'settings', path: './pages/diagnostics.js' },
];

const root = document.getElementById('root');
let currentUser = null;
let currentPageModule = null;
let currentPageId = null;

async function boot() {
  try {
    const me = await api.me();
    currentUser = me.user;
    renderShell();
  } catch {
    renderLogin();
  }
}

function renderLogin(errorMsg) {
  clearNode(root);
  const errorBox = el('div', { class: 'login-error' }, errorMsg || '');
  const userInput = el('input', { type: 'text', name: 'username', autocomplete: 'username', required: 'required' });
  const passInput = el('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: 'required' });

  const form = el('form', {
    onsubmit: async (ev) => {
      ev.preventDefault();
      try {
        const res = await api.login(userInput.value.trim(), passInput.value);
        currentUser = res.user;
        renderShell();
      } catch (err) {
        errorBox.textContent = err.message || 'Login failed';
      }
    },
  }, [
    el('div', { class: 'form-row' }, [el('label', {}, 'Username'), userInput]),
    el('div', { class: 'form-row' }, [el('label', {}, 'Password'), passInput]),
    el('button', { type: 'submit', class: 'pill-btn primary' }, 'Sign in'),
    errorBox,
  ]);

  root.appendChild(el('div', { class: 'login-screen' }, [
    el('div', { class: 'login-card' }, [
      el('h1', {}, 'Smart Learning Center'),
      el('p', {}, 'TUP - Group 3'),
      form,
      el('div', { class: 'demo-accounts' }, [
        el('div', {}, [el('code', {}, 'admin'), ' / ', el('code', {}, 'admin123')]),
        el('div', {}, [el('code', {}, 'faculty'), ' / ', el('code', {}, 'faculty123')]),
        el('div', {}, [el('code', {}, 'registrar'), ' / ', el('code', {}, 'registrar123')]),
        el('div', {}, [el('code', {}, 'security'), ' / ', el('code', {}, 'security123')]),
        el('div', {}, [el('code', {}, 'maintenance'), ' / ', el('code', {}, 'maintenance123')]),
      ]),
    ]),
  ]));
}

function renderShell() {
  clearNode(root);

  const sidebar = el('nav', { class: 'sidebar' }, [
    el('div', { class: 'sidebar-brand' }, [
      el('div', { class: 'brand-text' }, [
        'Smart Learning Center',
        el('small', {}, 'TUP - Group 3'),
      ]),
    ]),
    el('ul', { class: 'nav-list', id: 'nav-list' }, PAGES.map((p) => navItem(p))),
  ]);

  const clockPill = el('span', { class: 'clock-pill', id: 'clock-pill' }, '--:--');
  const connPill = el('span', { class: 'conn-pill', id: 'conn-pill' }, 'Connecting...');
  const presentBtn = el('button', { class: 'btn-icon', id: 'presentation-toggle' }, 'Presentation Mode');
  const logoutBtn = el('button', {
    class: 'btn-icon', onclick: async () => { await api.logout(); location.reload(); },
  }, ['Log out']);

  const topbar = el('div', { class: 'topbar' }, [
    el('div', { class: 'topbar-left' }, [
      el('div', { class: 'topbar-title', id: 'page-title' }, 'Command Center'),
    ]),
    el('div', { class: 'topbar-right' }, [
      clockPill,
      connPill,
      el('span', { class: 'user-pill' }, `${currentUser.name} - ${currentUser.role}`),
      presentBtn,
      logoutBtn,
    ]),
  ]);

  const pageRoot = el('main', { class: 'page', id: 'page-root' });

  root.appendChild(el('div', { class: 'shell' }, [sidebar, topbar, pageRoot]));

  if (localStorage.getItem('slc_presentation') === '1') document.body.classList.add('presentation');
  presentBtn.addEventListener('click', () => {
    document.body.classList.toggle('presentation');
    localStorage.setItem('slc_presentation', document.body.classList.contains('presentation') ? '1' : '0');
  });

  onStoreChange(() => {
    clockPill.textContent = state.telemetry?.sim_time ? `Sim time ${state.telemetry.sim_time}` : 'Sim time --:--';

    connPill.className = 'conn-pill';
    if (state.demoMode) { connPill.classList.add('demo'); connPill.textContent = 'DEMO MODE'; }
    else if (state.connected) { connPill.classList.add('ok'); connPill.textContent = 'Connected'; }
    else if (state.socketUp === false) { connPill.classList.add('bad'); connPill.textContent = 'Offline'; }
    else { connPill.classList.add('warn'); connPill.textContent = 'Reconnecting...'; }
  });

  window.addEventListener('hashchange', route);
  route();
}

function navItem(p) {
  const li = el('li', { class: 'nav-item', 'data-page': p.id }, [
    el('a', { href: `#/${p.id}`, html: `${icon(p.icon)}<span>${p.label}</span>` }),
  ]);
  return li;
}

async function route() {
  const id = (location.hash.replace(/^#\//, '') || 'command-center');
  const page = PAGES.find((p) => p.id === id) || PAGES[0];

  document.querySelectorAll('.nav-item').forEach((li) => {
    li.classList.toggle('active', li.getAttribute('data-page') === page.id);
  });
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = page.label;

  if (currentPageModule && typeof currentPageModule.unmount === 'function') {
    try { currentPageModule.unmount(); } catch { /* noop */ }
  }
  currentPageModule = null;
  currentPageId = page.id;

  const pageRoot = document.getElementById('page-root');
  clearNode(pageRoot);
  pageRoot.appendChild(el('div', { class: 'loading-state' }, 'Loading page...'));

  const mod = await import(page.path);
  if (currentPageId !== page.id) return; // navigated away while loading
  clearNode(pageRoot);
  currentPageModule = mod.default;
  currentPageModule.mount(pageRoot, { user: currentUser });
}

boot();
