# Smart Learning Center - Wire Protocol

This document is the single source of truth for the serial protocol between
the ESP32 firmware (`firmware/src/*`) and the Python central server
(`server/*.py`, FastAPI). The dashboard never talks to the ESP32 directly -
it only ever sees JSON relayed over the WebSocket at `/ws`, and it sends
commands through the REST API, which the server turns into `CMD` lines.

```
Wokwi ESP32 (UART0) --RFC2217 (localhost:4000)--> server/bridge.py
                                                        |
                                                   server/main.py  <-- REST --> dashboard
                                                        |
                                                    WebSocket /ws --> dashboard (browser)
```

## Transport

- **Baud rate:** 115200, 8N1.
- **Line-oriented:** every message is exactly one line, terminated by `\n`.
- **Machine-readable lines** are prefixed with `@@` followed by a single-line
  JSON object, e.g. `@@{"t":"telemetry","sim_time":"07:31",...}`.
- **Everything else** (plain `Serial.println(...)` calls used for debugging)
  is treated as free text and shown in the Diagnostics page's raw console
  panel, not parsed as protocol data.
- The Python bridge (`server/bridge.py`, asyncio) connects to Wokwi's
  RFC2217 server (`localhost:4000`, see `firmware/wokwi.toml`) as a **plain
  TCP client**, strips Telnet/RFC2217 IAC negotiation bytes from the stream
  (including `IAC IAC` escaping and `IAC SB ... IAC SE` subnegotiation
  blocks), and reassembles `\n`-terminated lines from what remains.
- In `BRIDGE_MODE=demo`, `server/demo_device.py` emits the exact same
  message shapes described below and accepts the exact same commands, so
  the dashboard cannot tell the difference except for the DEMO MODE banner.

## ESP32 -> server messages

Every object has a `"t"` field naming its type. Field names below match the
firmware's `Proto::begin(...)` / `Proto::send(...)` calls exactly.

| `t` | When | Key fields |
|---|---|---|
| `boot` | Once, at startup | `device`, `fw`, `modules`. Triggers the server's `sync_users`/`sync_schedule`/`set_thresholds` resync (see `on_device_message` in `server/main.py`) - the firmware's registry/schedule live only in RAM, so this is what restores them after every reset. |
| `telemetry` | Every 1s | `sim_time`, `sim_scale`, `uptime_s`, `heap_free`, `environment{temp_c,humidity_pct,motion,aqi}`, `security{smoke_pct,smoke_level,intrusion,false_alarms}`, `smart_room{room,state,subject,section,faculty,attendance,abnormal}`, `waste{fill_pct,full}`, `metal_detector{threshold_pct,hold_active}`, `doors{main_entrance_unlocked,override_active}`, `emergency{state,active,pending}`, `wifi{connected,rssi,ip}`, `relay_sf03`, `attendance_today`, `modules{rfid,smart_room,environment,security,metal_detector,waste,network}` |
| `rfid` | On every tap (reader or web) | `uid`, `source` (`reader`\|`web`), `result` (`granted`\|`granted_hold`\|`denied`\|`duplicate`\|`bypassed_emergency`), `name`, `role`, `room`, `ts` |
| `attendance` | On a granted tap | `uid`, `name`, `role`, `room`, `ts`, `source` |
| `flow` | On every flowchart node transition | `m` (module id: `MAIN`,`A`-`I`), `s` (node id), `v` (branch label, optional: `YES`/`NO`/`ADMIN`/`FACULTY`), `ms`. Still emitted by the firmware for every module (matching the flowcharts in Section 1 of the brief) even though the dashboard no longer visualizes it. |
| `alert` | State-worthy events | `module`, `severity` (`info`\|`warning`\|`critical`), `message` (env/waste/etc.) or `phase` (`pending`\|`dismissed`\|`active`\|`cleared`) / `state`/`reason`/`drill` (module G) |
| `false_alarm` | Module D false-alarm rejection | `count`, `smoke_pct`, `reason`, `ts` |
| `screening` | Metal detector scan result | `result` (`clear`\|`hold`\|`allowed`\|`denied`), `signal_pct`, `threshold_pct`, `reason`, `scans`, `alerts`, `allowed`, `denied`, `ts` |
| `waste` | Bin level change | `bin_id`, `room`, `fill_pct`, `state`, `live`, `ts` |
| `net_stats` | Every 1s | `scenario`, `wifi_connected`, `wifi_rssi`, `wifi_ip`, `firewall_rules[]`, `blocked_hosts[]`, `vlans[]`, `switch_segments[]` |
| `net_result` | Reply to `net_request` | `user`, `role`, `port`, `permit`, `rule_id`, `vlan`, `ts` |
| `log` | Free-form status line | `msg` |
| `ack` | Reply to every `CMD` | `cmd`, `ok`, `detail` |

