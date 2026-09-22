"""Smart Learning Center - Central Smart Learning System server (Python).

FastAPI REST API + WebSocket relay bridging the Wokwi-simulated ESP32 (or
the demo-mode generator) to the dashboard. JSON-file persistence, no
external database. See PROTOCOL.md for the wire format and README.md for
run instructions.
"""
import asyncio
import json
import os
import secrets
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

import db
from bridge import Bridge
from demo_device import DemoDevice

load_dotenv()

PORT = int(os.environ.get("PORT", "8080"))
BRIDGE_MODE = os.environ.get("BRIDGE_MODE", "rfc2217").lower()
RFC2217_HOST = os.environ.get("RFC2217_HOST", "127.0.0.1")
RFC2217_PORT = int(os.environ.get("RFC2217_PORT", "4000"))

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "..", "public")

MODULE_NAMES = ["rfid", "smart_room", "environment", "security", "metal_detector", "waste", "network"]

app = FastAPI()

# ---------------------------------------------------------------------------
# Device connection (real Wokwi bridge, or the demo generator)
# ---------------------------------------------------------------------------
device = DemoDevice() if BRIDGE_MODE == "demo" else Bridge(RFC2217_HOST, RFC2217_PORT)

device_connected = False
last_telemetry = None
last_net_stats = None
event_log = []  # recent raw debug lines, capped
MAX_EVENT_LOG = 300
pre_emergency_door_state = None


def now_iso():
    return datetime.now(timezone.utc).isoformat()


async def send_command(type_, payload=None):
    line = "CMD " + json.dumps({"type": type_, **(payload or {})})
    return await device.send(line)


# ---------------------------------------------------------------------------
# WebSocket broadcast
# ---------------------------------------------------------------------------
ws_clients = set()


async def broadcast(obj):
    data = json.dumps(obj)
    dead = []
    for ws in ws_clients:
        try:
            await ws.send_text(data)
        except Exception:
            dead.append(ws)
    for ws in dead:
        ws_clients.discard(ws)


async def broadcast_flow(m, s, v=None):
    msg = {"t": "flow", "m": m, "s": s, "ts": now_iso()}
    if v:
        msg["v"] = v
    await broadcast(msg)


async def broadcast_status():
    await broadcast({
        "t": "conn_status",
        "connected": device_connected,
        "demo_mode": BRIDGE_MODE == "demo",
        "bridge_mode": BRIDGE_MODE,
    })


# ---------------------------------------------------------------------------
# Device message handling
# ---------------------------------------------------------------------------
async def on_device_connected():
    global device_connected
    device_connected = True
    await broadcast_status()
    # Registry/schedule/threshold resync happens on the firmware's own
    # "boot" message (see on_device_message), not here - "connected" fires
    # the instant the RFC2217 TCP socket opens, which can be well before
    # the ESP32 has actually finished setup() and is ready to receive
    # commands on its UART. Sending this early risked the resync silently
    # arriving during boot and being lost, which would leave the firmware
    # holding only its 12 hardcoded seed users - "registered" cards read
    # as denied again after every Wokwi restart even though the server's
    # own copy of the registry was correct the whole time.


async def on_device_disconnected():
    global device_connected
    device_connected = False
    await broadcast_status()


async def on_device_raw(line):
    event_log.append({"ts": now_iso(), "line": line})
    if len(event_log) > MAX_EVENT_LOG:
        del event_log[0]
    await broadcast({"t": "console", "line": line})


async def apply_emergency_door_effects(msg):
    global pre_emergency_door_state
    if msg.get("module") != "G":
        return
    doors = db.get("doors")
    if msg.get("phase") == "active":
        if not pre_emergency_door_state:
            pre_emergency_door_state = [{"id": d["id"], "locked": d["locked"]} for d in doors]
        db.set_("doors", [{**d, "locked": False} for d in doors])
        await broadcast({"t": "doors_update", "doors": db.get("doors")})
    elif msg.get("phase") == "cleared":
        prev_by_id = {p["id"]: p["locked"] for p in (pre_emergency_door_state or [])}
        restored = [{**d, "locked": prev_by_id.get(d["id"], True)} for d in doors]
        db.set_("doors", restored)
        pre_emergency_door_state = None
        await broadcast({"t": "doors_update", "doors": db.get("doors")})


