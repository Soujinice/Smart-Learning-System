// Module A - RFID / Attendance.
// Wokwi has no native RC522/PN532 part, so RFID is simulated two ways:
//   1. Three pushbuttons (CARD1 = registered student, CARD2 = registered
//      faculty, CARD3 = an unregistered/invalid card).
//   2. Virtual taps sent from the website (source "web"), e.g. tapping any
//      of the registered users shown in the Attendance & RFID page.
// Both paths feed the same handler, exactly like a real reader would.
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <functional>
#include "config.h"
#include "protocol.h"
#include "indicators.h"
#include "simclock.h"

struct RegisteredUser {
  String uid;
  String name;
  String role; // student | faculty
  String room;
};

class RfidModule {
public:
  static const uint8_t MAX_USERS = 32;

  // Wired by main.cpp: true while the entrance is in a metal-detector
  // screening hold (acceptance test 6 - CARD taps must not unlock then).
  std::function<bool()> isEntranceOnHold;
  // Wired by main.cpp: pulses the door servo open for Defaults::DOOR_UNLOCK_MS.
  std::function<void()> pulseDoorUnlock;
  // Wired by main.cpp: true while the building-wide emergency override is
  // active - RFID checks are bypassed entirely (doors already unlocked).
  std::function<bool()> isEmergencyOverrideActive;
  // Wired by main.cpp: notifies module B when a granted tap belongs to the
  // room it is currently tracking, so the smart-room flowchart's attendance
  // nodes (B_ATTEND_TAG..B_ATTEND_RECORDED) fire at the right moment.
  std::function<void(const String &room, const String &name, const String &role)> onAttendanceGranted;

  void begin() {
    pinMode(PIN_BTN_CARD1, INPUT_PULLUP);
    pinMode(PIN_BTN_CARD2, INPUT_PULLUP);
    pinMode(PIN_BTN_CARD3, INPUT_PULLUP);
    seedDefaultUsers();
  }

  void seedDefaultUsers() {
    userCount = 0;
    addUser("04A3C1B2", "Juan Miguel Dela Cruz", "student", "SF-03");
    addUser("04B7E2F1", "Prof. Ramon Reyes", "faculty", "SF-03");
    addUser("04C9D4A0", "Maria Clara Santos", "student", "SF-05");
  }

  bool addUser(const String &uid, const String &name, const String &role, const String &room = "") {
    for (uint8_t i = 0; i < userCount; i++) {
      if (users[i].uid == uid) {
        users[i].name = name;
        users[i].role = role;
        users[i].room = room;
        return true;
      }
    }
    if (userCount >= MAX_USERS) return false;
    users[userCount++] = { uid, name, role, room };
    return true;
  }

  void syncUsers(JsonArrayConst arr) {
    userCount = 0;
    for (JsonObjectConst o : arr) {
      if (userCount >= MAX_USERS) break;
      addUser(o["uid"].as<String>(), o["name"].as<String>(), o["role"].as<String>(),
              o["room"].as<String>());
    }
    Proto::log("RFID: registry synced (" + String(userCount) + " users)");
  }

  void loop() {
    handleButton(PIN_BTN_CARD1, btn1Down, "04A3C1B2");
    handleButton(PIN_BTN_CARD2, btn2Down, "04B7E2F1");
    handleButton(PIN_BTN_CARD3, btn3Down, "FFFFFFFF"); // intentionally unregistered
  }

  void handleWebTap(const String &uid) {
    processTap(uid, "web");
  }

  void handleCommand(const String &type, JsonObjectConst payload) {
    if (type == "sync_users") {
      syncUsers(payload["users"].as<JsonArrayConst>());
      Proto::ack(type, true);
    } else if (type == "rfid_tap") {
      handleWebTap(payload["uid"].as<String>());
      Proto::ack(type, true);
    } else {
      Proto::ack(type, false, "unknown rfid command");
    }
  }

private:
  RegisteredUser users[MAX_USERS];
  uint8_t userCount = 0;

  bool btn1Down = false, btn2Down = false, btn3Down = false;
  String lastUid;
  unsigned long lastTapMs = 0;

  void handleButton(uint8_t pin, bool &downState, const char *uid) {
    bool pressed = digitalRead(pin) == LOW;
    if (pressed && !downState) {
      downState = true;
      processTap(String(uid), "button");
    } else if (!pressed) {
      downState = false;
    }
  }

  int findUser(const String &uid) {
    for (uint8_t i = 0; i < userCount; i++) {
      if (users[i].uid == uid) return i;
    }
    return -1;
  }

  void processTap(const String &uid, const String &source) {
    if (isEmergencyOverrideActive && isEmergencyOverrideActive()) {
      // Flowchart G: during an active override all smart doors are already
      // unlocked and RFID locks are bypassed - still log the tap.
      sendRfidEvent(uid, source, "bypassed_emergency", "", "", "");
      return;
    }

    Proto::flow("A", "A_START");
    Proto::flow("A", "A_READER");
    Proto::flow("A", "A_PROCESS");

    if (uid == lastUid && (millis() - lastTapMs) < Defaults::DUPLICATE_TAP_WINDOW_MS) {
      sendRfidEvent(uid, source, "duplicate", "", "", "");
      return;
    }
    lastUid = uid;
    lastTapMs = millis();

    int idx = findUser(uid);
    Proto::flow("A", "A_CHECK", idx >= 0 ? "YES" : "NO");

    if (idx < 0) {
      Proto::flow("A", "A_INVALID");
      indicators.beep(2, 150, 150);
      sendRfidEvent(uid, source, "denied", "", "", "");
      return;
    }

    bool onHold = isEntranceOnHold && isEntranceOnHold();

    Proto::flow("A", "A_RECORD");
    Proto::flow("A", "A_DATA");
    Proto::flow("A", "A_DB");
    Proto::flow("A", "A_REGISTRAR");
    Proto::flow("A", "A_END");

    sendRfidEvent(uid, source, onHold ? "granted_hold" : "granted",
                  users[idx].name, users[idx].role, users[idx].room);

    if (!onHold && pulseDoorUnlock) {
      pulseDoorUnlock();
    }
  }

  void sendRfidEvent(const String &uid, const String &source, const String &result,
                      const String &name, const String &role, const String &room) {
    JsonDocument doc = Proto::begin("rfid");
    doc["uid"] = uid;
    doc["source"] = source;
    doc["result"] = result;
    doc["name"] = name;
    doc["role"] = role;
    doc["room"] = room;
    doc["ts"] = simClock.hhmm();
    Proto::send(doc);

    if (result == "granted" || result == "granted_hold") {
      JsonDocument att = Proto::begin("attendance");
      att["uid"] = uid;
      att["name"] = name;
      att["role"] = role;
      att["room"] = room.length() ? room : "Main Entrance";
      att["ts"] = simClock.hhmm();
      att["source"] = source;
      Proto::send(att);

      if (onAttendanceGranted) onAttendanceGranted(att["room"].as<String>(), name, role);
    }
  }
};

RfidModule rfidModule;
