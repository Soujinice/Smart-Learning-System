// Shared in-memory client state, kept current by the WebSocket stream.
// Pages read store.state directly and call store.on(...) to react to
// changes without each page re-implementing its own WS plumbing.
//
// Notifications are batched onto animation frames: telemetry/flow/log
// messages can arrive several times a second, and firing a full page
// re-render for each one individually is what makes a page-per-message
// dashboard feel jerky. Coalescing into one notify per frame keeps every
// page's render() cheap and the UI visibly smooth.
import { subscribe, onStatus } from './ws.js';

export const state = {
  connected: false,
  demoMode: false,
  bridgeMode: 'rfc2217',
  telemetry: null,
  events: [],       // alerts + log, newest first, capped
  attendance: [],   // newest first, capped
  rfidTaps: [],
  screenings: [],
  falseAlarms: [],
  netStats: null,
  netResults: [],
  bins: null,
  virtualZones: null,
  consoleLines: [],
};

const listeners = new Set();
let notifyScheduled = false;
function notify() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  requestAnimationFrame(() => {
    notifyScheduled = false;
    for (const fn of listeners) fn(state);
  });
}
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function cap(arr, max = 200) { if (arr.length > max) arr.length = max; }

onStatus((s) => {
  state.connected = s.connected;
  state.demoMode = s.demoMode;
  state.bridgeMode = s.bridgeMode;
  notify();
});

subscribe('telemetry', (msg) => { state.telemetry = msg; notify(); });

subscribe('alert', (msg) => {
  state.events.unshift({ kind: 'alert', ...msg, id: msg.ts + Math.random() });
  cap(state.events, 300);
  notify();
});

subscribe('log', (msg) => {
  state.events.unshift({ kind: 'log', message: msg.msg, ts: new Date().toISOString(), id: Math.random() });
  cap(state.events, 300);
  notify();
});

subscribe('rfid', (msg) => {
  state.rfidTaps.unshift({ ...msg, id: msg.ts + Math.random() });
  cap(state.rfidTaps, 100);
  notify();
});

subscribe('attendance', (msg) => {
  state.attendance.unshift({ ...msg, id: msg.ts + Math.random() });
  cap(state.attendance, 200);
  notify();
});

subscribe('screening', (msg) => {
  state.screenings.unshift({ ...msg, id: msg.ts + Math.random() });
  cap(state.screenings, 100);
  notify();
});

subscribe('false_alarm', (msg) => {
  state.falseAlarms.unshift({ ...msg, id: msg.ts + Math.random() });
  cap(state.falseAlarms, 100);
  notify();
});

subscribe('net_stats', (msg) => { state.netStats = msg; notify(); });
subscribe('net_result', (msg) => { state.netResults.unshift(msg); cap(state.netResults, 50); notify(); });

subscribe('bins_update', (msg) => { state.bins = msg.bins; notify(); });
subscribe('virtual_zones', (msg) => { state.virtualZones = msg.zones; notify(); });

subscribe('console', (msg) => {
  state.consoleLines.push(msg.line);
  cap(state.consoleLines, 400);
  notify();
});
