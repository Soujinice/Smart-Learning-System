import { api } from '../api.js';
import { state, on as onStoreChange } from '../store.js';
import { el, card, table, fmtTime, liveBadge, gauge, toast, clearNode } from '../ui.js';

let container = null;
let unsub = null;
let thresholds = null;

let webcamStream = null;
let webcamVideoEl = null;
let webcamError = null;
let webcamOn = false;

const LEVEL_LABELS = ['Normal', 'Watch', 'Warning', 'Danger', 'CONFIRMED EMERGENCY'];
const LEVEL_COLORS = ['var(--green)', 'var(--green)', 'var(--amber)', 'var(--amber)', 'var(--red-primary)'];

function render() {
  if (!container) return;
  clearNode(container);
  const t = state.telemetry;
  const level = t?.security?.smoke_level ?? 0;
  const emergency = t?.emergency || { state: 'IDLE', active: false, pending: false };

  container.appendChild(el('div', { class: 'page-header' }, [el('h1', {}, 'Security & Fire')]));

  if (emergency.pending) container.appendChild(pendingCard(emergency));
  if (emergency.active) container.appendChild(activeCard(emergency));

  const grid2 = el('div', { class: 'grid grid-2' });
  grid2.appendChild(card('Smoke / Fire - GF-06', [
    gauge(t?.security?.smoke_pct ?? 0, LEVEL_LABELS[level], () => LEVEL_COLORS[level]),
    row('Intrusion check', t?.security?.intrusion ? 'SUSPECTED' : 'Normal'),
    row('False alarms', t?.security?.false_alarms ?? 0),
    thresholds ? row('Thresholds L1-L4', `${thresholds.smoke_l1}/${thresholds.smoke_l2}/${thresholds.smoke_l3}/${thresholds.smoke_l4}%`) : null,
  ], { titleRight: liveBadge(true) }));

  grid2.appendChild(buildCctvCard(t));
  container.appendChild(grid2);

  container.appendChild(el('div', { class: 'section-title' }, 'Metal Detector'));
  const metalGrid = el('div', { class: 'grid grid-2' });
  metalGrid.appendChild(card('Status', [
    gauge(state.screenings[0]?.signal_pct ?? 0, `Threshold ${t?.metal_detector?.threshold_pct ?? 55}%`),
    row('Hold', t?.metal_detector?.hold_active ? 'ACTIVE' : 'Idle'),
    row('Total scans', state.screenings.length),
  ], { titleRight: liveBadge(true) }));

  metalGrid.appendChild(card('Screening Decision', t?.metal_detector?.hold_active ? [
    el('div', { class: 'form-inline' }, [
      el('button', { class: 'pill-btn primary', onclick: () => decide(true) }, 'Allow Entry'),
      el('button', { class: 'pill-btn danger', onclick: () => decide(false) }, 'Deny Entry'),
    ]),
  ] : [el('div', { class: 'empty-state' }, 'No hold active.')]));
  container.appendChild(metalGrid);

  const grid3 = el('div', { class: 'grid grid-2', style: 'margin-top:16px;' });
  grid3.appendChild(card('False Alarms', state.falseAlarms.length ? [table(
    [
      { key: 'ts', label: 'Time', render: (r) => fmtTime(r.ts) },
      { key: 'smoke_pct', label: 'Smoke %', render: (r) => `${(r.smoke_pct ?? 0).toFixed(0)}%` },
      { key: 'reason', label: 'Reason' },
    ],
    state.falseAlarms.slice(0, 15),
  )] : [el('div', { class: 'empty-state' }, 'None logged.')]));

  const screeningStats = state.screenings.length ? {
    scans: state.screenings[0]?.scans ?? state.screenings.length,
    allowed: state.screenings[0]?.allowed ?? 0,
    denied: state.screenings[0]?.denied ?? 0,
  } : { scans: 0, allowed: 0, denied: 0 };
  grid3.appendChild(card('Screening Stats', [
    row('Scans', screeningStats.scans),
    row('Allowed', screeningStats.allowed),
    row('Denied', screeningStats.denied),
    el('div', { class: 'section-title', style: 'margin-top:12px;' }, 'Recent'),
    table(
      [
        { key: 'ts', label: 'Time', render: (r) => fmtTime(r.ts) },
        { key: 'result', label: 'Result' },
        { key: 'signal_pct', label: 'Signal', render: (r) => `${(r.signal_pct ?? 0).toFixed(0)}%` },
      ],
      state.screenings.slice(0, 8),
    ),
  ]));
  container.appendChild(grid3);

  // The <video> element must exist in the DOM before we can attach a
  // stream to it; render() just rebuilt the page, so reattach now.
  if (webcamOn) attachWebcamStream();
}

