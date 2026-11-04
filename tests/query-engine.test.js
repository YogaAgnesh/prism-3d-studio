import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFilter, normalizeFilterAst } from '../src/query/filter-compiler.js';
import { compileCalculation } from '../src/query/calculation-parser.js';
import { executeQuery } from '../src/query/query-engine.js';

const fields = [
  { id: 'period', label: 'Actual Close Period (13P)', type: 'text', semanticType: 'fiscalPeriod' },
  { id: 'amount', label: 'Split Amount (USD)', type: 'currency', semanticType: 'currency' },
  { id: 'probability', label: 'Probability (%)', type: 'percent', semanticType: 'percent' },
  { id: 'stage', label: 'Stage', type: 'text', semanticType: 'category' },
];

const rows = [
  { period: 'FY26 - P13', amount: 20_000_000, probability: 0.4, stage: 'Pipeline' },
  { period: 'FY27 - P01', amount: 12_000_000, probability: 0.8, stage: 'Closed Won' },
  { period: 'FY27 - P02', amount: 55_000_000, probability: 0.5, stage: 'Pipeline' },
  { period: 'FY27 - P03', amount: 40_000_000, probability: 0.25, stage: 'Closed Won' },
];

test('composes fiscal-period and numeric-range conditions without losing source rows', () => {
  const ast = normalizeFilterAst({
    kind: 'group',
    conjunction: 'and',
    children: [
      { kind: 'condition', fieldId: 'period', operator: 'startsWith', value: 'FY27' },
      { kind: 'condition', fieldId: 'amount', operator: 'between', value: 10_000_000, value2: 50_000_000 },
    ],
  });
  const predicate = compileFilter(ast, fields);
  const included = rows.filter(predicate);

  assert.deepEqual(included.map((row) => row.amount), [12_000_000, 40_000_000]);
  assert.equal(rows.length, 4);
});

test('supports nested OR groups and blank checks with deterministic semantics', () => {
  const predicate = compileFilter({
    kind: 'group', conjunction: 'or', children: [
      { kind: 'condition', fieldId: 'stage', operator: 'in', value: ['Closed Won'] },
      { kind: 'condition', fieldId: 'amount', operator: 'gt', value: 50_000_000 },
    ],
  }, fields);
  assert.deepEqual(rows.filter(predicate).map((row) => row.amount), [12_000_000, 55_000_000, 40_000_000]);
});

test('compiles calculated fields without eval and handles field labels containing punctuation', () => {
  const calculation = compileCalculation('[Split Amount (USD)] * [Probability (%)]', fields);

  assert.equal(calculation.evaluate(rows[1]), 9_600_000);
  assert.equal(calculation.dependencies.has('amount'), true);
  assert.equal(calculation.dependencies.has('probability'), true);
  assert.equal(calculation.source.includes('eval'), false);
});

test('runs calculations then filters then aggregation and returns stage diagnostics', () => {
  const result = executeQuery({
    rows,
    fields,
    calculations: [{ id: 'weighted', label: 'Weighted Pipeline', expression: '[Split Amount (USD)] * [Probability (%)]', type: 'currency' }],
    filters: { kind: 'condition', fieldId: 'period', operator: 'startsWith', value: 'FY27' },
    dimensions: ['stage'],
    measure: 'weighted',
    aggregation: 'sum',
  });

  assert.deepEqual(result.groups, [
    { key: ['Closed Won'], value: 19_600_000, count: 2 },
    { key: ['Pipeline'], value: 27_500_000, count: 1 },
  ]);
  assert.deepEqual(result.diagnostics, {
    sourceRows: 4,
    calculatedRows: 4,
    filteredRows: 3,
    excludedRows: 1,
    invalidCalculations: 0,
    omittedGroups: 0,
  });
});

test('rejects unsafe or unknown calculated expressions with a source position', () => {
  assert.throws(
    () => compileCalculation('window.alert([Split Amount (USD)])', fields),
    /position 6|unknown identifier/i,
  );
});

test('calculated fields propagate blanks instead of silently creating zero or 1970 dates', () => {
  const amount = compileCalculation('[Split Amount (USD)] * 2', fields);
  const year = compileCalculation('YEAR([Actual Close Period (13P)])', fields);
  assert.equal(amount.evaluate({ amount: null }), null);
  assert.equal(year.evaluate({ period: null }), null);
});
