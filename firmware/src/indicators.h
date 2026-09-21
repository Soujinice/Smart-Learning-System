// Smart Learning Center - shared LED/buzzer indicator driver.
// Non-blocking: a small state machine drives buzzer beep sequences and the
// emergency flash pattern so no module ever calls delay().
#pragma once

#include <Arduino.h>
#include "config.h"

class Indicators {
public:
  enum Level { LEVEL_NORMAL, LEVEL_WARNING, LEVEL_EMERGENCY };

  void begin() {
    pinMode(PIN_LED_GREEN, OUTPUT);
    pinMode(PIN_LED_YELLOW, OUTPUT);
    pinMode(PIN_LED_RED, OUTPUT);
    pinMode(PIN_BUZZER, OUTPUT);
    digitalWrite(PIN_BUZZER, LOW);
    setLevel(LEVEL_NORMAL);
  }

  void setLevel(Level lvl) { level = lvl; }
  void setAlarm(bool active) { alarmActive = active; }
  bool isAlarming() const { return alarmActive; }

  // Queues `count` short beeps (used for access-denied double-buzz, metal
  // detector alerts, etc). Ignored while the full emergency alarm pattern
  // is active since that pattern already drives the buzzer continuously.
  void beep(uint8_t count, uint16_t onMs = 150, uint16_t offMs = 150) {
    if (alarmActive) return;
    buzzTarget = count;
    buzzOnMs = onMs;
    buzzOffMs = offMs;
    buzzesDone = 0;
    buzzing = true;
    buzzState = true;
    digitalWrite(PIN_BUZZER, HIGH);
    buzzNextToggle = millis() + buzzOnMs;
  }

  void loop() {
    unsigned long now = millis();

    if (alarmActive) {
      bool on = ((now / 250) % 2) == 0;
      digitalWrite(PIN_LED_RED, on ? HIGH : LOW);
      digitalWrite(PIN_LED_YELLOW, LOW);
      digitalWrite(PIN_LED_GREEN, LOW);
      digitalWrite(PIN_BUZZER, on ? HIGH : LOW);
      buzzing = false;
      return;
    }

    digitalWrite(PIN_LED_GREEN, level == LEVEL_NORMAL ? HIGH : LOW);
    digitalWrite(PIN_LED_YELLOW, level == LEVEL_WARNING ? HIGH : LOW);
    digitalWrite(PIN_LED_RED, level == LEVEL_EMERGENCY ? HIGH : LOW);

    if (buzzing && now >= buzzNextToggle) {
      buzzState = !buzzState;
      digitalWrite(PIN_BUZZER, buzzState ? HIGH : LOW);
      if (buzzState) {
        buzzNextToggle = now + buzzOnMs;
      } else {
        buzzesDone++;
        buzzNextToggle = now + buzzOffMs;
        if (buzzesDone >= buzzTarget) {
          buzzing = false;
          digitalWrite(PIN_BUZZER, LOW);
        }
      }
    }
  }

private:
  Level level = LEVEL_NORMAL;
  bool alarmActive = false;

  bool buzzing = false;
  bool buzzState = false;
  uint8_t buzzTarget = 0;
  uint8_t buzzesDone = 0;
  uint16_t buzzOnMs = 150;
  uint16_t buzzOffMs = 150;
  unsigned long buzzNextToggle = 0;
};

Indicators indicators;
