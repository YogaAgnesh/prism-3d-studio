import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { compileFilter } from '../src/query/filter-compiler.js';

test('filters the certified 100,000-row boundary within the interactive performance budget', () => {
  const fields = [
    { id: 'period', label: 'Actual Close Period (13P)', type: 'text', semanticType: 'fiscalPeriod' },
    { id: 'amount', label: 'Split Amount (USD)', type: 'currency', semanticType: 'currency' },
  ];
  const rows = Array.from({ length: 100_000 }, (_, index) => ({
    period: index % 2 ? 'FY27 - P01' : 'FY26 - P13',
    amount: index * 1_000,
  }));
  const predicate = compileFilter({
    kind: 'group', conjunction: 'and', children: [
      { kind: 'condition', fieldId: 'period', operator: 'startsWith', value: 'FY27' },
      { kind: 'condition', fieldId: 'amount', operator: 'between', value: 10_000_000, value2: 50_000_000 },
    ],
  }, fields);

  const started = performance.now();
  const included = rows.filter(predicate);
  const elapsed = performance.now() - started;

  assert.equal(included.length, 20_000);
  assert.ok(elapsed < 2_000, `100,000-row filter took ${elapsed.toFixed(1)} ms`);
});
