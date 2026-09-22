// Smart Learning Center - single ESP32 firmware entry point.
// Technological University of the Philippines - Group 3 midterm simulation.
//
// One ESP32 runs every subsystem (flowcharts A-I) concurrently as
// non-blocking, millis()-driven state machines - there is no delay() in
// loop(). Each module lives in its own header (module_*.h) and is wired
// together here via small std::function callbacks so modules stay
// independent of each other's internals. See PROTOCOL.md for the full
// wire format and README.md for the wiring table and demo guide.

#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

#include "config.h"
#include "protocol.h"
#include "simclock.h"
#include "indicators.h"
#include "module_flags.h"

#include "module_metaldetector.h"
#include "module_rfid.h"
#include "module_smartroom.h"
#include "module_environment.h"
#include "module_emergency.h"
#include "module_security.h"
#include "module_network.h"
#include "module_waste.h"
#include "module_display.h"

// ---------------------------------------------------------------------------
// Main entrance smart door lock (the one physical servo). Virtual doors
// elsewhere in the building are tracked by the server; it mirrors this
// module's "override_active" telemetry flag onto all of them.
// ---------------------------------------------------------------------------
class DoorController {
public:
  void begin() {
    servo.setPeriodHertz(50);
    servo.attach(PIN_SERVO, 500, 2400);
    lock();
  }

  void loop() {
    if (pulsing && !overrideActive && millis() > pulseUntil) {
      pulsing = false;
      lock();
    }
  }

  void pulseUnlock() {
    if (overrideActive) return; // already unlocked building-wide
    unlock();
    pulsing = true;
    pulseUntil = millis() + Defaults::DOOR_UNLOCK_MS;
  }

  void setOverride(bool active) {
    overrideActive = active;
    if (active) {
      unlock();
    } else if (!pulsing) {
      lock();
    }
  }

  // Admin dashboard manual control of the main-entrance door. Has no
  // effect while the module-G emergency override is active (the override
  // always wins, matching "RFID locks are bypassed" during ACTIVE/RESPONSE).
  void manualSet(bool unlocked) {
    if (overrideActive) return;
    pulsing = false;
    if (unlocked) unlock(); else lock();
  }

  bool isUnlocked() const { return unlockedState; }

private:
  Servo servo;
  bool unlockedState = false;
  bool pulsing = false;
  bool overrideActive = false;
  unsigned long pulseUntil = 0;

  void unlock() { servo.write(90); unlockedState = true; }
  void lock() { servo.write(0); unlockedState = false; }
};

DoorController doorController;

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
uint32_t attendanceToday = 0;
String announcementText;

String serialBuffer;
unsigned long lastTelemetryMs = 0;
unsigned long bootMs = 0;

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------
void dispatchCommand(const String &type, JsonObjectConst payload) {
  if (type == "ping") {
    Proto::ack(type, true, "pong");
  } else if (type == "time_scale") {
    simClock.setScale(payload["minutes_per_second"].as<uint32_t>());
    Proto::ack(type, true);
  } else if (type == "jump_time") {
    simClock.jumpTo(payload["minutes"].as<uint16_t>());
    Proto::ack(type, true);
  } else if (type == "display_text") {
    announcementText = payload["text"].as<String>();
    Proto::ack(type, true);
  } else if (type == "door_override") {
    String doorId = payload["door_id"].as<String>();
    if (doorId == "main_entrance" || doorId.length() == 0) {
      bool locked = payload["locked"].as<bool>();
      doorController.manualSet(!locked);
    }
    // Doors other than the physical main entrance are virtual and tracked
    // entirely by the server; it applies the override to its own door list.
    Proto::ack(type, true);
  } else if (type == "virtual_override") {
    // Most virtual entities (extra rooms, extra bins, extra doors) live on
    // the server, which owns their simulated state directly. The firmware
    // just acknowledges so the server's optimistic UI update is confirmed.
    Proto::ack(type, true);
  } else if (type == "module_toggle") {
    handleModuleToggle(payload);
  } else if (type == "sync_users" || type == "rfid_tap") {
    rfidModule.handleCommand(type, payload);
  } else if (type == "sync_schedule" || type == "class_override") {
    smartRoom.handleCommand(type, payload);
  } else if (type == "screening_decision") {
    metalDetector.handleCommand(type, payload);
  } else if (type == "waste_collect") {
    waste.handleCommand(type, payload);
  } else if (type == "emergency_confirm" || type == "emergency_dismiss" || type == "emergency_clear" || type == "emergency_test") {
    emergencyModule.handleCommand(type, payload);
  } else if (type == "net_scenario" || type == "net_request") {
    network.handleCommand(type, payload);
  } else if (type == "set_thresholds") {
    // A single set_thresholds command may carry fields for several modules
    // at once; each module reads only the keys it recognizes.
    environment.handleCommand(type, payload);
    smartRoom.handleCommand(type, payload);
    security.handleCommand(type, payload);
    waste.handleCommand(type, payload);
    metalDetector.handleCommand(type, payload);
    Proto::ack(type, true);
  } else {
    Proto::ack(type, false, "unrecognized command type");
  }
}

