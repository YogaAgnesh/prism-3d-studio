import test from 'node:test';
import assert from 'node:assert/strict';

import { coerceFieldValue, formatFieldValue, inferColumnType } from '../src/data-types.js';

const cell = (value, format = 'General', rawType) => ({
  value,
  format,
  rawType: rawType ?? (typeof value === 'number' ? 'n' : typeof value === 'boolean' ? 'b' : 's'),
});

test('infers Salesforce names as text and ignores blanks', () => {
  const result = inferColumnType([cell('Jupiter Holdings'), cell(null), cell('Acme Corp')]);
  assert.equal(result.type, 'text');
  assert.equal(result.nonEmptyCount, 2);
});

test('infers ordinary numeric measures as number', () => {
  const result = inferColumnType([cell(12), cell(19.5, '#,##0.0'), cell(0)]);
  assert.equal(result.type, 'number');
});

test('uses the Excel number format to distinguish USD currency', () => {
  const result = inferColumnType([
    cell(4200000, '$#,##0.00'),
    cell(975000, '$#,##0.00'),
  ]);
  assert.equal(result.type, 'currency');
  assert.equal(result.currency, 'USD');
});

test('uses the Excel number format to distinguish percentages', () => {
  const result = inferColumnType([cell(0.73, '0.0%'), cell(0.4, '0%')]);
  assert.equal(result.type, 'percent');
});

test('recognizes Excel date serials only when a date format is present', () => {
  const result = inferColumnType([cell(45524, 'm/d/yy'), cell(45602, 'dd-mmm-yyyy')]);
  assert.equal(result.type, 'date');
});

test('recognizes boolean columns', () => {
  const result = inferColumnType([cell(true), cell(false), cell(true)]);
  assert.equal(result.type, 'boolean');
});

test('formats currency, percentage, and date values for preview', () => {
  assert.equal(formatFieldValue(1234.5, { type: 'currency', currency: 'USD' }), '$1,234.50');
  assert.equal(formatFieldValue(0.426, { type: 'percent' }), '42.6%');
  assert.equal(formatFieldValue(new Date('2026-08-20T00:00:00Z'), { type: 'date' }), '20 Aug 2026');
});

test('coerces accounting negatives and trailing-minus currency without flipping their sign', () => {
  const currency = { type: 'currency', currency: 'USD' };
  assert.equal(coerceFieldValue('(1,234.50)', currency), -1234.5);
  assert.equal(coerceFieldValue('$2,500-', currency), -2500);
});
