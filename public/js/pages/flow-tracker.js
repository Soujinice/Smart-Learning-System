import { state, on as onStoreChange } from '../store.js';
import { el, clearNode } from '../ui.js';
import { MODULES, FLOWCHARTS } from '../data/flowcharts.js';

let container = null;
let unsub = null;
let activeModule = 'MAIN';

const COL_W = 250, ROW_H = 84, BOX_W = 216, BOX_H = 58;

function nodeCenter(node) {
  return { x: 30 + node.col * COL_W + BOX_W / 2, y: 30 + node.row * ROW_H + BOX_H / 2 };
}

function shapeMarkup(node, x, y, fillColor, strokeColor) {
  const w = BOX_W, h = BOX_H;
  if (node.type === 'decision') {
    const cx = x + w / 2, cy = y + h / 2;
    return `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="1.5"></polygon>`;
  }
  if (node.type === 'io') {
    const skew = 16;
    return `<polygon points="${x + skew},${y} ${x + w},${y} ${x + w - skew},${y + h} ${x},${y + h}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="1.5"></polygon>`;
  }
  if (node.type === 'start' || node.type === 'end') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" ry="${h / 2}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="1.5"></rect>`;
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fillColor}" stroke="${strokeColor}" stroke-width="1.5"></rect>`;
}

function buildSvg(chart, activeNodeId, activeBranch) {
  const maxCol = Math.max(...chart.nodes.map((n) => n.col));
  const maxRow = Math.max(...chart.nodes.map((n) => n.row));
  const width = 60 + (maxCol + 1) * COL_W;
  const height = 60 + (maxRow + 1) * ROW_H;

  const byId = Object.fromEntries(chart.nodes.map((n) => [n.id, n]));

  const edgesSvg = chart.edges.map((edge) => {
    const from = byId[edge.from], to = byId[edge.to];
    if (!from || !to) return '';
    const a = nodeCenter(from), b = nodeCenter(to);
    const isActive = activeNodeId === edge.from && (!edge.label || edge.label === activeBranch);
    const stroke = isActive ? 'var(--red-primary)' : 'var(--gray-300)';
    const widthPx = isActive ? 2.5 : 1.5;
    let path;
    if (edge.loop) {
      const midX = Math.max(a.x, b.x) + 90;
      path = `M ${a.x + BOX_W / 2} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x + BOX_W / 2} ${b.y}`;
    } else if (from.row === to.row) {
      path = `M ${a.x + BOX_W / 2} ${a.y} L ${b.x - BOX_W / 2} ${b.y}`;
    } else if (from.col === to.col) {
      path = `M ${a.x} ${a.y + BOX_H / 2} L ${b.x} ${b.y - BOX_H / 2}`;
    } else {
      path = `M ${a.x} ${a.y + BOX_H / 2} L ${a.x} ${(a.y + b.y) / 2} L ${b.x} ${(a.y + b.y) / 2} L ${b.x} ${b.y - BOX_H / 2}`;
    }
    const labelX = (a.x + b.x) / 2, labelY = (a.y + b.y) / 2 - 4;
    const label = edge.label ? `<text x="${labelX}" y="${labelY}" class="flow-edge-label" text-anchor="middle">${edge.label}</text>` : '';
    return `<path class="flow-edge" d="${path}" stroke="${stroke}" stroke-width="${widthPx}" marker-end="url(#arrow)"></path>${label}`;
  }).join('');

  const nodesSvg = chart.nodes.map((node) => {
    const x = 30 + node.col * COL_W, y = 30 + node.row * ROW_H;
    const isActive = node.id === activeNodeId;
    const fill = isActive ? 'var(--red-primary)' : '#fff';
    const stroke = isActive ? 'var(--red-dark)' : 'var(--gray-300)';
    const textColor = isActive ? '#fff' : '#1F2937';
    const shape = shapeMarkup(node, x, y, fill, stroke);
    return `<g>${shape}
      <foreignObject x="${x + 8}" y="${y + 4}" width="${BOX_W - 16}" height="${BOX_H - 8}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-size:10.5px;line-height:1.2;color:${textColor};display:flex;align-items:center;justify-content:center;text-align:center;width:100%;height:100%;font-weight:${isActive ? 700 : 500};">${escapeHtml(node.text)}</div>
      </foreignObject>
    </g>`;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <path d="M0,0 L6,3 L0,6 Z" fill="var(--gray-300)"></path>
      </marker>
    </defs>
    ${edgesSvg}
    ${nodesSvg}
  </svg>`;
}

function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function render() {
  if (!container) return;
  clearNode(container);

  container.appendChild(el('div', { class: 'page-header' }, [
    el('div', {}, [
      el('h1', {}, 'Flow Tracker'),
      el('p', {}, 'MAIN and A-I rendered from the same node/edge data the firmware and server emit "flow" events for. The active node highlights in real time.'),
    ]),
  ]));

  container.appendChild(el('div', { class: 'tabs' }, MODULES.map((m) => el('button', {
    class: `tab-btn ${m.id === activeModule ? 'active' : ''}`,
    onclick: () => { activeModule = m.id; render(); },
  }, m.label))));

  const flowState = state.flowByModule[activeModule];
  const chart = FLOWCHARTS[activeModule];

  container.appendChild(el('div', { style: 'margin-bottom:10px;font-size:12.5px;color:var(--text-muted);' },
    flowState ? `Current node: ${flowState.nodeId}${flowState.branch ? ` (branch: ${flowState.branch})` : ''}` : 'No flow events received yet for this module.'));

  container.appendChild(el('div', { class: 'flow-svg-wrap' }, [
    el('div', { html: buildSvg(chart, flowState?.nodeId, flowState?.branch), style: 'padding:12px;' }),
  ]));
}

export default {
  mount(rootEl) {
    container = rootEl;
    unsub = onStoreChange(render);
    render();
  },
  unmount() { if (unsub) unsub(); container = null; },
};