void processLine(const String &line) {
  if (!line.startsWith("CMD ")) return; // non-protocol input is ignored
  String json = line.substring(4);
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, json);
  if (err) {
    Proto::log(String("Malformed CMD line: ") + err.c_str());
    return;
  }
  String type = doc["type"].as<String>();
  dispatchCommand(type, doc.as<JsonObjectConst>());
}

void pollSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      processLine(serialBuffer);
      serialBuffer = "";
    } else if (c != '\r') {
      serialBuffer += c;
      if (serialBuffer.length() > 900) serialBuffer = "";
    }
  }
}

// ---------------------------------------------------------------------------
// Telemetry (1 Hz)
// ---------------------------------------------------------------------------
void sendTelemetry() {
  JsonDocument doc = Proto::begin("telemetry");
  doc["sim_time"] = simClock.hhmm();
  doc["sim_scale"] = simClock.scale();
  doc["uptime_s"] = (millis() - bootMs) / 1000;
  doc["heap_free"] = ESP.getFreeHeap();

  JsonObject env = doc["environment"].to<JsonObject>();
  env["temp_c"] = smartRoom.temperature();
  env["humidity_pct"] = smartRoom.humidity();
  env["motion"] = smartRoom.motionPresent();
  env["aqi"] = environment.airQualityIndex();

  JsonObject fire = doc["security"].to<JsonObject>();
  fire["smoke_pct"] = security.smokePct();
  fire["smoke_level"] = (int)security.currentLevel();
  fire["intrusion"] = security.intrusionActive();
  fire["false_alarms"] = security.falseAlarmCount();

  JsonObject rm = doc["smart_room"].to<JsonObject>();
  rm["room"] = "SF-03";
  rm["state"] = smartRoom.stateName();
  rm["subject"] = smartRoom.currentSubject();
  rm["section"] = smartRoom.currentSection();
  rm["faculty"] = smartRoom.currentFaculty();
  rm["attendance"] = smartRoom.attendanceTotal();
  rm["abnormal"] = smartRoom.conditionAbnormal();

  JsonObject wasteObj = doc["waste"].to<JsonObject>();
  wasteObj["fill_pct"] = waste.fillPercent();
  wasteObj["full"] = waste.isFull();

  JsonObject metal = doc["metal_detector"].to<JsonObject>();
  metal["threshold_pct"] = metalDetector.threshold();
  metal["hold_active"] = metalDetector.isHoldActive();

  JsonObject doors = doc["doors"].to<JsonObject>();
  doors["main_entrance_unlocked"] = doorController.isUnlocked();
  doors["override_active"] = emergencyModule.isOverrideActive();

  JsonObject emerg = doc["emergency"].to<JsonObject>();
  emerg["state"] = emergencyModule.stateName();
  emerg["active"] = emergencyModule.isOverrideActive();
  emerg["pending"] = emergencyModule.isPending();

  JsonObject wifi = doc["wifi"].to<JsonObject>();
  wifi["connected"] = network.isWifiConnected();
  wifi["rssi"] = network.rssi();
  wifi["ip"] = network.ip();

  doc["relay_sf03"] = strcmp(smartRoom.stateName(), "STANDBY") != 0;
  doc["attendance_today"] = attendanceToday;
  if (announcementText.length()) doc["announcement"] = announcementText;

  JsonObject mods = doc["modules"].to<JsonObject>();
  mods["rfid"] = moduleFlags.rfid;
  mods["smart_room"] = moduleFlags.smartRoom;
  mods["environment"] = moduleFlags.environment;
  mods["security"] = moduleFlags.security;
  mods["metal_detector"] = moduleFlags.metalDetector;
  mods["waste"] = moduleFlags.waste;
  mods["network"] = moduleFlags.network;

  Proto::send(doc);
}

