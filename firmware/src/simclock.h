// Smart Learning Center - simulated building clock.
// Real time would make a class schedule impossible to demonstrate in a
// short presentation, so the firmware keeps its own time-of-day that runs
// at a configurable multiple of real time (default: 1 real second = 1
// simulated minute) and can be jumped directly to any time-of-day from the
// dashboard's "sim clock" controls.
#pragma once

#include <Arduino.h>
#include "config.h"

class SimClock {
public:
  void begin(uint16_t startMinutes = 7 * 60) {
    minutesOfDay = startMinutes % 1440;
    lastMillis = millis();
    accumulatorMs = 0;
  }

  void loop() {
    unsigned long now = millis();
    unsigned long elapsed = now - lastMillis;
    lastMillis = now;
    accumulatorMs += elapsed;
    while (accumulatorMs >= 1000UL) {
      accumulatorMs -= 1000UL;
      minutesOfDay = (minutesOfDay + scaleMinutesPerRealSecond) % 1440;
    }
  }

  void setScale(uint32_t minutesPerRealSecond) {
    if (minutesPerRealSecond < 1) minutesPerRealSecond = 1;
    scaleMinutesPerRealSecond = minutesPerRealSecond;
  }

  uint32_t scale() const { return scaleMinutesPerRealSecond; }

  void jumpTo(uint16_t minutes) { minutesOfDay = minutes % 1440; }

  uint16_t minutesOfDayValue() const { return minutesOfDay; }
  uint8_t hour() const { return minutesOfDay / 60; }
  uint8_t minute() const { return minutesOfDay % 60; }

  bool withinBuildingHours() const {
    return minutesOfDay >= Defaults::BUILDING_OPEN_MIN &&
           minutesOfDay < Defaults::BUILDING_CLOSE_MIN;
  }

  String hhmm() const {
    char buf[6];
    snprintf(buf, sizeof(buf), "%02u:%02u", hour(), minute());
    return String(buf);
  }

private:
  uint16_t minutesOfDay = 7 * 60;
  uint32_t scaleMinutesPerRealSecond = Defaults::SIM_MINUTES_PER_REAL_SECOND;
  unsigned long lastMillis = 0;
  unsigned long accumulatorMs = 0;
};

SimClock simClock;
