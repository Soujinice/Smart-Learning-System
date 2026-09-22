// Digital Information Display - Main Lobby (GF-01), 20x4 I2C character LCD
// (Wokwi part "wokwi-lcd2004", library LiquidCrystal_I2C). Swapped in place
// of the original SSD1306 graphic OLED because its large blocky characters
// are far easier to read in a Wokwi screenshot/recording than a small
// 128x64 graphic display. Rotates every 3 seconds through one page per
// currently-enabled module (plus an always-on building-status page).
// A full-screen page takes over while module G is PENDING (awaiting admin
// confirmation) or ACTIVE/RESPONSE (confirmed override).
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

  uint32_t attendanceToday = 0;
  int doorsUnlocked = 0; int doorsTotal = 1;

  bool wifiConnected = false; int rssi = 0; String ip;
  uint8_t blockedHosts = 0;

  float wastePct = 0; bool wasteFull = false;

  // Which modules are currently enabled (see main.cpp ModuleFlags) - the
  // matching LCD page is skipped in rotation when its module is off.
  bool smartRoomEnabled = true;
  bool rfidEnabled = true;
  bool securityEnabled = true;
  bool networkEnabled = true;
  bool wasteEnabled = true;
};

class DisplayModule {
public:
  bool begin() {
    Wire.begin(PIN_LCD_SDA, PIN_LCD_SCL);
    lcd.init();
    lcd.backlight();
    lcd.setCursor(0, 0);
    lcd.print("Smart Learning Ctr");
    lcd.setCursor(0, 1);
    lcd.print("Booting...");
    ready = true; // the LCD2004 has no I2C-ack probe in this library; assume present
    return ready;
  }

  void loop(const DisplaySnapshot &snap) {
    if (!ready) return;

    if (snap.emergencyActive) { drawActive(snap); return; }
    if (snap.emergencyPending) { drawPending(snap); return; }

    uint8_t activePages[6];
    uint8_t activeCount = 0;
    activePages[activeCount++] = 0; // building status - always shown
    if (snap.smartRoomEnabled) activePages[activeCount++] = 1;
    if (snap.rfidEnabled) activePages[activeCount++] = 2;
    if (snap.securityEnabled) activePages[activeCount++] = 3;
    if (snap.networkEnabled) activePages[activeCount++] = 4;
    if (snap.wasteEnabled) activePages[activeCount++] = 5;

    unsigned long now = millis();
    if (now - lastSwitch >= 3000) {
      lastSwitch = now;
      pageIndex = (pageIndex + 1) % activeCount;
    }
    if (pageIndex >= activeCount) pageIndex = 0;

    switch (activePages[pageIndex]) {
      case 0: drawBuilding(snap); break;
      case 1: drawEnvironment(snap); break;
      case 2: drawAccess(snap); break;
      case 3: drawSecurity(snap); break;
      case 4: drawNetwork(snap); break;
      case 5: drawWaste(snap); break;
    }
  }

private:
  LiquidCrystal_I2C lcd { 0x27, 20, 4 };
  bool ready = false;
  uint8_t pageIndex = 0;
  unsigned long lastSwitch = 0;

  // Writes exactly 20 characters to a row (space-padded/truncated) so stale
  // characters from a longer previous line never linger on screen.
  void line(uint8_t row, const String &text) {
    String padded = text;
    if (padded.length() > 20) padded = padded.substring(0, 20);
    while (padded.length() < 20) padded += ' ';
    lcd.setCursor(0, row);
    lcd.print(padded);
  }

  void drawBuilding(const DisplaySnapshot &s) {
    line(0, "BUILDING STATUS");
    line(1, "Doors: " + String(s.doorsUnlocked) + "/" + String(s.doorsTotal));
    line(2, "Attendance: " + String(s.attendanceToday));
    line(3, "Time " + s.simTime);
  }

  void drawEnvironment(const DisplaySnapshot &s) {
    line(0, "ENVIRONMENT SF-03");
    line(1, "Temp: " + String(s.roomTempC, 1) + "C");
    line(2, "Hum: " + String(s.roomHumPct, 0) + "%  Mot:" + (s.roomMotion ? "Y" : "N"));
    line(3, "Room: " + s.smartRoomState);
  }

  void drawAccess(const DisplaySnapshot &s) {
    line(0, "ACCESS / ATTENDANCE");
    line(1, "Today: " + String(s.attendanceToday));
    line(2, s.doorsUnlocked > 0 ? "Door: UNLOCKED" : "Door: locked");
    line(3, "Time " + s.simTime);
  }

  void drawSecurity(const DisplaySnapshot &s) {
    line(0, "SECURITY & FIRE");
    line(1, "Smoke level: L" + String(s.smokeLevel));
    line(2, "Smoke: " + String(s.smokePct, 0) + "%");
    line(3, "Time " + s.simTime);
  }

  void drawNetwork(const DisplaySnapshot &s) {
    line(0, "NETWORK / FIREWALL");
    line(1, s.wifiConnected ? ("WAN: OK " + String(s.rssi) + "dBm") : "WAN: offline");
    line(2, "Blocked: " + String(s.blockedHosts));
    line(3, "Time " + s.simTime);
  }

  void drawWaste(const DisplaySnapshot &s) {
    line(0, "WASTE - MAIN LOBBY");
    line(1, "Fill: " + String(s.wastePct, 0) + "%");
    line(2, s.wasteFull ? "STATUS: BIN FULL" : "STATUS: normal");
    line(3, "Time " + s.simTime);
  }

  void drawPending(const DisplaySnapshot &s) {
    line(0, "!! CHECK REQUIRED !!");
    line(1, "Possible fire/smoke");
    line(2, "Awaiting admin ack");
    line(3, "Time " + s.simTime);
  }

  void drawActive(const DisplaySnapshot &s) {
    line(0, "!!! EMERGENCY !!!");
    line(1, "State: " + s.emergencyState);
    line(2, "ALL DOORS UNLOCKED");
    line(3, "Time " + s.simTime);
  }
};

DisplayModule display;
