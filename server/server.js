// Smart Learning Center - Central Smart Learning System server.
// Express REST API + WebSocket relay bridging the Wokwi-simulated ESP32
// (or the demo-mode generator) to the dashboard. JSON-file persistence,
// no external database. See PROTOCOL.md for the wire format and
// README.md for run instructions.
import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import db from './db.js';
import Bridge from './bridge.js';
import DemoDevice from './demoDevice.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '8080', 10);
const BRIDGE_MODE = (process.env.BRIDGE_MODE || 'rfc2217').toLowerCase();
const RFC2217_HOST = process.env.RFC2217_HOST || '127.0.0.1';
const RFC2217_PORT = parseInt(process.env.RFC2217_PORT || '4000', 10);

// ---------------------------------------------------------------------------
// Device connection (real Wokwi bridge, or the demo generator)
// ---------------------------------------------------------------------------
const device = BRIDGE_MODE === 'demo'
  ? new DemoDevice()
  : new Bridge({ host: RFC2217_HOST, port: RFC2217_PORT });

let deviceConnected = false;
let lastTelemetry = null;
let lastNetStats = null;
const eventLog = []; // recent raw debug lines, capped
const MAX_EVENT_LOG = 300;

function sendCommand(type, payload = {}) {
  const line = 'CMD ' + JSON.stringify({ type, ...payload });
  const ok = device.send(line);
  return ok;
}

// ---------------------------------------------------------------------------
// WebSocket broadcast
// ---------------------------------------------------------------------------
const wsClients = new Set();
function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(data);
  }
}
function broadcastFlow(m, s, v) {
  broadcast({ t: 'flow', m, s, v, ts: new Date().toISOString() });
}
function broadcastStatus() {
  broadcast({
    t: 'conn_status',
    connected: deviceConnected,
    demo_mode: BRIDGE_MODE === 'demo',
    bridge_mode: BRIDGE_MODE,
  });
}

// ---------------------------------------------------------------------------
// Device message handling
// ---------------------------------------------------------------------------
device.on('connected', () => {
  deviceConnected = true;
  broadcastStatus();
  // Push the server's current source-of-truth down to the device.
  sendCommand('sync_users', { users: db.get('rfid_registry') });
  sendCommand('sync_schedule', { entries: db.get('schedule') });
  sendCommand('set_thresholds', db.get('thresholds'));
});

device.on('disconnected', () => {
  deviceConnected = false;
  broadcastStatus();
});

device.on('raw', (line) => {
  eventLog.push({ ts: new Date().toISOString(), line });
  if (eventLog.length > MAX_EVENT_LOG) eventLog.shift();
  broadcast({ t: 'console', line });
});

device.on('message', (msg) => handleDeviceMessage(msg));

function handleDeviceMessage(msg) {
  switch (msg.t) {
    case 'telemetry':
      lastTelemetry = msg;
      break;
    case 'rfid':
      break;
    case 'attendance':
      db.push('attendance', { ...msg, id: crypto.randomUUID() });
      break;
    case 'alert':
      db.push('events', { ...msg, id: crypto.randomUUID(), kind: 'alert' });
      applyEmergencyDoorEffects(msg);
      break;
    case 'log':
      db.push('events', { id: crypto.randomUUID(), kind: 'log', message: msg.msg, ts: new Date().toISOString() });
      break;
    case 'false_alarm':
      db.push('false_alarms', { ...msg, id: crypto.randomUUID() });
      break;
    case 'screening':
      db.push('screenings', { ...msg, id: crypto.randomUUID() });
      break;
    case 'waste': {
      db.update('bins', (b) => b.id === msg.bin_id, (b) => ({ ...b, fill_pct: msg.fill_pct }));
      break;
    }
    case 'net_stats':
      lastNetStats = msg;
      break;
    case 'net_result':
      db.push('events', { id: crypto.randomUUID(), kind: 'net_result', ...msg });
      break;
    case 'flow':
    case 'ack':
    case 'boot':
      break;
    default:
      break;
  }
  broadcast(msg);
}