void refreshDisplay() {
  DisplaySnapshot snap;
  snap.simTime = simClock.hhmm();
  snap.emergencyActive = emergencyModule.isOverrideActive();
  snap.emergencyPending = emergencyModule.isPending();
  snap.emergencyState = emergencyModule.stateName();
  snap.smokePct = security.smokePct();
  snap.smokeLevel = (uint8_t)security.currentLevel();
  snap.roomTempC = smartRoom.temperature();
  snap.roomHumPct = smartRoom.humidity();
  snap.roomMotion = smartRoom.motionPresent();
  snap.smartRoomState = smartRoom.stateName();
  snap.roomAttendance = smartRoom.attendanceTotal();
  snap.attendanceToday = attendanceToday;
  snap.doorsUnlocked = doorController.isUnlocked() ? 1 : 0;
  snap.doorsTotal = 1;
  snap.wifiConnected = network.isWifiConnected();
  snap.rssi = network.rssi();
  snap.ip = network.ip();
  snap.wastePct = waste.fillPercent();
  snap.wasteFull = waste.isFull();
  snap.rfidEnabled = moduleFlags.rfid;
  snap.securityEnabled = moduleFlags.security;
  snap.networkEnabled = moduleFlags.network;
  snap.wasteEnabled = moduleFlags.waste;
  display.loop(snap);
}

// ---------------------------------------------------------------------------
// setup / loop
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(50); // allow the USB-CDC/UART bridge to settle before first prints
  bootMs = millis();

  simClock.begin(7 * 60 + 10); // demo starts a little before the 07:30 class
  indicators.begin();
  doorController.begin();

  metalDetector.begin();
  rfidModule.begin();
  smartRoom.begin();
  environment.begin();
  emergencyModule.begin();
  security.begin();
  network.begin();
  waste.begin();
  bool oledOk = display.begin();
  if (!oledOk) Proto::log("OLED SSD1306 not detected at 0x3C - continuing without the digital display");

  // --- wire modules together ---
  rfidModule.isEntranceOnHold = []() { return metalDetector.isHoldActive(); };
  rfidModule.pulseDoorUnlock = []() { doorController.pulseUnlock(); };
  rfidModule.isEmergencyOverrideActive = []() { return emergencyModule.isOverrideActive(); };
  rfidModule.onAttendanceGranted = [](const String &room, const String &name, const String &role) {
    attendanceToday++;
    smartRoom.notifyAttendance(room, name, role);
  };

  smartRoom.setRelay = [](bool on) { digitalWrite(PIN_RELAY, on ? HIGH : LOW); };
  pinMode(PIN_RELAY, OUTPUT);
  digitalWrite(PIN_RELAY, LOW);

  security.onConfirmedEmergency = [](const String &reason) { emergencyModule.triggerFromSecurity(reason); };
  security.onManualPull = []() { emergencyModule.triggerManualPull(); };

  emergencyModule.setAllDoors = [](bool unlock) { doorController.setOverride(unlock); };
  emergencyModule.onResolved = []() { security.resetEscalation(); };

  JsonDocument boot = Proto::begin("boot");
  boot["device"] = DEVICE_ID;
  boot["fw"] = FIRMWARE_VERSION;
  boot["modules"] = "A,B,C,D,E,F,G,H";
  Proto::send(boot);
  Proto::log("Smart Learning Center firmware ready.");
}

void loop() {
  pollSerial();

  simClock.loop();
  indicators.loop();
  doorController.loop();

  if (moduleFlags.rfid) rfidModule.loop();
  if (moduleFlags.smartRoom) smartRoom.loop();
  if (moduleFlags.environment) { smartRoom.pollSensors(); environment.loop(); }
  if (moduleFlags.security) security.loop();
  if (moduleFlags.metalDetector) metalDetector.loop();
  if (moduleFlags.waste) waste.loop();
  if (moduleFlags.network) network.loop();
  emergencyModule.loop(); // core safety state machine - never gated

  refreshDisplay();

  unsigned long now = millis();
  if (now - lastTelemetryMs >= 1000) {
    lastTelemetryMs = now;
    sendTelemetry();
  }
}