function pendingCard(emergency) {
  return el('div', { class: 'card alert-card alert-pending', style: 'margin-bottom:16px;' }, [
    el('div', { class: 'alert-card-title' }, 'POSSIBLE EMERGENCY - CONFIRMATION NEEDED'),
    el('div', { class: 'sub' }, emergency.reason || 'Sensors reported a sustained fire/smoke condition. Doors remain locked and no alarm has sounded until an admin decides.'),
    el('div', { class: 'form-inline', style: 'margin-top:10px;' }, [
      el('button', { class: 'pill-btn primary', onclick: () => act('confirm') }, 'Confirm Emergency'),
      el('button', { class: 'pill-btn ghost', onclick: () => act('dismiss') }, 'Dismiss (False Alarm)'),
    ]),
  ]);
}

function activeCard(emergency) {
  return el('div', { class: 'card alert-card alert-active', style: 'margin-bottom:16px;' }, [
    el('div', { class: 'alert-card-title' }, 'EMERGENCY ACTIVE - ALL DOORS UNLOCKED'),
    el('div', { class: 'sub' }, `State: ${emergency.state}`),
    el('div', { class: 'form-inline', style: 'margin-top:10px;' }, [
      el('button', { class: 'pill-btn primary', onclick: () => act('clear') }, 'Clear Emergency'),
    ]),
  ]);
}

async function act(action) {
  try {
    await api.emergency(action);
    toast(`Emergency ${action} sent`, 'success');
  } catch (e) { toast(e.message, 'error'); }
}

function buildCctvCard(t) {
  let status;
  if (!webcamOn) {
    status = el('div', { class: 'empty-state' }, 'Camera is off.');
  } else if (webcamError) {
    status = el('div', { class: 'empty-state' }, webcamError);
  } else {
    webcamVideoEl = el('video', { autoplay: 'autoplay', playsinline: 'playsinline', muted: 'muted', style: 'width:100%;border-radius:6px;background:#12181f;display:block;max-height:220px;object-fit:cover;' });
    status = el('div', {}, [webcamVideoEl]);
  }

  const toggleBtn = el('button', {
    class: `pill-btn ${webcamOn ? 'danger' : 'primary'}`,
    onclick: () => toggleWebcam(),
  }, webcamOn ? 'Turn Off Camera' : 'Turn On Camera');

  return card('CCTV - SF-03', [
    status,
    el('div', { class: 'form-inline', style: 'margin-top:10px;' }, [toggleBtn]),
    row('Motion (PIR)', t?.environment?.motion ? 'PRESENT' : 'none'),
  ].filter(Boolean), { titleRight: liveBadge(webcamOn && !webcamError) });
}

function toggleWebcam() {
  if (webcamOn) {
    webcamOn = false;
    stopWebcam();
    render();
  } else {
    webcamOn = true;
    webcamError = null;
    render(); // mounts the <video> element, then attachWebcamStream() runs
  }
}

function attachWebcamStream() {
  if (!webcamVideoEl) return;
  if (webcamStream) {
    webcamVideoEl.srcObject = webcamStream;
    return;
  }
  if (webcamError) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    webcamError = 'This browser does not support camera access (getUserMedia).';
    render();
    return;
  }
  navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then((stream) => {
    webcamStream = stream;
    if (webcamVideoEl) webcamVideoEl.srcObject = stream;
  }).catch(() => {
    webcamError = 'Camera permission denied or unavailable - allow camera access in the browser to show a live feed here.';
    render();
  });
}

function stopWebcam() {
  if (webcamStream) {
    webcamStream.getTracks().forEach((t) => t.stop());
    webcamStream = null;
  }
}

async function decide(allow) {
  try { await api.screeningDecision(allow); toast(allow ? 'Entry allowed' : 'Entry denied', 'success'); } catch (e) { toast(e.message, 'error'); }
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
    webcamError = null;
    Promise.all([api.thresholds(), api.screenings(), api.falseAlarms()]).then(([th, sc, fa]) => {
      thresholds = th.thresholds;
      state.screenings = sc.screenings;
      state.falseAlarms = fa.false_alarms;
      render();
    }).catch(() => render());
    unsub = onStoreChange(render);
    render();
  },
  unmount() {
    if (unsub) unsub();
    stopWebcam();
    webcamVideoEl = null;
    webcamOn = false;
    container = null;
  },
};
