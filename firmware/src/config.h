// Smart Learning Center - shared pin map and default configuration.
// Technological University of the Philippines - Group 3 midterm simulation.
#pragma once

#include <Arduino.h>

// ---------------------------------------------------------------------------
// Pin map (see README.md "Wiring table" for the human-readable version)
// ---------------------------------------------------------------------------
#define PIN_LCD_SDA          21   // shared I2C bus (LCD + nothing else needs it)
#define PIN_LCD_SCL          22

#define PIN_DHT22            15
#define PIN_PIR              13

#define PIN_MQ2_AOUT         34   // ADC1_CH6 - smoke/gas analog level

#define PIN_HCSR04_TRIG       5
#define PIN_HCSR04_ECHO      18

#define PIN_POT_METAL        33   // ADC1_CH5 - metal detector signal strength

#define PIN_BTN_SCREEN       14
#define PIN_BTN_PULL_STATION  4   // manual fire pull station (active low)

// MFRC522 RFID reader - real hardware simulation (Wokwi part "board-mfrc522").
// Custom (non-default-VSPI) pins via SPI.begin(sck,miso,mosi,ss) so they
// don't collide with the pins already used above. GPIO12 is a boot
// strapping pin on real ESP32 hardware (sets flash voltage) - it is safe
// here because nothing external pulls it during boot, but if you ever
// port this wiring to real hardware with a different reset circuit,
// move RST to a different free GPIO. See README wiring table.
#define PIN_RFID_RST         12
#define PIN_RFID_SS          27   // a.k.a. SDA on the RC522 breakout
#define PIN_RFID_SCK         26
#define PIN_RFID_MOSI        25
#define PIN_RFID_MISO        35   // input-only pin - correct direction for MISO

#define PIN_LED_GREEN        16
#define PIN_LED_YELLOW       17
#define PIN_LED_RED          19

#define PIN_BUZZER           23
#define PIN_RELAY            32   // SF-03 smart board / projector power
#define PIN_SERVO             2   // Main entrance smart door lock

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
#define DEVICE_ID            "ESP32-SLC-01"
// Bump this with any firmware change worth being able to confirm is
// actually running - it's reported in the "boot" message (t:"boot",
// fw:"..."), visible in the Diagnostics page's raw console and in
// firmware/wokwi.toml's build. If a fix "isn't working," checking this
// against the version in firmware/src/config.h on the branch is the
// fastest way to tell a real regression from Wokwi still running an
// unrebuilt/unrestarted binary.
#define FIRMWARE_VERSION     "1.3.0"
#define SERIAL_BAUD          115200

// Machine-readable lines are prefixed with this marker so ordinary
// human debug prints (Serial.println("...")) never get mistaken for
// protocol data by the bridge/server. See PROTOCOL.md.
#define WIRE_PREFIX          "@@"

// ---------------------------------------------------------------------------
// Default thresholds - all overridable at runtime via CMD set_thresholds
// ---------------------------------------------------------------------------
namespace Defaults {
  // Environment (module C) - Smart Classroom 1, SF-03
  constexpr float TEMP_MIN_C        = 20.0f;
  constexpr float TEMP_MAX_C        = 28.0f;
  constexpr float HUMIDITY_MIN_PCT  = 40.0f;
  constexpr float HUMIDITY_MAX_PCT  = 70.0f;

  // Security & Fire (module D) - percent of MQ-2 ADC range (0-4095 -> 0-100%)
  constexpr float SMOKE_L1_WATCH     = 20.0f;
  constexpr float SMOKE_L2_WARNING   = 40.0f;
  constexpr float SMOKE_L3_DANGER    = 60.0f;
  constexpr float SMOKE_L4_EMERGENCY = 80.0f;
  constexpr uint8_t SMOKE_CONFIRM_SAMPLES = 4;      // consecutive samples above threshold
  constexpr unsigned long VERIFY_WINDOW_MS = 5000;  // condition must persist this long
  constexpr float TEMP_RISE_LIMIT_C_PER_MIN = 6.0f; // rate-of-rise confirmation

  // Metal detector (module F) - percent of potentiometer range
  constexpr float METAL_THRESHOLD_PCT = 55.0f;
  constexpr unsigned long SCREENING_HOLD_TIMEOUT_MS = 20000; // auto-deny after this

  // Waste (module H) - bin depth in cm and fill bands
  constexpr float BIN_DEPTH_CM       = 40.0f;
  constexpr float WASTE_FILLING_PCT  = 60.0f;
  constexpr float WASTE_FULL_PCT     = 80.0f;

  // RFID (module A)
  constexpr unsigned long DUPLICATE_TAP_WINDOW_MS = 4000;
  constexpr unsigned long DOOR_UNLOCK_MS = 3000;

  // Simulated clock - 1 real second = 1 simulated minute by default
  constexpr uint32_t SIM_MINUTES_PER_REAL_SECOND = 1;

  // Building hours for PIR intrusion detection (simulated minutes since 00:00)
  constexpr uint16_t BUILDING_OPEN_MIN  = 6 * 60;   // 06:00
  constexpr uint16_t BUILDING_CLOSE_MIN = 21 * 60;  // 21:00
}

// Shared by module D (security) and module C (environment/AQI) so both read
// the gas sensor the same way. diagram.json pins the part's own simulated
// slider to "value": "0" at boot (same as the metal-detector potentiometer),
// so a direct linear 0-100% mapping already starts quiet and stays fully
// responsive across the whole slider range as you raise it in Wokwi.
inline float mq2RawToPct(int raw) {
  return (raw / 4095.0f) * 100.0f;
}
