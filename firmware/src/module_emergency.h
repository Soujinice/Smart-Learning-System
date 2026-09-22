// Module G - Emergency System.
// State machine: IDLE -> PENDING -> ACTIVE -> (CLEARED) -> IDLE.
// A confirmed module D detection does NOT unlock doors or sound the alarm
// by itself anymore - it raises PENDING and waits for a human. An admin
// must explicitly Confirm (-> ACTIVE, full override) or Dismiss (-> IDLE,
// logged as an admin-dismissed false alarm) from the dashboard. Manual
// fire-pull-station presses and the dashboard "test drill" are inherently
// human-initiated already, so they go straight to ACTIVE, skipping PENDING.
// While ACTIVE, all smart doors (the physical main-entrance servo, plus
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
  enum State { IDLE, PENDING, ACTIVE, CLEARED };

  std::function<void(bool unlockAll)> setAllDoors;

  void begin() {}

  bool isOverrideActive() const { return state == ACTIVE; }
  bool isPending() const { return state == PENDING; }
  State currentState() const { return state; }

  const char *stateName() const {
    switch (state) {
      case IDLE: return "IDLE";
      case PENDING: return "PENDING";
      case ACTIVE: return "ACTIVE";
      case CLEARED: return "CLEARED";
    }
    return "IDLE";
  }

  // Sensor-confirmed (module D) - waits for an admin decision.
  void triggerFromSecurity(const String &reason) {
    if (state != IDLE) return; // one emergency at a time
    activeReason = reason;
    isDrill = false;
    Proto::flow("G", "G_RECEIVED");
    Proto::flow("G", "G_VERIFY");
    Proto::flow("G", "G_CONFIRMED", "YES");
    state = PENDING;
    sendState("pending");
  }

  // Human-initiated - already confirmed by the act of pressing/clicking it.
  void triggerManualPull() { startConfirmed("Manual fire pull station activated"); }
  void triggerDrill() { startConfirmed("Emergency drill (dashboard test)"); }

  void loop() {
    if (state == CLEARED) doReset();
  }

  // Admin: PENDING -> ACTIVE.
  void confirm() {
    if (state != PENDING) return;
    activate();
  }

  // Admin: PENDING -> IDLE (false alarm, no override ever engaged).
  void dismiss() {
    if (state != PENDING) return;
    Proto::flow("G", "G_LOG_CANCEL");
    Proto::flow("G", "G_NORMAL_STATUS");
    sendState("dismissed");
    state = IDLE;
    activeReason = "";
  }

  // Admin: ACTIVE -> CLEARED. Like Confirm/Dismiss, this is the admin's
  // call to make, not gated on the sensor reading also being back to
  // normal - a security officer clearing a panel isn't blocked by the
  // system second-guessing them.
  void requestClear() {
    if (state != ACTIVE) return;
    Proto::flow("G", "G_CLEARED", "YES");
    state = CLEARED;
  }

  void handleCommand(const String &type, JsonObjectConst payload) {
    if (type == "emergency_confirm") {
      confirm();
      Proto::ack(type, true);
    } else if (type == "emergency_dismiss") {
      dismiss();
      Proto::ack(type, true);
    } else if (type == "emergency_clear") {
      requestClear();
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

  void startConfirmed(const String &reason) {
    if (state != IDLE) return; // one emergency at a time
    activeReason = reason;
    isDrill = reason.indexOf("drill") >= 0;
    Proto::flow("G", "G_RECEIVED");
    Proto::flow("G", "G_VERIFY");
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
    doc["severity"] = (state == ACTIVE) ? "critical" : (state == PENDING ? "warning" : "info");
    doc["phase"] = phase;
    doc["state"] = stateName();
    doc["reason"] = activeReason;
    doc["drill"] = isDrill;
    doc["ts"] = simClock.hhmm();
    Proto::send(doc);
  }
};

EmergencyModule emergencyModule;
