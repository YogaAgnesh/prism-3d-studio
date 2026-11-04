import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioState, addChartTile, saveChartAndCreateDraft, setTheme } from '../src/state/studio-store.js';
import { exportProject, importProject } from '../src/state/project-io.js';

test('creates a guided Command Center with fixed chart tiles and matched themes', () => {
  const initial = createStudioState();
  const withChart = addChartTile(initial, { chartType: 'columns3d', title: 'Pipeline by stage' });
  const light = setTheme(withChart, 'light');

  assert.equal(initial.mode, 'guided');
  assert.equal(withChart.charts[0].tile.width, 640);
  assert.equal(withChart.charts[0].tile.height, 420);
  assert.equal(light.theme, 'light');
  assert.equal(withChart.theme, 'light');
});

test('saving preserves a configured chart and activates an independent working copy', () => {
  const initial = addChartTile(createStudioState(), { id: 'chart-1', chartType: 'scatter3d', title: 'Pipeline', mappings: { x: 'industry' } });
  const next = saveChartAndCreateDraft(initial, initial.charts[0]);
  assert.equal(next.charts.length, 2);
  assert.equal(next.charts[0].title, 'Pipeline');
  assert.notEqual(next.activeChartId, 'chart-1');
  assert.deepEqual(next.charts[1].mappings, { x: 'industry' });
  assert.equal(next.charts[1].title, 'New chart');
});

test('project exports contain semantic configuration but never workbook rows', () => {
  const state = {
    ...createStudioState(),
    source: { fileName: 'Sales.xlsx', sheetName: 'Pipeline', rowCount: 100_000 },
    fields: [{ id: 'c0', label: 'Stage', semanticType: 'category', type: 'text' }],
    rows: [{ c0: 'Closed Won' }],
    charts: [{ id: 'chart-1', chartType: 'columns3d', mappings: { x: 'c0' }, tile: { width: 640, height: 420 } }],
  };
  const project = exportProject(state);
  const serialized = JSON.stringify(project);

  assert.equal(project.version, 2);
  assert.equal(serialized.includes('Closed Won'), false);
  assert.equal(serialized.includes('rows'), false);
  assert.equal(project.dataSignature.fields[0].label, 'Stage');
});

test('project import reconciles renamed field ids by normalized labels', () => {
  const project = {
    product: 'Prism', version: 2,
    dataSignature: { fields: [{ id: 'old-stage', label: 'Stage', semanticType: 'category' }] },
    workspace: { theme: 'dark', mode: 'advanced', charts: [{ id: 'chart-1', chartType: 'columns3d', mappings: { x: 'old-stage' } }], filters: [] },
  };
  const imported = importProject(project, [{ id: 'c14', label: ' Stage ', semanticType: 'category' }]);

  assert.equal(imported.workspace.charts[0].mappings.x, 'c14');
  assert.deepEqual(imported.diagnostics.missingFields, []);
});

test('project import rejects unknown chart contracts and normalizes untrusted identifiers', () => {
  const base = {
    product: 'Prism', version: 2,
    dataSignature: { fields: [{ id: 'old-stage', label: 'Stage', semanticType: 'category' }] },
    workspace: { theme: 'dark', mode: 'guided', charts: [], filters: [] },
  };
  assert.throws(() => importProject({
    ...base,
    workspace: { ...base.workspace, charts: [{ id: 'bad', chartType: 'javascript:alert(1)', mappings: {} }] },
  }, []), /unsupported chart type/i);

  const imported = importProject({
    ...base,
    workspace: {
      ...base.workspace,
      charts: [{ id: '\" onmouseover=alert(1)', chartType: 'columns3d', title: '<img>', mappings: { x: 'old-stage' } }],
      filters: [{ id: '\" onclick=alert(1)', fieldId: 'old-stage', operator: 'equals', value: 'Closed Won' }],
    },
  }, [{ id: 'c14', label: 'Stage', semanticType: 'category' }]);

  assert.equal(imported.workspace.charts[0].id, 'chart-1');
  assert.equal(imported.workspace.filters[0].id, 'filter-1');
  assert.equal(imported.workspace.charts[0].title, '<img>');
});

test('project import preserves calculated-field dependencies in chart mappings', () => {
  const project = {
    product: 'Prism', version: 2,
    dataSignature: { fields: [
      { id: 'amount-old', label: 'Split Amount (USD)', semanticType: 'currency' },
      { id: 'weighted-old', label: 'Weighted Pipeline', semanticType: 'currency' },
    ] },
    workspace: {
      theme: 'dark', mode: 'guided', filters: [],
      calculations: [{ id: 'weighted-old', label: 'Weighted Pipeline', expression: '[Split Amount (USD)] * 0.5', type: 'currency' }],
      charts: [{ id: 'chart-old', chartType: 'scatter3d', title: 'Weighted', mappings: { x: 'amount-old', y: 'amount-old', z: 'weighted-old' } }],
    },
  };
  const imported = importProject(project, [{ id: 'c4', label: 'Split Amount (USD)', semanticType: 'currency' }]);

  assert.equal(imported.workspace.calculations[0].id, 'calc_1');
  assert.equal(imported.workspace.charts[0].mappings.z, 'calc_1');
  assert.deepEqual(imported.diagnostics.missingFields, []);
});

test('project round-trip preserves axis settings, aggregation, sampling, and semantic overrides', () => {
  const project = exportProject({
    ...createStudioState(),
    fields: [{ id: 'amount', label: 'Amount', type: 'number', semanticType: 'currency', inferredType: 'number', inferredSemanticType: 'number', override: { active: true } }],
    charts: [{
      id: 'chart-old', chartType: 'columns3d', title: 'Revenue', mappings: { x: 'amount', z: 'amount' }, tile: { width: 640, height: 420 },
      settings: { aggregation: 'maximum', xTitle: 'Account', zTitle: 'Revenue', zMin: 10, zMax: 50, pointLimit: 4_000, groupLimit: 120 },
    }],
  });
  const imported = importProject(project, [{ id: 'c1', label: 'Amount', type: 'number', semanticType: 'number' }]);
  const settings = imported.workspace.charts[0].settings;

  assert.equal(settings.aggregation, 'maximum');
  assert.equal(settings.xTitle, 'Account');
  assert.equal(settings.zMin, 10);
  assert.equal(settings.zMax, 50);
  assert.equal(settings.pointLimit, 4_000);
  assert.equal(settings.groupLimit, 120);
  assert.deepEqual(imported.workspace.fieldOverrides, [{ fieldId: 'c1', semanticType: 'currency' }]);
});

test('project import rejects retired Line charts', () => {
  assert.throws(() => importProject({
    product: 'Prism', version: 2, dataSignature: { fields: [] },
    workspace: { theme: 'light', mode: 'guided', filters: [], calculations: [], charts: [{ id: 'line-old', chartType: 'line3d', mappings: {} }] },
  }, []), /unsupported chart type/i);
});
