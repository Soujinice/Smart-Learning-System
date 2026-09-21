// Schematic floor-plan layout coordinates (SVG units, 24 x 14 model-inch
// frame, matching the building's 24in x 14in model at 1in = 4ft). These are
// presentation rectangles roughly proportional to Section 1's room table -
// not an architectural drawing. Room facts (dimensions/areas/devices) come
// from /api/rooms; this file only supplies where to draw each one.

export const GROUND_LAYOUT = {
  viewBox: '0 0 24 14',
  corridors: [
    { x: 11.5, y: 0, w: 1, h: 14 },
  ],
  rooms: [
    { id: 'GF-05', x: 0, y: 0, w: 7, h: 9 },
    { id: 'GF-06', x: 7, y: 0, w: 4.5, h: 9 },
    { id: 'GF-02', x: 13, y: 0, w: 4, h: 6.7 },
    { id: 'GF-03', x: 17, y: 0, w: 3.5, h: 4.5 },
    { id: 'GF-04', x: 20.5, y: 0, w: 3.5, h: 4.5 },
    { id: 'GF-08', x: 0, y: 9, w: 3.3, h: 3.3 },
    { id: 'GF-09', x: 3.3, y: 9, w: 3.3, h: 3.3 },
    { id: 'GF-10', x: 6.6, y: 9, w: 3.3, h: 3.3 },
    { id: 'GF-07', x: 12.5, y: 9, w: 3, h: 5 },
    { id: 'GF-01', x: 15.5, y: 6.7, w: 8.5, h: 7.3 },
  ],
  labels: [
    { text: 'MAIN STAIRCASE (to 2F)', x: 17, y: 4.5, w: 7, h: 2.2 },
    { text: 'MAIN ENTRANCE', x: 18, y: 13.2, w: 4, h: 0.7, entrance: true },
  ],
  icons: [
    { type: 'rfid', x: 20, y: 13.6 },
    { type: 'fire_panel', x: 15.9, y: 7 },
    { type: 'display', x: 22.5, y: 6.9 },
    { type: 'cctv', x: 0.4, y: 0.4 },
    { type: 'wifi', x: 13.4, y: 0.4 },
    { type: 'env_sensor', x: 7.4, y: 0.4 },
    { type: 'cctv', x: 13.4, y: 5.9 },
  ],
  title: 'SMART LEARNING CENTER - GROUND FLOOR PLAN',
};

export const SECOND_LAYOUT = {
  viewBox: '0 0 24 14',
  corridors: [
    { x: 10.5, y: 0, w: 1, h: 14 },
  ],
  rooms: [
    { id: 'SF-03', x: 0, y: 0, w: 5.5, h: 6.5 },
    { id: 'SF-04', x: 5.5, y: 0, w: 5, h: 6.5 },
    { id: 'SF-05', x: 11.5, y: 0, w: 5, h: 6.5 },
    { id: 'SF-06', x: 16.5, y: 0, w: 7.5, h: 6.5 },
    { id: 'SF-01', x: 0, y: 6.5, w: 3, h: 3.5 },
    { id: 'SF-02', x: 3, y: 6.5, w: 3, h: 2 },
    { id: 'SF-09', x: 0, y: 10, w: 3, h: 3 },
    { id: 'SF-10', x: 6, y: 8, w: 6, h: 6 },
    { id: 'SF-07', x: 12.5, y: 6.5, w: 5, h: 4 },
    { id: 'SF-08', x: 17.5, y: 6.5, w: 4, h: 4 },
  ],
  labels: [],
  icons: [
    { type: 'env_sensor', x: 0.4, y: 0.4 },
    { type: 'cctv', x: 5.9, y: 0.4 },
    { type: 'wifi', x: 11.9, y: 0.4 },
    { type: 'cctv', x: 16.9, y: 0.4 },
    { type: 'display', x: 3.4, y: 10.4 },
    { type: 'wifi', x: 3.4, y: 6.9 },
  ],
  title: 'SMART LEARNING CENTER - SECOND FLOOR PLAN',
};
