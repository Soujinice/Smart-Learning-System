// Thin fetch wrapper for the Central Smart Learning System REST API.
async function request(method, url, body) {
  const opts = {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { /* not json (e.g. csv) */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body || {}),

  login: (username, password) => request('POST', '/api/login', { username, password }),
  logout: () => request('POST', '/api/logout'),
  me: () => request('GET', '/api/me'),

  status: () => request('GET', '/api/status'),
  rooms: () => request('GET', '/api/rooms'),

  schedule: () => request('GET', '/api/schedule'),
  saveSchedule: (entries) => request('POST', '/api/schedule', { entries }),
  classOverride: (action) => request('POST', '/api/class/override', { action }),

  rfid: () => request('GET', '/api/rfid'),
  saveRfid: (users) => request('POST', '/api/rfid', { users }),
  tap: (uid) => request('POST', '/api/rfid/tap', { uid }),

  attendance: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/api/attendance${qs ? '?' + qs : ''}`);
  },

  thresholds: () => request('GET', '/api/thresholds'),
  saveThresholds: (patch) => request('POST', '/api/thresholds', patch),

  modules: () => request('GET', '/api/modules'),
  toggleModule: (name, enabled) => request('POST', `/api/modules/${name}/toggle`, { enabled }),

  events: () => request('GET', '/api/events'),
  falseAlarms: () => request('GET', '/api/false-alarms'),
  screenings: () => request('GET', '/api/screenings'),
  screeningDecision: (allow) => request('POST', '/api/screenings/decision', { allow }),

  doors: () => request('GET', '/api/doors'),
  setDoor: (id, locked) => request('POST', `/api/doors/${id}`, { locked }),

  bins: () => request('GET', '/api/bins'),
  collectBin: (id, adminOverride) => request('POST', `/api/bins/${id}/collect`, { admin_override: !!adminOverride }),

  emergency: (action) => request('POST', `/api/emergency/${action}`),

  networkScenario: (scenario) => request('POST', '/api/network/scenario', { scenario }),
  lmsRequest: (port) => request('POST', '/api/network/lms-request', { port }),
  networkStats: () => request('GET', '/api/network/stats'),

  simClockScale: (minutesPerSecond) => request('POST', '/api/simclock/scale', { minutes_per_second: minutesPerSecond }),
  simClockJump: (minutes) => request('POST', '/api/simclock/jump', { minutes }),

  announcements: () => request('GET', '/api/announcements'),
  postAnnouncement: (text) => request('POST', '/api/announcements', { text }),

  console: () => request('GET', '/api/console'),
  ping: () => request('POST', '/api/ping'),
};
