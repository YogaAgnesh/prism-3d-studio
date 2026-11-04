import { parseNumericValue, coerceFieldValue } from './data-types.js';

const OPERATIONS = new Set(['sum', 'average', 'count', 'minimum', 'maximum']);

function dimensionValue(value, field) {
  if (value === null || value === undefined || value === '') return 'Unspecified';
  if (field) value = coerceFieldValue(value,field);
  if (value === null) return 'Unspecified';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function numericValue(value) {
  return parseNumericValue(value);
}

export function aggregateRows(rows = [], dimensions = [], measure, operation = 'sum', limit = Infinity, field, dimensionFields = []) {
  if (!OPERATIONS.has(operation)) throw new Error(`Unsupported aggregation operation: ${operation}`);
  const buckets = new Map();

  for (const row of rows) {
    const key = dimensions.map((dimension,index) => dimensionValue(row?.[dimension],dimensionFields[index]));
    const serializedKey = JSON.stringify(key);
    const number = field ? coerceFieldValue(row?.[measure], field) : numericValue(row?.[measure]);
    if (operation !== 'count' && number === null) continue;

    if (!buckets.has(serializedKey)) buckets.set(serializedKey, { key, numbers: [], rowCount: 0 });
    const bucket = buckets.get(serializedKey);
    bucket.rowCount += 1;
    if (number !== null) bucket.numbers.push(number);
  }

  let groups = [...buckets.values()].map((bucket) => {
    let value;
    if (operation === 'count') value = bucket.rowCount;
    if (operation === 'sum') value = bucket.numbers.reduce((sum, number) => sum + number, 0);
    if (operation === 'average') value = bucket.numbers.reduce((sum, number) => sum + number, 0) / bucket.numbers.length;
    if (operation === 'minimum') value = Math.min(...bucket.numbers);
    if (operation === 'maximum') value = Math.max(...bucket.numbers);
    return { key: bucket.key, value, count: operation === 'count' ? bucket.rowCount : bucket.numbers.length };
  });

  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : groups.length;
  const omittedGroups = Math.max(0, groups.length - normalizedLimit);
  if (omittedGroups > 0) {
    groups = groups.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, normalizedLimit);
  }

  return {
    groups,
    keys: groups.map((group) => group.key.join(' · ')),
    values: groups.map((group) => group.value),
    sourceRows: rows.length,
    omittedGroups,
  };
}
