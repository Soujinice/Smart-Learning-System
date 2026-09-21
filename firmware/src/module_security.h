// Module D - Security & Fire.
// Reads the MQ-2 smoke/gas sensor (GF-06 Cafeteria), the flame sensor
// fallback (see README - Wokwi has no native flame-sensor part, so a slide
// switch labeled FLAME stands in for it), and the shared PIR (SF-03) for
// building-hours intrusion detection. Implements a five-level smoke scale
// with false-alarm rejection before ever calling into module G.
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <functional>
#include "config.h"
#include "protocol.h"
#include "indicators.h"
#include "simclock.h"
#include "module_smartroom.h"

class SecurityModule {
public:
  enum SmokeLevel { L0_NORMAL, L1_WATCH, L2_WARNING, L3_DANGER, L4_EMERGENCY };

  std::function<void(const String &reason)> onConfirmedEmergency; // -> module G
  std::function<void()> onManualPull;                              // -> module G (bypasses D)

  void begin() {
    pinMode(PIN_FLAME_DO, INPUT);
    pinMode(PIN_BTN_PULL_STATION, INPUT_PULLUP);
    lastTempSampleC = smartRoom.temperature();
    lastTempSampleMs = millis();
  }

  void loop() {
    handlePullStation();

    unsigned long now = millis();
    if (now - lastTick >= TICK_MS) {
      lastTick = now;
      evaluateSmoke();
      evaluatePir();
    }

    if (verifying && now - lastVerifyCheck >= Defaults::VERIFY_WINDOW_MS) {
      lastVerifyCheck = now;
      runVerificationCycle();
    }
  }

  bool isBelowWarning() const { return level < L2_WARNING; }
  SmokeLevel currentLevel() const { return level; }
  float smokePct() const { return smokePercent; }
  bool flameActive() const { return flameOn; }
  bool intrusionActive() const { return intrusion; }
  bool presenceActive() const { return pirOn; }
  uint32_t falseAlarmCount() const { return falseAlarms; }

  void setThresholds(float l1, float l2, float l3, float l4) {
    thL1 = l1; thL2 = l2; thL3 = l3; thL4 = l4;
  }

  void handleCommand(const String &type, JsonObjectConst payload) {
    if (type == "set_thresholds") {
      if (payload["smoke_l1"].is<float>()) thL1 = payload["smoke_l1"].as<float>();
      if (payload["smoke_l2"].is<float>()) thL2 = payload["smoke_l2"].as<float>();
      if (payload["smoke_l3"].is<float>()) thL3 = payload["smoke_l3"].as<float>();
      if (payload["smoke_l4"].is<float>()) thL4 = payload["smoke_l4"].as<float>();
      Proto::ack(type, true);
    } else {
      Proto::ack(type, false, "unknown security command");
    }
  }

private:
  static const unsigned long TICK_MS = 250;
  unsigned long lastTick = 0;

  SmokeLevel level = L0_NORMAL;
  float smokePercent = 5.0f;
  float smokeBuf[5] = {5, 5, 5, 5, 5};
  uint8_t smokeBufIdx = 0;

  bool flameOn = false;
  unsigned long flameSince = 0;

  float thL1 = Defaults::SMOKE_L1_WATCH, thL2 = Defaults::SMOKE_L2_WARNING,
        thL3 = Defaults::SMOKE_L3_DANGER, thL4 = Defaults::SMOKE_L4_EMERGENCY;
  uint8_t aboveL2Count = 0;

  bool verifying = false;
  unsigned long lastVerifyCheck = 0;
  unsigned long l3SustainedSince = 0;

  float lastTempSampleC = 24.0f;
  unsigned long lastTempSampleMs = 0;
  float tempRiseRateCPerMin = 0.0f;

  uint32_t falseAlarms = 0;

  bool pirOn = false;
  bool intrusion = false;
  unsigned long lastMotionMs = 0;
  bool pullDown = false;

  void handlePullStation() {
    bool pressed = digitalRead(PIN_BTN_PULL_STATION) == LOW;
    if (pressed && !pullDown) {
      pullDown = true;
      Proto::log("Manual fire pull station activated at Main Entrance");
      if (onManualPull) onManualPull();
    } else if (!pressed) {
      pullDown = false;
    }
  }

  float readSmokeAveraged() {
    int raw = analogRead(PIN_MQ2_AOUT);
    float pct = (raw / 4095.0f) * 100.0f;
    smokeBuf[smokeBufIdx] = pct;
    smokeBufIdx = (smokeBufIdx + 1) % 5;
    float sum = 0;
    for (float v : smokeBuf) sum += v;
    return sum / 5.0f;
  }

  void updateTempRiseRate() {
    unsigned long now = millis();
    float t = smartRoom.temperature();
    float dtMin = (now - lastTempSampleMs) / 60000.0f;
    if (dtMin > 0.05f) { // avoid divide-by-near-zero on the first samples
      tempRiseRateCPerMin = (t - lastTempSampleC) / dtMin;
      lastTempSampleC = t;
      lastTempSampleMs = now;
    }
  }

