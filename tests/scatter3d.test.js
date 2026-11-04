import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScatter3d } from '../src/charts/build-scatter3d.js';

const fields = {
  region: { id: 'region', label: 'Region', type: 'text', semanticType: 'category' },
  date: { id: 'date', label: 'Close date', type: 'date', semanticType: 'date' },
  value: { id: 'value', label: 'Pipeline', type: 'currency', semanticType: 'currency', currency: 'USD' },
  size: { id: 'size', label: 'Employees', type: 'number', semanticType: 'number' },
  label: { id: 'label', label: 'Account', type: 'text', semanticType: 'identifier' },
};

test('builds Scatter with universal axes, area sizing, and business hover content', () => {
  const dataset = { fields: Object.values(fields), rows: [
    { region: 'East', date: '2026-08-01', value: 10, size: 100, label: 'Alpha' },
    { region: 'West', date: '2026-09-01', value: 30, size: 900, label: 'Beta' },
    { region: 'East', date: 'invalid', value: 20, size: 400, label: 'Excluded' },
  ] };
  const spec = buildScatter3d(dataset, {
    x: fields.region, y: fields.date, z: fields.value, size: fields.size, label: fields.label,
  }, { markerMode: 'lines+markers', markerScale: 1 });

  assert.equal(spec.data[0].type, 'scatter3d');
  assert.equal(spec.data[0].mode, 'lines+markers');
  assert.equal(spec.data[0].marker.sizemode, 'area');
  assert.deepEqual(spec.data[0].x, [0, 1]);
  assert.deepEqual(spec.layout.scene.xaxis.ticktext, ['East', 'West']);
  assert.match(spec.layout.scene.zaxis.title.text, /USD/);
  assert.match(spec.data[0].hovertemplate, /Region/);
  assert.equal(spec.stats.excludedRows, 1);
});

test('discloses deterministic sampling and continuous color encoding', () => {
  const rows = Array.from({ length: 120 }, (_, index) => ({
    region: `R${index % 3}`, date: `2026-08-${String((index % 28) + 1).padStart(2, '0')}`, value: index + 1,
  }));
  const spec = buildScatter3d({ fields: Object.values(fields), rows }, {
    x: fields.region, y: fields.date, z: fields.value, color: fields.value,
  }, { pointLimit: 100, palette: 'spectrum' });

  assert.equal(spec.stats.renderedPoints, 100);
  assert.equal(spec.stats.sampledOutRows, 20);
  assert.equal(spec.stats.samplingStrategy, 'deterministic-hash');
  assert.equal(spec.data[0].marker.showscale, true);
  assert.equal(spec.data[0].marker.colorbar.title.text, 'Pipeline (USD)');
});

test('plots formatted CSV measures and uses them for marker sizing', () => {
  const dataset = { fields: Object.values(fields), rows: [
    { region: 'East', date: '2026-08-01', value: '$1,280,000', size: '$100', label: 'Alpha' },
    { region: 'West', date: '2026-09-01', value: '$2,400,000', size: '$900', label: 'Beta' },
  ] };
  const spec = buildScatter3d(dataset, {
    x: fields.region, y: fields.date, z: fields.value, size: fields.size, label: fields.label,
  }, {});

  assert.deepEqual(spec.data[0].z, [1_280_000, 2_400_000]);
  assert.ok(spec.data[0].marker.size[1] > spec.data[0].marker.size[0]);
  assert.equal(spec.stats.renderedPoints, 2);
});