function applyEmergencyDoorEffects(msg) {
  if (msg.module !== 'G') return;
  const doors = db.get('doors');
  if (msg.phase === 'active') {
    if (!preEmergencyDoorState) {
      preEmergencyDoorState = doors.map((d) => ({ id: d.id, locked: d.locked }));
    }
    db.set('doors', doors.map((d) => ({ ...d, locked: false })));
    broadcast({ t: 'doors_update', doors: db.get('doors') });
  } else if (msg.phase === 'cleared') {
    const restored = doors.map((d) => {
      const prev = preEmergencyDoorState?.find((p) => p.id === d.id);
      return { ...d, locked: prev ? prev.locked : true };
    });
    db.set('doors', restored);
    preEmergencyDoorState = null;
    broadcast({ t: 'doors_update', doors: db.get('doors') });
  }
}
let preEmergencyDoorState = null;

device.start();

// ---------------------------------------------------------------------------
// Virtual node simulation (rooms/bins with no physical hardware)
// ---------------------------------------------------------------------------
function minutesFromHHMM(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

setInterval(() => {
  const simMinutes = lastTelemetry ? minutesFromHHMM(lastTelemetry.sim_time) : 0;

  // Virtual bins slowly fill, except the physical lobby-main bin which is
  // driven entirely by device 'waste' messages.
  const bins = db.get('bins');
  let binsChanged = false;
  for (const b of bins) {
    if (b.live) continue;
    b.fill_pct = Math.min(100, b.fill_pct + Math.random() * 1.2);
    binsChanged = true;
  }
  if (binsChanged) {
    db.set('bins', bins);
    broadcast({ t: 'bins_update', bins });
  }

  // Virtual room occupancy/environment, derived from the shared schedule.
  const rooms = db.get('rooms').filter((r) => !r.has_hardware && r.floor === 2 && r.id.startsWith('SF'));
  const schedule = db.get('schedule');
  const zones = rooms.map((r) => {
    const active = schedule.find((s) => s.room === r.id && simMinutes >= s.start && simMinutes < s.end);
    return {
      room: r.id,
      name: r.name,
      state: active ? 'IN_SESSION' : 'STANDBY',
      subject: active ? active.subject : '',
      temp_c: 22 + Math.random() * 4,
      humidity_pct: 45 + Math.random() * 15,
      live: false,
    };
  });
  broadcast({ t: 'virtual_zones', zones, ts: lastTelemetry?.sim_time || '' });
}, 4000);

// ---------------------------------------------------------------------------
// Sessions (minimal cookie-based auth for the demo login accounts)
// ---------------------------------------------------------------------------
const sessions = new Map(); // token -> { username, role, name, title }

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function currentUser(req) {
  const cookies = parseCookies(req);
  const token = cookies['slc_session'];
  if (!token) return null;
  return sessions.get(token) || null;
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ ok: false, error: 'not authenticated' });
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ ok: false, error: 'not authenticated' });
    if (!roles.includes(user.role)) return res.status(403).json({ ok: false, error: 'insufficient role' });
    req.user = user;
    next();
  };
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/vendor/chartjs', express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist')));

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    connected: deviceConnected,
    demo_mode: BRIDGE_MODE === 'demo',
    bridge_mode: BRIDGE_MODE,
    sim_time: lastTelemetry?.sim_time || null,
    telemetry: lastTelemetry,
    net_stats: lastNetStats,
  });
});

// --- Auth ---
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.get('users').find((u) => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid username or password' });
  const token = crypto.randomUUID();
  const session = { username: user.username, role: user.role, name: user.name, title: user.title };
  sessions.set(token, session);
  res.setHeader('Set-Cookie', `slc_session=${token}; HttpOnly; Path=/; SameSite=Lax`);

  broadcastFlow('I', 'I_ENTER');
  broadcastFlow('I', 'I_AUTH');
  broadcastFlow('I', 'I_VALID', 'YES');
  broadcastFlow('I', 'I_ROLE');
  broadcastFlow('I', 'I_ADMIN_OR_FACULTY', user.role === 'admin' ? 'ADMIN' : 'FACULTY');

  res.json({ ok: true, user: session });
});

