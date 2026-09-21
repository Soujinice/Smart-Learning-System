// Module F - Metal Detector (Main Entrance walk-through screening).
// SCREEN button simulates presenting a person/object; the potentiometer
// simulates the detector's signal strength (0-100%). A detection puts the
// entrance into a screening hold: module A (RFID) will not unlock the door
// while the hold is active, until a security officer presses Allow/Deny on
// the dashboard, or the hold times out (auto-deny).
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"
#include "protocol.h"
#include "indicators.h"
#include "simclock.h"

class MetalDetectorModule {
public:
  void begin() {
    pinMode(PIN_BTN_SCREEN, INPUT_PULLUP);
  }

  void loop() {
    bool pressed = digitalRead(PIN_BTN_SCREEN) == LOW;
    if (pressed && !btnDown) {
      btnDown = true;
      startScreening();
    } else if (!pressed) {
      btnDown = false;
    }

    if (state == HOLD && millis() > holdDeadline) {
      resolveScreening(false, "timeout");
    }
  }

  bool isHoldActive() const { return state == HOLD; }

  void decide(bool allow) {
    if (state != HOLD) return;
    resolveScreening(allow, "officer");
  }

  void setThreshold(float pct) { thresholdPct = pct; }
  float threshold() const { return thresholdPct; }

  void handleCommand(const String &type, JsonObjectConst payload) {
    if (type == "screening_decision") {
      decide(payload["allow"].as<bool>());
      Proto::ack(type, true);
    } else if (type == "set_thresholds") {
      if (payload["metal_threshold_pct"].is<float>()) thresholdPct = payload["metal_threshold_pct"].as<float>();
      Proto::ack(type, true);
    } else {
      Proto::ack(type, false, "unknown metal detector command");
    }
  }

private:
  enum State { IDLE, HOLD } state = IDLE;
  bool btnDown = false;
  float thresholdPct = Defaults::METAL_THRESHOLD_PCT;
  float lastSignalPct = 0;
  unsigned long holdDeadline = 0;
  uint32_t scansTotal = 0, alertsTotal = 0, allowedTotal = 0, deniedTotal = 0;

  void startScreening() {
    Proto::flow("F", "F_PRESENT");
    Proto::flow("F", "F_SCAN");
    int raw = analogRead(PIN_POT_METAL);
    lastSignalPct = (raw / 4095.0f) * 100.0f;
    scansTotal++;
    bool detected = lastSignalPct >= thresholdPct;
    Proto::flow("F", "F_DETECTED", detected ? "YES" : "NO");

    if (!detected) {
      Proto::flow("F", "F_CLEAR");
      sendScreeningEvent("clear");
      return;
    }

    alertsTotal++;
    Proto::flow("F", "F_BUZZER");
    indicators.beep(3, 120, 120);
    Proto::flow("F", "F_WARNING");
    Proto::flow("F", "F_NOTIFY");
    Proto::flow("F", "F_VERIFY");
    state = HOLD;
    holdDeadline = millis() + Defaults::SCREENING_HOLD_TIMEOUT_MS;
    sendScreeningEvent("hold");
  }

  void resolveScreening(bool allow, const String &reason) {
    Proto::flow("F", "F_ALLOWED", allow ? "YES" : "NO");
    if (allow) {
      Proto::flow("F", "F_ALLOW");
      allowedTotal++;
    } else {
      Proto::flow("F", "F_DENY");
      deniedTotal++;
    }
    Proto::flow("F", "F_END");
    state = IDLE;
    sendScreeningEvent(allow ? "allowed" : "denied", reason);
  }

  void sendScreeningEvent(const String &result, const String &reason = "") {
    JsonDocument doc = Proto::begin("screening");
    doc["result"] = result;
    doc["signal_pct"] = lastSignalPct;
    doc["threshold_pct"] = thresholdPct;
    if (reason.length()) doc["reason"] = reason;
    doc["scans"] = scansTotal;
    doc["alerts"] = alertsTotal;
    doc["allowed"] = allowedTotal;
    doc["denied"] = deniedTotal;
    doc["ts"] = simClock.hhmm();
    Proto::send(doc);
  }
};

MetalDetectorModule metalDetector;
