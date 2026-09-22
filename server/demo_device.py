"""Smart Learning Center - demo-mode device generator.

Mimics the ESP32's wire protocol (same 'connected' / 'disconnected' /
'message' / 'raw' events and async send(line) method as bridge.py) so the
rest of main.py does not need to know whether it is talking to the real
Wokwi simulation or this generator. Used when BRIDGE_MODE=demo, so the
dashboard can be rehearsed without Wokwi running. The UI must show a
persistent DEMO MODE banner whenever this is active - see main.py.
"""
import asyncio
import json
import random
import time

from emitter import AsyncEmitter

ROOM = "SF-03"


class DemoDevice(AsyncEmitter):
    def __init__(self):
        super().__init__()
        self.connected = False
        self.sim_minutes = 7 * 60 + 10
        self.scale = 1
        self.registry = []
        self.schedule = []
        self._task = None
        self._start_time = time.monotonic()

        self.state = {
            "temp": 24.0, "hum": 55.0, "motion": False,
            "smoke": 6.0, "smoke_level": 0,
            "waste_pct": 15.0, "waste_full": False,
            "metal_threshold": 55.0, "hold_active": False,
            "doors_unlocked": 0, "override_active": False,
            "emergency_state": "IDLE",
            "smart_room_state": "STANDBY",
            "attendance_today": 0,
            "wifi_connected": True, "rssi": -58, "ip": "10.0.0.42",
        }

        self.modules = {
            "rfid": True, "smart_room": True, "environment": True, "security": True,
            "metal_detector": True, "waste": True, "network": True,
        }

    def start(self):
        self.connected = True
        self._task = asyncio.create_task(self._run())

    def stop(self):
        self.connected = False
        if self._task:
            self._task.cancel()

    def is_connected(self) -> bool:
        return self.connected

    async def send(self, line: str) -> bool:
        if not line.startswith("CMD "):
            return False
        try:
            msg = json.loads(line[4:])
        except json.JSONDecodeError:
            return False
        await self._handle_command(msg)
        return True

    async def _run(self):
        await asyncio.sleep(0.05)
        await self.emit("connected")
        await self._emit_msg({"t": "boot", "device": "DEMO-ESP32", "fw": "demo-1.0.0", "modules": "A,B,C,D,E,F,G,H"})
        await self._emit_msg({"t": "log", "msg": "Demo device generator started (BRIDGE_MODE=demo). No Wokwi simulation is running."})
        while True:
            await asyncio.sleep(1)
            await self._tick()

    async def _emit_msg(self, obj):
        await self.emit("message", obj)

    async def _flow(self, m, s, v=None):
        msg = {"t": "flow", "m": m, "s": s}
        if v:
            msg["v"] = v
        await self._emit_msg(msg)

    def _hhmm(self) -> str:
        h = (self.sim_minutes // 60) % 24
        m = self.sim_minutes % 60
        return f"{h:02d}:{m:02d}"

    async def _tick(self):
        self.sim_minutes = (self.sim_minutes + self.scale) % 1440
        m = self.modules
        s = self.state

        if m["environment"]:
            s["temp"] = max(18.0, min(32.0, s["temp"] + (random.random() - 0.5) * 0.3))
            s["hum"] = max(30.0, min(85.0, s["hum"] + (random.random() - 0.5) * 0.6))
            s["motion"] = random.random() < 0.3
        if m["security"]:
            s["smoke"] = max(2.0, min(18.0, s["smoke"] + (random.random() - 0.5) * 2))
        if m["waste"] and not s["waste_full"]:
            s["waste_pct"] = min(100.0, s["waste_pct"] + 0.04)
            s["waste_full"] = s["waste_pct"] >= 80

        active = None
        if m["smart_room"]:
            active = next((e for e in self.schedule if self.sim_minutes >= e["start"] and self.sim_minutes < e["end"]), None)
            if s["emergency_state"] == "IDLE":
                s["smart_room_state"] = "IN_SESSION" if active else "STANDBY"

        # Keep dashboards showing live flow activity, same as the firmware -
        # but only for modules that are actually enabled.
        if m["environment"]:
            for node in ("C_SENSOR", "C_READ", "C_PROCESS"):
                await self._flow("C", node)
            await self._flow("C", "C_NORMAL", "YES")
            await self._flow("C", "C_DISPLAY_STATUS")
        if m["security"] and s["emergency_state"] == "IDLE":
            for node in ("D_DETECT", "D_READ_LEVEL", "D_COMPARE"):
                await self._flow("D", node)
            await self._flow("D", "D_ABOVE_WARN", "NO")
        if m["smart_room"] and s["smart_room_state"] == "IN_SESSION":
            for node in ("B_SENSOR_DATA", "B_PROCESS_SENSOR"):
                await self._flow("B", node)
            await self._flow("B", "B_COND_NORMAL", "YES")
            await self._flow("B", "B_DISPLAY_NORMAL")

        await self._emit_msg({
            "t": "telemetry",
            "sim_time": self._hhmm(),
            "sim_scale": self.scale,
            "uptime_s": int(time.monotonic() - self._start_time),
            "heap_free": 180000,
            "environment": {"temp_c": s["temp"], "humidity_pct": s["hum"], "motion": s["motion"], "aqi": s["smoke"] * 5},
            "security": {"smoke_pct": s["smoke"], "smoke_level": s["smoke_level"], "intrusion": False, "false_alarms": 0},
            "smart_room": {
                "room": ROOM, "state": s["smart_room_state"],
                "subject": active["subject"] if active else "", "section": active["section"] if active else "",
                "faculty": active["faculty"] if active else "",
                "attendance": s["attendance_today"], "abnormal": False,
            },
            "waste": {"fill_pct": s["waste_pct"], "full": s["waste_full"]},
            "metal_detector": {"threshold_pct": s["metal_threshold"], "hold_active": s["hold_active"]},
            "doors": {"main_entrance_unlocked": s["doors_unlocked"] > 0, "override_active": s["override_active"]},
            "emergency": {
                "state": s["emergency_state"],
                "active": s["emergency_state"] == "ACTIVE",
                "pending": s["emergency_state"] == "PENDING",
            },
            "wifi": {"connected": s["wifi_connected"], "rssi": s["rssi"], "ip": s["ip"]},
            "relay_sf03": s["smart_room_state"] != "STANDBY",
            "attendance_today": s["attendance_today"],
            "modules": self.modules,
        })

    async def _handle_command(self, msg):
        type_ = msg.get("type")
        s = self.state

        if type_ == "ping":
            await self._ack(type_, True, "pong")
        elif type_ == "sync_users":
            self.registry = msg.get("users") or []
            await self._ack(type_, True)
        elif type_ == "sync_schedule":
            self.schedule = [e for e in (msg.get("entries") or []) if e.get("room") == ROOM]
            await self._ack(type_, True)
        elif type_ == "rfid_tap":
            await self._simulate_tap(msg.get("uid", ""), "web")
            await self._ack(type_, True)
        elif type_ == "time_scale":
            self.scale = msg.get("minutes_per_second") or 1
            await self._ack(type_, True)
        elif type_ == "jump_time":
            self.sim_minutes = (msg.get("minutes") or 0) % 1440
            await self._ack(type_, True)
        elif type_ == "class_override":
            if msg.get("action") == "start":
                s["smart_room_state"] = "IN_SESSION"
                for node in ("B_ACTIVATE", "B_DISPLAY_STATUS", "B_IN_SESSION"):
                    await self._flow("B", node)
            else:
                s["smart_room_state"] = "STANDBY"
                for node in ("B_SAVE_DATA", "B_SEND_CENTRAL", "B_STANDBY_OFF", "B_STANDBY_STATUS", "B_END"):
                    await self._flow("B", node)
            await self._ack(type_, True)
        elif type_ == "screening_decision":
            allow = bool(msg.get("allow"))
            s["hold_active"] = False
            await self._flow("F", "F_ALLOWED", "YES" if allow else "NO")
            await self._flow("F", "F_ALLOW" if allow else "F_DENY")
            if allow:
                await self._flow("F", "F_END")
            await self._emit_msg({
                "t": "screening", "result": "allowed" if allow else "denied", "signal_pct": 70,
                "threshold_pct": s["metal_threshold"], "scans": 1, "alerts": 1,
                "allowed": 1 if allow else 0, "denied": 0 if allow else 1, "ts": self._hhmm(),
            })
            await self._ack(type_, True)
        elif type_ == "waste_collect":
            s["waste_pct"] = 10.0
            s["waste_full"] = False
            for node in ("H_COLLECTION", "H_RESET", "H_END"):
                await self._flow("H", node)
            await self._emit_msg({"t": "waste", "bin_id": "lobby-main", "room": "GF-01", "fill_pct": 10, "state": "collected", "live": True, "ts": self._hhmm()})
            await self._ack(type_, True)
        elif type_ in ("emergency_test", "emergency_confirm", "emergency_dismiss", "emergency_clear"):
            await self._handle_emergency(type_)
            await self._ack(type_, True)
        elif type_ == "net_scenario":
            await self._emit_msg({"t": "log", "msg": f"Demo: network scenario '{msg.get('scenario')}' simulated."})
            await self._ack(type_, True)
        elif type_ == "net_request":
            for node in ("E_REQUEST", "E_AUTH"):
                await self._flow("E", node)
            await self._flow("E", "E_AUTHORIZED", "YES")
            for node in ("E_CONNECT", "E_ACCESS_LMS", "E_EXCHANGE", "E_DISPLAY_INFO", "E_END"):
                await self._flow("E", node)
            await self._emit_msg({"t": "net_result", "user": msg.get("user"), "role": msg.get("role"), "port": msg.get("port"), "permit": True, "rule_id": "FW-01", "vlan": "VLAN30", "ts": self._hhmm()})
            await self._ack(type_, True)
        elif type_ == "set_thresholds":
            if msg.get("metal_threshold_pct"):
                s["metal_threshold"] = msg["metal_threshold_pct"]
            await self._ack(type_, True)
        elif type_ == "module_toggle":
            name = msg.get("module")
            if name in self.modules:
                self.modules[name] = bool(msg.get("enabled"))
                await self._emit_msg({"t": "log", "msg": f"Demo: module '{name}' {'enabled' if msg.get('enabled') else 'disabled'}."})
                await self._ack(type_, True)
            else:
                await self._ack(type_, False, "unknown module")
        elif type_ in ("door_override", "virtual_override"):
            await self._ack(type_, True)
        else:
            await self._ack(type_, False, "unrecognized command type (demo mode)")

    async def _handle_emergency(self, type_):
        s = self.state
        if type_ == "emergency_test":
            if s["emergency_state"] != "IDLE":
                return
            s["emergency_state"] = "ACTIVE"
            s["override_active"] = True
            s["doors_unlocked"] = 1
            for node in ("G_RECEIVED", "G_VERIFY"):
                await self._flow("G", node)
            await self._flow("G", "G_CONFIRMED", "YES")
            for node in ("G_OVERRIDE", "G_UNLOCK", "G_ALARM", "G_DISPLAY_ALERT", "G_NOTIFY", "G_ADMIN_RECEIVE"):
                await self._flow("G", node)
            await self._emit_msg({"t": "alert", "module": "G", "severity": "critical", "phase": "active", "state": "ACTIVE", "reason": "Emergency drill (dashboard test)", "drill": True, "ts": self._hhmm()})
        elif type_ == "emergency_confirm":
            if s["emergency_state"] != "PENDING":
                return
            s["emergency_state"] = "ACTIVE"
            s["override_active"] = True
            s["doors_unlocked"] = 1
            for node in ("G_OVERRIDE", "G_UNLOCK", "G_ALARM", "G_DISPLAY_ALERT", "G_NOTIFY", "G_ADMIN_RECEIVE"):
                await self._flow("G", node)
            await self._emit_msg({"t": "alert", "module": "G", "severity": "critical", "phase": "active", "state": "ACTIVE", "reason": "", "drill": False, "ts": self._hhmm()})
        elif type_ == "emergency_dismiss":
            if s["emergency_state"] != "PENDING":
                return
            s["emergency_state"] = "IDLE"
            await self._flow("G", "G_LOG_CANCEL")
            await self._flow("G", "G_NORMAL_STATUS")
            await self._emit_msg({"t": "alert", "module": "G", "severity": "info", "phase": "dismissed", "state": "IDLE", "reason": "", "drill": False, "ts": self._hhmm()})
        elif type_ == "emergency_clear":
            if s["emergency_state"] != "ACTIVE":
                return
            s["emergency_state"] = "IDLE"
            s["override_active"] = False
            s["doors_unlocked"] = 0
            for node in ("G_RESET", "G_RETURN_DOORS", "G_END"):
                await self._flow("G", node)
            await self._emit_msg({"t": "alert", "module": "G", "severity": "info", "phase": "cleared", "state": "IDLE", "reason": "", "drill": False, "ts": self._hhmm()})

    async def _simulate_tap(self, uid, source):
        for node in ("A_START", "A_READER", "A_PROCESS"):
            await self._flow("A", node)
        user = next((u for u in self.registry if u.get("uid") == uid), None)
        if not user:
            await self._flow("A", "A_CHECK", "NO")
            await self._flow("A", "A_INVALID")
            await self._emit_msg({"t": "rfid", "uid": uid, "source": source, "result": "denied", "name": "", "role": "", "room": "", "ts": self._hhmm()})
            return
        await self._flow("A", "A_CHECK", "YES")
        for node in ("A_RECORD", "A_DATA", "A_DB", "A_REGISTRAR", "A_END"):
            await self._flow("A", node)
        self.state["attendance_today"] += 1
        await self._emit_msg({"t": "rfid", "uid": uid, "source": source, "result": "granted", "name": user["name"], "role": user["role"], "room": user.get("room", ""), "ts": self._hhmm()})
        await self._emit_msg({"t": "attendance", "uid": uid, "name": user["name"], "role": user["role"], "room": user.get("room") or "Main Entrance", "ts": self._hhmm(), "source": source})

    async def _ack(self, cmd, ok, detail=""):
        await self._emit_msg({"t": "ack", "cmd": cmd, "ok": ok, "detail": detail})
