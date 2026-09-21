// Module C - Environment.
// Building-wide environmental monitoring. The only physical readings come
// from the SF-03 DHT22 (shared with module B, read there to avoid driving
// the same one-wire-style sensor from two places) and the MQ-2 gas sensor,
// which also yields a simple derived air-quality index. Other zones shown
// on the Environment dashboard page are virtual nodes simulated server-side.
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"
#include "protocol.h"
#include "simclock.h"
#include "module_smartroom.h"

class EnvironmentModule {
public:
  void begin() {}

  void loop() {
    unsigned long now = millis();
    if (now - lastTick < TICK_MS) return;
    lastTick = now;

    Proto::flow("C", "C_SENSOR");
    Proto::flow("C", "C_READ");

    float temp = smartRoom.temperature();
    float hum = smartRoom.humidity();
    int smokeRaw = analogRead(PIN_MQ2_AOUT);
    float smokePct = (smokeRaw / 4095.0f) * 100.0f;
    aqi = smokePct * 5.0f;
    if (aqi > 500) aqi = 500;

    Proto::flow("C", "C_PROCESS");

    bool abnormal = (temp < tempMin || temp > tempMax || hum < humMin || hum > humMax);
    Proto::flow("C", "C_NORMAL", abnormal ? "NO" : "YES");

    if (!abnormal) {
      Proto::flow("C", "C_DISPLAY_STATUS");
    } else {
      Proto::flow("C", "C_GEN_WARNING");
      Proto::flow("C", "C_SEND_ALERT");
      Proto::flow("C", "C_DISPLAY_ALERT");
      sendAlert(temp, hum);
    }
  }

  void setThresholds(float tMin, float tMax, float hMin, float hMax) {
    tempMin = tMin; tempMax = tMax; humMin = hMin; humMax = hMax;
  }

  float airQualityIndex() const { return aqi; }

  void handleCommand(const String &type, JsonObjectConst payload) {
    if (type == "set_thresholds") {
      if (payload["env_temp_min"].is<float>()) tempMin = payload["env_temp_min"].as<float>();
      if (payload["env_temp_max"].is<float>()) tempMax = payload["env_temp_max"].as<float>();
      if (payload["env_hum_min"].is<float>()) humMin = payload["env_hum_min"].as<float>();
      if (payload["env_hum_max"].is<float>()) humMax = payload["env_hum_max"].as<float>();
      Proto::ack(type, true);
    } else {
      Proto::ack(type, false, "unknown environment command");
    }
  }

private:
  float tempMin = Defaults::TEMP_MIN_C, tempMax = Defaults::TEMP_MAX_C;
  float humMin = Defaults::HUMIDITY_MIN_PCT, humMax = Defaults::HUMIDITY_MAX_PCT;
  float aqi = 35.0f;
  unsigned long lastTick = 0;
  static const unsigned long TICK_MS = 3000;

  void sendAlert(float temp, float hum) {
    JsonDocument doc = Proto::begin("alert");
    doc["module"] = "C";
    doc["room"] = "SF-03";
    doc["severity"] = "warning";
    doc["message"] = "Environmental condition out of range (temp " + String(temp, 1) +
                      "C, humidity " + String(hum, 1) + "%)";
    doc["ts"] = simClock.hhmm();
    Proto::send(doc);
  }
};

EnvironmentModule environment;
