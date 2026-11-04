const DEFAULT_CAMERA = Object.freeze({
  eye: Object.freeze({ x: 1.55, y: 1.55, z: 1.15 }),
  center: Object.freeze({ x: 0, y: 0, z: 0 }),
  up: Object.freeze({ x: 0, y: 0, z: 1 }),
});

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function vector(input, fallback) {
  return {
    x: finite(input?.x, fallback.x),
    y: finite(input?.y, fallback.y),
    z: finite(input?.z, fallback.z),
  };
}

export function normalizeCamera(input = {}, fallback = DEFAULT_CAMERA) {
  const camera = {
    eye: vector(input.eye, fallback.eye ?? DEFAULT_CAMERA.eye),
    center: vector(input.center, fallback.center ?? DEFAULT_CAMERA.center),
    up: vector(input.up, fallback.up ?? DEFAULT_CAMERA.up),
  };
  const projectionType = input.projection?.type ?? fallback.projection?.type;
  if (projectionType === 'perspective' || projectionType === 'orthographic') camera.projection = { type: projectionType };
  return camera;
}

function cameraUpdate(event = {}, current) {
  const nested = event['scene.camera'] ?? event.scene?.camera;
  let changed = Boolean(nested);
  const update = normalizeCamera(nested ?? {}, current);
  for (const vectorName of ['eye', 'center', 'up']) {
    for (const component of ['x', 'y', 'z']) {
      const key = `scene.camera.${vectorName}.${component}`;
      if (!(key in event)) continue;
      const value = Number(event[key]);
      if (!Number.isFinite(value)) continue;
      update[vectorName][component] = value;
      changed = true;
    }
  }
  const projection = event['scene.camera.projection.type'];
  if (projection === 'perspective' || projection === 'orthographic') {
    update.projection = { type: projection };
    changed = true;
  }
  return changed ? update : null;
}

export function captureCamera(settings = {}, relayoutEvent = {}) {
  const current = normalizeCamera(settings.authoredCamera ?? {});
  const authoredCamera = cameraUpdate(relayoutEvent, current);
  if (!authoredCamera) return settings;
  return { ...settings, camera: 'custom', authoredCamera };
}

export function cameraRelayoutPatch(settings = {}, fallbackCamera) {
  return { 'scene.camera': normalizeCamera(settings.authoredCamera ?? fallbackCamera ?? {}) };
}
