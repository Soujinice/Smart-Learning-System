// Module H - Waste Management (physical bin: Main Lobby, GF-01).
// HC-SR04 measures distance-to-trash, converted to a fill percentage.
// Other bins shown on the dashboard (Cafeteria, Library, Corridors) have no
// hardware and are simulated by the server - badged SIMULATED there.
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"
#include "protocol.h"
#include "simclock.h"

class WasteModule {
public:
  void begin() {
    pinMode(PIN_HCSR04_TRIG, OUTPUT);
    pinMode(PIN_HCSR04_ECHO, INPUT);
    digitalWrite(PIN_HCSR04_TRIG, LOW);
  }

  void loop() {
    unsigned long now = millis();
    if (now - lastTick < TICK_MS) return;
    lastTick = now;

    Proto::flow("H", "H_SENSOR");
    float distanceCm = readDistanceCm();
    Proto::flow("H", "H_READ");

    if (distanceCm > 0) {
      float pct = (1.0f - (distanceCm / binDepthCm)) * 100.0f;
      if (pct < 0) pct = 0;
      if (pct > 100) pct = 100;
      fillBuf[fillBufIdx] = pct;
      fillBufIdx = (fillBufIdx + 1) % 5;
      float sum = 0;
      for (float v : fillBuf) sum += v;
      fillPct = sum / 5.0f;
    }

    Proto::flow("H", "H_COMPARE");
    bool full = fillPct >= fullThresholdPct;
    Proto::flow("H", "H_FULL", full ? "YES" : "NO");

    if (!full) {
      fullSince = 0;
      if (state == FULL) state = NORMAL; // the physical level actually dropped
      Proto::flow("H", "H_DISPLAY_NORMAL");
      sendReading();
      return;
    }

    if (fullSince == 0) fullSince = now;
    if (now - fullSince < FULL_SUSTAIN_MS) {
      Proto::flow("H", "H_DISPLAY_NORMAL");
      sendReading();
      return;
    }

    if (state != FULL) {
      state = FULL;
      Proto::flow("H", "H_ALERT");
      Proto::flow("H", "H_DISPLAY_FULL");
      Proto::flow("H", "H_NOTIFY");
      sendAlert();
    }
    sendReading();
  }

  void markCollected(bool adminOverride) {
    Proto::flow("H", "H_COLLECTION");
    if (adminOverride || fillPct < fullThresholdPct) {
      Proto::flow("H", "H_RESET");
      Proto::flow("H", "H_END");
      state = NORMAL;
      fullSince = 0;
      if (adminOverride) {
        for (float &v : fillBuf) v = 10.0f;
        fillPct = 10.0f;
      }
      sendReading("collected");
    } else {
      Proto::log("Waste: mark-collected requested but the bin still reads full; use the admin override to force a reset");
    }
  }

  float fillPercent() const { return fillPct; }
  bool isFull() const { return state == FULL; }

  void handleCommand(const String &type, JsonObjectConst payload) {
    if (type == "waste_collect") {
      markCollected(payload["admin_override"].as<bool>());
      Proto::ack(type, true);
    } else if (type == "set_thresholds") {
      if (payload["bin_depth_cm"].is<float>()) binDepthCm = payload["bin_depth_cm"].as<float>();
      if (payload["waste_filling_pct"].is<float>()) fillingThresholdPct = payload["waste_filling_pct"].as<float>();
      if (payload["waste_full_pct"].is<float>()) fullThresholdPct = payload["waste_full_pct"].as<float>();
      Proto::ack(type, true);
    } else {
      Proto::ack(type, false, "unknown waste command");
    }
  }

private:
  enum State { NORMAL, FULL } state = NORMAL;
  float binDepthCm = Defaults::BIN_DEPTH_CM;
  float fillingThresholdPct = Defaults::WASTE_FILLING_PCT;
  float fullThresholdPct = Defaults::WASTE_FULL_PCT;
  float fillPct = 15.0f;
  float fillBuf[5] = { 15, 15, 15, 15, 15 };
  uint8_t fillBufIdx = 0;
  unsigned long fullSince = 0;
  unsigned long lastTick = 0;
  static const unsigned long TICK_MS = 1000;
  static const unsigned long FULL_SUSTAIN_MS = 3000;

  float readDistanceCm() {
    digitalWrite(PIN_HCSR04_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(PIN_HCSR04_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_HCSR04_TRIG, LOW);
    unsigned long duration = pulseIn(PIN_HCSR04_ECHO, HIGH, 30000UL);
    if (duration == 0) return -1;
    return duration / 58.0f;
  }

  void sendAlert() {
    JsonDocument doc = Proto::begin("alert");
    doc["module"] = "H";
    doc["room"] = "GF-01";
    doc["severity"] = "warning";
    doc["message"] = "Main Lobby waste bin is full (" + String((int)fillPct) + "%)";
    doc["ts"] = simClock.hhmm();
    Proto::send(doc);
  }

  void sendReading(const String &state_ = "") {
    JsonDocument w = Proto::begin("waste");
    w["bin_id"] = "lobby-main";
    w["room"] = "GF-01";
    w["fill_pct"] = fillPct;
    w["state"] = state_.length() ? state_ : (isFull() ? "full" : "normal");
    w["live"] = true;
    w["ts"] = simClock.hhmm();
    Proto::send(w);
  }
};

WasteModule waste;
