import { api } from '../api.js';
import { state, on as onStoreChange } from '../store.js';
import { el, clearNode, liveBadge } from '../ui.js';
import { GROUND_LAYOUT, SECOND_LAYOUT } from '../data/floorplan.js';
import { icon } from '../icons.js';

let container = null;
let unsub = null;
let rooms = [];
let activeFloor = 1;
let selectedRoomId = null;

const ICON_COLOR = {
  cctv: '#1E7A46',
  wifi: '#6B7280',
  env_sensor: '#6d28d9',
  rfid: '#9B1C2E',
  fire_panel: '#9B1C2E',
  display: '#1D5A9B',
};
const ICON_LABEL = {
  cctv: 'CCTV Camera', wifi: 'Wi-Fi Access Point', env_sensor: 'Environmental Sensor',
  rfid: 'RFID Access Control', fire_panel: 'Fire Alarm Control Panel', display: 'Digital Information Display',
};

function roomFill(room) {
  const t = state.telemetry;
  if (room.id === 'SF-03' && t?.smart_room) {
    if (t.smart_room.abnormal) return 'var(--amber-bg)';
    if (t.smart_room.state === 'IN_SESSION') return 'var(--blue-bg)';
  }
  if (room.id === 'GF-06' && t?.security) {
    if ((t.security.smoke_level ?? 0) >= 2) return 'var(--red-bg)';
    if ((t.security.smoke_level ?? 0) >= 1) return 'var(--amber-bg)';
  }
  if (room.id === 'GF-01' && t?.waste?.full) return 'var(--amber-bg)';
  const zone = state.virtualZones?.find((z) => z.room === room.id);
  if (zone?.state === 'IN_SESSION') return 'var(--blue-bg)';
  return 'var(--white)';
}

function roomStroke(room) {
  if (state.emergencyActive) return 'var(--red-primary)';
  return 'var(--gray-300)';
}

function buildSvg(layout) {
  const rects = layout.rooms.map((r) => {
    const meta = rooms.find((m) => m.id === r.id);
    const label = meta ? meta.name : r.id;
    const fill = meta ? roomFill(meta) : 'var(--white)';
    const stroke = meta ? roomStroke(meta) : 'var(--gray-300)';
    return `
      <g data-room="${r.id}" style="cursor:pointer;">
        <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${fill}" stroke="${stroke}" stroke-width="0.06" rx="0.08"></rect>
        <text x="${r.x + r.w / 2}" y="${r.y + r.h / 2}" font-size="0.32" text-anchor="middle" fill="#1F2937" style="pointer-events:none;">${wrapLabel(label, r.w)}</text>
        <text x="${r.x + 0.15}" y="${r.y + 0.4}" font-size="0.24" fill="#6B7280" style="pointer-events:none;">${r.id}</text>
      </g>`;
  }).join('');

  const corridors = layout.corridors.map((c) => `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="var(--surface-alt)" stroke="var(--gray-100)" stroke-width="0.04"></rect>`).join('');

  const labels = (layout.labels || []).map((l) => `
    <g>
      <rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" fill="none" stroke="var(--gray-300)" stroke-dasharray="0.1,0.1" stroke-width="0.04"></rect>
      <text x="${l.x + l.w / 2}" y="${l.y + l.h / 2}" font-size="0.26" text-anchor="middle" fill="#6B7280">${l.text}</text>
    </g>`).join('');

  const icons = layout.icons.map((ic) => `
    <g transform="translate(${ic.x},${ic.y})">
      <circle r="0.32" fill="${ICON_COLOR[ic.type]}"></circle>
      <text x="0" y="0.1" font-size="0.28" text-anchor="middle" fill="#fff" font-weight="700">${iconGlyph(ic.type)}</text>
    </g>`).join('');

  const emergencyOverlay = state.emergencyActive ? `
    <g class="emergency-overlay">
      <rect x="0" y="0" width="24" height="14" fill="var(--red-primary)" opacity="0.12"></rect>
      <text x="12" y="7" font-size="1" text-anchor="middle" fill="var(--red-primary)" font-weight="700" opacity="0.55">EMERGENCY - ALL DOORS UNLOCKED</text>
    </g>` : '';

  return `<svg viewBox="${layout.viewBox}" width="100%" style="max-width:960px;font-family:inherit;">
    <rect x="0" y="0" width="24" height="14" fill="var(--surface-alt)" stroke="var(--border)" stroke-width="0.05"></rect>
    ${corridors}
    ${rects}
    ${labels}
    ${icons}
    ${emergencyOverlay}
  </svg>`;
}

function wrapLabel(text, w) {
  // very small floor plan cells - shorten long names so they stay legible
  if (text.length * 0.19 <= w || text.length <= 10) return escapeXml(text);
  return escapeXml(text.slice(0, Math.max(6, Math.floor(w / 0.19))) + '...');
}
function escapeXml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function iconGlyph(type) {
  return { cctv: 'C', wifi: 'W', env_sensor: 'E', rfid: 'R', fire_panel: 'F', display: 'D' }[type] || '?';
}

