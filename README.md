# Smart Learning Center - Simulation

Technological University of the Philippines - Smart Cities / Intelligent
Buildings midterm - **Group 3**.

A complete, runnable simulation of a two-floor "Smart Learning Center":
**one** ESP32 (simulated in Wokwi) runs every subsystem from the project's
flowcharts (MAIN, A-I) concurrently as non-blocking state machines, and a
Python "Central Smart Learning System" server (FastAPI) turns its serial
output into a live, browser-based building-management dashboard.

```
smart-learning-center/
  firmware/    PlatformIO project - one ESP32, one diagram.json
  server/      Python central server (FastAPI + asyncio), JSON-file storage
  public/      Static dashboard (vanilla ES modules, no build step)
  README.md    This file
  PROTOCOL.md  Full wire protocol reference
```

## Honesty notes (please read before the demo)

- **RFID uses a real reader part.** Wokwi's `board-mfrc522` part is wired to
  the ESP32 over SPI (see the wiring table below) and driven by the
  `miguelbalboa/MFRC522` library - tap a card in the Wokwi RFID inspector (or
  the website's virtual-tap panel) to trigger a real read, exactly like
  physical hardware.
- **Fire detection is smoke-only.** There is no flame sensor - the gas/smoke
  sensor on GF-06 (Cafeteria) is the only input to module D's five-level
  smoke scale, and it is present and wired in `firmware/diagram.json`
  (`wokwi-gas-sensor`, `AOUT` -> GPIO34). Its simulated slider is pinned to
  `"value": "0"` in `diagram.json` (same trick used for the metal detector's
  potentiometer) so it reads a quiet baseline until you drag it up in the
  Wokwi inspector - leaving it untouched no longer produces a warning on its
  own.
- **Only one module starts enabled: RFID/Attendance.** Every other module
  (Smart Room, Environment, Security & Fire, Metal Detector, Waste, Network)
  boots **off** so their sensors don't compete for the serial line or spam
  the dashboard before you're ready to test them - turn each one on from the
  Controls page right before you touch its part in Wokwi. See
  `firmware/src/module_flags.h`.
- **A confirmed fire/smoke reading does not auto-trigger the emergency.**
  Module D still escalates through its Watch/Warning/Danger levels, but a
  sustained Danger-level reading only raises module G to **PENDING** - doors
  stay locked and no alarm sounds. An admin must open the Security & Fire
  page and either **Confirm Emergency** (-> ACTIVE: all doors unlock, alarm
  sounds) or **Dismiss** (-> back to IDLE, logged as a false alarm). A human
  trigger (the manual pull station, or the dashboard's drill button) still
  goes straight to ACTIVE, since the human action is itself the
  confirmation. **Dismiss** and **Clear Emergency** are always honored the
  moment you click them - like Confirm, they're the admin's call, not
  something the sensor reading can veto - and module D's own escalation
  counters reset at the same time, so leaving the gas sensor's slider raised
  in Wokwi won't cause an immediate new PENDING right after you dismiss or
  clear one.
- **Two physical LCDs, one I2C bus.** The Main Lobby display (`0x27`) rotates
  through building-wide pages; a second, dedicated display for Smart
  Classroom 1 (`0x28`) always shows that room's live temperature, humidity,
  motion, and class state - both wired to the same SDA/SCL pins, addressed
  separately, exactly like stacking two real I2C LCD backpacks on one bus.
- **RFID cards register on the fly.** The seed registry only knows 12 fixed
  UIDs, so a card you attach in the Wokwi editor almost certainly won't be
  one of them and will read as Access Denied at first - that's the reader
  correctly reporting an unrecognized card, not a bug. On the Attendance &
  RFID page, the **Register New Card** panel auto-fills the UID from that
  denied tap; give it a name and click **Register & Grant** to add it to the
  registry and immediately show it as a granted attendance tap. Registering
  also clears the reader's duplicate-tap guard for that UID, so a real
  re-tap right after registering is re-checked fresh instead of being
  swallowed as a duplicate of the earlier denial.
- **Registry updates now actually reach the firmware.** Every `sync_users`
  command sends the *entire* registry, and even the 12 seed users alone
  serialize past 1.2KB - the firmware's incoming serial line buffer was
  capped at 900 bytes as an arbitrary safety limit, so that command was
  being silently truncated and dropped before it ever reached `syncUsers()`.
  Registering a card looked like it worked (the server accepted the
  request), but the ESP32's own copy of the registry was never actually
  updated, so every subsequent tap of that card still came back denied.
  The cap is now 8KB - comfortably past the largest payload the firmware
  can ever produce (a full 32-user registry or 24-entry schedule) - see
  `pollSerial()` in `firmware/src/main.cpp`.
- **Ending a class sticks.** "Start Class Now" / "End Class Now" on the
  Smart Room page take effect immediately, and once you manually end a
  class it stays in STANDBY (relay off) even if the sim clock is still
  inside that class's scheduled window - it only hands control back to the
  schedule once that window naturally ends, so it can't immediately
  re-enter session the instant you ended it.
- **Typing doesn't get interrupted anymore.** Pages rebuild their DOM on
  every store update (telemetry alone ticks about once a second), which
  used to drop focus out of whatever field you were typing into - one
  keystroke would land, the next second's re-render would knock focus onto
  nothing, and the rest never landed (this could also mangle what got
  submitted from the **Register New Card** panel, which is why a card
  might still read denied even after "granting" it). Any page with form
  fields (Attendance & RFID, Smart Room's sim-clock controls, Admin/
  Faculty, Controls' sliders) now pauses its own rebuild while a field has
  focus or a slider is being dragged, and catches up the moment you're
  done - see `withPreservedFocus` in `public/js/ui.js`.
- **CCTV is the presenter's own webcam**, shown via the browser's
  `getUserMedia()` API on the Security & Fire page - not a Wokwi part, since
  Wokwi has no camera peripheral. It starts **off**; use the **Turn On
  Camera** button on that card and allow camera access when prompted (and
  **Turn Off Camera** to release it again).
- **The interactive smart board is a website drawing demo.** Wokwi has no
  touchscreen/whiteboard part, so the Smart Room page includes a simple
  canvas you can draw/clear on to represent the board's live content; the
  physical relay (GPIO32) still represents the board/projector's power
  state.
- **Only one physical sensor node exists** (Main Lobby, Main Entrance,
  Cafeteria GF-06, and Smart Classroom 1 / SF-03). Every other room/bin/door
  shown on the dashboard is a **virtual node**, generated by the server or
  firmware, and is badged `SIMULATED` - never presented as `LIVE`.
- **Wokwi part names used** (`wokwi-gas-sensor`, `wokwi-relay-module`,
  `wokwi-potentiometer`, `wokwi-hc-sr04`, `wokwi-lcd2004`, `board-mfrc522`,
  ...) and the exact ESP32 DevKit pin labels (`D2`, `3V3`, `GND.1`, `5V`,
  ...) are based on common Wokwi example projects at the time this was
  written and are believed correct, but **have not been verified against a
  live Wokwi session by the author of this repository**. If a wire shows
  red/broken when you first open `diagram.json` in the Wokwi editor, click
  the part to see its real pin names and adjust the `connections` array
  accordingly - see Troubleshooting below.

## Prerequisites

- **VS Code** with the **PlatformIO IDE** extension.
- The **Wokwi for VS Code** extension, with a Wokwi account/license
  (the free tier is enough for one ESP32 + these peripherals).
- **Python 3.10+** and pip.

## Run order

### 1. Firmware (Wokwi simulation)

1. Open the `firmware/` folder in VS Code (PlatformIO should auto-detect
   `platformio.ini`).
2. Build once so `.pio/build/esp32dev/firmware.bin` / `.elf` exist (Wokwi
   needs these paths, set in `wokwi.toml`):
   ```
   pio run
   ```
3. Open `firmware/diagram.json` and press the Wokwi "Play" button (or use
   the command palette: "Wokwi: Start Simulator"). Confirm in the Wokwi
   output panel that it is serving RFC2217 on port 4000 (from
   `wokwi.toml`'s `rfc2217ServerPort = 4000`).
4. Leave the simulation running.

### 2. Server (Central Smart Learning System)

```
cd server
python -m venv .venv && source .venv/bin/activate   # optional but recommended
pip install -r requirements.txt
cp .env.example .env       # defaults already point at BRIDGE_MODE=rfc2217, localhost:4000
uvicorn main:app --host 0.0.0.0 --port 8080
```

The console prints `Smart Learning Center server listening on
http://localhost:8080` and either "expecting Wokwi RFC2217 at
127.0.0.1:4000" or, if you set `BRIDGE_MODE=demo` in `.env`, "(DEMO MODE -
no Wokwi connection)".

### 3. Dashboard

Open **http://localhost:8080** in a browser. Sign in with one of the demo
accounts (see below). The top bar's connection pill shows `Connected` once
the server's bridge has a live line from the ESP32; if you left `.env` on
`BRIDGE_MODE=demo`, it shows a persistent `DEMO MODE` badge instead and the
server generates believable telemetry on its own so you can rehearse the UI
without Wokwi running.

### Testing one subsystem at a time

The simulation boots with only **RFID/Attendance** enabled - every other
module starts off so its sensor isn't generating readings, flow events, or
LCD pages you don't care about yet. When you're ready to test another part
(say, the gas sensor), open the **Controls** page and flip that module's
switch on right before you touch it in Wokwi; flip it back off when you're
done. A disabled module's `loop()` stops running on the ESP32 entirely (see
`firmware/src/module_flags.h`), so the simulation stays smooth and focused
on whatever you're actually testing. Toggling takes effect immediately, no
reflash needed.

The **Environment** module now drives the SF-03 DHT22 (temperature/
humidity) and PIR reading shown on the Environment page, sampling
continuously as soon as you turn it on - not only while a class happens to
be in session. The **Smart Room** module is separate: it only drives the
class-schedule state machine (relay, attendance window, SF-03 state).
Clicking **Start Class Now** on the Smart Room page turns both of those
modules on for you, so it never silently does nothing even if they were
left off.

### Demo accounts (simulation only - do not reuse these credentials anywhere real)

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Administrator |
| `faculty` | `faculty123` | Faculty |
| `registrar` | `registrar123` | Registrar |
| `security` | `security123` | Security Officer |
| `maintenance` | `maintenance123` | Maintenance |

## Wiring table (single ESP32 DevKit V1)

| ESP32 pin | Device (Wokwi part) | Room / purpose |
|---|---|---|
| GPIO21 (SDA) / GPIO22 (SCL) | `wokwi-lcd2004` 20x4 I2C character LCD (`0x27`) | Digital Information Display - Main Lobby |
| GPIO21 (SDA) / GPIO22 (SCL) | `wokwi-lcd2004` 20x4 I2C character LCD (`0x28`) | Dedicated room display - Smart Classroom 1 (SF-03), same shared I2C bus, different address |
| GPIO15 | DHT22 data | Temp/Humidity - Smart Classroom 1 (SF-03) |
| GPIO13 | PIR HC-SR501 `OUT` | Motion/presence - SF-03 |
| GPIO34 (ADC1) | MQ-2 `AOUT` | Smoke/gas level - Cafeteria (GF-06) |
| GPIO5 / GPIO18 | HC-SR04 `TRIG` / `ECHO` | Waste bin fill level - Main Lobby |
| GPIO33 (ADC1) | Potentiometer wiper | Metal detector signal strength - Main Entrance |
| GPIO14 | Pushbutton, `INPUT_PULLUP` | `SCREEN` - person/object presented for screening |
| GPIO12 | `board-mfrc522` `RST` | RFID reader reset - Main Entrance (see GPIO12 note below) |
| GPIO27 | `board-mfrc522` `SDA`/`SS` | RFID reader chip-select |
| GPIO26 | `board-mfrc522` `SCK` | RFID reader SPI clock |
| GPIO25 | `board-mfrc522` `MOSI` | RFID reader SPI data out |
| GPIO35 (input-only) | `board-mfrc522` `MISO` | RFID reader SPI data in |
| GPIO4 | Pushbutton, `INPUT_PULLUP`, active low | Manual fire pull station / local emergency |
| GPIO16 | Green LED + 330 ohm resistor | Status: normal |
| GPIO17 | Yellow LED + 330 ohm resistor | Status: warning |
| GPIO19 | Red LED + 330 ohm resistor | Status: emergency |
| GPIO23 | Buzzer | Audible alerts / alarm |
| GPIO32 | Relay module `IN` | SF-03 smart board/projector power (drives an indicator LED load through the relay's NO/COM contacts) |
| GPIO2 | Servo signal | Main entrance smart door lock (0deg locked, 90deg unlocked) |

Only ADC1 pins (32-39) are used for analog reads, so Wi-Fi stays usable.
All buttons use `INPUT_PULLUP` (active low) - no external pull resistors
needed for them. The RFID reader powers from 3.3V (MFRC522 boards are not
5V tolerant). **GPIO12 note:** GPIO12 is an ESP32 boot-strapping pin (must
be low at reset to select 3.3V flash voltage); it's safe here because
nothing else pulls it during boot, but avoid adding any other pull-up on
this net if you extend the circuit.

## Architecture

- **Firmware** (`firmware/src/*.h` + `main.cpp`): one header per subsystem
  (modules A-H, plus indicators/display/protocol/sim-clock helpers), each
  exposing `begin()`/`loop()` and driven entirely by `millis()` timers -
  **no `delay()` in `loop()`**. `main.cpp` wires modules together with small
  `std::function` callbacks (e.g. module F's screening hold blocks module
  A's door unlock) and owns the single physical door servo.
- **Server** (`server/*.py`, FastAPI + asyncio): `bridge.py` is the RFC2217
  TCP client with Telnet/IAC stripping; `demo_device.py` is a drop-in
  stand-in with the identical event interface for `BRIDGE_MODE=demo`;
  `db.py` is flat JSON-file persistence under `server/data/`; `main.py`
  wires it all into a FastAPI REST API plus a `/ws` WebSocket relay, and
  also runs the light server-side simulation for virtual rooms/bins.
- **Dashboard** (`public/*`): no build step - static HTML/CSS and vanilla
  ES modules, hash-routed single page (`public/js/app.js`), Chart.js
  vendored as a static UMD file at `public/vendor/chartjs/chart.umd.js`
  (no Node.js dependency).

## Troubleshooting

**Nothing shows up / connection pill stuck on "Reconnecting..."**
- Confirm the Wokwi simulation is actually running (green triangle turns
  into a stop icon) and its output shows the RFC2217 server started on
  port 4000.
- Confirm `server/.env` has `RFC2217_PORT=4000` and nothing else on your
  machine is already bound to that port (`lsof -i :4000` on macOS/Linux).
- The server auto-reconnects with exponential backoff (1s -> 15s cap), so
  give it a few seconds after starting Wokwi.

**A Wokwi part shows a broken/red wire, or fails to load**
- Click the part in the Wokwi editor and check its real pin names in the
  inspector panel; some Wokwi core-library versions rename pins (e.g. a
  future update could rename `AOUT` on the MQ-2 part, or `SDA`/`SS` on the
  `board-mfrc522` part). Edit the matching entry in `firmware/diagram.json`'s
  `connections` array to match.
- If `wokwi-gas-sensor` or `wokwi-relay-module` are not available in
  your Wokwi version, the nearest substitutes are a `wokwi-potentiometer`
  (relabel as "smoke level") and a `wokwi-led` wired directly to GPIO32
  respectively - the firmware code does not need to change, only the part
  type in `diagram.json`.
- If `board-mfrc522` is not available, the nearest substitute is 3
  pushbuttons wired to spare pins standing in for card taps, with
  `firmware/src/module_rfid.h` reverted to poll `digitalRead()` instead of
  the MFRC522 library - only needed as a last resort.

**Wi-Fi never connects**
- `Wokwi-GUEST` is Wokwi's built-in simulated open network and should
  connect within a few seconds of boot. If it does not (e.g. running
  offline, or a future Wokwi build changes the SSID), the building
  simulation keeps working normally - Wi-Fi status is reported honestly as
  `offline` and only affects the "WAN/Wi-Fi Link" tile on the Network page.

**CCTV tile shows "Camera permission denied or unavailable"**
- The Security & Fire page's CCTV card uses the browser's own webcam via
  `getUserMedia()`, not a Wokwi part. Allow camera access when the browser
  prompts, and make sure the dashboard is served over `http://localhost`
  or `https://` (browsers block camera access on other origins).

**Port 8080 already in use**
- Change `PORT` in `server/.env` and reload the dashboard at the new port.

## Asset inventory (design vs. this simulation)

| Component | Designed qty | Represented in this simulation |
|---|---|---|
| Interactive smart boards | 4 | 1 relay-driven load (SF-03) LIVE + website drawing demo; rest listed as building assets, SIMULATED |
| RFID readers | 3-4 + 10-15 tags | 1 real MFRC522 reader (LIVE) + web taps; 12 tags seeded |
| CCTV / PIR | 5-6 | 1 PIR (SF-03, LIVE) + 1 browser webcam feed (LIVE); other camera tiles SIMULATED |
| Environmental sensors (DHT) | 4-6 | 1 DHT22 (SF-03, LIVE); other zones SIMULATED |
| Smart projectors | 2 | 1 relay-driven indicator (SF-03, LIVE) |
| Digital displays | 3-4 | 2 20x4 I2C LCDs (Main Lobby + SF-03 room, both LIVE); others SIMULATED on dashboard |
| Central controller | 1-2 | 1 Python (FastAPI) server (this repo) |
| Network ESP32 modules | 2-3 | 1 ESP32 running every module concurrently (assignment requires a single microcontroller) |
| Fire/safety set + indicators | 3-4 | MQ-2 smoke sensor (GF-06, LIVE) + 3 LEDs + buzzer (LIVE) |

## Demo guide / acceptance tests

Also rendered live on the Diagnostics & Settings page. Only RFID/Attendance
is enabled by default - turn on the module each test needs from the
**Controls** page first (test 1 needs none, the rest need their own module).

| # | Action | Expected result |
|---|---|---|
| 1 | Tap a registered card on the RFID reader | Attendance recorded, door unlocks for 3s. An unregistered card gives Access Denied; register it from the Attendance & RFID page's **Register New Card** panel (UID auto-filled) and it's immediately granted. |
| 2 | Enable Smart Room, then start class now (SF-03) | Relay ON, room ACTIVE. Push DHT22 temp above 28C -> alert. End class -> data saved, relay OFF. |
| 3 | Raise MQ-2 briefly, then lower it | "Possible False Alarm" logged, no emergency. |
| 4 | Raise MQ-2 high & sustained | Module G goes to **PENDING** - doors stay locked, no alarm yet. On the Security & Fire page, **Confirm Emergency** -> all doors unlock, alarm sounds; or **Dismiss** -> back to IDLE, logged as a false alarm. Once ACTIVE, **Clear Emergency** returns doors to locked. |
| 5 | Press the manual pull station | Immediate ACTIVE emergency (human action is itself the confirmation, skips PENDING). |
| 6 | `SCREEN` with potentiometer above threshold | Metal alert, entry held; Allow/Deny from the Security & Fire page. While held, `CARD1` will not unlock the door. |
| 7 | PIR trigger after building hours | Intrusion alert; during class hours it is presence only. |
| 8 | HC-SR04 distance below threshold | Bin Full alert -> Mark Collected -> resets. |
| 9 | Network scenario buttons | Firewall blocks and the auto-block list grows; student LMS login is permitted, a server-port attempt is denied. |
| 10 | Admin edits a user/schedule/threshold | ESP32 acknowledges and behavior changes immediately. |
| 11 | Stop the Wokwi simulation | UI shows Offline within ~5s and recovers automatically on restart. |

## Assumptions and anything that could not be verified

- Exact Wokwi part identifiers/pin names for `wokwi-gas-sensor`,
  `wokwi-relay-module`, `wokwi-hc-sr04`, `wokwi-potentiometer`,
  `wokwi-lcd2004`, `board-mfrc522`, and the ESP32 DevKit V1's own pin
  labels (`D2`, `3V3`, `GND.1`/`GND.2`/`GND.3`, `5V`) were not confirmed
  against a live Wokwi session - see the honesty note above and the
  Troubleshooting section for how to fix a mismatch quickly.
- `ArduinoJson` v7's `JsonDocument` (no fixed capacity) is assumed
  available via the pinned `bblanchon/ArduinoJson @ ^7.1.0`; if Wokwi's
  bundled PlatformIO registry resolves an older v6 release, the `to<T>()` /
  `JsonObjectConst` calls in the firmware would need updating to v6's
  `StaticJsonDocument`/`DynamicJsonDocument` API.
- The building's schedule, RFID registry, and thresholds are seeded with
  realistic Filipino university sample data (`server/data/seed.json`) but
  are entirely fictional.
- Demo login passwords are intentionally simple and stored in plain text in
  `seed.json` - this is a classroom simulation, not a production auth
  system.
- The dashboard is intentionally lean: Floor Plans, Flow Tracker, a
  dedicated Emergency page, and Presentation Mode were removed after the
  first round of feedback in favor of a Controls page (per-module on/off
  switches plus threshold sliders) so the simulation stays smooth and
  focused on whichever subsystem you're actually testing on Wokwi.
