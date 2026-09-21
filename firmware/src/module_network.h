// Module E - LMS/Network access, plus the campus firewall + router + core
// switch simulation (Section 4 "F/R" of the brief). All of this runs inside
// the single ESP32 as pure software - there is no second microcontroller.
// Real Wi-Fi (Wokwi-GUEST) is attempted non-blocking purely to report a
// live WAN/Wi-Fi status line; the building network simulation itself does
// not depend on it being connected.
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include "config.h"
#include "protocol.h"
#include "simclock.h"

struct FirewallRule {
  const char *id;
  const char *action;     // ALLOW | DENY
  const char *proto;      // tcp | udp
  uint16_t port;
  const char *description;
  uint32_t hits;
};

struct VlanEntry {
  const char *id;      // VLAN10 ...
  const char *name;
  uint16_t dhcpPoolSize;
  uint16_t dhcpLeased;
  uint32_t natTranslations;
};

struct SwitchSegment {
  const char *name;
  uint32_t txBytes;
  uint32_t rxBytes;
};

struct BlockedHost {
  String ip;
  String reason;
  unsigned long expiresAtMs;
  bool used = false;
};

class NetworkModule {
public:
  void begin() {
    WiFi.mode(WIFI_STA);
    WiFi.begin("Wokwi-GUEST", "", 6);
    wifiAttemptedAt = millis();
    seedTables();
  }

  void loop() {
    unsigned long now = millis();

    if (!wifiReportedOnce && WiFi.status() == WL_CONNECTED) {
      wifiReportedOnce = true;
      Proto::log("Wi-Fi connected: " + WiFi.localIP().toString() + " RSSI " + String(WiFi.RSSI()) + " dBm");
    }

    if (now - lastTrafficTick >= 1000) {
      lastTrafficTick = now;
      generateTraffic();
      expireBlocks(now);
      sendNetStats();
    }
  }

  bool isWifiConnected() const { return WiFi.status() == WL_CONNECTED; }
  int32_t rssi() const { return isWifiConnected() ? WiFi.RSSI() : 0; }
  String ip() const { return isWifiConnected() ? WiFi.localIP().toString() : ""; }

  void runScenario(const String &scenario) {
    currentScenario = scenario;
    if (scenario == "port_scan") simulatePortScan();
    else if (scenario == "brute_force") simulateBruteForce();
    else if (scenario == "dos_flood") simulateDosFlood();
    else if (scenario == "blocked_port") simulateBlockedPort();
    // "normal" just clears back to baseline traffic generation.
  }

  void handleLmsRequest(const String &user, const String &role, uint16_t port) {
    Proto::flow("E", "E_REQUEST");
    Proto::flow("E", "E_AUTH");
    bool knownRole = role.length() > 0;
    Proto::flow("E", "E_AUTHORIZED", knownRole ? "YES" : "NO");

    if (!knownRole) {
      Proto::flow("E", "E_DENIED");
      sendNetResult(user, role, port, false, "FW-08", "-");
      return;
    }

    String vlan = vlanForRole(role);
    String ruleId;
    bool permit = checkPolicy(vlan, port, ruleId);

    if (!permit) {
      Proto::flow("E", "E_DENIED");
      sendNetResult(user, role, port, false, ruleId, vlan);
      return;
    }

    Proto::flow("E", "E_CONNECT");
    Proto::flow("E", "E_ACCESS_LMS");
    Proto::flow("E", "E_EXCHANGE");
    Proto::flow("E", "E_DISPLAY_INFO");
    Proto::flow("E", "E_END");
    sendNetResult(user, role, port, true, ruleId, vlan);
  }