function render() {
  if (!container) return;
  clearNode(container);

  container.appendChild(el('div', { class: 'page-header' }, [
    el('div', {}, [
      el('h1', {}, 'Floor Plans'),
      el('p', {}, 'Schematic plans (not the AutoCAD file) - scale 1 in = 4 ft, model 24in x 14in per floor, actual floor area 5,376 sq ft.'),
    ]),
  ]));

  const tabs = el('div', { class: 'tabs' }, [
    el('button', { class: `tab-btn ${activeFloor === 1 ? 'active' : ''}`, onclick: () => { activeFloor = 1; render(); } }, 'Ground Floor'),
    el('button', { class: `tab-btn ${activeFloor === 2 ? 'active' : ''}`, onclick: () => { activeFloor = 2; render(); } }, 'Second Floor'),
  ]);
  container.appendChild(tabs);

  const layout = activeFloor === 1 ? GROUND_LAYOUT : SECOND_LAYOUT;

  const planCard = el('div', { class: 'card' }, [
    el('div', { class: 'card-title' }, layout.title),
    el('div', { html: buildSvg(layout) }),
  ]);
  planCard.addEventListener('click', (ev) => {
    const g = ev.target.closest('[data-room]');
    if (!g) return;
    selectedRoomId = g.getAttribute('data-room');
    openDrawer(selectedRoomId);
  });
  container.appendChild(planCard);

  container.appendChild(el('div', { class: 'card', style: 'margin-top:16px;' }, [
    el('div', { class: 'card-title' }, 'Legend'),
    el('div', { class: 'legend' }, Object.entries(ICON_LABEL).map(([type, label]) => el('div', { class: 'item' }, [
      el('span', { style: `width:12px;height:12px;border-radius:50%;display:inline-block;background:${ICON_COLOR[type]};` }),
      label,
    ]))),
  ]));

  container.appendChild(el('div', { id: 'room-drawer-mount' }));
  if (selectedRoomId) openDrawer(selectedRoomId);
}

function openDrawer(roomId) {
  const meta = rooms.find((r) => r.id === roomId);
  if (!meta) return;
  document.querySelectorAll('.drawer-backdrop, .drawer').forEach((n) => n.remove());

  const t = state.telemetry;
  const readings = [];
  if (roomId === 'SF-03') {
    readings.push(['Temperature', `${(t?.environment?.temp_c ?? 0).toFixed(1)} C`]);
    readings.push(['Humidity', `${(t?.environment?.humidity_pct ?? 0).toFixed(0)} %`]);
    readings.push(['Motion', t?.environment?.motion ? 'Present' : 'None']);
    readings.push(['Room state', t?.smart_room?.state ?? '-']);
  } else if (roomId === 'GF-06') {
    readings.push(['Smoke level', `L${t?.security?.smoke_level ?? 0}`]);
    readings.push(['Smoke %', `${(t?.security?.smoke_pct ?? 0).toFixed(0)}%`]);
    readings.push(['Flame', t?.security?.flame ? 'DETECTED' : 'Clear']);
  } else if (roomId === 'GF-01') {
    readings.push(['Bin fill', `${(t?.waste?.fill_pct ?? 0).toFixed(0)}%`]);
    readings.push(['Status', t?.waste?.full ? 'FULL' : 'Normal']);
  } else if (roomId === 'GF-ENTRANCE') {
    readings.push(['Door', t?.doors?.main_entrance_unlocked ? 'UNLOCKED' : 'Locked']);
    readings.push(['Metal detector hold', t?.metal_detector?.hold_active ? 'ACTIVE' : 'Idle']);
  } else {
    const zone = state.virtualZones?.find((z) => z.room === roomId);
    if (zone) {
      readings.push(['Simulated temp', `${zone.temp_c.toFixed(1)} C`]);
      readings.push(['Simulated humidity', `${zone.humidity_pct.toFixed(0)} %`]);
      readings.push(['Room state', zone.state]);
    }
  }

  const backdrop = el('div', { class: 'drawer-backdrop show', onclick: () => { backdrop.remove(); drawer.remove(); selectedRoomId = null; } });
  const drawer = el('div', { class: 'drawer show' }, [
    el('button', { class: 'drawer-close', onclick: () => { backdrop.remove(); drawer.remove(); selectedRoomId = null; } }, '×'),
    el('h2', { style: 'font-size:15px;margin:0 0 2px;' }, meta.name),
    el('div', { style: 'color:var(--text-muted);font-size:12px;margin-bottom:12px;' }, meta.id),
    liveBadge(meta.has_hardware),
    el('div', { class: 'section-title' }, 'Dimensions'),
    kv('Model size', `${meta.model_w} in x ${meta.model_h} in`),
    kv('Model area', `${meta.model_area} in²`),
    kv('Actual area', `${meta.actual_area.toLocaleString()} ft²`),
    el('div', { class: 'section-title' }, 'Devices'),
    meta.devices.length ? el('ul', { style: 'margin:0;padding-left:18px;font-size:12.5px;' }, meta.devices.map((d) => el('li', {}, d))) : el('div', { class: 'sub' }, 'No dedicated devices listed.'),
    readings.length ? el('div', { class: 'section-title' }, 'Latest Readings') : null,
    ...readings.map(([k, v]) => kv(k, v)),
  ]);
  document.body.appendChild(backdrop);
  document.body.appendChild(drawer);
}

function kv(k, v) {
  return el('div', { style: 'display:flex;justify-content:space-between;padding:4px 0;font-size:12.5px;border-bottom:1px solid var(--border);' }, [
    el('span', { style: 'color:var(--text-muted);' }, k),
    el('span', { style: 'font-weight:600;' }, String(v)),
  ]);
}

export default {
  mount(rootEl) {
    container = rootEl;
    api.rooms().then((r) => { rooms = r.rooms; render(); }).catch(() => { rooms = []; render(); });
    unsub = onStoreChange(render);
    render();
  },
  unmount() {
    if (unsub) unsub();
    document.querySelectorAll('.drawer-backdrop, .drawer').forEach((n) => n.remove());
    container = null;
  },
};
