// Digital Information Displays - two 20x4 I2C character LCDs (Wokwi part
// "wokwi-lcd2004", library LiquidCrystal_I2C) sharing one I2C bus at
// different addresses, same as wiring two real I2C LCD backpacks together:
//   - Main Lobby (GF-01), address 0x27: rotates every 3s through one page
//     per currently-enabled module (plus an always-on building-status
//     page).
//   - Smart Classroom 1 (SF-03), address 0x28: a dedicated room display -
//     always shows live temp/humidity/motion/class state for that room.
// A full-screen alert page takes over on BOTH displays while module G is
// PENDING (awaiting admin confirmation) or ACTIVE (confirmed override).
#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include "config.h"

struct DisplaySnapshot {
  String simTime;
  bool emergencyPending = false; // module G: sensor-confirmed, awaiting admin
  bool emergencyActive = false;  // module G: admin-confirmed override engaged
  String emergencyState = "IDLE";

  float smokePct = 0; uint8_t smokeLevel = 0;
  float roomTempC = 24; float roomHumPct = 55; bool roomMotion = false;
  String smartRoomState = "STANDBY";
  uint32_t roomAttendance = 0;

  uint32_t attendanceToday = 0;
  int doorsUnlocked = 0; int doorsTotal = 1;

  bool wifiConnected = false; int rssi = 0; String ip;
  uint8_t blockedHosts = 0;

  float wastePct = 0; bool wasteFull = false;

  // Which modules are currently enabled (see main.cpp ModuleFlags) - the
  // matching LCD page is skipped in rotation when its module is off. The
  // SF-03 room display always shows regardless (it's just one page).
  bool rfidEnabled = true;
  bool securityEnabled = true;
  bool networkEnabled = true;
  bool wasteEnabled = true;
};

class DisplayModule {
public:
  bool begin() {
    Wire.begin(PIN_LCD_SDA, PIN_LCD_SCL);
    lcdLobby.init();
    lcdLobby.backlight();
    lcdRoom.init();
    lcdRoom.backlight();
    line(lcdLobby, 0, "Smart Learning Ctr");
    line(lcdLobby, 1, "Booting...");
    line(lcdRoom, 0, "SF-03 Classroom");
    line(lcdRoom, 1, "Booting...");
    ready = true; // the LCD2004 has no I2C-ack probe in this library; assume present
    return ready;
  }

  void loop(const DisplaySnapshot &snap) {
    if (!ready) return;

    if (snap.emergencyActive) { drawActive(lcdLobby, snap); drawActive(lcdRoom, snap); return; }
    if (snap.emergencyPending) { drawPending(lcdLobby, snap); drawPending(lcdRoom, snap); return; }

    drawRoom(snap); // SF-03 display: always live, no rotation needed

    uint8_t activePages[5];
    uint8_t activeCount = 0;
    activePages[activeCount++] = 0; // building status - always shown
    if (snap.rfidEnabled) activePages[activeCount++] = 1;
    if (snap.securityEnabled) activePages[activeCount++] = 2;
    if (snap.networkEnabled) activePages[activeCount++] = 3;
    if (snap.wasteEnabled) activePages[activeCount++] = 4;

    unsigned long now = millis();
    if (now - lastSwitch >= 3000) {
      lastSwitch = now;
      pageIndex = (pageIndex + 1) % activeCount;
    }
    if (pageIndex >= activeCount) pageIndex = 0;

    switch (activePages[pageIndex]) {
      case 0: drawBuilding(snap); break;
      case 1: drawAccess(snap); break;
      case 2: drawSecurity(snap); break;
      case 3: drawNetwork(snap); break;
      case 4: drawWaste(snap); break;
    }
  }

private:
  LiquidCrystal_I2C lcdLobby { 0x27, 20, 4 }; // Main Lobby - GF-01
  LiquidCrystal_I2C lcdRoom { 0x28, 20, 4 };  // Smart Classroom 1 - SF-03
  bool ready = false;
  uint8_t pageIndex = 0;
  unsigned long lastSwitch = 0;

  // Writes exactly 20 characters to a row (space-padded/truncated) so stale
  // characters from a longer previous line never linger on screen.
  void line(LiquidCrystal_I2C &target, uint8_t row, const String &text) {
    String padded = text;
    if (padded.length() > 20) padded = padded.substring(0, 20);
    while (padded.length() < 20) padded += ' ';
    target.setCursor(0, row);
    target.print(padded);
  }

  void drawBuilding(const DisplaySnapshot &s) {
    line(lcdLobby, 0, "BUILDING STATUS");
    line(lcdLobby, 1, "Doors: " + String(s.doorsUnlocked) + "/" + String(s.doorsTotal));
    line(lcdLobby, 2, "Attendance: " + String(s.attendanceToday));
    line(lcdLobby, 3, "Time " + s.simTime);
  }

  void drawRoom(const DisplaySnapshot &s) {
    line(lcdRoom, 0, "SF-03 CLASSROOM");
    line(lcdRoom, 1, "Temp: " + String(s.roomTempC, 1) + "C  Hum:" + String(s.roomHumPct, 0) + "%");
    line(lcdRoom, 2, "Room: " + s.smartRoomState + "  Mot:" + (s.roomMotion ? "Y" : "N"));
    line(lcdRoom, 3, "Attend: " + String(s.roomAttendance) + "  " + s.simTime);
  }

  void drawAccess(const DisplaySnapshot &s) {
    line(lcdLobby, 0, "ACCESS / ATTENDANCE");
    line(lcdLobby, 1, "Today: " + String(s.attendanceToday));
    line(lcdLobby, 2, s.doorsUnlocked > 0 ? "Door: UNLOCKED" : "Door: locked");
    line(lcdLobby, 3, "Time " + s.simTime);
  }

  void drawSecurity(const DisplaySnapshot &s) {
    line(lcdLobby, 0, "SECURITY & FIRE");
    line(lcdLobby, 1, "Smoke level: L" + String(s.smokeLevel));
    line(lcdLobby, 2, "Smoke: " + String(s.smokePct, 0) + "%");
    line(lcdLobby, 3, "Time " + s.simTime);
  }

  void drawNetwork(const DisplaySnapshot &s) {
    line(lcdLobby, 0, "NETWORK / FIREWALL");
    line(lcdLobby, 1, s.wifiConnected ? ("WAN: OK " + String(s.rssi) + "dBm") : "WAN: offline");
    line(lcdLobby, 2, "Blocked: " + String(s.blockedHosts));
    line(lcdLobby, 3, "Time " + s.simTime);
  }

  void drawWaste(const DisplaySnapshot &s) {
    line(lcdLobby, 0, "WASTE - MAIN LOBBY");
    line(lcdLobby, 1, "Fill: " + String(s.wastePct, 0) + "%");
    line(lcdLobby, 2, s.wasteFull ? "STATUS: BIN FULL" : "STATUS: normal");
    line(lcdLobby, 3, "Time " + s.simTime);
  }

  void drawPending(LiquidCrystal_I2C &target, const DisplaySnapshot &s) {
    line(target, 0, "!! CHECK REQUIRED !!");
    line(target, 1, "Possible fire/smoke");
    line(target, 2, "Awaiting admin ack");
    line(target, 3, "Time " + s.simTime);
  }

  void drawActive(LiquidCrystal_I2C &target, const DisplaySnapshot &s) {
    line(target, 0, "!!! EMERGENCY !!!");
    line(target, 1, "State: " + s.emergencyState);
    line(target, 2, "ALL DOORS UNLOCKED");
    line(target, 3, "Time " + s.simTime);
  }
};

DisplayModule display;
