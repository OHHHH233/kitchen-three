import * as THREE from './public/vendor/three/build/three.module.js';

// Recenter on the picked surface without rotating the current viewing direction.
export function tapFocusFrame(camera, target, point, { factor = 1.6, minDistance = .6, maxZoom = 8 } = {}) {
  const direction = camera.position.clone().sub(target).normalize();
  if (camera.isOrthographicCamera) {
    const shift = point.clone().sub(target);
    shift.addScaledVector(direction, -shift.dot(direction));
    return { position: camera.position.clone().add(shift), target: target.clone().add(shift),
      zoom: Math.min(maxZoom, camera.zoom * factor) };
  }
  const distance = Math.max(minDistance, camera.position.clone().sub(point).dot(direction) / factor);
  return { position: point.clone().addScaledVector(direction, distance), target: point.clone(), zoom: camera.zoom };
}

// Observe pointer events without taking them away from OrbitControls.
export function bindTapToZoom(element, onTap, { isEnabled = () => true, onStart = () => {} } = {}) {
  const pointers = new Map();
  const down = event => {
    onStart();
    const tap = { x: event.clientX, y: event.clientY, started: Date.now(),
      cancelled: event.button !== 0 || !isEnabled(event) || pointers.size > 0 };
    if (pointers.size) for (const pointer of pointers.values()) pointer.cancelled = true;
    pointers.set(event.pointerId, tap);
  };
  const move = event => {
    const tap = pointers.get(event.pointerId);
    if (tap && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 10) tap.cancelled = true;
  };
  const up = event => {
    const tap = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (tap && !tap.cancelled && Date.now() - tap.started <= 350 &&
        Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 10) onTap(event);
  };
  const cancel = event => pointers.delete(event.pointerId);
  const events = { pointerdown: down, pointermove: move, pointerup: up,
    pointercancel: cancel, lostpointercapture: cancel };
  const listenerOptions = { capture: true };
  for (const [type, listener] of Object.entries(events)) element.addEventListener(type, listener, listenerOptions);
  return () => {
    for (const [type, listener] of Object.entries(events)) element.removeEventListener(type, listener, listenerOptions);
    pointers.clear();
  };
}