async def on_device_message(msg):
    global last_telemetry, last_net_stats
    t = msg.get("t")
    if t == "boot":
        # The firmware only ever reaches setup()'s final Proto::send(boot)
        # once Serial and every module's begin() have run, so this is the
        # first moment it's actually safe to push state at it - resync the
        # registry/schedule/thresholds it may have lost across the reset.
        await send_command("sync_users", {"users": db.get("rfid_registry")})
        await send_command("sync_schedule", {"entries": db.get("schedule")})
        await send_command("set_thresholds", db.get("thresholds"))
    elif t == "telemetry":
        last_telemetry = msg
    elif t == "attendance":
        db.push("attendance", {**msg, "id": str(uuid.uuid4())})
    elif t == "alert":
        db.push("events", {**msg, "id": str(uuid.uuid4()), "kind": "alert"})
        await apply_emergency_door_effects(msg)
    elif t == "log":
        db.push("events", {"id": str(uuid.uuid4()), "kind": "log", "message": msg.get("msg"), "ts": now_iso()})
    elif t == "false_alarm":
        db.push("false_alarms", {**msg, "id": str(uuid.uuid4())})
    elif t == "screening":
        db.push("screenings", {**msg, "id": str(uuid.uuid4())})
    elif t == "waste":
        bin_id = msg.get("bin_id")
        db.update("bins", lambda b: b["id"] == bin_id, lambda b: {**b, "fill_pct": msg.get("fill_pct")})
    elif t == "net_stats":
        last_net_stats = msg
    elif t == "net_result":
        db.push("events", {"id": str(uuid.uuid4()), "kind": "net_result", **msg})
    await broadcast(msg)


device.on("connected", on_device_connected)
device.on("disconnected", on_device_disconnected)
device.on("raw", on_device_raw)
device.on("message", on_device_message)


# ---------------------------------------------------------------------------
# Virtual node simulation (rooms/bins with no physical hardware)
# ---------------------------------------------------------------------------
def minutes_from_hhmm(hhmm):
    if not hhmm:
        return 0
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


async def virtual_sim_loop():
    import random
    while True:
        await asyncio.sleep(4)
        sim_minutes = minutes_from_hhmm(last_telemetry.get("sim_time")) if last_telemetry else 0

        bins = db.get("bins")
        changed = False
        for b in bins:
            if b.get("live"):
                continue
            b["fill_pct"] = min(100, b["fill_pct"] + random.random() * 1.2)
            changed = True
        if changed:
            db.set_("bins", bins)
            await broadcast({"t": "bins_update", "bins": bins})

        rooms = [r for r in db.get("rooms") if not r.get("has_hardware") and r.get("floor") == 2 and r["id"].startswith("SF")]
        schedule = db.get("schedule")
        zones = []
        for r in rooms:
            active = next((s for s in schedule if s["room"] == r["id"] and sim_minutes >= s["start"] and sim_minutes < s["end"]), None)
            zones.append({
                "room": r["id"], "name": r["name"],
                "state": "IN_SESSION" if active else "STANDBY",
                "subject": active["subject"] if active else "",
                "temp_c": 22 + random.random() * 4,
                "humidity_pct": 45 + random.random() * 15,
                "live": False,
            })
        await broadcast({"t": "virtual_zones", "zones": zones, "ts": last_telemetry.get("sim_time") if last_telemetry else ""})


# ---------------------------------------------------------------------------
# Sessions (minimal cookie-based auth for the demo login accounts)
# ---------------------------------------------------------------------------
sessions = {}  # token -> {username, role, name, title}


def current_user(request: Request):
    token = request.cookies.get("slc_session")
    if not token:
        return None
    return sessions.get(token)


def require_auth(request: Request):
    user = current_user(request)
    if not user:
        return None, JSONResponse({"ok": False, "error": "not authenticated"}, status_code=401)
    return user, None


def require_role(request: Request, *roles):
    user = current_user(request)
    if not user:
        return None, JSONResponse({"ok": False, "error": "not authenticated"}, status_code=401)
    if user["role"] not in roles:
        return None, JSONResponse({"ok": False, "error": "insufficient role"}, status_code=403)
    return user, None


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------
@app.get("/api/status")
async def api_status():
    return {
        "ok": True,
        "connected": device_connected,
        "demo_mode": BRIDGE_MODE == "demo",
        "bridge_mode": BRIDGE_MODE,
        "sim_time": last_telemetry.get("sim_time") if last_telemetry else None,
        "telemetry": last_telemetry,
        "net_stats": last_net_stats,
    }


