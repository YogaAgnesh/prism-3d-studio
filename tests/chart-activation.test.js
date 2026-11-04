import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateChartState } from '../src/state/chart-activation.js';

test('project hydration selects the imported first chart without copying stale UI state into it', () => {
  const fields = [{ id: 'c1', label: 'Stage' }];
  const importedFirst = {
    id: 'chart-1', chartType: 'columns3d', title: 'Imported first chart',
    mappings: { x: 'c1' }, settings: { palette: 'sunset', aggregation: 'sum' },
  };
  const state = {
    activeChartId: null,
    chartType: 'mesh',
    mappings: {},
    settings: { title: 'Pre-import stale chart', palette: 'electric' },
    charts: [importedFirst],
  };

  hydrateChartState(state, 'chart-1', (id) => fields.find((field) => field.id === id), { columns3d: 'columns' });

  assert.equal(state.chartType, 'columns');
  assert.equal(state.settings.title, 'Imported first chart');
  assert.equal(state.settings.palette, 'sunset');
  assert.equal(state.charts[0].title, 'Imported first chart');
  assert.equal(state.mappings.x, fields[0]);
});