app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies['slc_session'];
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'slc_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ ok: false });
  res.json({ ok: true, user });
});

// --- Rooms / floor plans ---
app.get('/api/rooms', (req, res) => res.json({ ok: true, rooms: db.get('rooms') }));

// --- Schedule ---
app.get('/api/schedule', (req, res) => res.json({ ok: true, schedule: db.get('schedule') }));
app.post('/api/schedule', requireRole('admin', 'faculty'), (req, res) => {
  const entries = req.body?.entries;
  if (!Array.isArray(entries)) return res.status(400).json({ ok: false, error: 'entries[] required' });
  db.set('schedule', entries);
  sendCommand('sync_schedule', { entries });
  broadcastFlow('I', 'I_FACULTY_PROCESS');
  res.json({ ok: true, schedule: entries });
});

app.post('/api/class/override', requireRole('admin', 'faculty'), (req, res) => {
  const { action } = req.body || {};
  if (!['start', 'end'].includes(action)) return res.status(400).json({ ok: false, error: 'action must be start|end' });
  sendCommand('class_override', { action });
  res.json({ ok: true });
});

// --- RFID registry & attendance ---
app.get('/api/rfid', (req, res) => res.json({ ok: true, users: db.get('rfid_registry') }));
app.post('/api/rfid', requireRole('admin'), (req, res) => {
  const users = req.body?.users;
  if (!Array.isArray(users)) return res.status(400).json({ ok: false, error: 'users[] required' });
  db.set('rfid_registry', users);
  sendCommand('sync_users', { users });
  broadcastFlow('I', 'I_ADMIN_PROCESS');
  res.json({ ok: true, users });
});

app.post('/api/rfid/tap', (req, res) => {
  const { uid } = req.body || {};
  if (!uid) return res.status(400).json({ ok: false, error: 'uid required' });
  sendCommand('rfid_tap', { uid });
  res.json({ ok: true });
});

app.get('/api/attendance', (req, res) => {
  let rows = db.get('attendance');
  const { room, role, q } = req.query;
  if (room) rows = rows.filter((r) => r.room === room);
  if (role) rows = rows.filter((r) => r.role === role);
  if (q) rows = rows.filter((r) => (r.name || '').toLowerCase().includes(String(q).toLowerCase()));
  res.json({ ok: true, attendance: rows.slice(-500).reverse() });
});