  void evaluateSmoke() {
    Proto::flow("D", "D_DETECT");
    smokePercent = readSmokeAveraged();
    flameOn = digitalRead(PIN_FLAME_DO) == HIGH;
    if (flameOn) {
      if (flameSince == 0) flameSince = millis();
    } else {
      flameSince = 0;
    }
    updateTempRiseRate();

    Proto::flow("D", "D_READ_LEVEL");
    Proto::flow("D", "D_COMPARE");

    bool aboveWarn = smokePercent >= thL2 || flameOn;
    Proto::flow("D", "D_ABOVE_WARN", aboveWarn ? "YES" : "NO");

    if (!aboveWarn) {
      aboveL2Count = 0;
      l3SustainedSince = 0;
      if (verifying) {
        // condition cleared before the verification window elapsed
        verifying = false;
        logFalseAlarm("condition cleared before verification window elapsed");
      }
      setLevel(smokePercent >= thL1 ? L1_WATCH : L0_NORMAL);
      indicators.setLevel(Indicators::LEVEL_NORMAL);
      return;
    }

    aboveL2Count++;
    if (aboveL2Count < Defaults::SMOKE_CONFIRM_SAMPLES) return; // debounce noise

    Proto::flow("D", "D_WARNING");
    setLevel(smokePercent >= thL3 ? L3_DANGER : L2_WARNING);
    indicators.setLevel(smokePercent >= thL3 ? Indicators::LEVEL_WARNING : Indicators::LEVEL_WARNING);
    if (level == L3_DANGER) {
      indicators.beep(1, 200, 200); // intermittent pre-alert buzzer
      if (l3SustainedSince == 0) l3SustainedSince = millis();
    } else {
      l3SustainedSince = 0;
    }

    Proto::flow("D", "D_DISPLAY_WARNING");

    if (!verifying) {
      verifying = true;
      lastVerifyCheck = millis();
      Proto::flow("D", "D_MONITOR");
    }

    // A hard confirmation can fire immediately, without waiting on the next
    // verification cycle, so a real fire is never delayed by the window.
    checkImmediateConfirmation();
  }

  void checkImmediateConfirmation() {
    if (confirmationSatisfied()) {
      confirmEmergency();
    }
  }

  bool confirmationSatisfied() {
    bool smokeL3Sustained = level == L3_DANGER && l3SustainedSince != 0 &&
                             (millis() - l3SustainedSince) >= Defaults::VERIFY_WINDOW_MS;
    bool flameWithSmokeL2 = flameOn && smokePercent >= thL2;
    bool flameSustained = flameOn && flameSince != 0 &&
                           (millis() - flameSince) >= Defaults::FLAME_SUSTAIN_MS;
    bool rapidRise = tempRiseRateCPerMin >= Defaults::TEMP_RISE_LIMIT_C_PER_MIN;
    return smokeL3Sustained || flameWithSmokeL2 || flameSustained || rapidRise;
  }

  void runVerificationCycle() {
    if (!verifying) return;
    Proto::flow("D", "D_MONITOR");

    bool persists = smokePercent >= thL2 || flameOn;
    Proto::flow("D", "D_PERSISTS", (persists && confirmationSatisfied()) ? "YES" : "NO");

    if (confirmationSatisfied()) {
      confirmEmergency();
      return;
    }

    if (!persists) {
      verifying = false;
      logFalseAlarm("smoke/flame reading dropped below warning level within the verification window");
      setLevel(L1_WATCH);
      indicators.setLevel(Indicators::LEVEL_NORMAL);
      return;
    }

    // Still elevated but not yet confirmed: log a possible-false-alarm note
    // and keep monitoring, exactly as the flowchart's loop back into
    // "Continue Monitoring / Verification" shows.
    logFalseAlarm("condition persists but has not met an emergency confirmation rule yet");
  }

  void confirmEmergency() {
    verifying = false;
    setLevel(L4_EMERGENCY);
    indicators.setLevel(Indicators::LEVEL_EMERGENCY);
    Proto::flow("D", "D_CONFIRMED", "YES");
    Proto::flow("D", "D_SEND_SIGNAL");

    String reason = "Confirmed fire/smoke emergency (smoke " + String(smokePercent, 0) + "%, flame " +
                     String(flameOn ? "detected" : "clear") + ")";
    if (onConfirmedEmergency) onConfirmedEmergency(reason);
  }

  void logFalseAlarm(const String &reasonDetail) {
    falseAlarms++;
    Proto::flow("D", "D_FALSE_ALARM");
    Proto::flow("D", "D_LOG_WARNING");
    JsonDocument doc = Proto::begin("false_alarm");
    doc["count"] = falseAlarms;
    doc["smoke_pct"] = smokePercent;
    doc["flame"] = flameOn;
    doc["reason"] = reasonDetail;
    doc["ts"] = simClock.hhmm();
    Proto::send(doc);
  }

  void setLevel(SmokeLevel lvl) { level = lvl; }

  void evaluatePir() {
    bool motion = digitalRead(PIN_PIR) == HIGH;
    if (motion) lastMotionMs = millis();
    pirOn = motion;

    bool afterHours = !simClock.withinBuildingHours();
    bool newIntrusion = motion && afterHours;
    if (newIntrusion && !intrusion) {
      intrusion = true;
      JsonDocument doc = Proto::begin("alert");
      doc["module"] = "D";
      doc["severity"] = "warning";
      doc["message"] = "Motion detected outside building hours near SF-03 - possible intrusion";
      doc["ts"] = simClock.hhmm();
      Proto::send(doc);
    } else if (!motion) {
      intrusion = false;
    }
  }
};

SecurityModule security;
