// Shared in-memory client state, kept current by the WebSocket stream.
// Pages read store.state directly and call store.on(...) to react to
// changes without each page re-implementing its own WS plumbing.
import { subscribe, subscribeAny, onStatus } from './ws.js';

export const state = {
  connected: false,
  demoMode: false,
  bridgeMode: 'rfc2217',
  telemetry: null,
  emergencyActive: false,
  emergencyState: 'IDLE',
  events: [],       // alerts + log, newest first, capped
  attendance: [],   // newest first, capped
  rfidTaps: [],
  screenings: [],
  falseAlarms: [],
  netStats: null,
  netResults: [],
  doors: null,
  bins: null,
  flowByModule: {},  // module id -> { nodeId, branch, ts }
  consoleLines: [],
};

const listeners = new Set();
function notify() { for (const fn of listeners) fn(state); }
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function cap(arr, max = 200) { if (arr.length > max) arr.length = max; }

onStatus((s) => {
  state.connected = s.connected;
  state.demoMode = s.demoMode;
  state.bridgeMode = s.bridgeMode;
  notify();
});

subscribe('telemetry', (msg) => {
  state.telemetry = msg;
  state.emergencyActive = !!msg.emergency?.active;
  state.emergencyState = msg.emergency?.state || 'IDLE';
  notify();
});

subscribe('alert', (msg) => {
  state.events.unshift({ kind: 'alert', ...msg, id: msg.ts + Math.random() });
  cap(state.events, 300);
  if (msg.module === 'G') {
    state.emergencyActive = msg.phase === 'active' || msg.phase === 'acknowledged' || msg.phase === 'continue';
    state.emergencyState = msg.state || state.emergencyState;
  }
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

subscribe('doors_update', (msg) => { state.doors = msg.doors; notify(); });
subscribe('bins_update', (msg) => { state.bins = msg.bins; notify(); });
subscribe('virtual_zones', (msg) => { state.virtualZones = msg.zones; notify(); });

subscribe('flow', (msg) => {
  state.flowByModule[msg.m] = { nodeId: msg.s, branch: msg.v || null, ts: Date.now() };
  notify();
});

subscribe('console', (msg) => {
  state.consoleLines.push(msg.line);
  cap(state.consoleLines, 400);
  notify();
});

subscribeAny(() => {}); // keeps the WS module's any-listener path exercised