  void handleCommand(const String &type, JsonObjectConst payload) {
    if (type == "net_scenario") {
      runScenario(payload["scenario"].as<String>());
      Proto::ack(type, true);
    } else if (type == "net_request") {
      handleLmsRequest(payload["user"].as<String>(), payload["role"].as<String>(),
                        payload["port"].as<uint16_t>());
      Proto::ack(type, true);
    } else {
      Proto::ack(type, false, "unknown network command");
    }
  }

private:
  static const uint8_t RULE_COUNT = 8;
  FirewallRule rules[RULE_COUNT] = {
    { "FW-01", "ALLOW", "tcp", 443,  "HTTPS / LMS (campus VLANs)", 0 },
    { "FW-02", "ALLOW", "tcp", 8443, "LMS alternate port",         0 },
    { "FW-03", "ALLOW", "udp", 53,   "DNS resolution",             0 },
    { "FW-04", "ALLOW", "tcp", 80,   "Web (campus VLANs)",         0 },
    { "FW-05", "DENY",  "tcp", 23,   "Telnet from Internet/guest", 0 },
    { "FW-06", "DENY",  "tcp", 445,  "SMB from Internet/guest",    0 },
    { "FW-07", "DENY",  "tcp", 3389, "RDP from Internet/guest",    0 },
    { "FW-08", "DENY",  "tcp", 0,    "Default deny inbound",       0 },
  };

  static const uint8_t VLAN_COUNT = 6;
  VlanEntry vlans[VLAN_COUNT] = {
    { "VLAN10", "Admin",             30, 0, 0 },
    { "VLAN20", "Faculty",           40, 0, 0 },
    { "VLAN30", "Students",         200, 0, 0 },
    { "VLAN40", "Classrooms/IoT",    60, 0, 0 },
    { "VLAN50", "CCTV/Security",     20, 0, 0 },
    { "VLAN99", "Servers",           10, 0, 0 },
  };

  static const uint8_t SEGMENT_COUNT = 4;
  SwitchSegment segments[SEGMENT_COUNT] = {
    { "Smart Classrooms (2F)",     0, 0 },
    { "Computer Laboratories (2F)", 0, 0 },
    { "Library (1F/2F)",            0, 0 },
    { "Server Room",                0, 0 },
  };

  static const uint8_t MAX_BLOCKS = 8;
  BlockedHost blocks[MAX_BLOCKS];

  String currentScenario = "normal";
  unsigned long lastTrafficTick = 0;
  unsigned long wifiAttemptedAt = 0;
  bool wifiReportedOnce = false;

  uint32_t portScanAttempts = 0;
  uint32_t bruteForceFails = 0;
  String activeAttackerIp;

  void seedTables() {
    vlans[0].dhcpLeased = 12; vlans[1].dhcpLeased = 18; vlans[2].dhcpLeased = 145;
    vlans[3].dhcpLeased = 34; vlans[4].dhcpLeased = 12; vlans[5].dhcpLeased = 8;
    for (auto &v : vlans) v.natTranslations = v.dhcpLeased * 3;
  }

  String vlanForRole(const String &role) {
    if (role == "admin") return "VLAN10";
    if (role == "faculty" || role == "registrar") return "VLAN20";
    if (role == "student") return "VLAN30";
    if (role == "security") return "VLAN50";
    if (role == "maintenance") return "VLAN40";
    return "VLAN30";
  }

  bool checkPolicy(const String &vlan, uint16_t port, String &ruleIdOut) {
    // LMS/web/DNS ports are reachable from every campus VLAN.
    for (auto &r : rules) {
      if (String(r.action) == "ALLOW" && r.port == port) {
        r.hits++;
        ruleIdOut = r.id;
        // Students may only reach the server VLAN through the LMS ports.
        if (vlan == "VLAN30" && port != 443 && port != 8443 && port != 80 && port != 53) {
          break;
        }
        return true;
      }
    }
    for (auto &r : rules) {
      if (String(r.action) == "DENY" && (r.port == port || r.port == 0)) {
        r.hits++;
        ruleIdOut = r.id;
        return false;
      }
    }
    ruleIdOut = "FW-08";
    rules[RULE_COUNT - 1].hits++;
    return false;
  }

  void sendNetResult(const String &user, const String &role, uint16_t port, bool permit,
                      const String &ruleId, const String &vlan) {
    JsonDocument doc = Proto::begin("net_result");
    doc["user"] = user;
    doc["role"] = role;
    doc["port"] = port;
    doc["permit"] = permit;
    doc["rule_id"] = ruleId;
    doc["vlan"] = vlan;
    doc["ts"] = simClock.hhmm();
    Proto::send(doc);
  }

  bool isBlocked(const String &ip) {
    for (auto &b : blocks) if (b.used && b.ip == ip) return true;
    return false;
  }

