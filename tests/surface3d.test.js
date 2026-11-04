import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSurface3d } from '../src/charts/build-surface3d.js';

const fields = {
  x: { id: 'x', label: 'Stage', type: 'text', semanticType: 'category' },
  y: { id: 'y', label: 'Region', type: 'text', semanticType: 'category' },
  z: { id: 'z', label: 'Pipeline', type: 'currency', semanticType: 'currency', currency: 'USD' },
  color: { id: 'color', label: 'Probability', type: 'percent', semanticType: 'percent' },
};

test('reshapes categories into an ordered matrix and preserves missing cells', () => {
  const dataset = { fields: Object.values(fields), rows: [
    { x: 'Discover', y: 'North', z: 10 },
    { x: 'Discover', y: 'South', z: 20 },
    { x: 'Develop', y: 'North', z: 30 },
  ] };
  const spec = buildSurface3d(dataset, { x: fields.x, y: fields.y, z: fields.z }, {});

  assert.deepEqual(spec.data[0].z, [[10, 30], [20, null]]);
  assert.equal(spec.data[0].connectgaps, false);
  assert.deepEqual(spec.layout.scene.xaxis.ticktext, ['Discover', 'Develop']);
  assert.equal(spec.stats.missingCells, 1);
  assert.equal(spec.stats.interpolated, false);
});

test('aggregates duplicate cells and exposes surface color, contours, and lighting', () => {
  const dataset = { fields: Object.values(fields), rows: [
    { x: 'Discover', y: 'North', z: 10, color: 0.2 },
    { x: 'Discover', y: 'North', z: 30, color: 0.6 },
    { x: 'Develop', y: 'North', z: 20, color: 0.8 },
  ] };
  const spec = buildSurface3d(dataset, {
    x: fields.x, y: fields.y, z: fields.z, surfaceColor: fields.color,
  }, {
    aggregation: 'sum', showContours: true, projectContours: true,
    lighting: { ambient: 0.65, diffuse: 0.75, specular: 0.35, roughness: 0.4, fresnel: 0.15 },
  });

  assert.deepEqual(spec.data[0].z, [[40, 20]]);
  assert.deepEqual(spec.data[0].surfacecolor, [[0.4, 0.8]]);
  assert.equal(spec.data[0].contours.z.project.z, true);
  assert.equal(spec.data[0].lighting.ambient, 0.65);
  assert.equal(spec.data[0].colorbar.title.text, 'Probability');
  assert.equal(spec.data[0].colorbar.tickformat, '.0%');
  assert.equal(spec.stats.duplicateCells, 1);
});

test('coerces formatted CSV measures before surface aggregation', () => {
  const dataset = { fields: Object.values(fields), rows: [
    { x: 'Discover', y: 'North', z: '$1,280,000', color: '22%' },
    { x: 'Develop', y: 'North', z: '$2,400,000', color: '46%' },
  ] };
  const spec = buildSurface3d(dataset, {
    x: fields.x, y: fields.y, z: fields.z, surfaceColor: fields.color,
  }, {});

  assert.deepEqual(spec.data[0].z, [[1_280_000, 2_400_000]]);
  assert.deepEqual(spec.data[0].surfacecolor, [[0.22, 0.46]]);
  assert.equal(spec.stats.excludedRows, 0);
});
