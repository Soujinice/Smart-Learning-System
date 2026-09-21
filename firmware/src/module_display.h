// Digital Information Display - Main Lobby (GF-01), SSD1306 128x64 I2C.
// Rotates through five status pages every 3 seconds; a full-screen
// EMERGENCY page overrides everything while module G is ACTIVE/RESPONSE.
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

  float smokePct = 0; bool flame = false; uint8_t smokeLevel = 0;
  float roomTempC = 24; float roomHumPct = 55; bool roomMotion = false;
  String smartRoomState = "STANDBY";

  uint32_t attendanceToday = 0;
  int doorsUnlocked = 0; int doorsTotal = 1;

  bool wifiConnected = false; int rssi = 0; String ip;
  uint8_t blockedHosts = 0;

  float wastePct = 0; bool wasteFull = false;
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
    unsigned long now = millis();

    if (snap.emergencyActive) {
      drawEmergency(snap);
      return;
    }

    if (now - lastSwitch >= 3000) {
      lastSwitch = now;
      page = (page + 1) % 5;
    }

    switch (page) {
      case 0: drawBuilding(snap); break;
      case 1: drawEnvironment(snap); break;
      case 2: drawAccess(snap); break;
      case 3: drawNetwork(snap); break;
      case 4: drawWaste(snap); break;
    }
  }

private:
  Adafruit_SSD1306 oled { 128, 64, &Wire, -1 };
  bool ready = false;
  uint8_t page = 0;
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
    oled.print("Smoke level: L"); oled.println(s.smokeLevel);
    oled.print("Flame: "); oled.println(s.flame ? "DETECTED" : "clear");
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