  void blockIp(const String &ip, const String &reason, unsigned long durationMs = 60000) {
    if (isBlocked(ip)) return;
    for (auto &b : blocks) {
      if (!b.used) {
        b.used = true; b.ip = ip; b.reason = reason; b.expiresAtMs = millis() + durationMs;
        JsonDocument doc = Proto::begin("alert");
        doc["module"] = "E";
        doc["severity"] = "warning";
        doc["message"] = "Firewall auto-blocked " + ip + " (" + reason + ")";
        doc["ts"] = simClock.hhmm();
        Proto::send(doc);
        return;
      }
    }
  }

  void expireBlocks(unsigned long now) {
    for (auto &b : blocks) {
      if (b.used && now > b.expiresAtMs) b.used = false;
    }
  }

  String randomExternalIp() {
    return "203.0.113." + String(random(2, 254));
  }

  void simulatePortScan() {
    activeAttackerIp = randomExternalIp();
    portScanAttempts += 6;
    rules[RULE_COUNT - 1].hits += 6; // hits the default-deny rule repeatedly
    Proto::log("Network: port scan pattern detected from " + activeAttackerIp);
    blockIp(activeAttackerIp, "port scan pattern", 90000);
  }

  void simulateBruteForce() {
    activeAttackerIp = randomExternalIp();
    bruteForceFails += 5;
    Proto::log("Network: 5 failed login attempts from " + activeAttackerIp);
    blockIp(activeAttackerIp, "brute-force login attempts", 120000);
  }

  void simulateDosFlood() {
    for (auto &s : segments) s.rxBytes += random(50000, 150000);
    Proto::log("Network: DoS-style traffic flood detected, rate limiter engaged");
  }

  void simulateBlockedPort() {
    rules[4].hits++; // FW-05 telnet deny
    Proto::log("Network: inbound Telnet (port 23) attempt blocked by FW-05");
  }

  void generateTraffic() {
    uint32_t base = (currentScenario == "dos_flood") ? 8000 : 800;
    for (auto &s : segments) {
      s.txBytes += random(base / 4, base);
      s.rxBytes += random(base / 4, base);
    }
    if (currentScenario != "normal") {
      // scenarios are one-shot bursts; settle back to normal traffic after
      // being reported once so the dashboard shows the spike then recovery.
      currentScenario = "normal";
    }
  }

  void sendNetStats() {
    JsonDocument doc = Proto::begin("net_stats");
    doc["scenario"] = currentScenario;
    doc["wifi_connected"] = isWifiConnected();
    doc["wifi_rssi"] = rssi();
    doc["wifi_ip"] = ip();

    JsonArray fw = doc["firewall_rules"].to<JsonArray>();
    for (auto &r : rules) {
      JsonObject o = fw.add<JsonObject>();
      o["id"] = r.id; o["action"] = r.action; o["proto"] = r.proto; o["port"] = r.port;
      o["description"] = r.description; o["hits"] = r.hits;
    }

    JsonArray bl = doc["blocked_hosts"].to<JsonArray>();
    for (auto &b : blocks) {
      if (!b.used) continue;
      JsonObject o = bl.add<JsonObject>();
      o["ip"] = b.ip; o["reason"] = b.reason;
      o["expires_in_s"] = (b.expiresAtMs > millis()) ? (b.expiresAtMs - millis()) / 1000 : 0;
    }

    JsonArray vl = doc["vlans"].to<JsonArray>();
    for (auto &v : vlans) {
      JsonObject o = vl.add<JsonObject>();
      o["id"] = v.id; o["name"] = v.name; o["dhcp_pool"] = v.dhcpPoolSize;
      o["dhcp_leased"] = v.dhcpLeased; o["nat_translations"] = v.natTranslations;
    }

    JsonArray sw = doc["switch_segments"].to<JsonArray>();
    for (auto &s : segments) {
      JsonObject o = sw.add<JsonObject>();
      o["name"] = s.name; o["tx_bytes"] = s.txBytes; o["rx_bytes"] = s.rxBytes;
    }

    doc["ts"] = simClock.hhmm();
    Proto::send(doc);
  }
};

NetworkModule network;
