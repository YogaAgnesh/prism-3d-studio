import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeAxis, formatAxisTitle, sortCoordinateValues } from '../src/charts/axis-encoding.js';

test('encodes repeated categories with stable readable tick labels', () => {
  const encoded = encodeAxis(['North', 'South', 'North'], {
    id: 'region', label: 'Region', type: 'text', semanticType: 'category',
  });

  assert.deepEqual(encoded.values, [0, 1, 0]);
  assert.deepEqual(encoded.ticks, { values: [0, 1], text: ['North', 'South'] });
  assert.equal(encoded.axisType, 'category-encoded');
  assert.deepEqual(encoded.diagnostics, { invalidCount: 0, uniqueCount: 2, encodedCategorically: true });
});

test('orders fiscal categories chronologically instead of using workbook order', () => {
  const field = { id: 'period', label: 'Period', type: 'text', semanticType: 'fiscalPeriod' };
  const encoded = encodeAxis(['FY27 - P02', 'FY26 - P13', 'FY27 - P01'], field);

  assert.deepEqual(encoded.values, [2, 0, 1]);
  assert.deepEqual(encoded.ticks.text, ['FY26 - P13', 'FY27 - P01', 'FY27 - P02']);
  assert.deepEqual(sortCoordinateValues(['FY27 - P02', 'FY26 - P13', 'FY27 - P01'], field), ['FY26 - P13', 'FY27 - P01', 'FY27 - P02']);
});

test('encodes booleans as labeled categories and counts invalid numeric values', () => {
  const booleans = encodeAxis([true, false, true], { id: 'active', label: 'Active', type: 'boolean' });
  assert.deepEqual(booleans.values, [0, 1, 0]);
  assert.deepEqual(booleans.ticks.text, ['True', 'False']);

  const numeric = encodeAxis([10, '20', 'bad', null], { id: 'amount', label: 'Amount', type: 'number' });
  assert.deepEqual(numeric.values, [10, 20, null, null]);
  assert.equal(numeric.axisType, 'linear');
  assert.equal(numeric.diagnostics.invalidCount, 2);
});

test('coerces spreadsheet-formatted measures before plotting coordinates', () => {
  const currency = encodeAxis(['$1,280,000', '$2,400,000', 'bad'], {
    id: 'amount', label: 'Amount', type: 'currency', semanticType: 'currency', currency: 'USD',
  });
  const percent = encodeAxis(['22%', '46%', null], {
    id: 'probability', label: 'Probability', type: 'percent', semanticType: 'percent',
  });

  assert.deepEqual(currency.values, [1_280_000, 2_400_000, null]);
  assert.deepEqual(percent.values, [0.22, 0.46, null]);
  assert.equal(currency.diagnostics.invalidCount, 1);
  assert.equal(percent.diagnostics.invalidCount, 1);
});

test('normalizes valid dates and produces data-aware axis titles', () => {
  const encoded = encodeAxis([new Date('2026-08-24T00:00:00Z'), '2026-09-01', 'invalid'], {
    id: 'close', label: 'Close date', type: 'date', semanticType: 'date',
  });
  assert.deepEqual(encoded.values, ['2026-08-24T00:00:00.000Z', '2026-09-01T00:00:00.000Z', null]);
  assert.equal(encoded.axisType, 'date');
  assert.equal(encoded.diagnostics.invalidCount, 1);

  assert.equal(formatAxisTitle({ label: 'Pipeline', currency: 'USD' }, { aggregation: 'sum', displayUnit: 'millions' }), 'Pipeline — Sum (USD millions)');
});
