// Static reference data for the Diagnostics & Settings page: the design
// component inventory (Section 1) and the ESP32 pin map (Section 3).

export const ASSET_INVENTORY = [
  { component: 'Interactive smart boards', designed: 4, represented: '1 relay-driven load (SF-03) LIVE + 3 listed as building assets (SIMULATED)' },
  { component: 'RFID readers', designed: '3-4 + 10-15 tags', represented: '1 reader simulated by 3 pushbuttons + web taps (LIVE) - 12 tags in registry' },
  { component: 'CCTV / PIR', designed: '5-6', represented: '1 PIR motion sensor (SF-03, LIVE) - other camera tiles SIMULATED' },
  { component: 'Environmental sensors (DHT)', designed: '4-6', represented: '1 DHT22 (SF-03, LIVE) - other zones SIMULATED' },
  { component: 'Smart projectors', designed: 2, represented: '1 relay-driven indicator LED (SF-03, LIVE)' },
  { component: 'Digital displays', designed: '3-4', represented: '1 SSD1306 OLED (Main Lobby, LIVE) - others SIMULATED on dashboard' },
  { component: 'Central controller', designed: '1-2', represented: '1 Node.js Central Smart Learning System (this server)' },
  { component: 'Network ESP32 modules', designed: '2-3', represented: '1 ESP32 running all modules concurrently (per assignment: single microcontroller)' },
  { component: 'Fire/safety set + indicators', designed: '3-4', represented: 'MQ-2 + flame fallback switch (GF-06, LIVE) + 3 LEDs + buzzer (LIVE)' },
];

export const PIN_MAP = [
  { pin: 'GPIO21 / GPIO22', device: 'SSD1306 OLED 128x64 I2C (0x3C)', role: 'Digital Information Display - Main Lobby', live: true },
  { pin: 'GPIO15', device: 'DHT22', role: 'Temperature/Humidity - Smart Classroom 1 (SF-03)', live: true },
  { pin: 'GPIO13', device: 'PIR HC-SR501', role: 'Motion/presence - SF-03 / CCTV trigger', live: true },
  { pin: 'GPIO34 (ADC1)', device: 'MQ-2 gas/smoke sensor (AOUT)', role: 'Smoke level - Cafeteria (GF-06)', live: true },
  { pin: 'GPIO35', device: 'Flame sensor fallback (slide switch, no native Wokwi part)', role: 'Flame detect - Cafeteria (GF-06)', live: true },
  { pin: 'GPIO5 / GPIO18', device: 'HC-SR04 (TRIG/ECHO)', role: 'Waste bin fill level - Main Lobby', live: true },
  { pin: 'GPIO33 (ADC1)', device: 'Potentiometer', role: 'Metal detector signal strength - Main Entrance', live: true },
  { pin: 'GPIO14', device: 'Pushbutton (SCREEN)', role: 'Metal detector: person/object presented', live: true },
  { pin: 'GPIO25', device: 'Pushbutton (CARD1)', role: 'RFID: registered student tap', live: true },
  { pin: 'GPIO26', device: 'Pushbutton (CARD2)', role: 'RFID: registered faculty tap', live: true },
  { pin: 'GPIO27', device: 'Pushbutton (CARD3)', role: 'RFID: unregistered/invalid card tap', live: true },
  { pin: 'GPIO4', device: 'Pushbutton (INPUT_PULLUP, active low)', role: 'Manual fire pull station / local emergency', live: true },
  { pin: 'GPIO16', device: 'Green LED', role: 'Status indicator - normal', live: true },
  { pin: 'GPIO17', device: 'Yellow LED', role: 'Status indicator - warning', live: true },
  { pin: 'GPIO19', device: 'Red LED', role: 'Status indicator - emergency', live: true },
  { pin: 'GPIO23', device: 'Buzzer', role: 'Audible alerts / emergency alarm', live: true },
  { pin: 'GPIO32', device: 'Relay module', role: 'SF-03 smart board / projector power', live: true },
  { pin: 'GPIO2', device: 'Servo', role: 'Main entrance smart door lock (0deg locked / 90deg unlocked)', live: true },
];
