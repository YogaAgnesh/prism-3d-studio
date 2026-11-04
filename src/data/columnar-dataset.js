import { coerceFieldValue } from '../data-types.js';

const NUMERIC_TYPES = new Set(['number', 'currency', 'percent', 'duration']);
const DATE_TYPES = new Set(['date', 'dateTime']);

function kindFor(field) {
  const semantic = field.semanticType ?? field.type;
  if (NUMERIC_TYPES.has(semantic)) return 'number';
  if (DATE_TYPES.has(semantic)) return 'date';
  if (semantic === 'boolean') return 'boolean';
  return 'dictionary';
}

export function createColumnVector(field, sourceValues = []) {
  const kind = kindFor(field);
  if (kind === 'number' || kind === 'date') {
    const values = new Float64Array(sourceValues.length);
    const valid = new Uint8Array(sourceValues.length);
    sourceValues.forEach((source, index) => {
      const converted = kind === 'date'
        ? coerceFieldValue(source, { type: 'date' })
        : coerceFieldValue(source, { type: field.type ?? field.semanticType });
      const numeric = converted instanceof Date ? converted.valueOf() : converted;
      if (typeof numeric === 'number' && Number.isFinite(numeric)) {
        values[index] = numeric;
        valid[index] = 1;
      }
    });
    return { kind, values, valid };
  }
  if (kind === 'boolean') {
    const values = new Int8Array(sourceValues.length).fill(-1);
    sourceValues.forEach((source, index) => {
      if (source === null || source === undefined || source === '') return;
      values[index] = coerceFieldValue(source, { type: 'boolean' }) ? 1 : 0;
    });
    return { kind, values };
  }
  const dictionary = [];
  const lookup = new Map();
  const codes = new Int32Array(sourceValues.length).fill(-1);
  sourceValues.forEach((source, index) => {
    if (source === null || source === undefined || source === '') return;
    const value = source instanceof Date ? source.toISOString() : String(source);
    if (!lookup.has(value)) {
      lookup.set(value, dictionary.length);
      dictionary.push(value);
    }
    codes[index] = lookup.get(value);
  });
  return { kind, codes, dictionary };
}

export function createColumnarDataset({ fields = [], columns = {}, rowCount = 0, sheetName = '' } = {}) {
  return { fields, columns, rowCount, sheetName };
}

export function createColumnarDatasetFromRows(fields = [], rows = [], sheetName = '') {
  const columns = Object.fromEntries(fields.map((field) => [
    field.id,
    createColumnVector(field, rows.map((row) => row?.[field.id] ?? null)),
  ]));
  return createColumnarDataset({ fields, columns, rowCount: rows.length, sheetName });
}

export function valueAt(dataset, fieldId, rowIndex) {
  const column = dataset?.columns?.[fieldId];
  if (!column || rowIndex < 0 || rowIndex >= dataset.rowCount) return null;
  if (column.kind === 'dictionary') return column.codes[rowIndex] < 0 ? null : column.dictionary[column.codes[rowIndex]];
  if (column.kind === 'boolean') return column.values[rowIndex] < 0 ? null : Boolean(column.values[rowIndex]);
  if (!column.valid[rowIndex]) return null;
  return column.kind === 'date' ? new Date(column.values[rowIndex]) : column.values[rowIndex];
}

export function previewRows(dataset, offset = 0, limit = 100) {
  const end = Math.min(dataset.rowCount, Math.max(0, offset) + Math.max(0, limit));
  return Array.from({ length: Math.max(0, end - offset) }, (_, position) => {
    const index = offset + position;
    return Object.fromEntries(dataset.fields.map((field) => [field.id, valueAt(dataset, field.id, index)]));
  });
}

export function estimateDatasetBytes(dataset) {
  return Object.values(dataset?.columns ?? {}).reduce((total, column) => {
    const typed = (column.values?.byteLength ?? 0) + (column.valid?.byteLength ?? 0) + (column.codes?.byteLength ?? 0);
    const strings = (column.dictionary ?? []).reduce((sum, value) => sum + String(value).length * 2, 0);
    return total + typed + strings;
  }, 0);
}