## Server -> ESP32 commands

Sent as a plain text line: `CMD {"type":"...", ...payload}`. Every command
receives an `ack` with `cmd` echoing the type.

| `type` | Payload | Effect |
|---|---|---|
| `sync_users` | `{users:[{uid,name,role,room,section}]}` | Replaces the RFID registry (module A) |
| `sync_schedule` | `{entries:[{room,start,end,subject,section,faculty}]}` | Replaces the SF-03 schedule (module B); `start`/`end` are minutes since 00:00 |
| `set_thresholds` | any of the threshold fields (env/room temp+hum, smoke L1-L4, metal, waste/bin) | Updates the relevant module(s); unrecognized keys are ignored |
| `rfid_tap` | `{uid}` | Injects a virtual tap (source `"web"`), same as a physical card on the reader. The dashboard's own Virtual Tap/Register & Grant buttons no longer send this - `/api/rfid/tap` now decides grant/deny itself against the server's registry and never depends on the firmware being reachable or in sync (see the honesty notes in README.md). The command still exists on the wire for anything that wants to inject a tap the firmware itself evaluates. |
| `class_override` | `{action:"start"\|"end"}` | Demo override for module B |
| `screening_decision` | `{allow:boolean}` | Resolves a module F screening hold |
| `waste_collect` | `{admin_override:boolean}` | Resets the physical bin (module H) |
| `emergency_confirm` | - | Admin confirms a sensor-detected fire/smoke condition: PENDING -> ACTIVE (unlocks doors, sounds alarm) |
| `emergency_dismiss` | - | Admin dismisses a sensor-detected condition as a false alarm: PENDING -> IDLE (doors stay locked, no alarm) |
| `emergency_clear` | - | Admin call (like confirm/dismiss, not gated on sensor readings): ACTIVE -> CLEARED -> IDLE (doors return to locked); no effect if not ACTIVE |
| `emergency_test` | - | Human-initiated drill: IDLE -> ACTIVE directly (dashboard test button, treated as pre-confirmed) |
| `door_override` | `{door_id,locked}` | Manually sets the main entrance door (only `door_id:"main_entrance"` has physical effect; the emergency override always wins) |
| `net_scenario` | `{scenario:"normal"\|"port_scan"\|"brute_force"\|"dos_flood"\|"blocked_port"}` | Triggers a one-shot synthetic traffic scenario |
| `net_request` | `{user,role,port}` | Runs the module E firewall/router/VLAN policy check, replies with `net_result` |
| `time_scale` | `{minutes_per_second}` | Changes the simulated-clock speed |
| `jump_time` | `{minutes}` | Jumps the simulated clock to a given minute-of-day |
| `display_text` | `{text}` | Shows an announcement on the 20x4 LCD's building-status page |
| `virtual_override` | `{entity,id,...}` | No firmware effect - acknowledged so the server's optimistic UI update for a purely virtual entity is confirmed |
| `module_toggle` | `{module:"rfid"\|"smart_room"\|"environment"\|"security"\|"metal_detector"\|"waste"\|"network", enabled:boolean}` | Enables/disables that module's `loop()` call (see `firmware/src/module_flags.h`). The sim clock, indicators, door servo, and module G are never gated. |
| `ping` | - | Replies `ack` with `detail:"pong"` |

Malformed `CMD` lines (bad JSON) are logged and otherwise ignored; the
firmware never crashes on unparsable input.

## Flow node IDs

The firmware still emits a `flow` message (`Proto::flow(m, s, v)`) at every
flowchart node transition for every module (MAIN and A-I), matching the
flowcharts in the project brief, even though the dashboard no longer
visualizes them (the Flow Tracker page was removed as part of the UI
simplification pass). These messages are otherwise ignored by the current
server and dashboard, but remain available on the wire for debugging via
the Diagnostics page's raw console panel.

## Simulated clock

The firmware keeps its own time-of-day (`sim_time`, `HH:MM`) that advances
`sim_scale` simulated minutes per real second (default 1, i.e. one real
second = one simulated minute), so a school day's schedule is demonstrable
in a few real minutes. `time_scale` and `jump_time` commands control it;
`demo_device.py` mirrors the same clock so demo mode behaves identically.
