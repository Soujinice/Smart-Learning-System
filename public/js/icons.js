// Minimal inline SVG icon set (24x24, stroke-based) shared by the sidebar
// and page headers, so the whole dashboard uses one consistent glyph style.
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  floorplan: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M9 9v12M15 3v6"/>',
  rfid: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M13 10h5M13 14h3"/>',
  room: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M8 4v16M3 10h5"/>',
  leaf: '<path d="M4 20c8 0 14-6 16-16-10 2-16 8-16 16Z"/><path d="M9 15c2-3 5-6 9-9"/>',
  flame: '<path d="M12 3c2 3-1 4 1 7 1.5 2-1 3-1 3s3 0 4-3c1 3-1 7-5 7-4 0-6-3-6-6 0-3 2-4 3-6 0 1 0 2 1 2 1-1 1-2 3-4Z"/>',
  detector: '<path d="M4 21V9a8 8 0 0 1 16 0v12"/><path d="M4 21h4M16 21h4"/>',
  emergency: '<path d="M12 2 2 20h20L12 2Z"/><path d="M12 9v5M12 17h.01"/>',
  network: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v4M12 11 6 17M12 11l6 6"/>',
  waste: '<path d="M5 7h14M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  admin: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 5-6 8-6s7 2 8 6"/>',
  flow: '<rect x="4" y="3" width="6" height="4"/><rect x="14" y="17" width="6" height="4"/><path d="M7 7v6a4 4 0 0 0 4 4h3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.2-1.6l2-1.6-2-3.4-2.3.9a7 7 0 0 0-2.8-1.6L13 2h-4l-.7 2.7a7 7 0 0 0-2.8 1.6l-2.3-.9-2 3.4 2 1.6A7 7 0 0 0 3 12c0 .5 0 1.1.2 1.6l-2 1.6 2 3.4 2.3-.9a7 7 0 0 0 2.8 1.6L9 22h4l.7-2.7a7 7 0 0 0 2.8-1.6l2.3.9 2-3.4-2-1.6c.2-.5.2-1.1.2-1.6Z"/>',
  camera: '<rect x="3" y="7" width="13" height="11" rx="2"/><path d="M16 10.5 21 8v9l-5-2.5"/>',
  wifi: '<path d="M2 8.5a16 16 0 0 1 20 0M5 12.5a11 11 0 0 1 14 0M8.5 16.5a6 6 0 0 1 7 0"/><circle cx="12" cy="20" r="1"/>',
  door: '<rect x="5" y="3" width="14" height="18" rx="1"/><circle cx="15" cy="12" r="1"/>',
  bell: '<path d="M6 10a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
};

export function icon(name, cls = '') {
  const body = ICONS[name] || ICONS.dashboard;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="${cls}">${body}</svg>`;
}
