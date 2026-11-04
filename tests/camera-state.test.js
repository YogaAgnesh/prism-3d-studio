import test from 'node:test';
import assert from 'node:assert/strict';

import { cameraRelayoutPatch, captureCamera, normalizeCamera } from '../src/state/camera-state.js';

test('captures a nested Plotly 3D camera event without mutating prior settings', () => {
  const previous = { camera: 'perspective', title: 'Pipeline' };
  const next = captureCamera(previous, {
    'scene.camera': {
      eye: { x: 2, y: 1, z: 0.8 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 },
    },
  });

  assert.notEqual(next, previous);
  assert.equal(previous.authoredCamera, undefined);
  assert.equal(next.camera, 'custom');
  assert.equal(next.authoredCamera.eye.x, 2);
});

test('merges flattened partial relayout coordinates and rejects non-finite values', () => {
  const previous = {
    camera: 'custom',
    authoredCamera: {
      eye: { x: 1, y: 1, z: 1 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 },
    },
  };
  const next = captureCamera(previous, {
    'scene.camera.eye.x': 1.8,
    'scene.camera.eye.y': Number.NaN,
    'scene.camera.center.z': 0.2,
  });

  assert.deepEqual(next.authoredCamera.eye, { x: 1.8, y: 1, z: 1 });
  assert.equal(next.authoredCamera.center.z, 0.2);
});

test('creates a safe reset patch from an authored or fallback camera', () => {
  const camera = normalizeCamera({ eye: { x: 2, y: 1, z: 0.8 } });
  assert.deepEqual(camera.eye, { x: 2, y: 1, z: 0.8 });
  assert.deepEqual(camera.up, { x: 0, y: 0, z: 1 });
  assert.deepEqual(cameraRelayoutPatch({ authoredCamera: camera }), { 'scene.camera': camera });
});