app.get('/api/attendance.csv', (req, res) => {
  const rows = db.get('attendance');
  const header = 'timestamp,uid,name,role,room,source\n';
  const body = rows.map((r) => [r.ts, r.uid, r.name, r.role, r.room, r.source].map((v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance.csv"');
  res.send(header + body);
});

// --- Thresholds ---
app.get('/api/thresholds', (req, res) => res.json({ ok: true, thresholds: db.get('thresholds') }));
app.post('/api/thresholds', requireRole('admin'), (req, res) => {
  const thresholds = { ...db.get('thresholds'), ...(req.body || {}) };
  db.set('thresholds', thresholds);
  sendCommand('set_thresholds', thresholds);
  broadcastFlow('I', 'I_ADMIN_PROCESS');
  res.json({ ok: true, thresholds });
});

// --- Events / alerts / false alarms / screenings ---
app.get('/api/events', (req, res) => res.json({ ok: true, events: db.get('events').slice(-300).reverse() }));
app.get('/api/false-alarms', (req, res) => res.json({ ok: true, false_alarms: db.get('false_alarms').slice(-100).reverse() }));
app.get('/api/screenings', (req, res) => res.json({ ok: true, screenings: db.get('screenings').slice(-100).reverse() }));
app.post('/api/screenings/decision', requireRole('admin', 'security'), (req, res) => {
  sendCommand('screening_decision', { allow: !!req.body?.allow });
  res.json({ ok: true });
});

// --- Doors ---
app.get('/api/doors', (req, res) => res.json({ ok: true, doors: db.get('doors') }));
app.post('/api/doors/:id', requireRole('admin', 'security'), (req, res) => {
  const { locked } = req.body || {};
  const doors = db.get('doors');
  const door = doors.find((d) => d.id === req.params.id);
  if (!door) return res.status(404).json({ ok: false, error: 'door not found' });
  door.locked = !!locked;
  db.set('doors', doors);
  if (door.live) sendCommand('door_override', { door_id: door.id, locked: door.locked });
  else sendCommand('virtual_override', { entity: 'door', id: door.id, locked: door.locked });
  broadcast({ t: 'doors_update', doors });
  res.json({ ok: true, doors });
});

// --- Waste ---
app.get('/api/bins', (req, res) => res.json({ ok: true, bins: db.get('bins') }));
app.post('/api/bins/:id/collect', requireRole('admin', 'maintenance'), (req, res) => {
  const bins = db.get('bins');
  const bin = bins.find((b) => b.id === req.params.id);
  if (!bin) return res.status(404).json({ ok: false, error: 'bin not found' });
  if (bin.live) {
    sendCommand('waste_collect', { admin_override: !!req.body?.admin_override });
  } else {
    bin.fill_pct = 8;
    db.set('bins', bins);
    broadcast({ t: 'bins_update', bins });
  }
  res.json({ ok: true });
});

// --- Emergency ---
app.post('/api/emergency/:action', requireRole('admin', 'security'), (req, res) => {
  const { action } = req.params;
  if (action === 'ack') sendCommand('emergency_ack');
  else if (action === 'test') sendCommand('emergency_test');
  else if (action === 'clear') {
    const smokeLevel = lastTelemetry?.security?.smoke_level ?? 0;
    sendCommand('emergency_clear', { sensors_normal: smokeLevel < 2 });
  } else return res.status(400).json({ ok: false, error: 'unknown action' });
  res.json({ ok: true });
});

// --- Network ---
app.post('/api/network/scenario', requireRole('admin', 'security'), (req, res) => {
  sendCommand('net_scenario', { scenario: req.body?.scenario || 'normal' });
  res.json({ ok: true });
});
app.post('/api/network/lms-request', requireAuth, (req, res) => {
  const port = req.body?.port || 443;
  sendCommand('net_request', { user: req.user.username, role: req.user.role, port });
  res.json({ ok: true });
});
app.get('/api/network/stats', (req, res) => res.json({ ok: true, net_stats: lastNetStats }));

// --- Sim clock ---
app.post('/api/simclock/scale', requireRole('admin'), (req, res) => {
  sendCommand('time_scale', { minutes_per_second: req.body?.minutes_per_second || 1 });
  res.json({ ok: true });
});
app.post('/api/simclock/jump', requireRole('admin'), (req, res) => {
  sendCommand('jump_time', { minutes: req.body?.minutes || 0 });
  res.json({ ok: true });
});

// --- Announcements ---
app.get('/api/announcements', (req, res) => res.json({ ok: true, announcements: db.get('announcements') }));
app.post('/api/announcements', requireRole('admin'), (req, res) => {
  const text = req.body?.text;
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });
  const entry = { id: crypto.randomUUID(), text, ts: new Date().toISOString(), author: req.user.username };
  db.push('announcements', entry);
  sendCommand('display_text', { text });
  res.json({ ok: true, announcement: entry });
});

// --- Diagnostics ---
app.get('/api/console', (req, res) => res.json({ ok: true, lines: eventLog }));
app.post('/api/ping', (req, res) => {
  sendCommand('ping');
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.send(JSON.stringify({
    t: 'hello',
    connected: deviceConnected,
    demo_mode: BRIDGE_MODE === 'demo',
    bridge_mode: BRIDGE_MODE,
    telemetry: lastTelemetry,
  }));
  ws.on('close', () => wsClients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`Smart Learning Center server listening on http://localhost:${PORT}`);
  console.log(`Bridge mode: ${BRIDGE_MODE}${BRIDGE_MODE === 'demo' ? ' (DEMO MODE - no Wokwi connection)' : ` (expecting Wokwi RFC2217 at ${RFC2217_HOST}:${RFC2217_PORT})`}`);
});
