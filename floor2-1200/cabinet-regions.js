export const cabinetElevations = {
  window: { label: '靠窗侧', direction: [0, 0, -1] },
  stove: { label: '煮饭侧', direction: [-1, 0, 0] },
  rice: { label: '炒菜侧', direction: [1, 0, 0] },
};

export function cabinetWallRegionForMaterial(name) {
  return ({
    '靠窗侧': 'window',
    '煮饭侧': 'stove',
    '炒菜侧': 'rice',
    '柱子': 'all',
  })[name] || null;
}

export function cabinetRegionsForBounds(bounds, name = '') {
  if (name.includes('地面')) return [];
  const regions = [];
  // The three dotted ranges in the supplied top view overlap at both corners.
  if (bounds.max.z >= .38) regions.push('window');
  if (bounds.max.x >= .62) regions.push('stove');
  if (bounds.min.x <= -.82) regions.push('rice');
  return regions;
}

export function cabinetDimensionRegion(item) {
  if (item.id.includes('靠窗侧')) return 'window';
  if (item.id.includes('靠墙侧')) return 'stove';
  if (item.id.includes('靠门侧')) return 'rice';
  const midpoint = item.endpoints[0].map((value, index) =>
    (value + item.endpoints[1][index]) / 2);
  if (item.axis === 'X') return 'window';
  // Blender Y becomes Three.js -Z. These measurements sit on the window run,
  // including the short board thicknesses and both corner height stacks.
  if (-midpoint[1] > .25) return 'window';
  return midpoint[0] >= 0 ? 'stove' : 'rice';
}

