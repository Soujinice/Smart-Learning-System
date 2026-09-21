// Smart Learning Center - wire protocol helpers.
// Every machine-readable line is a single-line JSON object prefixed with
// "@@" (see config.h WIRE_PREFIX). Anything printed without that prefix is
// treated by the bridge as a free-text debug line. Full spec: PROTOCOL.md
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"

namespace Proto {

  inline void send(JsonDocument &doc) {
    Serial.print(WIRE_PREFIX);
    serializeJson(doc, Serial);
    Serial.println();
  }

  // Emits a state-transition event so the website's Flow Tracker page can
  // highlight the exact flowchart node the firmware is currently executing.
  // moduleId matches the flowchart letters in the spec: MAIN, A, B, C, D, E,
  // F, G, H. state is the flowchart node name (upper snake case). branch is
  // "YES"/"NO" when the transition follows a decision diamond.
  inline void flow(const char *moduleId, const char *state, const char *branch = nullptr) {
    JsonDocument doc;
    doc["t"] = "flow";
    doc["m"] = moduleId;
    doc["s"] = state;
    if (branch != nullptr) doc["v"] = branch;
    doc["ms"] = millis();
    send(doc);
  }

  inline void log(const String &message) {
    JsonDocument doc;
    doc["t"] = "log";
    doc["msg"] = message;
    send(doc);
  }

  inline void ack(const String &cmdType, bool ok, const String &detail = "") {
    JsonDocument doc;
    doc["t"] = "ack";
    doc["cmd"] = cmdType;
    doc["ok"] = ok;
    if (detail.length()) doc["detail"] = detail;
    send(doc);
  }

  // Begins a document the caller fills in before calling send(). Kept as a
  // thin helper so every module sets "t" the same way.
  inline JsonDocument begin(const char *type) {
    JsonDocument doc;
    doc["t"] = type;
    return doc;
  }

} // namespace Proto
