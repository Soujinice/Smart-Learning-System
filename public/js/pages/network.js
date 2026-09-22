import { api } from '../api.js';
import { state, on as onStoreChange } from '../store.js';
import { el, card, table, toast, clearNode } from '../ui.js';

let container = null;
let unsub = null;

function topologySvg() {
  const stats = state.netStats;
  const seg = (name) => stats?.switch_segments?.find((s) => s.name === name);
  const fmtBytes = (n) => n ? `${(n / 1024).toFixed(1)} KB` : '0 KB';

  const segments = ['Smart Classrooms (2F)', 'Computer Laboratories (2F)', 'Library (1F/2F)', 'Server Room'];
  const segX = [2, 8, 14, 20];

  const segNodes = segments.map((name, i) => {
    const s = seg(name);
    return `
      <g transform="translate(${segX[i]},9)">
        <rect x="-2.6" y="0" width="5.2" height="1.6" rx="0.15" fill="#fff" stroke="var(--text-faint)"></rect>
        <text x="0" y="0.65" font-size="0.28" text-anchor="middle" fill="#1F2937">${name}</text>
        <text x="0" y="1.2" font-size="0.24" text-anchor="middle" fill="#6B7280">Tx ${fmtBytes(s?.tx_bytes)} / Rx ${fmtBytes(s?.rx_bytes)}</text>
        <line x1="0" y1="0" x2="0" y2="-2" stroke="var(--text-faint)"></line>
      </g>`;
  }).join('');

  return `<svg viewBox="0 0 24 12" width="100%" style="max-width:960px;">
    <g transform="translate(12,0.9)">
      <rect x="-2" y="-0.7" width="4" height="1.4" rx="0.15" fill="var(--surface-3)" stroke="var(--border-strong)" stroke-width="0.05"></rect>
      <text x="0" y="0.15" font-size="0.3" text-anchor="middle" fill="#fff">Internet</text>
    </g>
    <line x1="12" y1="1.6" x2="12" y2="2.6" stroke="var(--text-faint)"></line>
    <g transform="translate(12,3.3)">
      <rect x="-2.2" y="-0.7" width="4.4" height="1.4" rx="0.15" fill="var(--red-primary)"></rect>
      <text x="0" y="0.15" font-size="0.3" text-anchor="middle" fill="#fff">Firewall</text>
    </g>
    <line x1="12" y1="4" x2="12" y2="5" stroke="var(--text-faint)"></line>
    <g transform="translate(12,5.7)">
      <rect x="-2" y="-0.7" width="4" height="1.4" rx="0.15" fill="var(--blue)"></rect>
      <text x="0" y="0.15" font-size="0.3" text-anchor="middle" fill="#fff">Router</text>
    </g>
    <line x1="12" y1="6.4" x2="12" y2="7.4" stroke="var(--text-faint)"></line>
    <g transform="translate(12,8.1)">
      <rect x="-2.6" y="-0.7" width="5.2" height="1.4" rx="0.15" fill="var(--surface-3)" stroke="var(--border-strong)" stroke-width="0.05"></rect>
      <text x="0" y="0.15" font-size="0.3" text-anchor="middle" fill="#fff">Core Switch</text>
    </g>
    ${segNodes}
  </svg>`;
}

function render() {
  if (!container) return;
  clearNode(container);
  const stats = state.netStats;
  const t = state.telemetry;

  container.appendChild(el('div', { class: 'page-header' }, [el('h1', {}, 'Network')]));

  container.appendChild(card('Topology', [el('div', { html: topologySvg() })]));

  const grid2 = el('div', { class: 'grid grid-2', style: 'margin-top:16px;' });
  grid2.appendChild(card('Wi-Fi Link', [
    row('Status', t?.wifi?.connected ? 'Connected' : 'Offline'),
    row('RSSI', t?.wifi?.connected ? `${t.wifi.rssi} dBm` : '-'),
    row('IP', t?.wifi?.connected ? t.wifi.ip : '-'),
  ]));
  grid2.appendChild(card('Scenarios', [
    el('div', { class: 'form-inline' }, [
      scenarioBtn('normal', 'Normal Load'),
      scenarioBtn('port_scan', 'Port Scan'),
      scenarioBtn('brute_force', 'Brute-Force Login'),
      scenarioBtn('dos_flood', 'DoS Flood'),
      scenarioBtn('blocked_port', 'Blocked-Port Attempt'),
    ]),
  ]));
  container.appendChild(grid2);

  container.appendChild(el('div', { class: 'section-title' }, 'Firewall Rules'));
  container.appendChild(card(null, [table(
    [
      { key: 'id', label: 'Rule' }, { key: 'action', label: 'Action' }, { key: 'proto', label: 'Proto' },
      { key: 'port', label: 'Port' }, { key: 'description', label: 'Description' }, { key: 'hits', label: 'Hits' },
    ],
    stats?.firewall_rules || [],
    { emptyText: 'Awaiting data...' },
  )]));

  container.appendChild(el('div', { class: 'section-title' }, 'Blocked Hosts'));
  container.appendChild(card(null, [table(
    [{ key: 'ip', label: 'IP' }, { key: 'reason', label: 'Reason' }, { key: 'expires_in_s', label: 'Expires (s)' }],
    stats?.blocked_hosts || [],
    { emptyText: 'None currently blocked.' },
  )]));

  const grid3 = el('div', { class: 'grid grid-2', style: 'margin-top:16px;' });
  grid3.appendChild(card('VLANs', [table(
    [
      { key: 'id', label: 'VLAN' }, { key: 'name', label: 'Name' },
      { key: 'dhcp_leased', label: 'DHCP' }, { key: 'nat_translations', label: 'NAT' },
    ],
    stats?.vlans || [],
  )]));
  grid3.appendChild(card('LMS Access', [
    el('div', { class: 'form-inline' }, [
      el('button', { class: 'pill-btn primary', onclick: async () => { await api.lmsRequest(443); toast('Request sent'); } }, 'Request LMS (443)'),
      el('button', { class: 'pill-btn', onclick: async () => { await api.lmsRequest(3389); toast('Request sent'); } }, 'Request Port 3389'),
    ]),
    el('div', { class: 'section-title' }, 'Recent'),
    table(
      [{ key: 'user', label: 'User' }, { key: 'port', label: 'Port' }, { key: 'permit', label: 'Result', render: (r) => r.permit ? 'PERMIT' : 'DENY' }, { key: 'rule_id', label: 'Rule' }, { key: 'vlan', label: 'VLAN' }],
      state.netResults.slice(0, 8),
      { emptyText: 'No requests yet.' },
    ),
  ]));
  container.appendChild(grid3);
}

function scenarioBtn(id, label) {
  return el('button', { class: 'pill-btn', onclick: async () => { await api.networkScenario(id); toast(`Scenario "${label}" triggered`); } }, label);
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
    api.networkStats().then((r) => { state.netStats = r.net_stats; render(); }).catch(() => render());
    unsub = onStoreChange(render);
    render();
  },
  unmount() { if (unsub) unsub(); container = null; },
};
