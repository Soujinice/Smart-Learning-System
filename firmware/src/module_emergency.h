// Module G - Emergency System.
// Central override state machine: IDLE -> VERIFY -> ACTIVE -> RESPONSE ->
// CLEARED -> RESET -> IDLE. Triggered by a confirmed module D event, the
// manual fire pull station, or a dashboard "test emergency drill". While
// ACTIVE/RESPONSE, all smart doors (the physical main-entrance servo, plus
// every virtual door the dashboard tracks) report UNLOCKED and RFID checks
// are bypassed (see module_rfid.h isEmergencyOverrideActive).
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <functional>
#include "config.h"
#include "protocol.h"
#include "indicators.h"
#include "simclock.h"

class EmergencyModule {
public:
  enum State { IDLE, VERIFY, ACTIVE, RESPONSE, CLEARED };

  std::function<void(bool unlockAll)> setAllDoors;

  void begin() {}

  bool isOverrideActive() const { return state == ACTIVE || state == RESPONSE; }
  State currentState() const { return state; }

  const char *stateName() const {
    switch (state) {
      case IDLE: return "IDLE";
      case VERIFY: return "VERIFY";
      case ACTIVE: return "ACTIVE";
      case RESPONSE: return "RESPONSE";
      case CLEARED: return "CLEARED";
    }
    return "IDLE";
  }

  void triggerFromSecurity(const String &reason) { startAndConfirm(reason, false); }
  void triggerManualPull() { startAndConfirm("Manual fire pull station activated", true); }
  void triggerDrill() { startAndConfirm("Emergency drill (dashboard test)", true); }

  void loop() {
    if (state == CLEARED) {
      doReset();
    }
  }

  void acknowledge() {
    if (state != ACTIVE) return;
    Proto::flow("G", "G_RESPONSE");
    state = RESPONSE;
    sendState("acknowledged");
  }

  void requestClear(bool sensorsNormal) {
    if (state != RESPONSE) return;
    Proto::flow("G", "G_CLEARED", sensorsNormal ? "YES" : "NO");
    if (!sensorsNormal) {
      Proto::flow("G", "G_CONTINUE");
      sendState("continue");
      return;
    }
    state = CLEARED;
  }

  void handleCommand(const String &type, JsonObjectConst payload) {
    if (type == "emergency_ack") {
      acknowledge();
      Proto::ack(type, true);
    } else if (type == "emergency_clear") {
      requestClear(payload["sensors_normal"].as<bool>());
      Proto::ack(type, true);
    } else if (type == "emergency_test") {
      triggerDrill();
      Proto::ack(type, true);
    } else {
      Proto::ack(type, false, "unknown emergency command");
    }
  }

private:
  State state = IDLE;
  String activeReason;
  bool isDrill = false;

  void startAndConfirm(const String &reason, bool preConfirmed) {
    if (state != IDLE) return; // one active emergency at a time
    Proto::flow("G", "G_RECEIVED");
    Proto::flow("G", "G_VERIFY");
    state = VERIFY;
    activeReason = reason;
    isDrill = preConfirmed && reason.indexOf("drill") >= 0;

    // Module D already performs the false-alarm rejection sequence before
    // ever calling triggerFromSecurity(); the manual pull station and the
    // dashboard drill are both inherently confirmed sources. So verification
    // here always resolves to YES - this still emits the flowchart's
    // "Verify Emergency Signal" / "Emergency Confirmed?" nodes for the
    // Flow Tracker page.
    Proto::flow("G", "G_CONFIRMED", "YES");
    activate();
  }

  void activate() {
    state = ACTIVE;
    Proto::flow("G", "G_OVERRIDE");
    if (setAllDoors) setAllDoors(true);
    Proto::flow("G", "G_UNLOCK");
    indicators.setAlarm(true);
    Proto::flow("G", "G_ALARM");
    Proto::flow("G", "G_DISPLAY_ALERT");
    Proto::flow("G", "G_NOTIFY");
    Proto::flow("G", "G_ADMIN_RECEIVE");
    sendState("active");
  }

  void doReset() {
    Proto::flow("G", "G_RESET");
    indicators.setAlarm(false);
    if (setAllDoors) setAllDoors(false);
    Proto::flow("G", "G_RETURN_DOORS");
    Proto::flow("G", "G_END");
    sendState("cleared");
    state = IDLE;
    activeReason = "";
    isDrill = false;
  }

  void sendState(const String &phase) {
    JsonDocument doc = Proto::begin("alert");
    doc["module"] = "G";
    doc["severity"] = (state == ACTIVE || state == RESPONSE) ? "critical" : "info";
    doc["phase"] = phase;
    doc["state"] = stateName();
    doc["reason"] = activeReason;
    doc["drill"] = isDrill;
    doc["ts"] = simClock.hhmm();
    Proto::send(doc);
  }
};

EmergencyModule emergencyModule;
