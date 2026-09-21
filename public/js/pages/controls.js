import { api } from '../api.js';
import { state, on as onStoreChange } from '../store.js';
import { el, card, toast, clearNode, toggleSwitch, sliderRow } from '../ui.js';

let container = null;
let unsub = null;
let thresholds = null;
let modules = null;

const MODULE_LIST = [
  { key: 'rfid', label: 'RFID / Attendance' },
  { key: 'smart_room', label: 'Smart Room (SF-03)' },
  { key: 'environment', label: 'Environment' },
  { key: 'security', label: 'Security & Fire' },
  { key: 'metal_detector', label: 'Metal Detector' },
  { key: 'waste', label: 'Waste' },
  { key: 'network', label: 'Network' },
];

function render() {
  if (!container) return;
  clearNode(container);

  container.appendChild(el('div', { class: 'page-header' }, [el('h1', {}, 'Controls')]));

  container.appendChild(card('Modules', modules ? el('div', { class: 'toggle-grid' }, MODULE_LIST.map((m) => moduleToggle(m))) : el('div', { class: 'empty-state' }, 'Loading...')));

  if (!thresholds) {
    container.appendChild(card('Thresholds', [el('div', { class: 'empty-state' }, 'Loading...')]));
    return;
  }

  const grid = el('div', { class: 'grid grid-2', style: 'margin-top:16px;' });

  grid.appendChild(card('Room Temperature / Humidity', [
    sliderRow('Temp min', thresholds.env_temp_min, 10, 35, 1, (v) => save({ room_temp_min: v, env_temp_min: v }), 'C'),
    sliderRow('Temp max', thresholds.env_temp_max, 10, 40, 1, (v) => save({ room_temp_max: v, env_temp_max: v }), 'C'),
    sliderRow('Humidity min', thresholds.env_hum_min, 0, 100, 1, (v) => save({ room_hum_min: v, env_hum_min: v }), '%'),
    sliderRow('Humidity max', thresholds.env_hum_max, 0, 100, 1, (v) => save({ room_hum_max: v, env_hum_max: v }), '%'),
  ]));

  grid.appendChild(card('Smoke Levels', [
    sliderRow('L1 - Watch', thresholds.smoke_l1, 0, 100, 1, (v) => save({ smoke_l1: v }), '%'),
    sliderRow('L2 - Warning', thresholds.smoke_l2, 0, 100, 1, (v) => save({ smoke_l2: v }), '%'),
    sliderRow('L3 - Danger', thresholds.smoke_l3, 0, 100, 1, (v) => save({ smoke_l3: v }), '%'),
    sliderRow('L4 - Emergency', thresholds.smoke_l4, 0, 100, 1, (v) => save({ smoke_l4: v }), '%'),
  ]));

  grid.appendChild(card('Metal Detector', [
    sliderRow('Threshold', thresholds.metal_threshold_pct, 0, 100, 1, (v) => save({ metal_threshold_pct: v }), '%'),
  ]));

  grid.appendChild(card('Waste Bin', [
    sliderRow('Bin depth', thresholds.bin_depth_cm, 10, 100, 1, (v) => save({ bin_depth_cm: v }), 'cm'),
    sliderRow('Filling at', thresholds.waste_filling_pct, 0, 100, 1, (v) => save({ waste_filling_pct: v }), '%'),
    sliderRow('Full at', thresholds.waste_full_pct, 0, 100, 1, (v) => save({ waste_full_pct: v }), '%'),
  ]));

  container.appendChild(grid);
}

function moduleToggle(m) {
  const on = modules?.[m.key] !== false;
  const sw = toggleSwitch(on, async (checked, input) => {
    try {
      await api.toggleModule(m.key, checked);
      modules[m.key] = checked;
      toast(`${m.label} ${checked ? 'enabled' : 'disabled'}`, 'success');
    } catch (e) {
      input.checked = !checked;
      toast(e.message, 'error');
    }
  });
  return el('div', { class: 'toggle-row' }, [el('span', {}, m.label), sw]);
}

async function save(patch) {
  try {
    thresholds = (await api.saveThresholds(patch)).thresholds;
    toast('Saved', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

export default {
  mount(rootEl) {
    container = rootEl;
    Promise.all([api.thresholds(), api.modules()]).then(([th, mo]) => {
      thresholds = th.thresholds;
      modules = mo.modules;
      render();
    }).catch(() => render());
    // Keep the module state in sync with telemetry, but deliberately do not
    // re-render on every tick - that would interrupt slider dragging and
    // flicker the toggles once a second, exactly the jerkiness this page
    // exists to avoid. The synced value is picked up next time this page
    // mounts, or you can flip a switch to see its current server state.
    unsub = onStoreChange(() => {
      if (state.telemetry?.modules && modules) {
        modules = { ...modules, ...state.telemetry.modules };
      }
    });
    render();
  },
  unmount() { if (unsub) unsub(); container = null; },
};