# --- Auth ---
@app.post("/api/login")
async def api_login(request: Request, response: Response):
    body = await request.json()
    username, password = body.get("username"), body.get("password")
    user = next((u for u in db.get("users") if u["username"] == username and u["password"] == password), None)
    if not user:
        return JSONResponse({"ok": False, "error": "Invalid username or password"}, status_code=401)
    token = secrets.token_urlsafe(24)
    session = {"username": user["username"], "role": user["role"], "name": user["name"], "title": user.get("title")}
    sessions[token] = session
    response.set_cookie("slc_session", token, httponly=True, samesite="lax", path="/")

    await broadcast_flow("I", "I_ENTER")
    await broadcast_flow("I", "I_AUTH")
    await broadcast_flow("I", "I_VALID", "YES")
    await broadcast_flow("I", "I_ROLE")
    await broadcast_flow("I", "I_ADMIN_OR_FACULTY", "ADMIN" if user["role"] == "admin" else "FACULTY")

    return {"ok": True, "user": session}


@app.post("/api/logout")
async def api_logout(request: Request, response: Response):
    token = request.cookies.get("slc_session")
    if token:
        sessions.pop(token, None)
    response.delete_cookie("slc_session", path="/")
    return {"ok": True}


@app.get("/api/me")
async def api_me(request: Request):
    user = current_user(request)
    if not user:
        return JSONResponse({"ok": False}, status_code=401)
    return {"ok": True, "user": user}


# --- Rooms ---
@app.get("/api/rooms")
async def api_rooms():
    return {"ok": True, "rooms": db.get("rooms")}


# --- Schedule ---
@app.get("/api/schedule")
async def api_schedule():
    return {"ok": True, "schedule": db.get("schedule")}


@app.post("/api/schedule")
async def api_schedule_save(request: Request):
    user, err = require_role(request, "admin", "faculty")
    if err:
        return err
    body = await request.json()
    entries = body.get("entries")
    if not isinstance(entries, list):
        return JSONResponse({"ok": False, "error": "entries[] required"}, status_code=400)
    db.set_("schedule", entries)
    await send_command("sync_schedule", {"entries": entries})
    await broadcast_flow("I", "I_FACULTY_PROCESS")
    return {"ok": True, "schedule": entries}


@app.post("/api/class/override")
async def api_class_override(request: Request):
    user, err = require_role(request, "admin", "faculty")
    if err:
        return err
    body = await request.json()
    action = body.get("action")
    if action not in ("start", "end"):
        return JSONResponse({"ok": False, "error": "action must be start|end"}, status_code=400)
    await send_command("class_override", {"action": action})
    return {"ok": True}


# --- RFID registry & attendance ---
@app.get("/api/rfid")
async def api_rfid():
    return {"ok": True, "users": db.get("rfid_registry")}


@app.post("/api/rfid")
async def api_rfid_save(request: Request):
    user, err = require_role(request, "admin")
    if err:
        return err
    body = await request.json()
    users = body.get("users")
    if not isinstance(users, list):
        return JSONResponse({"ok": False, "error": "users[] required"}, status_code=400)
    db.set_("rfid_registry", users)
    await send_command("sync_users", {"users": users})
    await broadcast_flow("I", "I_ADMIN_PROCESS")
    return {"ok": True, "users": users}


@app.post("/api/rfid/tap")
async def api_rfid_tap(request: Request):
    body = await request.json()
    uid = body.get("uid")
    if not uid:
        return JSONResponse({"ok": False, "error": "uid required"}, status_code=400)

    # Decided here, against the server's own (always-current) registry,
    # instead of only forwarding to the firmware and waiting for it to
    # report back. A "virtual tap" exists specifically so the dashboard/
    # attendance flow can be tested even when the ESP32's in-memory copy
    # of the registry isn't in sync yet - it has no persistent storage, so
    # every reset forgets everything sync_users hasn't re-sent since, and
    # that resync depends on a working serial link. This endpoint no
    # longer depends on any of that for its own result.
    registry = db.get("rfid_registry")
    user = next((u for u in registry if u.get("uid") == uid), None)
    ts = (last_telemetry or {}).get("sim_time") or now_iso()

    if user:
        event = {
            "t": "rfid", "uid": uid, "source": "web", "result": "granted",
            "name": user.get("name", ""), "role": user.get("role", ""), "room": user.get("room", ""),
            "ts": ts,
        }
        db.push("attendance", {
            "t": "attendance", "uid": uid, "name": user.get("name", ""), "role": user.get("role", ""),
            "room": user.get("room") or "Main Entrance", "ts": ts, "source": "web",
            "id": str(uuid.uuid4()),
        })
    else:
        event = {"t": "rfid", "uid": uid, "source": "web", "result": "denied", "name": "", "role": "", "room": "", "ts": ts}
    await broadcast(event)

    # Deliberately not forwarded to the firmware: if it happened to also be
    # in sync, its own echoed rfid/attendance messages would double up the
    # tap feed and attendance table for the same tap. A virtual tap is a
    # dashboard-only simulation - it doesn't pulse the physical door servo,
    # same as it never has.
    return {"ok": True, "result": event["result"]}


