// Module B - Smart Room (physical instance: Smart Classroom 1, SF-03).
// Drives the only physically-wired classroom through the full flowchart:
// BEFORE CLASS -> DURING CLASS -> AFTER CLASS -> back to standby, gated by
// the synced class schedule and the simulated clock (or manual demo
// overrides). Other smart rooms (SF-04, Computer Labs, etc.) have no
// physical hardware and are simulated by the server as virtual nodes.
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <functional>
#include "config.h"
#include "protocol.h"
#include "simclock.h"

struct ScheduleEntry {
  String room;
  uint16_t startMin;
  uint16_t endMin;
  String subject;
  String section;
  String faculty;
};

class SmartRoomModule {
public:
  static const char *ROOM_ID;
  static const uint8_t MAX_SCHEDULE = 24;

  std::function<void(bool on)> setRelay; // wired to GPIO32 relay
  std::function<void(const char *msg)> onAlert;

  void begin() {
    dht.begin();
    pinMode(PIN_PIR, INPUT);
    seedDefaultSchedule();
  }

  void seedDefaultSchedule() {
    scheduleCount = 0;
    addEntry("SF-03", 7 * 60 + 30, 9 * 60, "CPE 301 - Embedded Systems", "BSCPE 3A", "Engr. Ramon Reyes");
    addEntry("SF-03", 9 * 60 + 15, 10 * 60 + 45, "CPE 412 - Intelligent Buildings", "BSCPE 4A", "Engr. Ramon Reyes");
    addEntry("SF-03", 13 * 60, 14 * 60 + 30, "IT 205 - Networking 1", "BSIT 2B", "Prof. Liza Manalo");
  }

  bool addEntry(const String &room, uint16_t start, uint16_t end, const String &subject,
                const String &section, const String &faculty) {
    if (scheduleCount >= MAX_SCHEDULE) return false;
    schedule[scheduleCount++] = { room, start, end, subject, section, faculty };
    return true;
  }

  void syncSchedule(JsonArrayConst arr) {
    scheduleCount = 0;
    for (JsonObjectConst o : arr) {
      if (scheduleCount >= MAX_SCHEDULE) break;
      String room = o["room"].as<String>();
      if (room != ROOM_ID) continue; // firmware only tracks its physical room
      addEntry(room, o["start"].as<uint16_t>(), o["end"].as<uint16_t>(),
               o["subject"].as<String>(), o["section"].as<String>(), o["faculty"].as<String>());
    }
    Proto::log("Smart Room: schedule synced (" + String(scheduleCount) + " SF-03 entries)");
  }

  void setThresholds(float tMin, float tMax, float hMin, float hMax) {
    tempMin = tMin; tempMax = tMax; humMin = hMin; humMax = hMax;
  }

  void notifyAttendance(const String &room, const String &name, const String &role) {
    if (room != ROOM_ID) return;
    if (state != IN_SESSION && state != ACTIVE_BEFORE) return;
    Proto::flow("B", "B_ATTEND_TAG");
    Proto::flow("B", "B_READER");
    Proto::flow("B", "B_PROCESS_ATTEND");
    Proto::flow("B", "B_ATTEND_RECORDED");
    attendanceCount++;
  }

  void requestStart() { manualStart = true; }
  void requestEnd() { manualEnd = true; }

  void loop() {
    unsigned long now = millis();

    switch (state) {
      case STANDBY: {
        Proto::flow("B", "B_START");
        Proto::flow("B", "B_CHECK_SCHED");
        int idx = findActiveEntry();
        bool scheduled = (idx >= 0) || manualStart;
        Proto::flow("B", "B_SCHEDULED", scheduled ? "YES" : "NO");
        if (scheduled) {
          activeEntryIdx = idx;
          enterBefore();
        } else {
          Proto::flow("B", "B_WAIT");
        }
        manualStart = false;
        break;
      }

      case ACTIVE_BEFORE: {
        // one-shot activation already emitted in enterBefore(); move on
        // immediately into the persistent in-session monitoring loop.
        enterSession();
        break;
      }

      case IN_SESSION: {
        if (now - lastDhtRead >= DHT_INTERVAL_MS) {
          lastDhtRead = now;
          readAndEvaluate();
        }
        bool motion = digitalRead(PIN_PIR) == HIGH;
        if (motion != lastMotion) {
          lastMotion = motion;
        }

        bool endSignal = manualEnd || (activeEntryIdx >= 0 && simClock.minutesOfDayValue() >= schedule[activeEntryIdx].endMin);
        if (activeEntryIdx < 0) endSignal = manualEnd; // manually-started class never auto-ends

        if (endSignal) {
          Proto::flow("B", "B_CLASS_END_SIGNAL");
          Proto::flow("B", "B_CLASS_ENDED", "YES");
          enterAfter();
        }
        manualEnd = false;
        break;
      }

      case AFTER_CLASS: {
        exitToStandby();
        break;
      }
    }
  }

  // --- status snapshot for telemetry ---
  const char *stateName() const {
    switch (state) {
      case STANDBY: return "STANDBY";
      case ACTIVE_BEFORE: return "ACTIVE_BEFORE";
      case IN_SESSION: return "IN_SESSION";
      case AFTER_CLASS: return "AFTER_CLASS";
    }
    return "STANDBY";
  }
  float temperature() const { return lastTempC; }
  float humidity() const { return lastHumPct; }
  bool motionPresent() const { return lastMotion; }
  bool conditionAbnormal() const { return lastAbnormal; }
  uint32_t attendanceTotal() const { return attendanceCount; }
  String currentSubject() const {
    if (activeEntryIdx >= 0) return schedule[activeEntryIdx].subject;
    return (state != STANDBY) ? String("Ad-hoc session") : String("");
  }
  String currentFaculty() const { return (activeEntryIdx >= 0) ? schedule[activeEntryIdx].faculty : String(""); }
  String currentSection() const { return (activeEntryIdx >= 0) ? schedule[activeEntryIdx].section : String(""); }

