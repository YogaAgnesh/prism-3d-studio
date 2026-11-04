import test from 'node:test';
import assert from 'node:assert/strict';

import { autoMapFields } from '../src/charts/auto-map.js';
import { CHART_SCHEMAS } from '../src/chart-schemas.js';

const fields = [
  { id: 'name', label: 'Opportunity Name', type: 'text', semanticType: 'identifier', roleKind: 'dimension', uniqueCount: 12 },
  { id: 'stage', label: 'Stage', type: 'text', semanticType: 'category', roleKind: 'dimension', uniqueCount: 4 },
  { id: 'geography', label: 'Geography', type: 'text', semanticType: 'geography', roleKind: 'dimension', uniqueCount: 4 },
  { id: 'probability', label: 'Probability (%)', type: 'percent', semanticType: 'percent', roleKind: 'measure', uniqueCount: 12 },
  { id: 'advise', label: 'Advise Amount', type: 'currency', semanticType: 'currency', roleKind: 'measure', uniqueCount: 12 },
  { id: 'total', label: 'Total Global Opportunity Amount', type: 'currency', semanticType: 'currency', roleKind: 'measure', uniqueCount: 12 },
];

test('surface auto-map favors low-cardinality dimensions for a visible grid', () => {
  const mappings = autoMapFields(CHART_SCHEMAS.surface, fields);

  assert.equal(mappings.x.id, 'stage');
  assert.equal(mappings.y.id, 'geography');
  assert.equal(mappings.z.id, 'total');
});

test('scatter auto-map keeps continuous analytical coordinates', () => {
  const mappings = autoMapFields(CHART_SCHEMAS.bubble, fields);

  assert.equal(mappings.x.id, 'probability');
  assert.equal(mappings.y.id, 'advise');
  assert.equal(mappings.z.id, 'total');
});
