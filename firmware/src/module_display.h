// Digital Information Display - Main Lobby (GF-01), SSD1306 128x64 I2C.
// Rotates every 3 seconds through one page per currently-enabled module
// (plus an always-on building-status page), so the display only shows data
// for whatever you actually have wired/running right now - see the
// Controls page's module toggles. A full-screen EMERGENCY page overrides
// everything while module G is ACTIVE/RESPONSE.
#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "config.h"

struct DisplaySnapshot {
  String simTime;
  bool emergencyActive = false;
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
  // matching OLED page is skipped in rotation when its module is off.
  bool smartRoomEnabled = true;
  bool rfidEnabled = true;
  bool securityEnabled = true;
  bool networkEnabled = true;
  bool wasteEnabled = true;
};

class DisplayModule {
public:
  bool begin() {
    Wire.begin(PIN_OLED_SDA, PIN_OLED_SCL);
    ready = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
    if (ready) {
      oled.clearDisplay();
      oled.setTextColor(SSD1306_WHITE);
      oled.setTextSize(1);
      oled.setCursor(0, 0);
      oled.println("Smart Learning Center");
      oled.println("Booting...");
      oled.display();
    }
    return ready;
  }

  void loop(const DisplaySnapshot &snap) {
    if (!ready) return;

    if (snap.emergencyActive) {
      drawEmergency(snap);
      return;
    }

    // Build the active page list fresh each call - cheap (<=6 entries) and
    // lets a module toggle take effect on the very next rotation.
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
  Adafruit_SSD1306 oled { 128, 64, &Wire, -1 };
  bool ready = false;
  uint8_t pageIndex = 0;
  unsigned long lastSwitch = 0;

  void header(const char *title, const String &time) {
    oled.clearDisplay();
    oled.setTextSize(1);
    oled.setCursor(0, 0);
    oled.print(title);
    oled.setCursor(128 - 30, 0);
    oled.print(time);
    oled.drawLine(0, 9, 127, 9, SSD1306_WHITE);
    oled.setCursor(0, 14);
  }

  void drawBuilding(const DisplaySnapshot &s) {
    header("BUILDING STATUS", s.simTime);
    oled.println("Smart Learning Center");
    oled.println("TUP - 2 floors");
    oled.print("Doors unlocked: ");
    oled.print(s.doorsUnlocked); oled.print("/"); oled.println(s.doorsTotal);
    oled.print("Attendance today: ");
    oled.println(s.attendanceToday);
    oled.display();
  }

  void drawEnvironment(const DisplaySnapshot &s) {
    header("ENVIRONMENT - SF-03", s.simTime);
    oled.print("Temp: "); oled.print(s.roomTempC, 1); oled.println(" C");
    oled.print("Humidity: "); oled.print(s.roomHumPct, 1); oled.println(" %");
    oled.print("Motion: "); oled.println(s.roomMotion ? "PRESENT" : "none");
    oled.print("Room: "); oled.println(s.smartRoomState);
    oled.display();
  }

  void drawAccess(const DisplaySnapshot &s) {
    header("ACCESS / ATTENDANCE", s.simTime);
    oled.print("Attendance today: "); oled.println(s.attendanceToday);
    oled.print("Door: "); oled.println(s.doorsUnlocked > 0 ? "UNLOCKED" : "locked");
    oled.display();
  }

  void drawSecurity(const DisplaySnapshot &s) {
    header("SECURITY & FIRE", s.simTime);
    oled.print("Smoke level: L"); oled.println(s.smokeLevel);
    oled.print("Smoke: "); oled.print(s.smokePct, 0); oled.println(" %");
    oled.display();
  }

  void drawNetwork(const DisplaySnapshot &s) {
    header("NETWORK / FIREWALL", s.simTime);
    oled.print("WAN: "); oled.println(s.wifiConnected ? ("OK " + String(s.rssi) + "dBm") : "offline");
    if (s.wifiConnected) { oled.print("IP: "); oled.println(s.ip); }
    oled.print("Blocked hosts: "); oled.println(s.blockedHosts);
    oled.display();
  }

  void drawWaste(const DisplaySnapshot &s) {
    header("WASTE - MAIN LOBBY", s.simTime);
    oled.print("Bin fill: "); oled.print(s.wastePct, 0); oled.println(" %");
    oled.println(s.wasteFull ? "STATUS: BIN FULL" : "STATUS: normal");
    oled.display();
  }

  void drawEmergency(const DisplaySnapshot &s) {
    oled.clearDisplay();
    oled.setTextSize(2);
    oled.setCursor(4, 4);
    oled.println("EMERGENCY");
    oled.setTextSize(1);
    oled.setCursor(4, 26);
    oled.print("State: "); oled.println(s.emergencyState);
    oled.setCursor(4, 38);
    oled.println("ALL DOORS UNLOCKED");
    oled.setCursor(4, 50);
    oled.print("Time: "); oled.println(s.simTime);
    oled.display();
  }
};

DisplayModule display;
