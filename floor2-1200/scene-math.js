import * as THREE from './public/vendor/three/build/three.module.js';

export function blenderToThree(point) {
  return new THREE.Vector3(point[0], point[2], -point[1]);
}

export function topViewDimensionVisible(item) {
  return (item.axis === 'X' || item.axis === 'Y') && item.value >= .1;
}

export function dedupeTopViewDimensions(items, precision = .005) {
  const seen = new Set();
  return items.filter(item => {
    if (!topViewDimensionVisible(item)) return false;
    const endpoints = item.endpoints.map(point => point.slice(0, 2)
      .map(value => Math.round(value / precision)).join(',' )).sort();
    const key = `${item.axis}|${Math.round(item.value / precision)}|${endpoints.join('|')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function topViewLabelAnchor(item, bounds, offset = new THREE.Vector3(), lane = 0) {
  const a = blenderToThree(item.endpoints[0]).add(offset);
  const b = blenderToThree(item.endpoints[1]).add(offset);
  const midpoint = a.clone().add(b).multiplyScalar(.5);
  const center = bounds.getCenter(new THREE.Vector3());
  const withinPlan = midpoint.x >= bounds.min.x && midpoint.x <= bounds.max.x &&
    midpoint.z >= bounds.min.z && midpoint.z <= bounds.max.z;
  const normal = item.axis === 'X' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const towardCenter = center.sub(midpoint).dot(normal);
  const side = (towardCenter >= 0 ? 1 : -1) * (withinPlan ? 1 : -1);
  return midpoint.addScaledVector(normal, side * (.12 + lane * .09));
}

export function topViewLabelLayout(entries, width, height) {
  const placed = [];
  const result = new Map();
  const overlaps = (a, b, gap = 4) => a.left < b.left + b.width + gap &&
    a.left + a.width + gap > b.left && a.top < b.top + b.height + gap &&
    a.top + a.height + gap > b.top;
  const crossesDimension = rect => entries.some(entry => {
    if (entry.horizontal) return entry.y >= rect.top - 2 && entry.y <= rect.top + rect.height + 2 &&
      entry.minX <= rect.left + rect.width && entry.maxX >= rect.left;
    return entry.x >= rect.left - 2 && entry.x <= rect.left + rect.width + 2 &&
      entry.minY <= rect.top + rect.height && entry.maxY >= rect.top;
  });
  const ordered = [...entries].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  for (const entry of ordered) {
    const candidates = [];
    const normal = (entry.horizontal ? entry.textHeight : entry.textWidth) / 2 + 9;
    for (let band = 0; band <= 7; band++) for (let tangent = -5; tangent <= 5; tangent++) {
      if (band === 0 && tangent === 0) continue;
      const across = normal + band * 13;
      for (const side of entry.preferredSide ? [entry.preferredSide] : [1, -1]) {
        const along = tangent * 12;
        const dx = entry.horizontal ? along : side * across;
        const dy = entry.horizontal ? side * across : along;
        candidates.push({ x: entry.x + dx, y: entry.y + dy, distance: Math.hypot(dx, dy), side });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || Math.abs(a.x - entry.x) - Math.abs(b.x - entry.x));
    let choice;
    for (const candidate of candidates) {
      const rect = { left: candidate.x - entry.textWidth / 2, top: candidate.y - entry.textHeight / 2,
        width: entry.textWidth, height: entry.textHeight };
      if (rect.left < 4 || rect.top < 4 || rect.left + rect.width > width - 4 ||
          rect.top + rect.height > height - 4 || placed.some(other => overlaps(rect, other)) || crossesDimension(rect)) continue;
      choice = { ...candidate, rect };
      break;
    }
    if (!choice) {
      const side = entry.preferredSide || (entry.horizontal ? -1 : 1);
      choice = { x: entry.x + (entry.horizontal ? 0 : side * normal),
        y: entry.y + (entry.horizontal ? side * normal : 0) };
      choice.rect = { left: choice.x - entry.textWidth / 2, top: choice.y - entry.textHeight / 2,
        width: entry.textWidth, height: entry.textHeight };
    }
    placed.push(choice.rect);
    result.set(entry.id, { x: choice.x, y: choice.y, leader: Math.hypot(choice.x - entry.x, choice.y - entry.y) > normal + 1 });
  }
  return result;
}

// Cone tips meet the measured endpoints; their bodies stay inside the span.
export function dimensionArrowHeads(a, b, maximumLength = .010) {
  const length = Math.min(maximumLength, a.distanceTo(b) * .22);
  const direction = b.clone().sub(a).normalize();
  return [[a, direction.clone().negate()], [b, direction]].map(([tip, facing]) => ({
    position: tip.clone().addScaledVector(facing, -length / 2),
    facing, length, radius: length * .28,
  }));
}

export function inlineDimensionTextScale(projectedFontHeight, baseFontSize) {
  return Math.max(.12, Math.min(1.2, projectedFontHeight / baseFontSize));
}

export function inlineDimensionLayout(a, b, textWidth, viewDistance, textScale = 1) {
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  let angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  if (angle >= 90) angle -= 180;
  if (angle < -90) angle += 180;
  const requiredSpan = (textWidth + 8) * textScale;
  const labelAbove = span < requiredSpan;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, angle, span, textScale,
    // Keep the line complete when the label cannot fit between its endpoints.
    // The caller then places the label above the projected line.
    labelAbove,
    gapFraction: labelAbove ? 0 : requiredSpan / (2 * Math.max(span, .001)),
    arrowPixels: Math.max(3, Math.min(6.5, Math.max(4.5, 4.2 + .45 * Math.sqrt(Math.max(0, viewDistance)))) * Math.min(1, textScale)),
  };
}

// Build a model-space engineering dimension directly on the measured segment.
// Short dimensions stay at their original endpoints; no outward extension
// lane is introduced. Screen-space arrows are added by the renderer.
export function fixedDimensionGeometry(a, b, axis, offset = .045, cap = .012) {
  const baselineA = a.clone();
  const baselineB = b.clone();
  return {
    baselineA, baselineB,
    extensionA: [a.clone(), a.clone()],
    extensionB: [b.clone(), b.clone()],
    capA: [a.clone(), a.clone()],
    capB: [b.clone(), b.clone()],
    anchor: baselineA.clone().add(baselineB).multiplyScalar(.5),
  };
}

// Only the label is displaced: leaders start at the original projected midpoint.
export function dimensionCallouts(entries, width, height, direction = 1, force = false) {
  const bounds = (x, y, w, h) => ({ x, y, w, h });
  const overlap = (a, b, padding = 5) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + padding &&
    Math.abs(a.y - b.y) < (a.h + b.h) / 2 + padding;
  const onScreen = e => e.x >= 0 && e.x <= width && e.y >= 0 && e.y <= height;
  const boxes = entries.map(e => {
    const angle = e.angle * Math.PI / 180;
    return bounds(e.x, e.y,
      (Math.abs(Math.cos(angle)) * e.textWidth + Math.abs(Math.sin(angle)) * e.textHeight) * e.textScale,
      (Math.abs(Math.sin(angle)) * e.textWidth + Math.abs(Math.cos(angle)) * e.textHeight) * e.textScale);
  });
  const displaced = new Set();
  const canDisplace = i => entries[i].value < .1 && onScreen(entries[i]);
  entries.forEach((e, i) => {
    if (canDisplace(i) && (force || e.span < (e.textWidth + 12) * e.textScale)) displaced.add(i);
  });
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    if (!onScreen(entries[i]) || !onScreen(entries[j]) || !overlap(boxes[i], boxes[j])) continue;
    // Keep larger dimensions scaled inline; only expand cramped detail dimensions.
    if (canDisplace(i) && canDisplace(j)) displaced.add(entries[i].span <= entries[j].span ? i : j);
    else if (canDisplace(i)) displaced.add(i);
    else if (canDisplace(j)) displaced.add(j);
  }
  const occupied = boxes.filter((box, i) => !displaced.has(i) && onScreen(entries[i]));
  const result = new Map();
  // Nearby callouts share a column and retain their vertical order.
  const ordered = [...displaced].sort((a, b) => entries[a].y - entries[b].y || a - b);
  for (const i of ordered) {
    const e = entries[i], scale = Math.max(13.2 / e.textHeight, Math.min(1.2, e.textScale));
    const w = e.textWidth * scale, h = e.textHeight * scale;
    const margin = 12, minX = w / 2 + margin, maxX = width - w / 2 - margin;
    let best;
    for (const side of [direction < 0 ? -1 : 1]) for (const radius of [65, 100, 140, 190, 250]) {
      for (const dy of [0, -24, 24, -48, 48, -72, 72, -100, 100, -140, 140]) {
        const x = Math.max(minX, Math.min(maxX, e.x + side * (radius + w / 2)));
        const y = Math.max(h / 2 + 36, Math.min(height - h / 2 - margin, e.y + dy));
        const box = bounds(x, y, w, h);
        const collisions = occupied.filter(other => overlap(box, other, 9)).length;
        const score = collisions * 100000 + Math.hypot(x - e.x, y - e.y) + Math.abs(dy) * .35;
        if (!best || score < best.score) best = { x, y, w, h, scale, score };
      }
    }
    const side = direction < 0 ? -1 : 1;
    const edgeX = best.x - side * (w / 2 + 5), lineY = best.y + h / 2 + 4;
    const elbowX = edgeX - side * 14;
    result.set(e.id, { ...best, source: { x: e.x, y: e.y },
      points: [{ x: e.x, y: e.y }, { x: elbowX, y: lineY },
        { x: best.x + side * (w / 2 + 3), y: lineY }] });
    occupied.push(bounds(best.x, best.y + 2, w + 8, h + 8));
  }
  return result;
}

// Screen-space triangles keep arrow tips on the projected measurement endpoints,
// with a visible width even when the dimension points toward the camera.
export function dimensionArrowTriangles(a, b, pixels) {
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  if (span < .001) return [];
  const dx = (b.x - a.x) / span, dy = (b.y - a.y) / span;
  const length = Math.min(pixels, span * .22), radius = Math.min(pixels * .45, length * .5);
  return [[a, 1], [b, -1]].map(([tip, sign]) => {
    const x = tip.x + sign * dx * length, y = tip.y + sign * dy * length;
    return [tip, { x: x - dy * radius, y: y + dx * radius }, { x: x + dy * radius, y: y - dx * radius }];
  });
}

export function validateDimensions(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('尺寸数据为空');
  const keys = new Set();
  const categories = new Set(['kitchen', 'cabinetBody', 'baseCabinet', 'wallCabinet', 'countertop']);
  for (const item of items) {
    const key = `${item.category}:${item.id}`;
    const points = item.endpoints;
    if (keys.has(key) || !categories.has(item.category) || typeof item.label !== 'string' ||
        !['X', 'Y', 'Z'].includes(item.axis) || !Number.isFinite(item.value) || item.value <= 0 ||
        !Array.isArray(points) || points.length !== 2 ||
        points.some(p => !Array.isArray(p) || p.length !== 3 || p.some(v => !Number.isFinite(v)))) {
      throw new Error(`尺寸数据无效：${key}`);
    }
    keys.add(key);
    const delta = points[1].map((v, i) => v - points[0][i]);
    if (Math.abs(Math.hypot(...delta) - item.value) > .02 ||
        delta.some((v, i) => i !== 'XYZ'.indexOf(item.axis) && Math.abs(v) > .0001)) {
      throw new Error(`尺寸端点与轴向或数值不一致：${key}`);
    }
  }
  return items;
}

export function centeredOffset(box) {
  const center = box.getCenter(new THREE.Vector3());
  return new THREE.Vector3(-center.x, -box.min.y, -center.z);
}

export function projectedSize(box, direction) {
  const forward = direction.clone().normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();
  let halfWidth = 0, halfHeight = 0, halfDepth = 0;
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(.5);
  for (const x of [-half.x, half.x]) for (const y of [-half.y, half.y]) for (const z of [-half.z, half.z]) {
    const corner = new THREE.Vector3(x, y, z);
    halfWidth = Math.max(halfWidth, Math.abs(corner.dot(right)));
    halfHeight = Math.max(halfHeight, Math.abs(corner.dot(up)));
    halfDepth = Math.max(halfDepth, Math.abs(corner.dot(forward)));
  }
  return { halfWidth, halfHeight, halfDepth };
}

export function cameraFrame(box, aspect, direction, fov = 42) {
  const { halfWidth, halfHeight, halfDepth } = projectedSize(box, direction);
  const safeAspect = Math.max(.1, aspect);
  const halfView = Math.max(halfHeight, halfWidth / safeAspect, .4) * 1.25;
  const distance = halfDepth + halfView / Math.tan(THREE.MathUtils.degToRad(fov / 2));
  return { target: box.getCenter(new THREE.Vector3()), halfView, distance };
}
