// WebSocket client: connects to the Central Smart Learning System server,
// auto-reconnects with backoff, and fans out messages to subscribers by
// their "t" type (see PROTOCOL.md). Also tracks device connection status.
const listeners = new Map(); // type -> Set<fn>
const anyListeners = new Set();
const statusListeners = new Set();

let socket = null;
let backoff = 1000;
let status = { connected: false, demoMode: false, bridgeMode: 'rfc2217' };

function emit(type, msg) {
  const set = listeners.get(type);
  if (set) for (const fn of set) fn(msg);
  for (const fn of anyListeners) fn(msg);
}

function setStatus(patch) {
  status = { ...status, ...patch };
  for (const fn of statusListeners) fn(status);
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);

  socket.addEventListener('open', () => {
    backoff = 1000;
  });

  socket.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.t === 'hello') {
      setStatus({ connected: !!msg.connected, demoMode: !!msg.demo_mode, bridgeMode: msg.bridge_mode || 'rfc2217', socketUp: true });
      if (msg.telemetry) emit('telemetry', msg.telemetry);
      return;
    }
    if (msg.t === 'conn_status') {
      setStatus({ connected: !!msg.connected, demoMode: !!msg.demo_mode, bridgeMode: msg.bridge_mode || 'rfc2217' });
      return;
    }
    emit(msg.t, msg);
  });

  socket.addEventListener('close', () => {
    setStatus({ socketUp: false, connected: false });
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 15000);
  });

  socket.addEventListener('error', () => {
    try { socket.close(); } catch { /* noop */ }
  });
}

export function subscribe(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type)?.delete(fn);
}

export function subscribeAny(fn) {
  anyListeners.add(fn);
  return () => anyListeners.delete(fn);
}

export function onStatus(fn) {
  statusListeners.add(fn);
  fn(status);
  return () => statusListeners.delete(fn);
}

export function getStatus() { return status; }

connect();
