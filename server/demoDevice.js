// Smart Learning Center - demo-mode device generator.
// Mimics the ESP32's wire protocol (same 'connected' / 'disconnected' /
// 'message' / 'raw' events and send(line) method as bridge.js) so the rest
// of server.js does not need to know whether it is talking to the real
// Wokwi simulation or this generator. Used when BRIDGE_MODE=demo, so the
// dashboard can be rehearsed without Wokwi running. The UI must show a
// persistent DEMO MODE banner whenever this is active - see server.js.
import { EventEmitter } from 'events';

const ROOM = 'SF-03';

export default class DemoDevice extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.simMinutes = 7 * 60 + 10;
    this.scale = 1;
    this.registry = [];
    this.schedule = [];
    this.timer = null;

    this.state = {
      temp: 24, hum: 55, motion: false,
      smoke: 6, flame: false, smokeLevel: 0,
      wastePct: 15, wasteFull: false,
      metalThreshold: 55, holdActive: false,
      doorsUnlocked: 0, overrideActive: false,
      emergencyState: 'IDLE',
      smartRoomState: 'STANDBY',
      attendanceToday: 0,
      wifiConnected: true, rssi: -58, ip: '10.0.0.42',
    };
  }

  start() {
    this.connected = true;
    setTimeout(() => this.emit('connected'), 50);
    this._emitMsg({ t: 'boot', device: 'DEMO-ESP32', fw: 'demo-1.0.0', modules: 'A,B,C,D,E,F,G,H' });
    this._emitMsg({ t: 'log', msg: 'Demo device generator started (BRIDGE_MODE=demo). No Wokwi simulation is running.' });
    this.timer = setInterval(() => this._tick(), 1000);
  }

  stop() {
    this.connected = false;
    if (this.timer) clearInterval(this.timer);
    this.emit('disconnected');
  }

  isConnected() { return this.connected; }

  send(line) {
    if (!line.startsWith('CMD ')) return false;
    let msg;
    try { msg = JSON.parse(line.slice(4)); } catch { return false; }
    this._handleCommand(msg);
    return true;
  }

  _emitMsg(obj) { this.emit('message', obj); }

  _hhmm() {
    const h = Math.floor(this.simMinutes / 60) % 24;
    const m = this.simMinutes % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  _tick() {
    this.simMinutes = (this.simMinutes + this.scale) % 1440;

    this.state.temp += (Math.random() - 0.5) * 0.3;
    this.state.temp = Math.max(18, Math.min(32, this.state.temp));
    this.state.hum += (Math.random() - 0.5) * 0.6;
    this.state.hum = Math.max(30, Math.min(85, this.state.hum));
    this.state.motion = Math.random() < 0.3;
    this.state.smoke = Math.max(2, Math.min(18, this.state.smoke + (Math.random() - 0.5) * 2));
    if (!this.state.wasteFull) this.state.wastePct = Math.min(100, this.state.wastePct + 0.04);
    this.state.wasteFull = this.state.wastePct >= 80;

    const active = this.schedule.find((s) => this.simMinutes >= s.start && this.simMinutes < s.end);
    if (this.state.emergencyState === 'IDLE') {
      this.state.smartRoomState = active ? 'IN_SESSION' : 'STANDBY';
    }

    this._emitMsg({
      t: 'telemetry',
      sim_time: this._hhmm(),
      sim_scale: this.scale,
      uptime_s: Math.floor(process.uptime()),
      heap_free: 180000,
      environment: { temp_c: this.state.temp, humidity_pct: this.state.hum, motion: this.state.motion, aqi: this.state.smoke * 5 },
      security: { smoke_pct: this.state.smoke, smoke_level: this.state.smokeLevel, flame: this.state.flame, intrusion: false, false_alarms: 0 },
      smart_room: {
        room: ROOM, state: this.state.smartRoomState,
        subject: active ? active.subject : '', section: active ? active.section : '', faculty: active ? active.faculty : '',
        attendance: this.state.attendanceToday, abnormal: false,
      },
      waste: { fill_pct: this.state.wastePct, full: this.state.wasteFull },
      metal_detector: { threshold_pct: this.state.metalThreshold, hold_active: this.state.holdActive },
      doors: { main_entrance_unlocked: this.state.doorsUnlocked > 0, override_active: this.state.overrideActive },
      emergency: { state: this.state.emergencyState, active: this.state.overrideActive },
      wifi: { connected: this.state.wifiConnected, rssi: this.state.rssi, ip: this.state.ip },
      relay_sf03: this.state.smartRoomState !== 'STANDBY',
      attendance_today: this.state.attendanceToday,
    });
  }

  _handleCommand(msg) {
    const { type } = msg;
    switch (type) {
      case 'ping':
        this._ack(type, true, 'pong');
        break;
      case 'sync_users':
        this.registry = msg.users || [];
        this._ack(type, true);
        break;
      case 'sync_schedule':
        this.schedule = (msg.entries || []).filter((e) => e.room === ROOM);
        this._ack(type, true);
        break;
      case 'rfid_tap':
        this._simulateTap(msg.uid, 'web');
        this._ack(type, true);
        break;
      case 'time_scale':
        this.scale = msg.minutes_per_second || 1;
        this._ack(type, true);
        break;
      case 'jump_time':
        this.simMinutes = (msg.minutes || 0) % 1440;
        this._ack(type, true);
        break;
      case 'class_override':
        this.state.smartRoomState = msg.action === 'start' ? 'IN_SESSION' : 'STANDBY';
        this._ack(type, true);
        break;
      case 'screening_decision':
        this.state.holdActive = false;
        this._emitMsg({
          t: 'screening', result: msg.allow ? 'allowed' : 'denied', signal_pct: 70,
          threshold_pct: this.state.metalThreshold, scans: 1, alerts: 1,
          allowed: msg.allow ? 1 : 0, denied: msg.allow ? 0 : 1, ts: this._hhmm(),
        });
        this._ack(type, true);
        break;
      case 'waste_collect':
        this.state.wastePct = 10;
        this.state.wasteFull = false;
        this._emitMsg({ t: 'waste', bin_id: 'lobby-main', room: 'GF-01', fill_pct: 10, state: 'collected', live: true, ts: this._hhmm() });
        this._ack(type, true);
        break;
      case 'emergency_test':
      case 'emergency_ack':
      case 'emergency_clear':
        this._handleEmergency(type);
        this._ack(type, true);
        break;
      case 'net_scenario':
        this._emitMsg({ t: 'log', msg: `Demo: network scenario '${msg.scenario}' simulated.` });
        this._ack(type, true);
        break;
      case 'net_request':
        this._emitMsg({ t: 'net_result', user: msg.user, role: msg.role, port: msg.port, permit: true, rule_id: 'FW-01', vlan: 'VLAN30', ts: this._hhmm() });
        this._ack(type, true);
        break;
      case 'set_thresholds':
        if (msg.metal_threshold_pct) this.state.metalThreshold = msg.metal_threshold_pct;
        this._ack(type, true);
        break;
      case 'door_override':
      case 'virtual_override':
        this._ack(type, true);
        break;
      default:
        this._ack(type, false, 'unrecognized command type (demo mode)');
    }
  }

  _handleEmergency(type) {
    if (type === 'emergency_test') {
      this.state.emergencyState = 'ACTIVE';
      this.state.overrideActive = true;
      this.state.doorsUnlocked = 1;
      this._emitMsg({ t: 'alert', module: 'G', severity: 'critical', phase: 'active', state: 'ACTIVE', reason: 'Emergency drill (dashboard test)', drill: true, ts: this._hhmm() });
    } else if (type === 'emergency_ack') {
      if (this.state.emergencyState === 'ACTIVE') {
        this.state.emergencyState = 'RESPONSE';
        this._emitMsg({ t: 'alert', module: 'G', severity: 'critical', phase: 'acknowledged', state: 'RESPONSE', reason: '', drill: false, ts: this._hhmm() });
      }
    } else if (type === 'emergency_clear') {
      if (this.state.emergencyState === 'RESPONSE') {
        this.state.emergencyState = 'IDLE';
        this.state.overrideActive = false;
        this.state.doorsUnlocked = 0;
        this._emitMsg({ t: 'alert', module: 'G', severity: 'info', phase: 'cleared', state: 'IDLE', reason: '', drill: false, ts: this._hhmm() });
      }
    }
  }

  _simulateTap(uid, source) {
    const user = this.registry.find((u) => u.uid === uid);
    if (!user) {
      this._emitMsg({ t: 'rfid', uid, source, result: 'denied', name: '', role: '', room: '', ts: this._hhmm() });
      return;
    }
    this.state.attendanceToday++;
    this._emitMsg({ t: 'rfid', uid, source, result: 'granted', name: user.name, role: user.role, room: user.room, ts: this._hhmm() });
    this._emitMsg({ t: 'attendance', uid, name: user.name, role: user.role, room: user.room || 'Main Entrance', ts: this._hhmm(), source });
  }

  _ack(cmd, ok, detail = '') {
    this._emitMsg({ t: 'ack', cmd, ok, detail });
  }
}