@app.get("/api/attendance")
async def api_attendance(room: str = None, role: str = None, q: str = None):
    rows = db.get("attendance")
    if room:
        rows = [r for r in rows if r.get("room") == room]
    if role:
        rows = [r for r in rows if r.get("role") == role]
    if q:
        rows = [r for r in rows if q.lower() in (r.get("name") or "").lower()]
    return {"ok": True, "attendance": list(reversed(rows[-500:]))}


@app.get("/api/attendance.csv")
async def api_attendance_csv():
    rows = db.get("attendance")
    header = "timestamp,uid,name,role,room,source\n"

    def esc(v):
        return '"' + str(v or "").replace('"', '""') + '"'

    body = "\n".join(",".join(esc(r.get(k)) for k in ("ts", "uid", "name", "role", "room", "source")) for r in rows)
    return Response(
        content=header + body,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="attendance.csv"'},
    )


# --- Thresholds ---
@app.get("/api/thresholds")
async def api_thresholds():
    return {"ok": True, "thresholds": db.get("thresholds")}


@app.post("/api/thresholds")
async def api_thresholds_save(request: Request):
    user, err = require_role(request, "admin")
    if err:
        return err
    body = await request.json()
    thresholds = {**db.get("thresholds"), **body}
    db.set_("thresholds", thresholds)
    await send_command("set_thresholds", thresholds)
    await broadcast_flow("I", "I_ADMIN_PROCESS")
    return {"ok": True, "thresholds": thresholds}


# --- Events / alerts / false alarms / screenings ---
@app.get("/api/events")
async def api_events():
    return {"ok": True, "events": list(reversed(db.get("events")[-300:]))}


@app.get("/api/false-alarms")
async def api_false_alarms():
    return {"ok": True, "false_alarms": list(reversed(db.get("false_alarms")[-100:]))}


@app.get("/api/screenings")
async def api_screenings():
    return {"ok": True, "screenings": list(reversed(db.get("screenings")[-100:]))}


@app.post("/api/screenings/decision")
async def api_screening_decision(request: Request):
    user, err = require_role(request, "admin", "security")
    if err:
        return err
    body = await request.json()
    await send_command("screening_decision", {"allow": bool(body.get("allow"))})
    return {"ok": True}


# --- Doors ---
@app.get("/api/doors")
async def api_doors():
    return {"ok": True, "doors": db.get("doors")}


@app.post("/api/doors/{door_id}")
async def api_door_set(door_id: str, request: Request):
    user, err = require_role(request, "admin", "security")
    if err:
        return err
    body = await request.json()
    locked = bool(body.get("locked"))
    doors = db.get("doors")
    door = next((d for d in doors if d["id"] == door_id), None)
    if not door:
        return JSONResponse({"ok": False, "error": "door not found"}, status_code=404)
    door["locked"] = locked
    db.set_("doors", doors)
    if door.get("live"):
        await send_command("door_override", {"door_id": door["id"], "locked": locked})
    else:
        await send_command("virtual_override", {"entity": "door", "id": door["id"], "locked": locked})
    await broadcast({"t": "doors_update", "doors": doors})
    return {"ok": True, "doors": doors}


# --- Waste ---
@app.get("/api/bins")
async def api_bins():
    return {"ok": True, "bins": db.get("bins")}


@app.post("/api/bins/{bin_id}/collect")
async def api_bin_collect(bin_id: str, request: Request):
    user, err = require_role(request, "admin", "maintenance")
    if err:
        return err
    body = await request.json()
    bins = db.get("bins")
    bin_ = next((b for b in bins if b["id"] == bin_id), None)
    if not bin_:
        return JSONResponse({"ok": False, "error": "bin not found"}, status_code=404)
    if bin_.get("live"):
        await send_command("waste_collect", {"admin_override": bool(body.get("admin_override"))})
    else:
        bin_["fill_pct"] = 8
        db.set_("bins", bins)
        await broadcast({"t": "bins_update", "bins": bins})
    return {"ok": True}


