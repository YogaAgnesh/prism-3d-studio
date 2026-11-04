import test from 'node:test';
import assert from 'node:assert/strict';

import { CHART_SCHEMAS, isFieldCompatible, validateMappings } from '../src/chart-schemas.js';

const field = (id, type) => ({ id, label: id, type });

test('exposes only the four focused 3D chart styles', () => {
  assert.deepEqual(Object.keys(CHART_SCHEMAS), ['bubble', 'columns', 'lollipop', 'surface']);
  assert.equal(CHART_SCHEMAS.line, undefined);
});

test('recognizes compatible measure, category, and temporal field groups', () => {
  assert.equal(isFieldCompatible('currency', ['measure']), true);
  assert.equal(isFieldCompatible('percent', ['measure']), true);
  assert.equal(isFieldCompatible('text', ['category']), true);
  assert.equal(isFieldCompatible('date', ['temporal']), true);
  assert.equal(isFieldCompatible('text', ['measure']), false);
});

test('validates a 3D Bubble mapping and reports a missing required axis', () => {
  const mappings = {
    x: field('Probability (%)', 'percent'),
    y: field('Split Amount (USD)', 'currency'),
    z: field('Advise Amount', 'number'),
  };
  assert.deepEqual(validateMappings('bubble', mappings), { valid: true, errors: [], missing: [], incompatible: [] });

  const invalid = validateMappings('bubble', { x: mappings.x, y: mappings.y });
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.missing, ['z']);
  assert.match(invalid.errors[0], /Z axis/i);
});

test('accepts text dimensions on bubble X and Y for portfolio cross-sections', () => {
  const bubble = validateMappings('bubble', {
    x: field('Account Name', 'text'),
    y: field('Probability (%)', 'percent'),
    z: field('Split Amount (USD)', 'currency'),
  });
  assert.equal(bubble.valid, true);

  const columns = validateMappings('columns', {
    x: field('Stage', 'text'),
    series: field('Geography', 'text'),
    z: field('Split Amount (USD)', 'currency'),
  });
  assert.equal(columns.valid, true);
});
