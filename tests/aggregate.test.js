import test from 'node:test';
import assert from 'node:assert/strict';

import { aggregateRows } from '../src/aggregate.js';

const rows = [
  { stage: 'Discover', region: 'US', amount: 100 },
  { stage: 'Discover', region: 'US', amount: 50 },
  { stage: 'Develop', region: 'US', amount: 80 },
  { stage: 'Develop', region: 'UK', amount: 20 },
  { stage: 'Close', region: 'US', amount: null },
];

test('aggregates sum and average across multiple category dimensions', () => {
  const sum = aggregateRows(rows, ['stage', 'region'], 'amount', 'sum');
  assert.deepEqual(sum.groups, [
    { key: ['Discover', 'US'], value: 150, count: 2 },
    { key: ['Develop', 'US'], value: 80, count: 1 },
    { key: ['Develop', 'UK'], value: 20, count: 1 },
  ]);

  const average = aggregateRows(rows, ['stage'], 'amount', 'average');
  assert.deepEqual(average.groups, [
    { key: ['Discover'], value: 75, count: 2 },
    { key: ['Develop'], value: 50, count: 2 },
  ]);
});

test('supports count, minimum, and maximum operations', () => {
  const count = aggregateRows(rows, ['region'], 'amount', 'count');
  assert.deepEqual(count.values, [4, 1]);

  const minimum = aggregateRows(rows, ['stage'], 'amount', 'minimum');
  assert.deepEqual(minimum.values, [50, 20]);

  const maximum = aggregateRows(rows, ['stage'], 'amount', 'maximum');
  assert.deepEqual(maximum.values, [100, 80]);
});

test('sorts limited results by significance and reports omitted groups', () => {
  const result = aggregateRows(rows, ['stage', 'region'], 'amount', 'sum', 2);
  assert.deepEqual(result.values, [150, 80]);
  assert.equal(result.omittedGroups, 1);
  assert.equal(result.sourceRows, 5);
});

test('labels missing dimensions and ignores invalid numeric measures', () => {
  const result = aggregateRows([
    { stage: null, amount: 10 },
    { stage: '', amount: 'not a number' },
    { stage: null, amount: 5 },
  ], ['stage'], 'amount', 'sum');
  assert.deepEqual(result.groups, [{ key: ['Unspecified'], value: 15, count: 2 }]);
});

