// Per-module enable/disable flags, controlled from the dashboard's
// Controls page (CMD module_toggle). Lets you run just the subsystem
// you're actually wiring/testing on Wokwi right now instead of every
// module's loop() competing for the same serial line and simulator CPU.
// Core services (sim clock, indicators, the door servo, and module G's
// emergency override) are never gated - they are cheap and safety-critical.
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "protocol.h"

// Only RFID starts enabled: that is almost always the first thing tested on
// Wokwi, and starting with every module live means several unrelated
// sensors compete for the serial line/simulator CPU before you have wired
// or touched most of them. Turn a module on from the Controls page right
// before you test it.
struct ModuleFlags {
  bool rfid = true;
  bool smartRoom = false;
  bool environment = false;
  bool security = false;
  bool metalDetector = false;
  bool waste = false;
  bool network = false;
};

ModuleFlags moduleFlags;

inline bool *moduleFlagPtr(const String &name) {
  if (name == "rfid") return &moduleFlags.rfid;
  if (name == "smart_room") return &moduleFlags.smartRoom;
  if (name == "environment") return &moduleFlags.environment;
  if (name == "security") return &moduleFlags.security;
  if (name == "metal_detector") return &moduleFlags.metalDetector;
  if (name == "waste") return &moduleFlags.waste;
  if (name == "network") return &moduleFlags.network;
  return nullptr;
}

inline void handleModuleToggle(JsonObjectConst payload) {
  String name = payload["module"].as<String>();
  bool *flag = moduleFlagPtr(name);
  if (!flag) {
    Proto::ack("module_toggle", false, "unknown module: " + name);
    return;
  }
  *flag = payload["enabled"].as<bool>();
  Proto::log("Module '" + name + "' " + String(*flag ? "enabled" : "disabled"));
  Proto::ack("module_toggle", true);
}
