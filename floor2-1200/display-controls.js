// One allowlist controls every visible part of the display panel.
// Adding a control to one section cannot make it appear in another section.
const common = ['dimensions', 'edges', '3d', 'top', 'reset'];
export const SECTION_CONTROLS = Object.freeze({
  1: Object.freeze([...common, 'ceiling', 'sockets', 'wallOpacity']),
  2: Object.freeze([...common, 'zones', 'wallOpacity', 'cabinetOpacity', 'cabinetView', 'wallCabinetView']),
  3: Object.freeze([...common, 'sockets', 'wallOpacity', 'tileSpecs']),
});

export function syncDisplayControls(panel, section) {
  const allowed = new Set(SECTION_CONTROLS[section] || []);
  panel.dataset.section = String(section);
  for (const control of panel.querySelectorAll('[data-control]')) {
    control.hidden = !allowed.has(control.dataset.control);
  }
}

export function isWallObject(name) {
  return /墙|wall|柱子/i.test(name) && !/铺贴|瓷砖/i.test(name);
}
