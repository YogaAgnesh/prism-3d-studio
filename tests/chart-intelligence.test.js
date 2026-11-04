import test from 'node:test';
import assert from 'node:assert/strict';
import { getChartContract, listChartContracts, evaluateRoleCompatibility } from '../src/charts/registry.js';
import { recommendVisualizations } from '../src/charts/recommend.js';
import { assessChartHealth } from '../src/charts/health.js';

const salesforceFields = [
  { id: 'stage', label: 'Stage', type: 'text', semanticType: 'category', uniqueCount: 5 },
  { id: 'period', label: 'Actual Close Period (13P)', type: 'text', semanticType: 'fiscalPeriod', uniqueCount: 13 },
  { id: 'split', label: 'Split Amount (USD)', type: 'currency', semanticType: 'currency', uniqueCount: 4_000 },
  { id: 'prob', label: 'Probability (%)', type: 'percent', semanticType: 'percent', uniqueCount: 96 },
  { id: 'opp', label: 'Opportunity Name', type: 'text', semanticType: 'identifier', uniqueCount: 5_000 },
];

test('registers only the focused 3D chart contracts', () => {
  assert.deepEqual(listChartContracts().map((contract) => contract.id), [
    'scatter3d', 'columns3d', 'lollipop3d', 'surface3d',
  ]);
  assert.equal(getChartContract('columns3d').version, 1);
  assert.equal(getChartContract('line'), null);
  assert.equal(getChartContract('line3d'), null);
});

test('allows every supported field semantic on X and Y while flagging dense identifiers for transformation', () => {
  const contract = getChartContract('scatter3d');
  const fields = [
    { type: 'number', semanticType: 'number' },
    { type: 'text', semanticType: 'category' },
    { type: 'date', semanticType: 'date' },
    { type: 'boolean', semanticType: 'boolean' },
    { type: 'text', semanticType: 'fiscalPeriod' },
  ];
  for (const [index, field] of fields.entries()) {
    assert.notEqual(evaluateRoleCompatibility(contract, 'x', { id: `f${index}`, label: `Field ${index}`, uniqueCount: 10, ...field }).state, 'invalid');
    assert.notEqual(evaluateRoleCompatibility(contract, 'y', { id: `f${index}`, label: `Field ${index}`, uniqueCount: 10, ...field }).state, 'invalid');
  }
  assert.equal(evaluateRoleCompatibility(contract, 'x', {
    id: 'account', label: 'Account ID', type: 'text', semanticType: 'identifier', uniqueCount: 5_000,
  }).state, 'transform');
});

test('distinguishes recommended, transformable, and invalid field-role mappings', () => {
  const contract = getChartContract('surface3d');
  assert.equal(evaluateRoleCompatibility(contract, 'x', salesforceFields[0]).state, 'recommended');
  assert.equal(evaluateRoleCompatibility(contract, 'x', { ...salesforceFields[0], uniqueCount: 4_500 }).state, 'transform');
  assert.equal(evaluateRoleCompatibility(contract, 'z', salesforceFields[0]).state, 'invalid');
});

test('recommends deterministic Salesforce recipes with reasons and complete mappings', () => {
  const recommendations = recommendVisualizations(salesforceFields);
  assert.equal(recommendations[0].chartType, 'columns3d');
  assert.deepEqual(recommendations[0].mappings, { x: 'stage', series: 'period', z: 'split' });
  assert.match(recommendations[0].reason, /compare/i);
  assert.equal(recommendations.every((item) => item.score <= 100 && item.score >= 0), true);
});

test('chart health gives actionable recovery for excessive marks and empty filters', () => {
  const health = assessChartHealth({
    contract: getChartContract('scatter3d'),
    diagnostics: { sourceRows: 80_000, filteredRows: 0, renderedPoints: 12_000, excludedRows: 80_000 },
  });
  assert.equal(health.status, 'needs-attention');
  assert.equal(health.publishable, false);
  assert.equal(health.issues.some((issue) => issue.action === 'clearFilters'), true);
  assert.equal(health.issues.some((issue) => issue.action === 'enableSampling'), true);
});

test('chart health warns whenever a chart omits groups or samples observations', () => {
  const health = assessChartHealth({
    contract: getChartContract('columns3d'),
    diagnostics: { sourceRows: 100, filteredRows: 100, groups: 60, omittedGroups: 40, sampledOutRows: 25 },
  });
  assert.equal(health.status, 'needs-attention');
  assert.equal(health.issues.some((issue) => issue.code === 'top-n'), true);
  assert.equal(health.issues.some((issue) => issue.code === 'sampled-rows'), true);
});

test('chart health distinguishes Building from Presentation ready', () => {
  const building = assessChartHealth({ contract: getChartContract('scatter3d'), diagnostics: {} });
  assert.equal(building.status, 'building');
  assert.equal(building.label, 'Building');
  assert.equal(building.publishable, false);

  const ready = assessChartHealth({
    contract: getChartContract('scatter3d'),
    diagnostics: { sourceRows: 20, validRows: 20, renderedPoints: 20 },
    spec: { layout: { scene: {
      xaxis: { title: { text: 'Region' }, visible: true },
      yaxis: { title: { text: 'Segment' }, visible: true },
      zaxis: { title: { text: 'Pipeline (USD)' }, visible: true },
    } } },
  });
  assert.equal(ready.status, 'presentation-ready');
  assert.equal(ready.label, 'Presentation ready');
  assert.equal(ready.publishable, true);
});

test('chart health gives trace-specific recovery for interpolated surfaces', () => {
  const surface = assessChartHealth({
    contract: getChartContract('surface3d'),
    diagnostics: { sourceRows: 10, groups: 6, gridCells: 9, missingCells: 3, gridDensity: 2 / 3, interpolated: true },
  });
  assert.equal(surface.issues.some((issue) => issue.action === 'preserveSurfaceGaps'), true);
  assert.equal(surface.status, 'needs-attention');
});