# --- Emergency ---
@app.post("/api/emergency/{action}")
async def api_emergency(action: str, request: Request):
    user, err = require_role(request, "admin", "security")
    if err:
        return err
    if action == "confirm":
        await send_command("emergency_confirm")
    elif action == "dismiss":
        await send_command("emergency_dismiss")
    elif action == "test":
        await send_command("emergency_test")
    elif action == "clear":
        # Admin call, like confirm/dismiss - not gated on the sensor
        # reading also being back to normal (see module_emergency.h).
        await send_command("emergency_clear")
    else:
        return JSONResponse({"ok": False, "error": "unknown action"}, status_code=400)
    return {"ok": True}


# --- Modules (per-subsystem enable/disable, so you can test one part at a time) ---
@app.get("/api/modules")
async def api_modules():
    modules = (last_telemetry or {}).get("modules") or {m: True for m in MODULE_NAMES}
    return {"ok": True, "modules": modules}


@app.post("/api/modules/{name}/toggle")
async def api_module_toggle(name: str, request: Request):
    user, err = require_role(request, "admin")
    if err:
        return err
    if name not in MODULE_NAMES:
        return JSONResponse({"ok": False, "error": "unknown module"}, status_code=400)
    body = await request.json()
    await send_command("module_toggle", {"module": name, "enabled": bool(body.get("enabled"))})
    return {"ok": True}


# --- Network ---
@app.post("/api/network/scenario")
async def api_network_scenario(request: Request):
    user, err = require_role(request, "admin", "security")
    if err:
        return err
    body = await request.json()
    await send_command("net_scenario", {"scenario": body.get("scenario", "normal")})
    return {"ok": True}


@app.post("/api/network/lms-request")
async def api_lms_request(request: Request):
    user, err = require_auth(request)
    if err:
        return err
    body = await request.json()
    port = body.get("port", 443)
    await send_command("net_request", {"user": user["username"], "role": user["role"], "port": port})
    return {"ok": True}


@app.get("/api/network/stats")
async def api_network_stats():
    return {"ok": True, "net_stats": last_net_stats}


# --- Sim clock ---
@app.post("/api/simclock/scale")
async def api_simclock_scale(request: Request):
    user, err = require_role(request, "admin")
    if err:
        return err
    body = await request.json()
    await send_command("time_scale", {"minutes_per_second": body.get("minutes_per_second", 1)})
    return {"ok": True}


@app.post("/api/simclock/jump")
async def api_simclock_jump(request: Request):
    user, err = require_role(request, "admin")
    if err:
        return err
    body = await request.json()
    await send_command("jump_time", {"minutes": body.get("minutes", 0)})
    return {"ok": True}


# --- Announcements ---
@app.get("/api/announcements")
async def api_announcements():
    return {"ok": True, "announcements": db.get("announcements")}


@app.post("/api/announcements")
async def api_announcements_post(request: Request):
    user, err = require_role(request, "admin")
    if err:
        return err
    body = await request.json()
    text = body.get("text")
    if not text:
        return JSONResponse({"ok": False, "error": "text required"}, status_code=400)
    entry = {"id": str(uuid.uuid4()), "text": text, "ts": now_iso(), "author": user["username"]}
    db.push("announcements", entry)
    await send_command("display_text", {"text": text})
    return {"ok": True, "announcement": entry}


# --- Diagnostics ---
@app.get("/api/console")
async def api_console():
    return {"ok": True, "lines": event_log}


@app.post("/api/ping")
async def api_ping():
    await send_command("ping")
    return {"ok": True}


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------
@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    ws_clients.add(websocket)
    try:
        await websocket.send_text(json.dumps({
            "t": "hello",
            "connected": device_connected,
            "demo_mode": BRIDGE_MODE == "demo",
            "bridge_mode": BRIDGE_MODE,
            "telemetry": last_telemetry,
        }))
        while True:
            # The dashboard never sends anything over this socket, but we
            # must keep reading so we notice a client-initiated close.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_clients.discard(websocket)


# ---------------------------------------------------------------------------
# Startup / static files
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def on_startup():
    device.start()
    asyncio.create_task(virtual_sim_loop())
    mode_note = "(DEMO MODE - no Wokwi connection)" if BRIDGE_MODE == "demo" else f"(expecting Wokwi RFC2217 at {RFC2217_HOST}:{RFC2217_PORT})"
    print(f"Smart Learning Center server listening on http://localhost:{PORT}")
    print(f"Bridge mode: {BRIDGE_MODE} {mode_note}")


# Registered last so it never shadows the /api/* and /ws routes above -
# Starlette matches routes in registration order, and a mount is just
# another route matched by prefix.
app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="static")
