import test from 'node:test';
import assert from 'node:assert/strict';
import { profileColumn } from '../src/semantic/profile-column.js';
import { createColumnarDatasetFromRows, valueAt } from '../src/data/columnar-dataset.js';
import { previewTypeOverride, applyTypeOverride } from '../src/semantic/type-override.js';

test('semantic profiling protects identifiers and recognizes Salesforce fiscal periods', () => {
  const identifier = profileColumn({ id: 'c0', label: 'Opportunity ID' }, [
    { value: 100001, rawType: 'n', format: '0' },
    { value: 100002, rawType: 'n', format: '0' },
  ]);
  const fiscal = profileColumn({ id: 'c1', label: 'Actual Close Period (13P)' }, [
    { value: 'FY26 - P12' },
    { value: 'FY27 - P01' },
  ]);

  assert.equal(identifier.semanticType, 'identifier');
  assert.equal(identifier.defaultAggregation, 'distinctCount');
  assert.equal(identifier.roleKind, 'dimension');
  assert.equal(fiscal.semanticType, 'fiscalPeriod');
  assert.equal(fiscal.sortStrategy, 'fiscal');
  assert.equal(fiscal.confidence >= 0.8, true);
});

test('semantic profiling reports mixed quality without silently discarding evidence', () => {
  const result = profileColumn({ id: 'c2', label: 'Split Amount (USD)' }, [
    { value: 12_000_000, rawType: 'n', format: '$#,##0' },
    { value: '$25,000,000', rawType: 's' },
    { value: 'not available', rawType: 's' },
    { value: null },
  ]);

  assert.equal(result.semanticType, 'currency');
  assert.equal(result.currency, 'USD');
  assert.equal(result.quality.invalidCount, 1);
  assert.equal(result.quality.nullCount, 1);
  assert.equal(result.defaultAggregation, 'sum');
});

test('recognizes numeric CSV strings using Salesforce currency and percent column names', () => {
  const amount = profileColumn({ id: 'amount', label: 'Split Amount (USD)' }, [
    { value: '1280000', rawType: 's' }, { value: '2400000', rawType: 's' },
  ]);
  const probability = profileColumn({ id: 'prob', label: 'Probability (%)' }, [
    { value: '0.25', rawType: 's' }, { value: '0.8', rawType: 's' },
  ]);

  assert.equal(amount.semanticType, 'currency');
  assert.equal(amount.type, 'currency');
  assert.equal(amount.currency, 'USD');
  assert.equal(probability.semanticType, 'percent');
});

test('columnar datasets use typed vectors and dictionary encoding with reversible access', () => {
  const fields = [
    { id: 'amount', label: 'Amount', semanticType: 'currency', type: 'currency' },
    { id: 'stage', label: 'Stage', semanticType: 'category', type: 'text' },
    { id: 'close', label: 'Close', semanticType: 'date', type: 'date' },
  ];
  const dataset = createColumnarDatasetFromRows(fields, [
    { amount: 10, stage: 'Closed Won', close: '2026-01-02' },
    { amount: null, stage: 'Pipeline', close: null },
    { amount: 30, stage: 'Closed Won', close: '2026-03-04' },
  ]);

  assert.equal(dataset.rowCount, 3);
  assert.equal(dataset.columns.amount.values instanceof Float64Array, true);
  assert.equal(dataset.columns.stage.codes instanceof Int32Array, true);
  assert.deepEqual(dataset.columns.stage.dictionary, ['Closed Won', 'Pipeline']);
  assert.equal(valueAt(dataset, 'amount', 1), null);
  assert.equal(valueAt(dataset, 'stage', 2), 'Closed Won');
  assert.equal(valueAt(dataset, 'close', 0).toISOString().slice(0, 10), '2026-01-02');
});

test('type overrides preview failures and preserve the inferred type for undo', () => {
  const field = { id: 'probability', label: 'Probability (%)', type: 'text', semanticType: 'category' };
  const cells = ['25%', '0.5', 'unknown', null];
  const preview = previewTypeOverride(field, cells, 'percent');
  const overridden = applyTypeOverride(field, preview);

  assert.equal(preview.convertedCount, 2);
  assert.equal(preview.invalidCount, 1);
  assert.equal(preview.nullCount, 1);
  assert.equal(overridden.type, 'percent');
  assert.equal(overridden.semanticType, 'percent');
  assert.equal(overridden.inferredType, 'text');
  assert.equal(overridden.override.active, true);
});