  void handleCommand(const String &type, JsonObjectConst payload) {
    if (type == "sync_schedule") {
      syncSchedule(payload["entries"].as<JsonArrayConst>());
      Proto::ack(type, true);
    } else if (type == "class_override") {
      String action = payload["action"].as<String>();
      if (action == "start") requestStart();
      else if (action == "end") requestEnd();
      Proto::ack(type, true);
    } else if (type == "set_thresholds") {
      if (payload["room_temp_min"].is<float>()) tempMin = payload["room_temp_min"].as<float>();
      if (payload["room_temp_max"].is<float>()) tempMax = payload["room_temp_max"].as<float>();
      if (payload["room_hum_min"].is<float>()) humMin = payload["room_hum_min"].as<float>();
      if (payload["room_hum_max"].is<float>()) humMax = payload["room_hum_max"].as<float>();
      Proto::ack(type, true);
    } else {
      Proto::ack(type, false, "unknown smart room command");
    }
  }

private:
  enum State { STANDBY, ACTIVE_BEFORE, IN_SESSION, AFTER_CLASS } state = STANDBY;
  DHT dht { PIN_DHT22, DHT22 };

  ScheduleEntry schedule[MAX_SCHEDULE];
  uint8_t scheduleCount = 0;
  int activeEntryIdx = -1;

  bool manualStart = false, manualEnd = false;
  bool lastMotion = false, lastAbnormal = false;
  float lastTempC = 24.0f, lastHumPct = 55.0f;
  float tempMin = Defaults::TEMP_MIN_C, tempMax = Defaults::TEMP_MAX_C;
  float humMin = Defaults::HUMIDITY_MIN_PCT, humMax = Defaults::HUMIDITY_MAX_PCT;
  unsigned long lastDhtRead = 0;
  static const unsigned long DHT_INTERVAL_MS = 2500;
  uint32_t attendanceCount = 0;

  int findActiveEntry() {
    uint16_t nowMin = simClock.minutesOfDayValue();
    for (uint8_t i = 0; i < scheduleCount; i++) {
      if (nowMin >= schedule[i].startMin && nowMin < schedule[i].endMin) return i;
    }
    return -1;
  }

  void enterBefore() {
    state = ACTIVE_BEFORE;
    Proto::flow("B", "B_ACTIVATE");
    if (setRelay) setRelay(true);
    Proto::flow("B", "B_DISPLAY_STATUS");
  }

  void enterSession() {
    state = IN_SESSION;
    lastDhtRead = 0; // force an immediate read
    Proto::flow("B", "B_IN_SESSION");
  }

  void readAndEvaluate() {
    float h = dht.readHumidity();
    float t = dht.readTemperature();
    Proto::flow("B", "B_SENSOR_DATA");
    if (!isnan(h) && !isnan(t)) {
      lastTempC = t;
      lastHumPct = h;
    }
    Proto::flow("B", "B_PROCESS_SENSOR");

    bool abnormal = (lastTempC < tempMin || lastTempC > tempMax ||
                      lastHumPct < humMin || lastHumPct > humMax);
    lastAbnormal = abnormal;
    Proto::flow("B", "B_COND_NORMAL", abnormal ? "NO" : "YES");

    if (!abnormal) {
      Proto::flow("B", "B_DISPLAY_NORMAL");
    } else {
      Proto::flow("B", "B_GEN_ALERT");
      Proto::flow("B", "B_DISPLAY_WARNING");
      if (onAlert) onAlert("SF-03 condition abnormal");
      sendRoomAlert();
    }
    sendTelemetryLine();
  }

  void enterAfter() {
    state = AFTER_CLASS;
    Proto::flow("B", "B_SAVE_DATA");
    Proto::flow("B", "B_SEND_CENTRAL");
    sendSessionSummary();
  }

  void exitToStandby() {
    if (setRelay) setRelay(false);
    Proto::flow("B", "B_STANDBY_OFF");
    Proto::flow("B", "B_STANDBY_STATUS");
    Proto::flow("B", "B_END");
    state = STANDBY;
    activeEntryIdx = -1;
    attendanceCount = 0;
  }

  void sendRoomAlert() {
    JsonDocument doc = Proto::begin("alert");
    doc["module"] = "B";
    doc["room"] = ROOM_ID;
    doc["severity"] = "warning";
    doc["message"] = "SF-03 room condition abnormal (temp " + String(lastTempC, 1) +
                      "C, humidity " + String(lastHumPct, 1) + "%)";
    doc["ts"] = simClock.hhmm();
    Proto::send(doc);
  }

  void sendSessionSummary() {
    JsonDocument doc = Proto::begin("log");
    doc["msg"] = "SF-03 session ended: " + currentSubject() + " (" + String(attendanceCount) + " attendees)";
    Proto::send(doc);
  }

  void sendTelemetryLine() {
    // Room-level telemetry rides inside the main 1Hz telemetry frame;
    // nothing to do here beyond keeping the readings current.
  }
};

const char *SmartRoomModule::ROOM_ID = "SF-03";

SmartRoomModule smartRoom;
