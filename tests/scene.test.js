import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlotlyConfig, buildSceneLayout, CAMERA_PRESETS } from '../src/charts/scene.js';

const mappings = {
  x: { id: 'region', label: 'Region', type: 'text', semanticType: 'category' },
  y: { id: 'segment', label: 'Segment', type: 'text', semanticType: 'category' },
  z: { id: 'pipeline', label: 'Pipeline', type: 'currency', currency: 'USD' },
};

test('builds a visible titled 3D scene with deterministic category ticks', () => {
  const layout = buildSceneLayout({
    mappings,
    settings: { title: 'Pipeline landscape', theme: 'dark', aspectmode: 'data' },
    ticks: { x: { values: [0, 1], text: ['East', 'West'] } },
  });

  assert.equal(layout.scene.xaxis.visible, true);
  assert.equal(layout.scene.xaxis.showline, true);
  assert.equal(layout.scene.xaxis.title.text, 'Region');
  assert.equal(layout.scene.yaxis.title.text, 'Segment');
  assert.equal(layout.scene.zaxis.title.text, 'Pipeline (USD)');
  assert.deepEqual(layout.scene.xaxis.ticktext, ['East', 'West']);
  assert.equal(layout.scene.aspectmode, 'data');
});

test('supports orthographic projection, manual aspect ratios, and authored cameras', () => {
  const authoredCamera = {
    eye: { x: 2, y: 1, z: 0.8 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 },
  };
  const layout = buildSceneLayout({
    mappings,
    settings: {
      theme: 'light', projection: 'orthographic', aspectmode: 'manual',
      aspectX: 1.5, aspectY: 1, aspectZ: 0.7, authoredCamera,
    },
  });

  assert.equal(layout.scene.camera.projection.type, 'orthographic');
  assert.equal(layout.scene.camera.eye.x, 2);
  assert.deepEqual(layout.scene.aspectratio, { x: 1.5, y: 1, z: 0.7 });
  assert.equal(layout.scene.xaxis.backgroundcolor, 'rgba(241,245,249,.72)');
  assert.equal(CAMERA_PRESETS.top.eye.z, 2.5);
});

test('creates responsive Plotly config with presentation-resolution exports', () => {
  const config = buildPlotlyConfig({ exportWidth: 1920, exportHeight: 1080 });
  assert.equal(config.responsive, true);
  assert.equal(config.displaylogo, false);
  assert.equal(config.scrollZoom, true);
  assert.deepEqual(config.toImageButtonOptions, {
    format: 'png', filename: 'prism-3d-chart', width: 1920, height: 1080, scale: 1,
  });
});
