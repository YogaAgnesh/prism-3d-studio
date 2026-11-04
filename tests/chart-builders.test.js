import test from 'node:test';
import assert from 'node:assert/strict';

import { buildChartSpec } from '../src/chart-builders.js';

const fields = {
  x: { id: 'x', label: 'Probability', type: 'percent' },
  y: { id: 'y', label: 'Advise Amount', type: 'currency', currency: 'USD' },
  z: { id: 'z', label: 'Implement Amount', type: 'currency', currency: 'USD' },
  size: { id: 'size', label: 'Total Amount', type: 'currency', currency: 'USD' },
  label: { id: 'label', label: 'Opportunity', type: 'text' },
  stage: { id: 'stage', label: 'Stage', type: 'text' },
  region: { id: 'region', label: 'Geography', type: 'text' },
};

test('builds a Bubble scatter3d trace and reports excluded rows', () => {
  const dataset = {
    fields: Object.values(fields),
    rows: [
      { x: 0.2, y: 100, z: 10, size: 400, label: 'Alpha', stage: 'Discover' },
      { x: 0.8, y: 300, z: 30, size: 900, label: 'Beta', stage: 'Close' },
      { x: null, y: 500, z: 50, size: 1000, label: 'Invalid', stage: 'Develop' },
    ],
  };
  const spec = buildChartSpec('bubble', dataset, {
    x: fields.x,
    y: fields.y,
    z: fields.z,
    size: fields.size,
    color: fields.stage,
    label: fields.label,
  }, { palette: 'spectrum' });

  assert.equal(spec.data[0].type, 'scatter3d');
  assert.deepEqual(spec.data[0].x, [0.2, 0.8]);
  assert.deepEqual(spec.data[0].y, [100, 300]);
  assert.deepEqual(spec.data[0].z, [10, 30]);
  assert.deepEqual(spec.data[0].text, ['Alpha', 'Beta']);
  assert.equal(spec.stats.renderedPoints, 2);
  assert.equal(spec.stats.excludedRows, 1);
  assert.equal(spec.data[0].marker.line.width, 0);
  assert.equal(spec.data[1].hoverinfo, 'skip');
});

test('encodes categorical bubble axes with readable tick labels', () => {
  const spec = buildChartSpec('bubble', { fields: [fields.stage, fields.region, fields.z], rows: [
    { stage: 'Discover', region: 'North', z: 10 }, { stage: 'Close', region: 'South', z: 20 },
  ] }, { x: fields.stage, y: fields.region, z: fields.z }, {});
  assert.deepEqual(spec.data[0].x, [0, 1]);
  assert.deepEqual(spec.layout.scene.xaxis.ticktext, ['Discover', 'Close']);
  assert.deepEqual(spec.layout.scene.yaxis.ticktext, ['North', 'South']);
});

const aggregateDataset = {
  fields: [fields.stage, fields.region, fields.z],
  rows: [
    { stage: 'Discover', region: 'North', z: 10 },
    { stage: 'Discover', region: 'South', z: 20 },
    { stage: 'Develop', region: 'North', z: 30 },
  ],
};

test('builds 3D Columns as rounded cylinder geometry with category ticks', () => {
  const spec = buildChartSpec('columns', aggregateDataset, {
    x: fields.stage,
    series: fields.region,
    z: fields.z,
  }, { aggregation: 'sum' });

  assert.equal(spec.data[0].type, 'mesh3d');
  assert.ok(spec.data[0].x.length > 24);
  assert.equal(spec.data[0].flatshading, false);
  assert.equal(Math.max(...spec.data[0].z), 30);
  assert.deepEqual(spec.layout.scene.xaxis.ticktext, ['Discover', 'Develop']);
  assert.deepEqual(spec.layout.scene.yaxis.ticktext, ['North', 'South']);
  assert.equal(spec.stats.groups, 3);
});

test('builds 3D Lollipop stems and markers from aggregated groups', () => {
  const spec = buildChartSpec('lollipop', aggregateDataset, {
    x: fields.stage,
    series: fields.region,
    z: fields.z,
  }, { aggregation: 'sum' });

  assert.equal(spec.data[0].type, 'scatter3d');
  assert.equal(spec.data[0].mode, 'lines');
  assert.deepEqual(spec.data[0].z.slice(0, 6), [0, 10, null, 0, 20, null]);
  assert.equal(spec.data[1].mode, 'markers');
  assert.deepEqual(spec.data[1].z, [10, 20, 30]);
});

test('builds a Surface matrix with nulls for missing category intersections', () => {
  const spec = buildChartSpec('surface', aggregateDataset, {
    x: fields.stage,
    y: fields.region,
    z: fields.z,
  }, { aggregation: 'sum' });

  assert.equal(spec.data[0].type, 'surface');
  assert.deepEqual(spec.data[0].z, [[10, 30], [20, null]]);
  assert.deepEqual(spec.layout.scene.xaxis.ticktext, ['Discover', 'Develop']);
});

test('rejects chart styles removed from the focused product', () => {
  for (const type of ['line', 'line3d', 'ribbons', 'mesh']) assert.throws(() => buildChartSpec(type, aggregateDataset, {}, {}), /Unsupported chart type/);
});

test('uses readable scene tokens in both light and dark themes', () => {
  const mappings = { x: fields.stage, series: fields.region, z: fields.z };
  const dark = buildChartSpec('columns', aggregateDataset, mappings, { theme: 'dark' });
  const light = buildChartSpec('columns', aggregateDataset, mappings, { theme: 'light', background: '#F7F9FD', plotBackground: '#FFFFFF' });

  assert.equal(dark.layout.title.font.color, '#F7F8FF');
  assert.equal(dark.layout.scene.xaxis.backgroundcolor, '#151B2E');
  assert.equal(light.layout.title.font.color, '#0F172A');
  assert.equal(light.layout.scene.xaxis.backgroundcolor, 'rgba(241,245,249,.72)');
});

test('discloses deterministic sampling and top-N aggregation transformations', () => {
  const scatterRows = Array.from({ length: 8_100 }, (_, index) => ({ x: index / 10_000, y: index, z: index * 2 }));
  const scatter = buildChartSpec('bubble', { fields: [fields.x, fields.y, fields.z], rows: scatterRows }, { x: fields.x, y: fields.y, z: fields.z }, {});
  assert.equal(scatter.stats.downsampled, true);
  assert.equal(scatter.stats.sampledOutRows, 100);
  assert.equal(scatter.stats.samplingStrategy, 'deterministic-hash');

  const categoryRows = Array.from({ length: 70 }, (_, index) => ({ stage: `Stage ${index}`, z: index + 1 }));
  const columns = buildChartSpec('columns', { fields: [fields.stage, fields.z], rows: categoryRows }, { x: fields.stage, z: fields.z }, { aggregation: 'sum' });
  assert.equal(columns.stats.omittedGroups, 10);
  assert.equal(columns.stats.groupStrategy, 'top-by-absolute-value');
});

test('uses an orthographic straight-front camera preset', () => {
  const period = { id: 'period', label: 'Fiscal period', type: 'text', semanticType: 'fiscalPeriod' };
  const spec = buildChartSpec('columns', { fields: [period, fields.z], rows: [{ period: 'FY27 - P01', z: 1 }] }, { x: period, z: fields.z }, { camera: 'front', perspective: false });
  assert.equal(spec.layout.scene.camera.projection.type, 'orthographic');
  assert.equal(spec.layout.scene.camera.eye.x, 0);
});
